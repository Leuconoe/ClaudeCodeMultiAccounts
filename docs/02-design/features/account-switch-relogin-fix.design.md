# account-switch-relogin-fix Design Document

> **Summary**: 스위치 파이프라인을 단계별 모듈(auth/proc/pipeline)로 분리하고, 복원 전 OAuth 토큰 리프레시 + 만료/identity 가드 + 원자적·병합 쓰기를 도입해 재로그인 없는 계정 전환을 구현한다.
>
> **Project**: claude-code-multi-accounts
> **Version**: 0.3.9
> **Author**: trkim (with Claude)
> **Date**: 2026-07-16
> **Status**: Draft
> **Planning Doc**: [account-switch-relogin-fix.plan.md](../../01-plan/features/account-switch-relogin-fix.plan.md)

---

## Context Anchor

> Copied from Plan document. Ensures strategic context survives Design→Do handoff.

| Key | Value |
|-----|-------|
| **WHY** | CC의 토큰 회전/폐기 + identity 검증 도입으로 스냅샷 복원 방식이 무효화되어 스위치마다 재로그인 발생 |
| **WHO** | Windows 네이티브에서 다계정을 전환하는 Claude Code 사용자 (본 도구 사용자 전체) |
| **RISK** | 리프레시 API 호출 실패/사양 변경 시 살아있는 라이브 토큰을 죽은 토큰으로 덮어쓸 수 있음 → 만료 검사 + 실패 시 복원 중단으로 완화 |
| **SUCCESS** | 스위치 후 Claude Code 재시작 시 /login 요구 없음(신선/오래된 슬롯 모두), 스토어 오염 0건 |
| **SCOPE** | Phase 1: 리프레시+가드 구현 → Phase 2: 원자적/병합 쓰기 → Phase 3: 세션 경고 + 재설치 검증 |

---

## 1. Overview

### 1.1 Design Goals

1. **살아있는 토큰만 복원**: 복원 직전 대상 계정의 액세스 토큰이 만료(또는 임박)면 OAuth 리프레시로 갱신 후 주입. refreshToken까지 죽었으면 라이브를 건드리지 않고 중단.
2. **토큰 유실 제로**: 리프레시로 회전된 새 refresh 토큰은 라이브 쓰기 **전에** 스토어에 먼저 영속화 — 어떤 실패 시나리오에서도 토큰이 최소 한 곳에 존재.
3. **스토어 오염 방지**: `syncStoreFromLive`가 라이브 자격증명의 소유 계정(accountUuid)과 슬롯 key의 일치를 검증.
4. **CC 미래 호환**: `.credentials.json`은 `claudeAiOauth` 키만 병합 교체 — CC가 추가하는 알 수 없는 sibling 키 보존. 모든 라이브 쓰기는 temp+rename 원자적.
5. **의존성 0 유지**: Node 내장 모듈(https, fs, child_process)만 사용.

### 1.2 Design Principles

- **단일 책임**: 네트워크(auth/refresh), 검증 규칙(auth/guard), 프로세스 감지(proc/sessions), 오케스트레이션(actions/switch-pipeline) 분리
- **순수 함수 우선**: guard는 입출력이 명확한 순수 함수 — 시계(now)를 인자로 주입해 테스트 가능
- **fail-safe**: 모든 실패 경로에서 라이브 파일 무변경(또는 원자적 완결) 보장
- **토큰 비노출**: 어떤 로그/에러에도 토큰 값 출력 금지

---

## 2. Architecture Options (v1.7.0)

### 2.0 Architecture Comparison

| Criteria | Option A: Minimal | Option B: Clean | Option C: Pragmatic |
|----------|:-:|:-:|:-:|
| **Approach** | switch.cjs/io.cjs 인라인 패치 | auth/proc/pipeline 모듈 신설, 완전 분리 | refresh만 분리, 가드는 기존 모듈 통합 |
| **New Files** | 0 | 4 | 1–2 |
| **Modified Files** | 4 | 4 | 5 |
| **Complexity** | Low | High | Medium |
| **Maintainability** | Medium | High | High |
| **Effort** | Low | High | Medium |
| **Risk** | Low (coupled) | Low (clean) | Low (balanced) |

