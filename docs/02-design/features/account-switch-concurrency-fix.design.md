# account-switch-concurrency-fix Design Document

> **Summary**: 안전하게 적용 가능한 순간에만 스위치를 적용하고(그 외에는 예약), 크로스 프로세스 락·최신 토큰 채택·쓰기 후 검증으로 "성공했다고 보고했지만 되돌려진" 상태를 제거한다.
>
> **Project**: claude-code-multi-accounts
> **Version**: 0.3.10 → 0.4.0
> **Author**: trkim (with Claude)
> **Date**: 2026-08-04
> **Status**: Phase 1 구현 완료
> **Planning Doc**: [account-switch-concurrency-fix.plan.md](../../01-plan/features/account-switch-concurrency-fix.plan.md)

---

## Context Anchor

| Key | Value |
|-----|-------|
| **WHY** | 실행 중 CC가 `.claude.json`을 되써 `oauthAccount` 교체를 무효화 → 토큰/계정 불일치로 재로그인 강제 |
| **WHO** | CC 내부(`!ccs N`) 및 터미널에서 다계정을 전환하는 Windows 사용자 |
| **RISK** | "실행 중이면 거부"가 기존 워크플로를 막음 → 예약 스위치 + PATH 등록으로 동시 완화 |
| **SUCCESS** | 성공 보고 시 실제로 성공(재로그인 0회), 불가능하면 성공으로 보고하지 않음, 터미널에서 `ccs` 인식 |
| **SCOPE** | Phase 1: 예약·락·검증·분류·PATH → Phase 2: CLAUDE_CONFIG_DIR 격리 |

---

## 1. Overview

### 1.1 Design Goals

1. **정직한 결과 보고**: 적용을 확인하지 못하면 실패로 보고한다. exit 0 + "Switched"는 검증을 통과한 경우에만.
2. **되돌림 원천 차단**: 되돌릴 주체(실행 중 CC)가 있으면 적용하지 않고 의도만 예약한다.
3. **단일사용 토큰 보호**: 락 안에서 읽고, 회전된 토큰을 즉시 영속화하며, 폐기된 토큰은 재시도하지 않는다.
4. **사용 가능한 대안 제공**: 거부·예약 시 정확히 무엇을 하면 되는지 알려주고, 그 경로(터미널 `ccs`)가 실제로 동작하게 만든다.

### 1.2 Design Principles

- 실패는 조용히 넘어가지 않는다(silent success 금지)
- 상태 변경은 락 안에서만, 읽기도 락 안에서(오래된 스냅샷으로 판단 금지)
- 예약은 라이브 파일을 건드리지 않는다
- 순수 판정 로직(guard)과 부수효과(io/refresh/proc)를 분리 유지

---

## 2. Architecture

### 2.1 Component Diagram

```
cc-switch.cjs (entry)
  ├─ cancel → staged.clearStagedSwitch                     (락 불필요)
  └─ withLock(store/lock.cjs) ── run()
       ├─ read live config/credentials/store  ← 락 안에서 읽어 최신 토큰 확보 (FR-04)
       ├─ syncStoreFromLive (identity 가드)
       ├─ 셀렉터 없음 → 예약 있으면 적용 시도 / 없으면 목록 + reportSlotHealth
       └─ 셀렉터 있음 → runSwitchAction → runSwitchPipeline
```

### 2.2 Switch Pipeline (Stage 순서)

```
1. detectClaudeSessions()
     count>0 && !--force → abort 'sessions-running' (라이브·스토어 무변경)
                            → switch.cjs가 예약 기록 후 안내, exit 1
     count>0 && --force   → 경고 출력 후 계속
2. assessCredentials()
     'refresh-expired' → 슬롯 needsReauth 표식 + writeStore → abort
3. 리프레시 (필요 시에만)
     쿨다운 활성 → abort 'rate-limited' (요청 없이)
     429 → 쿨다운 시작 후 abort
     400/401 → needsReauth 표식 + writeStore → abort 'revoked'
4. writeStore  ← 회전된 refresh 토큰을 라이브보다 먼저 영속화
5. writeLiveState (원자적 + claudeAiOauth 병합)
6. verifyLiveState  ← 되읽어 accountUuid/accessToken 일치 확인
     불일치 → abort 'verify-failed' (성공 보고 금지)
```

### 2.3 Staged Switch Flow

```
[CC 내부]  !ccs 2
   → sessions-running abort
   → settings.stagedSwitch = { key, emailAddress, stagedAt }
   → "Cannot switch now … Staged switch to [2] … run: ccs / cancel: ccs cancel", exit 1

[터미널]  ccs            (세션 0개)
   → 예약 발견 → 슬롯 재해석(인덱스 변동/삭제 대응)
   → 적용 성공 → 예약 삭제
   → 대상 슬롯이 사라짐 → 안내 후 예약 폐기(self-healing)
```

