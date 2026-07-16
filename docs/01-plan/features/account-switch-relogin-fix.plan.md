# account-switch-relogin-fix Planning Document

> **Summary**: Claude Code 2026년 4~6월 인증 변경(리프레시 토큰 회전·identity 검증) 이후 계정 스위치 시 매번 재로그인이 요구되는 문제를, 복원 전 토큰 리프레시 + 안전 가드 도입으로 해결한다.
>
> **Project**: claude-code-multi-accounts
> **Version**: 0.3.9
> **Author**: trkim (with Claude)
> **Date**: 2026-07-16
> **Status**: Draft

---

## Executive Summary

| Perspective | Content |
|-------------|---------|
| **Problem** | CC v2.1.118+가 리프레시 토큰을 매 갱신마다 회전시키고 이전 토큰을 서버에서 폐기하며(v2.1.129~136: 자격증명 충돌 시 강제 로그아웃, v2.1.176~193: 토큰↔계정 identity 교차검증), 본 도구는 저장 시점의 토큰 스냅샷을 만료 검사 없이 그대로 복원하므로 스위치할 때마다 죽은/불일치 토큰이 주입되어 재로그인이 강제된다. |
| **Solution** | 복원 직전 대상 계정의 refreshToken으로 OAuth 토큰 리프레시를 수행해 살아있는 토큰을 주입하고, 실패 시 명확한 /login 안내로 폴백. 추가로 accountUuid identity 가드, 만료 검사, 원자적 쓰기(temp+rename), claudeAiOauth 병합 쓰기, 실행 중 세션 경고를 도입한다. |
| **Function/UX Effect** | 재로그인 없는 완전 자동 계정 스위치 복원. 스토어 오염(slot poisoning) 방지로 계정 데이터 신뢰성 확보. 실패 시에도 원인과 다음 행동이 명확한 에러 메시지. |
| **Core Value** | 도구의 존재 이유(원클릭 계정 전환) 복구 — 최신 CC(2.1.211+) 인증 모델과 호환되는 유일한 안전 전환 경로 제공. |

---

## Context Anchor

> Auto-generated from Executive Summary. Propagated to Design/Do documents for context continuity.

| Key | Value |
|-----|-------|
| **WHY** | CC의 토큰 회전/폐기 + identity 검증 도입으로 스냅샷 복원 방식이 무효화되어 스위치마다 재로그인 발생 |
| **WHO** | Windows 네이티브에서 다계정을 전환하는 Claude Code 사용자 (본 도구 사용자 전체) |
| **RISK** | 리프레시 API 호출 실패/仕様 변경 시 살아있는 라이브 토큰을 죽은 토큰으로 덮어쓸 수 있음 → 만료 검사 + 실패 시 복원 중단으로 완화 |
| **SUCCESS** | 스위치 후 Claude Code 재시작 시 /login 요구 없음(신선/오래된 슬롯 모두), 스토어 오염 0건 |
| **SCOPE** | Phase 1: 리프레시+가드 구현 → Phase 2: 원자적/병합 쓰기 → Phase 3: 세션 경고 + 재설치 검증 |

---

## 1. Overview

### 1.1 Purpose

계정 스위치 후 Claude Code가 재로그인을 요구하지 않도록, 복원되는 자격증명이 항상 **살아있고(identity 일치, 미만료, 미폐기)** 라이브 파일 쓰기가 **안전(원자적, 병합, 오염 방지)**하도록 스위치 파이프라인을 재설계한다.

### 1.2 Background

- 본 도구는 `~/.claude.json`의 `oauthAccount`와 `~/.claude/.credentials.json` 전체를 스냅샷/복원하는 파일 스와프 방식.
- CC 2026-04~06 릴리즈에서 인증 동작이 3단계로 강화됨:
  1. **v2.1.118** (2026-04-22): 리프레시 토큰 회전 + 서버측 폐기 — 스냅샷 토큰은 라이브 세션이 한 번이라도 리프레시하면 사망.
  2. **v2.1.129/133/136** (2026-05): 외부 자격증명 쓰기 충돌 → 무시 대신 강제 로그아웃 처리.
  3. **v2.1.176/178/181/193** (2026-06): 토큰 소유 계정 ↔ `oauthAccount` 교차검증 + 시작 시 프로필 fetch.