**Selected**: **Option B — Clean Architecture** — **Rationale**: 사용자 선택 (Checkpoint 3). 인증 로직은 CC 사양 변경 시 가장 자주 손댈 영역이므로 완전 분리가 장기 유지보수에 유리. 단계별 파이프라인은 실패 지점별 fail-safe 보장을 코드 구조로 강제한다.

### 2.1 Component Diagram

```
cc-switch.cjs (entry, async main)
    │
    ▼
lib/actions/switch.cjs ──────▶ lib/actions/switch-pipeline.cjs
                                 │  Stage 1: warnRunningSessions ──▶ lib/proc/sessions.cjs
                                 │  Stage 2: syncOutgoing ─────────▶ lib/store/accounts.cjs (identity guard)
                                 │  Stage 3: assessIncoming ───────▶ lib/auth/guard.cjs (만료/유효성 판정)
                                 │  Stage 4: refreshIfNeeded ──────▶ lib/auth/refresh.cjs (OAuth HTTP)
                                 │  Stage 5: persistStoreFirst ────▶ lib/store/io.cjs (writeStore)
                                 │  Stage 6: writeLive ────────────▶ lib/store/io.cjs (atomic + merge)
                                 ▼
                               출력 (성공/경고/중단 메시지)
```

### 2.2 Data Flow

```
[스위치 요청 N]
  → 실행중 claude 프로세스 감지 → (있으면 경고 출력, 진행)
  → 라이브(.claude.json/.credentials.json) 읽기
  → identity 가드(오염 감지): 라이브 토큰이 다른 슬롯의 저장 토큰과 verbatim 일치? → 일치(오염) 시 sync 스킵+경고, 아니면 outgoing 슬롯 sync
     (로컬 파일만으로는 토큰 소유 계정을 증명할 수 없음 — 감지 가능한 오염 케이스에 한정)
  → incoming 슬롯 평가 (guard.assessCredentials):
      ├─ refreshToken 만료          → ABORT: 라이브 무변경 + /login 안내
      ├─ accessToken 유효(>5분 여유) → SKIP_REFRESH: 그대로 복원
      └─ accessToken 만료/임박       → NEED_REFRESH
  → NEED_REFRESH: POST /v1/oauth/token
      ├─ 200 → 스토어 슬롯에 신규 토큰 기록 → writeStore (선영속화)
      ├─ 400 → ABORT: 슬롯 폐기됨, /login 안내 (라이브 무변경)
      ├─ 429 → ABORT: 백오프 안내 (라이브 무변경)
      └─ 기타/네트워크 → ABORT (라이브 무변경)
  → writeLive: .claude.json(oauthAccount 교체) + .credentials.json(claudeAiOauth 병합) 원자적 쓰기
  → writeStore (lastUsedAt 갱신) → 성공 출력
```

### 2.3 Dependencies

| Component | Depends On | Purpose |
|-----------|-----------|---------|
| `actions/switch-pipeline.cjs` | auth/guard, auth/refresh, proc/sessions, store/io, store/accounts | 단계 오케스트레이션 |
| `auth/refresh.cjs` | node:https | OAuth 토큰 리프레시 HTTP |
| `auth/guard.cjs` | (없음 — 순수 함수) | 만료/identity 판정 규칙 |
| `proc/sessions.cjs` | node:child_process | claude 프로세스 감지 (best-effort) |
| `store/io.cjs` | node:fs, node:path | 원자적/병합 쓰기 |
| `cc-switch.cjs` | 전체 | 진입점, async 전환 |

---

## 3. Data Model

### 3.1 Entity Definition

```js
// 스토어 계정 엔트리 (기존 스키마 유지 — 변경 없음)
// ~/.ClaudeCodeMultiAccounts.json
{
  key: "uuid:<accountUuid>",        // 또는 "email:<emailAddress>"
  metadata: { /* oauthAccount 전체 (19 필드) */ },
  credentials: {
    claudeAiOauth: {
      accessToken: string,           // 리프레시 시 갱신
      refreshToken: string,          // 리프레시 시 회전 — 즉시 영속화 필수
      expiresAt: number,             // epoch-ms = Date.now() + expires_in*1000
      refreshTokenExpiresAt: number, // 리프레시 응답에 없음 → 기존 값 보존
      scopes: string[],              // 보존
      subscriptionType: string,      // 보존 (플랜 표시에 사용)
      rateLimitTier: string          // 보존
    }
  },
  capturedAt, lastSyncedAt, lastUsedAt, usageSnapshot, alias
}
```