---

## 3. Data Model

```js
// ~/.claude/multi-account-switch/settings.json (기존 파일 재사용)
{
  showUsage: boolean,
  rateLimitResetAt: string,      // 기존 usage 표시용
  tokenCooldownUntil: string,    // 신규: 토큰 엔드포인트 429 쿨다운 (5분)
  stagedSwitch: {                // 신규: 예약 스위치
    key: string,                 // 슬롯 key (uuid:… / email:…)
    emailAddress: string,
    stagedAt: string             // ISO
  }
}

// 스토어 계정 엔트리 (기존 스키마 + 1 필드)
{ …기존…, needsReauth?: true }   // 폐기/만료된 refresh 토큰 표식, 성공 시 제거
```

### 3.1 Lock

```
~/.claude/multi-account-switch/switch.lock/        ← mkdir 원자성 이용
  holder.json { pid, acquiredAt }
획득 타임아웃 10s (100ms 폴링), stale 60s 초과 시 자동 해제
```

---

## 4. API Specification

토큰 엔드포인트 계약은 1차 사이클(`account-switch-relogin-fix.design.md` §4)과 동일하며 변경 없음.
본 사이클에서 추가된 운영 규칙:

| 응답 | 처리 | 상태 변화 |
|------|------|-----------|
| 200 | 병합 후 스토어 선영속화 → 라이브 | needsReauth 제거 |
| 400 / 401 | abort 'revoked' | 슬롯 `needsReauth = true` 영속화 |
| 429 | abort 'rate-limited' | `tokenCooldownUntil = now + 5min` (전 계정 공통, per-IP 제한이므로) |
| 404 / 403 / 5xx | 폴백 호스트 1회 → abort | 없음 |
| 네트워크/타임아웃 | 폴백 호스트 1회 → abort | 없음 |

쿨다운이 활성일 때는 **요청을 보내지 않고** 즉시 중단한다(제한 창을 깊게 만들지 않기 위함).

---

## 5. CLI UX

### 5.1 신규/변경 커맨드

| 커맨드 | 동작 |
|--------|------|
| `ccs <n>` | 세션 없으면 즉시 적용(검증 포함), 있으면 예약 + 안내(exit 1) |
| `ccs <n> --force` / `-f` | 세션이 있어도 강행(경고 출력, 검증은 그대로 수행) |
| `ccs` | 예약 있으면 적용, 없으면 목록 + 슬롯 건강 경고 |
| `ccs cancel` | 예약 폐기 |

### 5.2 Message Checklist

#### 세션 실행 중 (예약)
- [ ] 왜 지금 못 하는지 1줄 (`.claude.json`을 되쓰기 때문)
- [ ] 예약 대상 표시 + 적용 방법(`ccs`) + 취소 방법(`ccs cancel`)
- [ ] "Switched" 문구 미출력, exit 1

#### 검증 실패
- [ ] 무엇이 되돌려졌는지(oauthAccount / credentials) 명시
- [ ] 모든 CC 창을 닫고 터미널에서 재시도 안내
- [ ] exit 1

#### 슬롯 건강 (목록)
- [ ] `needsReauth` 슬롯: /login 후 `ccs sync` 안내
- [ ] refresh 하드 만료 3일 이내: 남은 일수 경고

---

## 6. Error Handling

| 상황 | code | 라이브 | 스토어 |
|------|------|:------:|:------:|
| 세션 실행 중(비강제) | `sessions-running` | 무변경 | 무변경(+예약 기록) |
| refresh 로컬 만료 | `refresh-expired` | 무변경 | needsReauth |
| 서버 폐기(400/401) | `revoked` | 무변경 | needsReauth |
| 쿨다운/429 | `rate-limited` | 무변경 | 무변경 |
| 프로토콜/네트워크 | `protocol`/`network` | 무변경 | 무변경 |
| 쓰기 후 불일치 | `verify-failed` | 기록됨(되돌려짐) | 기록됨 |
| 락 획득 실패 | (throw) | 무변경 | 무변경 |

---

## 7. Security Considerations

- [ ] 토큰 값 비노출 유지 (예약 기록에도 토큰 미포함 — key/email/시각만)
- [ ] 락 holder에 pid/시각만 기록
- [ ] PATH 등록은 사용자 범위(HKCU)만, 멱등, uninstall에서 제거
- [ ] `CC_SWITCH_SESSION_COUNT`는 감지 우회용 진단 스위치 — 자격증명 검증에는 영향 없음

---

## 8. Test Plan

### 8.1 L1 단위 (신규/변경)

