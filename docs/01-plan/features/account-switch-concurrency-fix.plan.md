# account-switch-concurrency-fix Planning Document

> **Summary**: 실행 중인 Claude Code 세션이 `.claude.json`을 통째로 되쓰면서 계정 스위치를 무효화하는 문제를, 1단계 스와프 경로 강화(락·검증·안전 거부·PATH 수정)와 2단계 계정별 `CLAUDE_CONFIG_DIR` 격리로 해결한다.
>
> **Project**: claude-code-multi-accounts
> **Version**: 0.3.10 → 0.4.0 (예정)
> **Author**: trkim (with Claude)
> **Date**: 2026-08-04
> **Status**: Draft
> **선행 사이클**: [account-switch-relogin-fix](./account-switch-relogin-fix.plan.md) (v0.3.10, 토큰 만료 원인 해결 — 유효하며 유지)

---

## Executive Summary

| Perspective | Content |
|-------------|---------|
| **Problem** | v0.3.10에서 "죽은 토큰 복원" 원인은 해결됐으나 재로그인이 계속됨. 실제 원인은 **동시 실행 세션**: 실행 중인 CC가 `.claude.json` 전체를 주기적으로 되쓰며 우리가 교체한 `oauthAccount`를 이전 계정으로 되돌리고(`.credentials.json`은 새 계정 토큰 유지) → 토큰↔계정 불일치 → `/login` 강제. 사용자는 CC 내부에서 `!ccs N`으로 실행하므로 스위치 시점에 CC가 **항상** 실행 중 → 100% 재현 |
| **Solution** | 1단계: 스와프 경로를 안전하게 — 실행 세션 감지 시 기본 거부(`--force` 제공), 크로스 프로세스 락, 쓰기 후 검증, 최신 토큰 채택, `invalid_grant` 분류, 만료 임박 경고, 그리고 터미널에서 실행 가능하도록 PATH 등록. 2단계: 계정별 `CLAUDE_CONFIG_DIR` 격리 모드로 파일 교체 자체를 제거 |
| **Function/UX Effect** | 1단계에서 "조용한 실패"가 사라지고(안전하지 않으면 거부하고 이유를 설명), 터미널에서 정상 실행 가능. 2단계에서 여러 계정 동시 사용 가능 + 세션 간 간섭 원천 차단 |
| **Core Value** | 스위치 결과를 신뢰할 수 있게 만든다 — 성공하면 실제로 성공이고, 불가능하면 즉시 알려준다 |

---

## Context Anchor

| Key | Value |
|-----|-------|
| **WHY** | 실행 중 CC가 `.claude.json`을 되써 `oauthAccount` 교체를 무효화 → 토큰/계정 불일치로 재로그인 강제 |
| **WHO** | CC 내부(`!ccs N`) 및 터미널에서 다계정을 전환하는 Windows 사용자 |
| **RISK** | 1단계의 "실행 중이면 거부"가 기존 `!ccs` 워크플로를 막음 → PATH 수정과 명확한 안내를 동시 제공해야 함. 격리 모드는 CC 실행 방법을 바꿈 |
| **SUCCESS** | 스위치 성공 보고 시 CC 재시작 후 재로그인 0회. 불가능한 상황은 성공으로 보고하지 않음. 터미널에서 `ccs` 인식 |
| **SCOPE** | Phase 1: 스와프 강화 + PATH → Phase 2: CLAUDE_CONFIG_DIR 격리 모드 |

---

## 1. Overview

### 1.1 Purpose

스위치가 "성공"이라고 보고했는데 실제로는 되돌려지는 상황을 제거한다. 안전하게 적용 가능할 때만 적용하고, 불가능하면 명확히 거부하며, 근본적으로는 파일 교체가 필요 없는 격리 구조를 제공한다.

### 1.2 Background — 재발 원인 조사 결과 (2026-08-04)

**확정된 원인**
- 실행 중 CC가 `.claude.json`을 수시로 전체 rewrite (오늘 mtime 16:30, 마지막 실제 스위치는 7/28 — 백업 기록으로 확인). 메모리 상 이전 계정의 `oauthAccount`가 파일에 되쓰임
- 현재 `claude.exe` 3개 동시 실행 중이며 도구의 감지기는 이를 정확히 감지하나 **경고 후 진행**하도록 되어 있음(1차 사이클 선택)
- CC 2.1.221 체인지로그도 동종 레이스(두 프로세스가 같은 토큰을 동시 갱신 → 재인증 강제)를 자사 코드에서 수정 중 — 다중 세션 환경에서 파일 스와프는 원리적으로 불안정