```js
// guard.assessCredentials 판정 결과 (신규 내부 타입)
{ verdict: 'ok' | 'need-refresh' | 'refresh-expired',
  reason: string }                   // 사용자 안내용 (토큰 값 미포함)

// refresh.refreshTokens 결과 (신규 내부 타입)
{ ok: true,  claudeAiOauth: {…} }    // 갱신 병합 완료본
{ ok: false, code: 'revoked'|'rate-limited'|'network'|'protocol', message }
```

### 3.2 Entity Relationships

```
live(.claude.json oauthAccount) 1 ──── 1 live(.credentials.json claudeAiOauth)
        │  (identity 가드: 타 슬롯 토큰 verbatim 일치 = 오염으로 간주, sync 거부)
store.accounts[N] ── key = uuid:<accountUuid> (슬롯별 독립 토큰 패밀리)
```

### 3.3 Database Schema

해당 없음 (JSON 파일 기반 CLI). 스토어 스키마 버전은 기존 `0.2.9` 형식과 하위호환 유지.

---

## 4. API Specification

### 4.1 Endpoint List

| Method | Path | Description | Auth |
|--------|------|-------------|------|
| POST | `https://platform.claude.com/v1/oauth/token` | OAuth 토큰 리프레시 (1차) | 없음 (public PKCE client) |
| POST | `https://api.anthropic.com/v1/oauth/token` | 동일 (1차 연결 실패 시 폴백) | 없음 |