- 로컬 증거: 스토어(v0.2.9)의 계정 2는 2026-07-13 동기화본으로 액세스 토큰이 이미 만료됨. 이를 복원하면 즉시 401 → /login.
- Windows Credential Manager 이관설은 **기각** (cmdkey 조회 0건, 토큰은 여전히 평문 파일, upstream FR #73582가 2026-07-02 기준 open).
- 사용자 확인: 스위치할 때마다 매번 발생, Windows 네이티브, CC 2.1.211.

### 1.3 Related Documents

- 조사 근거: CC CHANGELOG v2.1.118/129/133/136/176/178, anthropics/claude-code#23906, #30031, #73582, hamed-elfayome/Claude-Usage-Tracker#263, realiti4/claude-swap#117
- 선행 리팩터: `docs/01-plan/features/v0-2-refactor.plan.md`

---

## 2. Scope

### 2.1 In Scope

- [ ] **FR-01 복원 전 토큰 리프레시**: 스위치 대상 계정의 `refreshToken`으로 OAuth 리프레시 수행, 회전된 새 토큰을 스토어와 라이브 파일 양쪽에 기록
- [ ] **FR-02 만료/유효성 가드**: `expiresAt`/`refreshTokenExpiresAt` 검사 — refreshToken까지 만료면 복원 중단 + 해당 슬롯 /login 안내 (라이브 자격증명은 건드리지 않음)
- [ ] **FR-03 identity 가드 (오염 감지)**: `syncStoreFromLive` 시 라이브 자격증명이 **다른 슬롯의 저장 토큰과 verbatim 일치**하면 동기화 거부(오염 방지). 로컬 파일만으로는 토큰의 소유 계정을 증명할 수 없으므로, 감지 가능한 오염 케이스(교차 슬롯 토큰 유입)에 한정한 가드임
- [ ] **FR-04 원자적 쓰기**: temp 파일 + rename 방식으로 `.claude.json`/`.credentials.json` 쓰기
- [ ] **FR-05 병합 쓰기**: `.credentials.json` 전체 교체 대신 `claudeAiOauth` 키만 교체, CC가 추가한 알 수 없는 sibling 키 보존
- [ ] **FR-06 실행 중 세션 경고**: 실행 중인 `claude` 프로세스 감지 시 경고 출력 후 진행 (차단 아님)
- [ ] **FR-07 로컬 재설치 및 검증**: 수정 완료 후 installer로 재설치 (설치본 v0.2.9 → 최신), 실제 스위치로 재로그인 없음 확인

### 2.2 Out of Scope

- 계정별 `CLAUDE_CONFIG_DIR` 격리 아키텍처 (차후 검토)
- macOS Keychain 지원 (파일 스와프로는 원리상 불가 — 별도 과제)
- 스토어 파일 암호화 (평문 토큰 보안 강화는 별도 과제)
- 사용량 표시(usage) 기능 변경

---

## 3. Requirements

### 3.1 Functional Requirements

| ID | Requirement | Priority | Status |
|----|-------------|----------|--------|
| FR-01 | 스위치 시 대상 계정 토큰을 OAuth 리프레시로 갱신 후 복원 (성공 시 신규 access/refresh 토큰을 스토어+라이브에 기록) | High | Pending |
| FR-02 | refreshToken 만료 시 복원 중단, 라이브 자격증명 보존, `/login` 후 재동기화 안내 메시지 | High | Pending |
| FR-03 | 스토어 동기화 전 오염 감지 — 라이브 토큰이 타 슬롯 저장 토큰과 verbatim 일치 시 쓰기 거부 + 경고 | High | Pending |
| FR-04 | 라이브 파일 쓰기를 temp+rename 원자적 쓰기로 전환 | Medium | Pending |
| FR-05 | `.credentials.json`은 `claudeAiOauth` 키만 병합 교체, 기타 키 보존 | Medium | Pending |
| FR-06 | 실행 중 claude 프로세스 감지 시 경고 출력 (진행은 허용) | Medium | Pending |
| FR-07 | 재설치 스크립트 실행으로 로컬 런타임 갱신 + 실환경 스위치 검증 | High | Pending |

### 3.2 Non-Functional Requirements

| Category | Criteria | Measurement Method |
|----------|----------|-------------------|
| 보안 | 토큰 값을 로그/에러 메시지에 절대 노출하지 않음 | 코드 리뷰 + 출력 검사 |
| 호환성 | Node 내장 모듈만 사용 (신규 의존성 0) — 기존 정책 유지 | package.json diff |
| 신뢰성 | 리프레시 실패 시 라이브 파일 무변경 (부분 쓰기 없음) | 실패 주입 테스트 |
| 하위호환 | 스토어 스키마(v0.2.9~0.3.9) 기존 데이터 그대로 읽기 가능 | 기존 스토어로 동작 확인 |

---

## 4. Success Criteria

### 4.1 Definition of Done

- [ ] SC-1: 오래된(액세스 토큰 만료) 슬롯으로 스위치 → CC 재시작 → **재로그인 요구 없음**
- [ ] SC-2: 방금 동기화된 슬롯으로 스위치 → CC 재시작 → 재로그인 요구 없음
- [ ] SC-3: refreshToken까지 만료된 슬롯 스위치 시도 → 라이브 자격증명 무손상 + 명확한 /login 안내 후 종료
- [ ] SC-4: identity 불일치 상태에서 sync 실행 → 슬롯 오염 없음 (기존 슬롯 데이터 보존)
- [ ] SC-5: 로컬 설치본이 최신 버전으로 갱신되고 실환경에서 SC-1 재현 확인

### 4.2 Quality Criteria

- [ ] 토큰 값 비노출 (로그·에러·백업 경로 안내 포함)
- [ ] 신규 외부 의존성 0
- [ ] 기존 CLI 인터페이스(번호 선택, --config 등 플래그) 불변

---

## 5. Risks and Mitigation

| Risk | Impact | Likelihood | Mitigation |
|------|--------|------------|------------|
| OAuth 리프레시 엔드포인트/클라이언트ID 仕様 미공개·변경 | High | Medium | CC 실제 트래픽 기준 엔드포인트 확인(Design 단계 검증), 실패 시 FR-02 폴백 경로가 항상 동작 |
| 리프레시 성공 후 라이브 쓰기 실패 → 회전된 토큰 유실 | High | Low | 리프레시 결과를 **스토어에 먼저** 기록 후 라이브 쓰기 (토큰이 최소 한 곳에 항상 존재) |
| 실행 중 CC 세션이 스위치 직후 회전 토큰을 되써서 오염 | Medium | Medium | FR-03 identity 가드가 다음 sync에서 오염 차단 + FR-06 경고 |
| 서버측 rate limit / 리프레시 남용 감지 | Low | Low | 스위치 시에만 1회 호출, 액세스 토큰이 아직 유효하면 리프레시 생략 |
| CC 향후 저장 위치 변경(OS keystore 이관) | High | Low | 이번 범위 외 — FR-02 폴백 메시지가 안전망, upstream #73582 모니터링 |

---

## 6. Impact Analysis

### 6.1 Changed Resources

| Resource | Type | Change Description |
|----------|------|--------------------|
| `lib/actions/switch.cjs` | Module | 복원 전 리프레시 + 만료 가드 로직 삽입 |
| `lib/store/accounts.cjs` | Module | `syncStoreFromLive`에 identity 가드 추가 |
| `lib/store/io.cjs` | Module | 원자적 쓰기(temp+rename), `.credentials.json` 병합 쓰기 |
| `lib/usage/fetch.cjs` 또는 신규 `lib/auth/refresh.cjs` | Module | OAuth 토큰 리프레시 HTTP 호출 (신규) |
| `cc-switch.cjs` | Entry | 실행 중 세션 감지 경고, 에러 메시지 확장 |
| `package.json` `files` | Config | 신규 lib 파일 추가 시 배포 목록 갱신 |

### 6.2 Current Consumers

| Resource | Operation | Code Path | Impact |
|----------|-----------|-----------|--------|
| `writeLiveState` (io.cjs) | WRITE | `lib/actions/switch.cjs` → runSwitchAction | Needs verification — 원자적/병합 쓰기로 교체 |
| `writeJson` (io.cjs) | WRITE | writeStore, writeLiveState, 백업 로직 | Needs verification — 시그니처 유지하며 내부만 변경 |
| `syncStoreFromLive` (accounts.cjs) | UPDATE | `cc-switch.cjs` main, `lib/actions/sync.cjs`, session-start hook | Needs verification — 가드 추가로 예외 케이스 발생 가능(불일치 시 skip) |
| `.credentials.json` 스냅샷 | READ | `lib/output/accounts.cjs` inferPlanType (subscriptionType/rateLimitTier) | None — 필드 보존됨 |
| 스토어 스키마 | READ/WRITE | list/remove/usage 액션, statusline.cjs | None — 스키마 불변, 토큰 값만 갱신됨 |
| session-start.cjs / statusline.cjs 훅 | READ | CC 훅에서 스토어/설정 읽기 | Needs verification — sync 경로 공유 시 가드 영향 확인 |

### 6.3 Verification

- [ ] 위 모든 소비자가 변경 후 정상 동작 검증
- [ ] 스토어 하위호환(기존 v0.2.9 데이터) 검증
- [ ] 훅(session-start, statusline) 경로 검증

---

## 7. Architecture Considerations

### 7.1 Project Level Selection

| Level | Characteristics | Recommended For | Selected |
|-------|-----------------|-----------------|:--------:|
| **Starter** | Simple structure | Static sites | ☐ |
| **Dynamic** | Feature-based modules | CLI tool with modular lib/ | ☑ |
| **Enterprise** | Strict layer separation | High-traffic systems | ☐ |

### 7.2 Key Architectural Decisions

| Decision | Options | Selected | Rationale |
|----------|---------|----------|-----------|
| 수정 접근 | 리프레시+가드 / 최소 가드 / CONFIG_DIR 격리 | **리프레시+가드** | 사용자 선택 (Checkpoint 2) — 재로그인 제로 목표 |
| 실행 중 세션 | 차단 / 경고 후 진행 | **경고 후 진행** | 사용자 선택 — UX 마찰 최소화 |
| HTTP 클라이언트 | 내장 https / fetch / axios | **내장 (기존 fetch.cjs 패턴 재사용)** | 의존성 0 정책 유지 |
| 쓰기 전략 | 전체 교체 / 병합+원자적 | **병합+원자적** | CC 신규 키 보존, 부분 쓰기 방지 |
| 리프레시 시점 | 항상 / 만료 시에만 | **액세스 토큰 만료(또는 임박) 시에만** | 불필요한 토큰 회전 최소화 |

### 7.3 Clean Architecture Approach

```
Selected Level: Dynamic (기존 구조 유지)

lib/
  actions/switch.cjs   ← 오케스트레이션 (리프레시 → 가드 → 복원)
  auth/refresh.cjs     ← 신규: OAuth 토큰 리프레시 (순수 HTTP)
  store/accounts.cjs   ← identity 가드
  store/io.cjs         ← 원자적/병합 쓰기
```

---

## 8. Convention Prerequisites

### 8.1 Existing Project Conventions

- [x] CommonJS(.cjs), Node 내장 모듈만 사용
- [x] 2-space JSON pretty print + trailing newline (io.cjs)
- [ ] ESLint/Prettier/tsconfig 없음 — 기존 코드 스타일 준수로 갈음

### 8.2 Conventions to Define/Verify

| Category | Current State | To Define | Priority |
|----------|---------------|-----------|:--------:|
| 에러 메시지 | 영어, 콘솔 출력 | 기존 lib/output/messages.cjs 패턴 준수 | High |
| 토큰 마스킹 | 관례 없음 | 토큰 값 출력 전면 금지 규칙 명문화 | High |

### 8.3 Environment Variables Needed

없음 (기존 CLI 플래그 체계 유지).

---

## 9. Next Steps

1. [ ] Design 문서 작성 (`account-switch-relogin-fix.design.md`) — OAuth 리프레시 엔드포인트 실검증 포함
2. [ ] 구현 (Do)
3. [ ] Gap 분석 + 실환경 스위치 검증 (Check)

---

## Version History

| Version | Date | Changes | Author |
|---------|------|---------|--------|
| 0.1 | 2026-07-16 | Initial draft — 근본 원인 조사(3-way) 및 Checkpoint 1/2 반영 | trkim + Claude |