**기각된 가설**
- Windows Credential Manager 이관: 없음 (`cmdkey` 조회 0건, 토큰은 여전히 `.credentials.json`)
- `.claude.json`의 `userID`가 계정 결합 키: 4개 계정 모두 동일 해시 → 머신 단위 식별자
- 설치본 노후화: 설치본은 v0.3.10 수정본 그대로(리프레시 엔드포인트·백업 보존 확인)
- refresh 토큰 만료: 4개 슬롯 전부 refresh 토큰 유효(8/19~8/29)

**부수 발견**
- 설치 프로그램이 런처를 `%USERPROFILE%\bin`에 넣지만 PATH에 등록하지 않음 → Git Bash(`$HOME/bin` 자동 등록)에서만 동작, PowerShell/CMD에서 `ccs` 인식 불가
- `.credentials.json`에 신규 형제 키 `mcpOAuth` 등장(플러그인 OAuth) — 기존 병합 쓰기가 이미 보존 중이나 스토어 스냅샷에는 계정별로 섞여 저장됨
- CC 2.1.217부터 `refreshTokenExpiresAt` 3일 전 경고 — 하드 만료는 어떤 스위처로도 회피 불가

### 1.3 Related Documents

- 선행 사이클: `docs/01-plan/features/account-switch-relogin-fix.plan.md`, `docs/04-report/account-switch-relogin-fix.report.md`
- 근거: CC CHANGELOG v2.1.214/216/217/221, anthropics/claude-code#83464 #83639 #83633 #81512, claude-accounts-pool, fourth-spark#154-156/PR#162

---

## 2. Scope

### 2.1 In Scope — Phase 1 (스와프 강화 + 즉시 사용성)

- [ ] **FR-01 안전하지 않은 스위치 거부**: 실행 중 CC 세션 감지 시 기본 거부 + 이유·해결 절차 안내, `--force` 제공(위험 명시)
- [ ] **FR-02 쓰기 후 검증**: 라이브 파일 기록 직후 되읽어 `oauthAccount.accountUuid`와 `claudeAiOauth` 소유가 의도한 계정과 일치하는지 확인, 불일치 시 실패로 보고
- [ ] **FR-03 크로스 프로세스 락**: 자격증명/스토어 read-modify-write 전체 구간을 락으로 보호(락 파일 + stale 락 해제)
- [ ] **FR-04 최신 토큰 채택**: 리프레시 직전 스토어/라이브를 다시 읽어 더 최신 토큰이 있으면 그것을 사용(소비된 토큰 재POST 방지)
- [ ] **FR-05 실패 분류 및 표식**: 400 `invalid_grant` → 슬롯에 `needsReauth` 표식 저장 + 목록 표시, 429 → 5분 쿨다운, 5xx/네트워크 → 폴백/재시도
- [ ] **FR-06 만료 카운트다운**: `refreshTokenExpiresAt` 3일 이내 슬롯을 목록에서 경고 표시 (CC 2.1.217 정책과 정합)
- [ ] **FR-07 PATH 등록**: Windows 설치 시 `%USERPROFILE%\bin`을 사용자 PATH에 멱등 등록 + 셸 재시작 안내 (터미널 `ccs` 인식 문제 해결)
- [ ] **FR-11 예약 자동 적용**: 예약 시 detached 감시자를 띄워 마지막 CC 세션이 종료되는 순간 자동 적용 (사용자가 터미널로 돌아올 필요 없음). 취소 시 감시자 자동 종료, 최대 대기 6시간, 중복 기동 방지

### 2.2 In Scope — Phase 2 (격리 모드)

- [ ] **FR-08 계정별 config 디렉터리**: `~/.claude-accounts/<key>/`에 계정별 `CLAUDE_CONFIG_DIR` 구성, 기존 스토어에서 초기 시딩
- [ ] **FR-09 런처**: `ccs launch <n>` — 해당 계정 환경변수로 CC를 새로 실행. 파일 교체 없음, 동시에 여러 계정 사용 가능
- [ ] **FR-10 모드 전환/안내**: 격리 모드 활성화 여부를 설정에 저장, CC 내부에서 `!ccs N` 실행 시 격리 모드면 런처 사용법 안내