| # | 대상 | 검증 |
|---|------|------|
| 1 | guard.getRefreshExpiryStatus | 만료/3일 이내/여유/필드 없음 4케이스 |
| 2 | pipeline sessions-running | count>0 → abort, 파일 무변경 |
| 3 | pipeline --force | 세션 있어도 진행 |
| 4 | pipeline verify-failed | 쓰기 후 외부가 되돌리면 실패 보고 |
| 5 | pipeline revoked | needsReauth 영속화 + 라이브 무변경 |
| 6 | pipeline 쿨다운 | 활성 시 요청 0회, 429 시 쿨다운 시작 |
| 7 | pipeline 성공 | needsReauth 해제, 스토어→라이브 순서 |
| 8 | lock | 동시 획득 배타성, stale 자동 해제 |

### 8.2 L2 CLI 통합

| # | 시나리오 | 검증 |
|---|----------|------|
| 1 | 세션 3개 + `ccs 0` | 거부 + 예약 기록, 라이브 무변경, exit 1, "Switched" 미출력 |
| 2 | 예약 후 세션 0개 + `ccs` | 자동 적용, 예약 삭제 |
| 3 | 예약 후 `ccs cancel` | 예약 폐기 |
| 4 | 기존 회귀 | 스위치/중단/sync 기존 동작 유지 |

> 세션 수는 `CC_SWITCH_SESSION_COUNT`로 고정하고, 설정 파일 오염 방지를 위해 테스트는 `HOME`/`USERPROFILE`을 임시 디렉터리로 고정한다.

### 8.3 L3 실환경 (사용자 확인)

| # | 시나리오 | 기준 |
|---|----------|------|
| 1 | CC 안에서 `!ccs N` | 예약 안내 출력, 재로그인 유발 없음 |
| 2 | CC 전부 종료 → 터미널 `ccs` | 예약 적용 + 재시작 시 재로그인 없음 |
| 3 | 새 PowerShell에서 `ccs` | 명령 인식 |

---

## 9. Clean Architecture

| Layer | Module | 상태 |
|-------|--------|------|
| Presentation | `lib/output/messages.cjs` | 확장 |
| Application | `lib/actions/switch.cjs`, `switch-pipeline.cjs`, `staged.cjs` | 확장/신규 |
| Domain | `lib/auth/guard.cjs` (순수) | 확장 |
| Infrastructure | `lib/store/{io,lock}.cjs`, `lib/auth/refresh.cjs`, `lib/proc/sessions.cjs`, `lib/usage/cache.cjs` | 확장/신규 |

의존 규칙 유지: `guard`는 어떤 모듈도 import하지 않음, `refresh`는 https만, `staged`는 주입된 설정 IO만 사용.

---

## 10. Implementation Status (Phase 1)

| 항목 | 파일 | 상태 |
|------|------|:----:|
| FR-01 거부/예약 | `switch-pipeline.cjs`, `switch.cjs`, `staged.cjs`, `messages.cjs` | ✅ |
| FR-02 쓰기 후 검증 | `io.cjs verifyLiveState`, pipeline stage 6 | ✅ |
| FR-03 크로스 프로세스 락 | `lib/store/lock.cjs`, `cc-switch.cjs` | ✅ |
| FR-04 최신 토큰 채택 | 락 안에서 읽기(`run()`) | ✅ |
| FR-05 실패 분류/표식 | pipeline, `cache.cjs` 쿨다운 | ✅ |
| FR-06 만료 카운트다운 | `guard.getRefreshExpiryStatus`, `reportSlotHealth` | ✅ |
| FR-07 PATH 등록 | `install.cjs`, `uninstall.cjs` | ✅ |
| FR-11 예약 자동 적용 | `lib/actions/watcher.cjs`, `cc-switch.cjs --watch-apply` | ✅ |
| FR-08~10 격리 모드 | — | Phase 2 |

### 10.1 Staged Auto-Apply (FR-11)

예약만으로는 사용자가 다시 터미널로 돌아와야 하므로, 예약 시 detached 감시자를 띄운다.

```
ccs <n> (세션 있음)
  → 예약 기록 + spawnWatcher (detached, stdio ignore, unref)
  → settings.watcher = { pid, startedAt }   ← 중복 기동 방지(pid 생존 확인)

감시자 루프 (5초 폴링, 최대 6시간)
  ├ 예약 사라짐        → 'cancelled' 종료
  ├ 최대 대기 초과      → 'timeout' 종료
  └ 세션 수 0           → 예약 재확인(슬립 중 취소 대비) → 락 획득 → 적용
                          검증 통과로 예약이 삭제되었는지로 성패 판정
  종료 시 settings.watcher 제거
```

`--no-watch`로 감시자 없이 예약만 할 수 있다(테스트/CI용).

---

## Version History

| Version | Date | Changes | Author |
|---------|------|---------|--------|
| 0.1 | 2026-08-04 | Phase 1 설계 + 구현 반영 (예약 스위치 Checkpoint 3 선택) | trkim + Claude |