> 검증 근거: CC 2.1.121 디버그 로그(anthropics/claude-code#54443), cedws 프로토콜 노트, querymt/anthropic-auth, openusage 문서. `console.anthropic.com`은 사망(404/Cloudflare) — 사용 금지.

### 4.2 Detailed Specification

#### `POST /v1/oauth/token`

**Request Headers:**
```
Content-Type: application/json
User-Agent: claude-cli/claude-code-multi-accounts
```
> ⚠️ `anthropic-beta: oauth-2025-04-20` 헤더는 리소스 API 전용 — 토큰 엔드포인트에 보내지 않는다. 빈 User-Agent는 거부됨.

**Request Body:**
```json
{
  "grant_type": "refresh_token",
  "refresh_token": "<stored refreshToken>",
  "client_id": "9d1c250a-e61b-44d9-88ed-5944d1962f5e"
}
```

**Response (200 OK):**
```json
{
  "token_type": "Bearer",
  "access_token": "...",
  "refresh_token": "...",
  "expires_in": 28800,
  "scope": "user:inference user:profile ..."
}
```

**병합 규칙** (응답 → claudeAiOauth):
- `accessToken` ← `access_token`
- `refreshToken` ← `refresh_token` (회전됨 — 즉시 스토어 영속화)
- `expiresAt` ← `Date.now() + expires_in * 1000` (epoch-ms)
- `refreshTokenExpiresAt`, `scopes`, `subscriptionType`, `rateLimitTier` ← **기존 값 보존** (응답에 미포함)

**Error Responses:**
- `400`: refresh 토큰 폐기/회전됨 (invalid_grant) → 슬롯 재로그인 필요 — ABORT + /login 안내
- `429`: 토큰 엔드포인트 rate limit → ABORT + 잠시 후 재시도 안내 (자격증명 문제 아님)
- `404`: 호스트/UA 문제 → 폴백 호스트 1회 시도 후 ABORT
- 네트워크 오류/타임아웃(10s): 폴백 호스트 1회 시도 후 ABORT

**회전 특성** (설계 제약):
- refresh 토큰은 **단일 사용** + 토큰 패밀리 무효화, 유예 없음
- 같은 계정으로 CC 세션이 실행 중일 때 리프레시하면 CC의 메모리 내 구토큰이 다음 리프레시에서 400 → 강제 로그아웃 유발 가능 → Stage 1 경고의 근거
- 리프레시는 스위치당 1회, 만료/임박 시에만 수행 (불필요한 회전 최소화)

---

## 5. UI/UX Design (CLI 출력)

### 5.1 Screen Layout

해당 없음 (CLI). 출력 메시지는 `lib/output/messages.cjs` 패턴을 따른다.

### 5.2 User Flow

```
/switch N
 ├─ [경고] Claude Code 실행 중 감지 시: "Warning: N running Claude Code process(es) detected..."
 ├─ [정보] 리프레시 수행 시: "Access token expired for [N] — refreshing..." → "Token refreshed."
 ├─ [성공] "Switched active account to [N] ... (Pro)." + 재시작 안내 (기존 유지)
 └─ [중단] "Switch aborted: stored refresh token for [N] has expired/been revoked.
            Run Claude Code with that account and /login, then run '/switch sync'."
```

### 5.3 Component List

| Component | Location | Responsibility |
|-----------|----------|----------------|
| 경고/중단 메시지 함수 | `lib/output/messages.cjs` | 세션 경고, 리프레시 진행, 중단 안내 문구 |

### 5.4 Page UI Checklist (CLI 메시지 체크리스트)

#### 스위치 성공 (리프레시 발생)
- [ ] 리프레시 진행 안내 1줄 (토큰 값 미노출)
- [ ] 기존 성공 메시지 + 재시작 안내 유지
- [ ] 계정 목록 요약 표시 유지

#### 스위치 중단 (refresh-expired / 400)
- [ ] 원인 1줄 + 복구 절차 2줄 (/login → sync)
- [ ] 라이브 파일 무변경임을 명시
- [ ] exit code 1

#### 실행 중 세션 경고
- [ ] 감지된 프로세스 수 표시, 진행은 계속
- [ ] 감지 실패(권한 등) 시 침묵 (best-effort)

---

## 6. Error Handling

### 6.1 Error Code Definition

| 상황 | 신호 | 처리 | 라이브 파일 |
|------|------|------|:---:|
| refresh 토큰 만료 (로컬 판정) | `refreshTokenExpiresAt < now` | ABORT + /login 안내 | 무변경 |
| refresh 토큰 폐기 (서버 판정) | 토큰 엔드포인트 400 | ABORT + /login 안내 | 무변경 |
| 토큰 엔드포인트 rate limit | 429 | ABORT + 재시도 안내 | 무변경 |
| 엔드포인트/UA 문제 | 404 | 폴백 호스트 1회 → ABORT | 무변경 |
| 네트워크/타임아웃 | ECONNRESET 등 / 10s | 폴백 호스트 1회 → ABORT | 무변경 |
| identity 불일치 (sync 시) | accountUuid ≠ slot key | 해당 슬롯 sync 스킵 + 경고 | 무변경 |
| 라이브 쓰기 실패 | fs 예외 | 에러 출력, temp 파일 정리 | 원자적 (부분 쓰기 없음) |
| 스토어 쓰기 실패 (선영속화 단계) | fs 예외 | ABORT — 라이브 쓰기 진입 금지 | 무변경 |

### 6.2 Error Response Format

CLI 출력 규칙: `Switch failed: <원인>` (기존 cc-switch.cjs catch 패턴 유지) + 필요 시 복구 절차. **토큰 값·토큰 일부 절대 미출력.**

---

## 7. Security Considerations

- [ ] 토큰 값 로그/에러/디버그 출력 전면 금지 (코드 리뷰 체크 항목)
- [ ] User-Agent는 실제 도구 식별자 사용 (`claude-cli/claude-code-multi-accounts`)
- [ ] client_id는 공개 상수 (public PKCE client) — secret 없음, 하드코딩 허용
- [ ] HTTPS 강제 (엔드포인트 상수화, http 금지)
- [ ] 리프레시는 스위치당 최대 1회 + 폴백 1회 (남용 방지)
- [ ] 스토어/백업 평문 저장은 기존 동작 유지 (Out of Scope — 별도 과제)

---

## 8. Test Plan (v2.3.0)

> CLI 도구이므로 L1=단위(node:test), L2=CLI 통합(임시 디렉터리 + 경로 플래그), L3=실환경 시나리오로 재해석한다.
> Do 단계에서 코드+테스트 1세트 원칙. 테스트는 `tests/*.test.cjs`, `node --test tests/`로 실행 (의존성 0).

### 8.1 Test Scope

| Type | Target | Tool | Phase |
|------|--------|------|-------|
| L1: 단위 | guard 판정, refresh 병합 규칙, io 원자적/병합 쓰기, accounts identity 가드 | node:test + 주입(mock http/clock) | Do |
| L2: CLI 통합 | cc-switch 전체 플로우 (--config/--credentials/--store 임시 경로) | node:test + child_process | Do |
| L3: 실환경 | 실제 계정 2개로 스위치 → CC 재시작 → 로그인 상태 확인 | 수동 (사용자 확인) | Check |

### 8.2 L1: 단위 테스트 시나리오

| # | Target | Test Description | Expected |
|---|--------|-----------------|----------|
| 1 | guard.assessCredentials | accessToken 유효(여유 >5min) | `verdict: 'ok'` |
| 2 | guard.assessCredentials | accessToken 만료, refreshToken 유효 | `verdict: 'need-refresh'` |
| 3 | guard.assessCredentials | refreshToken 만료 | `verdict: 'refresh-expired'` |
| 4 | guard.assessCredentials | expiresAt 필드 없음/이상값 | `need-refresh` (보수적) |
| 5 | refresh 병합 | 200 응답 → accessToken/refreshToken/expiresAt만 갱신, 나머지 4필드 보존 | 병합 규칙 일치 |
| 6 | refresh 에러 매핑 | 400/429/404/timeout → code 매핑 | revoked/rate-limited/protocol/network |
| 7 | io.writeJsonAtomic | 쓰기 후 파일 완전성, temp 파일 잔존 없음 | 원자성 |
| 8 | io.mergeCredentialsWrite | 기존 sibling 키 보존 + claudeAiOauth만 교체 | 병합 정확성 |
| 9 | accounts.syncStoreFromLive | 라이브 accountUuid ≠ 슬롯 key → 스킵+경고 플래그 | 오염 방지 |
| 10 | accounts.syncStoreFromLive | 일치 시 기존 동작 (upsert) 불변 | 하위호환 |

### 8.3 L2: CLI 통합 테스트 시나리오

| # | Scenario | Steps | Expected |
|---|----------|-------|----------|
| 1 | 유효 토큰 스위치 | 임시 스토어(미만료 슬롯) → switch 1 | 라이브 교체 완료, 리프레시 호출 없음 |
| 2 | 만료 토큰 스위치 (mock 200) | 만료 슬롯 + mock 서버 → switch 1 | 스토어 선갱신 → 라이브 반영 순서 검증 |
| 3 | 폐기 토큰 스위치 (mock 400) | switch 1 | exit 1, 라이브 파일 해시 불변, /login 안내 출력 |
| 4 | sibling 키 보존 | .credentials.json에 가짜 키 추가 → switch | 스위치 후 가짜 키 생존 |
| 5 | 기존 명령 회귀 | list/sync/remove/rename/usage 동작 | 기존과 동일 |

### 8.4 L3: 실환경 시나리오 (Check 단계, 사용자 참여)

| # | Scenario | Steps | Success Criteria |
|---|----------|-------|-----------------|
| 1 | 오래된 슬롯 복귀 (SC-1) | 7/13 동기화 슬롯으로 스위치 → CC 시작 | /login 요구 없음 |
| 2 | 신선한 슬롯 왕복 (SC-2) | A→B→A 연속 스위치 | 양방향 모두 재로그인 없음 |
| 3 | 재설치 검증 (SC-5) | install 재실행 → 버전 확인 → 시나리오 1 반복 | 설치본 최신 + 정상 동작 |

### 8.5 Seed Data Requirements

| Entity | Minimum Count | Key Fields Required |
|--------|:------------:|---------------------|
| 임시 스토어 계정 | 2 | 유효/만료/폐기 상태별 claudeAiOauth 픽스처 (가짜 토큰 문자열) |
| 임시 .claude.json | 1 | oauthAccount 19필드 축약본 + 무관 top-level 키 |
| 임시 .credentials.json | 1 | claudeAiOauth + 가짜 sibling 키 1개 |

---

## 9. Clean Architecture

### 9.1 Layer Structure

| Layer | Responsibility | Location |
|-------|---------------|----------|
| **Presentation** | CLI 출력 메시지 | `lib/output/` |
| **Application** | 스위치 파이프라인 오케스트레이션 | `lib/actions/switch-pipeline.cjs`, `lib/actions/*.cjs` |
| **Domain** | 검증 규칙 (만료/identity 판정 — 순수 함수) | `lib/auth/guard.cjs`, `lib/store/accounts.cjs` |
| **Infrastructure** | HTTP(리프레시), fs(원자적 쓰기), 프로세스 감지 | `lib/auth/refresh.cjs`, `lib/store/io.cjs`, `lib/proc/sessions.cjs` |

### 9.2 Dependency Rules

```
cc-switch.cjs → actions(switch → switch-pipeline) → auth/guard (순수)
                                                  → auth/refresh, proc/sessions, store/io (인프라)
규칙: guard는 어떤 모듈도 import하지 않음 (now, 자격증명을 인자로 수신)
      refresh는 https만 사용, fs 접근 금지 (영속화는 파이프라인이 io로 수행)
      output 함수들은 데이터만 받아 문자열 생성 (부수효과 없음)
```

### 9.3 File Import Rules

| From | Can Import | Cannot Import |
|------|-----------|---------------|
| switch-pipeline | auth/*, proc/*, store/*, output/* | (entry 제외 전부 허용) |
| auth/guard | 없음 (내장 모듈 포함 금지) | 전부 |
| auth/refresh | node:https | fs, store/* |
| proc/sessions | node:child_process, node:os | store/* |
| store/io | node:fs, node:os, node:path | auth/*, actions/* |

### 9.4 This Feature's Layer Assignment

| Component | Layer | Location | 상태 |
|-----------|-------|----------|------|
| `refreshTokens(claudeAiOauth, {httpPost?})` | Infrastructure | `lib/auth/refresh.cjs` | 신규 |
| `assessCredentials(claudeAiOauth, now)` / `verifyLiveIdentity(config, credentials, store, getAccountKey)` | Domain | `lib/auth/guard.cjs` | 신규 |
| `detectClaudeSessions()` | Infrastructure | `lib/proc/sessions.cjs` | 신규 |
| `runSwitchPipeline(context)` | Application | `lib/actions/switch-pipeline.cjs` | 신규 |
| `runSwitchAction` (파이프라인 위임으로 축소) | Application | `lib/actions/switch.cjs` | 수정 |
| `syncStoreFromLive` (identity 가드) | Domain | `lib/store/accounts.cjs` | 수정 |
| `writeJsonAtomic`, `mergeCredentialsWrite`, `writeLiveState` | Infrastructure | `lib/store/io.cjs` | 수정 |
| async main + await switch | Entry | `cc-switch.cjs` | 수정 |
| 신규 메시지 함수 | Presentation | `lib/output/messages.cjs` | 수정 |

---

## 10. Coding Convention Reference

### 10.1 Naming Conventions

| Target | Rule | Example |
|--------|------|---------|
| 함수 | camelCase 동사구 | `refreshTokens()`, `assessCredentials()` |
| 상수 | UPPER_SNAKE_CASE | `OAUTH_CLIENT_ID`, `TOKEN_ENDPOINTS` |
| 파일 | kebab/camel 소문자 `.cjs` | `switch-pipeline.cjs`, `refresh.cjs` |
| 모듈 export | `module.exports = { … }` 객체 | 기존 패턴 동일 |

### 10.2 Import Order

기존 패턴 유지: node 내장 → 내부 상대경로. (외부 라이브러리 없음)

### 10.3 Environment Variables

없음. 모든 경로/옵션은 기존 CLI 플래그 체계.

### 10.4 This Feature's Conventions

| Item | Convention Applied |
|------|-------------------|
| 에러 처리 | throw → entry catch에서 `Switch failed: …` 출력 (기존), ABORT는 전용 결과 객체로 구분 |
| HTTP | `lib/usage/fetch.cjs`의 Promise + 10s timeout 패턴 |
| 테스트 | node:test (`node --test tests/`), 픽스처는 tests/fixtures/ |
| 주입 | guard: `now` 인자, refresh: `httpPost` 옵션 주입으로 mock |

---

## 11. Implementation Guide

### 11.1 File Structure

```
lib/
├── auth/
│   ├── refresh.cjs          # 신규: OAuth 리프레시 (endpoints, client_id, 병합 규칙, 폴백)
│   └── guard.cjs            # 신규: assessCredentials, verifyLiveIdentity (순수)
├── proc/
│   └── sessions.cjs         # 신규: detectClaudeSessions (win32: tasklist/wmic, unix: ps)
├── actions/
│   ├── switch.cjs           # 수정: runSwitchAction → 파이프라인 위임 (async)
│   └── switch-pipeline.cjs  # 신규: Stage 1~6 오케스트레이션
├── store/
│   ├── accounts.cjs         # 수정: syncStoreFromLive identity 가드
│   └── io.cjs               # 수정: writeJsonAtomic, mergeCredentialsWrite
├── output/
│   └── messages.cjs         # 수정: 경고/진행/중단 메시지
cc-switch.cjs                # 수정: await runSwitchAction
tests/
├── guard.test.cjs
├── refresh.test.cjs
├── io.test.cjs
├── accounts.test.cjs
└── cli-switch.test.cjs
package.json                 # files 배열에 신규 lib 추가, scripts.test
```

### 11.2 Implementation Order

1. [ ] `lib/auth/guard.cjs` + 테스트 (순수 — 의존 없음)
2. [ ] `lib/auth/refresh.cjs` + 테스트 (mock httpPost)
3. [ ] `lib/store/io.cjs` 원자적/병합 쓰기 + 테스트
4. [ ] `lib/store/accounts.cjs` identity 가드 + 테스트
5. [ ] `lib/proc/sessions.cjs` (best-effort, 실패 시 빈 결과)
6. [ ] `lib/actions/switch-pipeline.cjs` + `switch.cjs` 위임 + `cc-switch.cjs` async 전환
7. [ ] `lib/output/messages.cjs` 신규 메시지
8. [ ] CLI 통합 테스트 (L2)
9. [ ] `package.json` files/scripts 갱신
10. [ ] 재설치 (install.cmd) + 실환경 검증 (L3)

### 11.3 Session Guide

#### Module Map

| Module | Scope Key | Description | Estimated Turns |
|--------|-----------|-------------|:---------------:|
| auth 코어 | `module-1` | guard + refresh + 단위 테스트 (구현 순서 1–2) | 15–20 |
| store 안전화 | `module-2` | io 원자적/병합 + accounts 가드 + 테스트 (3–4) | 10–15 |
| 파이프라인 통합 | `module-3` | sessions + pipeline + entry async + 메시지 + L2 테스트 (5–9) | 15–20 |
| 실환경 검증 | `module-4` | 재설치 + L3 시나리오 (10) | 5–10 |

#### Recommended Session Plan

| Session | Phase | Scope | Turns |
|---------|-------|-------|:-----:|
| Session 1 | Plan + Design | 전체 | 완료 |
| Session 2 | Do | `--scope module-1,module-2` | 25–35 |
| Session 3 | Do | `--scope module-3,module-4` | 20–30 |
| Session 4 | Check + Report | 전체 | 20–30 |

---

## Version History

| Version | Date | Changes | Author |
|---------|------|---------|--------|
| 0.1 | 2026-07-16 | Initial draft — Option B 선택(Checkpoint 3), OAuth 리프레시 프로토콜 실검증 반영 | trkim + Claude |
| 0.2 | 2026-07-16 | Act-1 반영 — identity 가드를 실제 메커니즘(교차 슬롯 verbatim 토큰 오염 감지)으로 정정, verifyLiveIdentity 시그니처 정정, 원자적 쓰기 권한 보존·백업 per-basename 보존·sync 스킵 경고 추가 | trkim + Claude |