### 2.3 Out of Scope

- macOS Keychain 지원 (파일 스와프 원리상 불가)
- 스토어 평문 토큰 암호화
- 하드 만료(`refreshTokenExpiresAt` 경과) 회피 — 불가능하므로 감지·안내만
- CC 프로세스 자동 종료/재시작 (사용자 데이터 손실 위험)

---

## 3. Requirements

### 3.1 Functional Requirements

| ID | Requirement | Priority | Phase |
|----|-------------|----------|:-----:|
| FR-01 | 실행 중 CC 감지 시 스위치 거부 + 절차 안내, `--force` 우회 제공 | High | 1 |
| FR-02 | 쓰기 후 라이브 파일 되읽기 검증, 불일치 시 실패 보고(성공 위장 금지) | High | 1 |
| FR-03 | 크로스 프로세스 락(획득 실패 시 대기/타임아웃 후 거부), stale 락 자동 해제 | High | 1 |
| FR-04 | 리프레시 직전 스토어/라이브 재확인 → 더 최신 토큰 채택 | High | 1 |
| FR-05 | `invalid_grant` → `needsReauth` 표식 영속화 및 목록 표시, 429 쿨다운 | High | 1 |
| FR-06 | refresh 토큰 만료 3일 이내 경고 표시 | Medium | 1 |
| FR-07 | Windows 사용자 PATH에 `%USERPROFILE%\bin` 멱등 등록 | High | 1 |
| FR-08 | 계정별 CLAUDE_CONFIG_DIR 디렉터리 생성·시딩 | High | 2 |
| FR-09 | `ccs launch <n>` 런처(새 CC 프로세스를 해당 계정으로 실행) | High | 2 |
| FR-10 | 격리 모드 설정 저장 + CC 내부 실행 시 안내 | Medium | 2 |

### 3.2 Non-Functional Requirements

| Category | Criteria | Measurement |
|----------|----------|-------------|
| 안전성 | 어떤 실패 경로에서도 라이브 자격증명이 손상되지 않음 | 실패 주입 테스트 |
| 정직성 | 검증 실패 시 절대 "성공" 출력/exit 0 금지 | 통합 테스트 |
| 보안 | 토큰 값 비노출 유지 | 코드 리뷰 + 출력 검사 |
| 호환성 | Node 내장 모듈만, 기존 스토어 스키마 하위호환 | package.json diff, 기존 스토어 동작 |
| 멱등성 | PATH 등록 반복 실행 시 중복 없음 | 재설치 테스트 |

---

## 4. Success Criteria

### 4.1 Definition of Done

- [ ] SC-1: CC 실행 중 `!ccs N` → 성공 위장 없이 거부 + 안전한 대안 안내
- [ ] SC-2: 모든 CC 종료 후 터미널 `ccs N` → 재시작 시 재로그인 없음 (검증 통과 출력 포함)
- [ ] SC-3: PowerShell/CMD 새 창에서 `ccs` 명령 인식
- [ ] SC-4: 소비된 refresh 토큰 재사용 시도 없음 — `invalid_grant` 발생 시 슬롯이 `needsReauth`로 표시되고 라이브 무손상
- [ ] SC-5: (Phase 2) 격리 모드에서 두 계정을 동시에 실행해도 상호 간섭·재로그인 없음

### 4.2 Quality Criteria

- [ ] 신규 외부 의존성 0
- [ ] 기존 명령(list/sync/usage/remove/rename) 회귀 없음
- [ ] 테스트 추가(락, 검증, 채택, 분류, PATH 멱등)

---

## 5. Risks and Mitigation

| Risk | Impact | Likelihood | Mitigation |
|------|--------|------------|------------|
| FR-01 거부가 기존 `!ccs` 사용을 막아 체감 후퇴 | High | High | 같은 릴리즈에 FR-07(PATH) 동봉 + 거부 메시지에 정확한 대안 제시, Phase 2 격리로 근본 해소 |
| `--force` 남용으로 동일 문제 재발 | Medium | Medium | 경고 문구에 결과(재로그인) 명시, 검증(FR-02)이 실패를 즉시 노출 |
| 락이 교착/잔존해 스위치 불가 | Medium | Low | stale 락 타임아웃 자동 해제 + 명시적 해제 안내 |
| PATH 수정이 사용자 환경 변경 | Medium | Low | 사용자 범위 PATH만, 멱등, 기존 값 보존, uninstall에서 제거 |
| 격리 모드가 기존 스토어/훅과 충돌 | Medium | Medium | opt-in, 기존 경로 유지, 별도 디렉터리 사용 |

---

## 6. Impact Analysis

### 6.1 Changed Resources

| Resource | Type | Change |
|----------|------|--------|
| `lib/proc/sessions.cjs` | Module | 거부 정책 지원(상세 프로세스 정보) |
| `lib/actions/switch-pipeline.cjs` | Module | 거부/락/재확인/검증 단계 추가 |
| `lib/auth/refresh.cjs` | Module | 429 쿨다운, 실패 분류 정교화 |
| `lib/auth/guard.cjs` | Module | 만료 카운트다운, needsReauth 판정 |
| `lib/store/io.cjs` | Module | 락 프리미티브, 되읽기 검증 헬퍼 |
| `lib/store/accounts.cjs` | Module | `needsReauth` 필드 |
| `lib/output/*` | Module | 거부/검증실패/경고/needsReauth 표시 |
| `cc-switch.cjs` | Entry | `--force`, `launch` 서브커맨드 |
| `install.cjs` / `uninstall.cjs` | Installer | PATH 등록/해제 |
| `lib/isolation/*` (신규) | Module | Phase 2 격리 모드 |

### 6.2 Current Consumers

| Resource | Code Path | Impact |
|----------|-----------|--------|
| `runSwitchAction` | cc-switch.cjs main | Needs verification — 거부 결과 처리 추가 |
| `syncStoreFromLive` | main(usage/touch/list/switch), sync.cjs, session-start.cjs, statusline.cjs | Needs verification — 락 도입 영향 |
| `writeLiveState`/`writeStore` | switch-pipeline, sync/usage/remove/rename | Needs verification — 락+검증 경유 |
| 설치 런처(`ccs`, `cc-switch` 등) | `~/bin` | 변경 없음, PATH만 추가 |
| 훅(auth_success, SessionStart) | settings.json | Needs verification — 락 경합 가능성 |

### 6.3 Verification

- [ ] 모든 소비자 동작 확인
- [ ] 훅 동시 실행 시 락 경합 없음 확인
- [ ] 기존 스토어(4계정) 하위호환 확인

---

## 7. Architecture Considerations

### 7.1 Key Architectural Decisions

| Decision | Options | Selected | Rationale |
|----------|---------|----------|-----------|
| 접근 | 스와프 강화 / 격리 / 둘 다 | **둘 다 (단계적)** | 사용자 선택 — 즉시 안정화 후 근본 해결 |
| 실행 중 세션 | 경고 후 진행 / 거부 | **거부 + --force** | 1차 사이클의 "경고 후 진행"이 재발 원인. 진행 자체가 실패를 보장 |
| 실행 위치 | CC 내부 / 터미널 | **터미널 권장 + PATH 등록** | CC 내부 실행은 원리적으로 불안전 |
| 격리 저장소 | 기존 스토어 재사용 / 별도 디렉터리 | **별도 `~/.claude-accounts/`** | 기존 경로 무손상, 롤백 용이 |

### 7.2 Clean Architecture

```
lib/
  auth/{guard,refresh}.cjs      ← 판정·네트워크 (기존)
  proc/sessions.cjs             ← 세션 감지 (기존, 확장)
  store/{io,accounts}.cjs       ← 락·검증 추가
  actions/switch-pipeline.cjs   ← 거부/락/재확인/검증 단계
  isolation/                    ← Phase 2 신규
```

---

## 8. Convention Prerequisites

기존 규약 유지: CommonJS `.cjs`, Node 내장 모듈만, 토큰 값 출력 금지, 2-space JSON + trailing newline, `node --test`.

---

## 9. Next Steps

1. [ ] Design 문서 작성 (거부 UX, 락 프로토콜, 검증 절차, 격리 구조)
2. [ ] Phase 1 구현 + 테스트
3. [ ] 실환경 검증(SC-1~4) 후 Phase 2

---

## Version History

| Version | Date | Changes | Author |
|---------|------|---------|--------|
| 0.1 | 2026-08-04 | 재발 원인 조사(로컬 상태 + CC 2.1.212~221 변경 + 워크플로) 및 2단계 계획 | trkim + Claude |
