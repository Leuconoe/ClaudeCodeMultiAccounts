# account-switch-relogin-fix Analysis Report

> **Analysis Type**: Gap Analysis (Design vs Implementation) + Correctness + Security
>
> **Project**: claude-code-multi-accounts
> **Version**: 0.3.9
> **Analyst**: trkim (with Claude)
> **Date**: 2026-07-16
> **Design Doc**: [account-switch-relogin-fix.design.md](../02-design/features/account-switch-relogin-fix.design.md)

---

## Context Anchor

| Key | Value |
|-----|-------|
| **WHY** | CC의 토큰 회전/폐기 + identity 검증 도입으로 스냅샷 복원 방식이 무효화되어 스위치마다 재로그인 발생 |
| **WHO** | Windows 네이티브에서 다계정을 전환하는 Claude Code 사용자 |
| **RISK** | 리프레시 실패 시 살아있는 라이브 토큰을 죽은 토큰으로 덮어쓸 위험 → 만료 검사 + 실패 시 복원 중단으로 완화 |
| **SUCCESS** | 스위치 후 CC 재시작 시 /login 요구 없음, 스토어 오염 0건 |
| **SCOPE** | Phase 1: 리프레시+가드 → Phase 2: 원자적/병합 쓰기 → Phase 3: 세션 경고 + 재설치 검증 |

---

## Strategic Alignment Check

### Success Criteria Status

| # | Criteria (from Plan) | Status | Evidence |
|---|---------------------|:------:|----------|
| SC-1 | 오래된 슬롯 스위치 → 재로그인 없음 | ⚠️ 구현 완료, 실사용 검증 대기 | `pipeline.test.cjs` 시나리오 1 (mock) — L3는 사용자 실환경 확인 필요 |
| SC-2 | 신선한 슬롯 스위치 → 재로그인 없음 | ⚠️ 구현 완료, 실사용 검증 대기 | `cli-switch.test.cjs` 시나리오 1 + 리프레시 스킵 로직 |
| SC-3 | 죽은 슬롯 스위치 → 라이브 무손상 + /login 안내 | ✅ Met | `cli-switch.test.cjs` 시나리오 2 (바이트 동일 검증, exit 1) |
| SC-4 | identity 불일치 sync → 오염 없음 | ✅ Met | `accounts.test.cjs` 오염 시나리오 + `guard.test.cjs` |
| SC-5 | 설치본 최신화 + 실환경 재현 확인 | ⚠️ 설치 완료(v0.2.9→현재), sync 스모크 통과 — 스위치 재현은 사용자 확인 필요 | `node install.cjs` + installed `sync` 실행 |

**Success Rate**: 2 Met + 3 Partial(사용자 실환경 검증 대기) / 5

### Decision Record Verification

| Source | Decision | Followed? | Deviation |
|--------|----------|:---------:|-----------|
| [Plan] | 리프레시+가드 접근 | ✅ | — |
| [Plan] | 세션 실행 중 경고 후 진행 | ✅ | — |
| [Design] | Option B 클린 아키텍처 (auth/proc/pipeline 분리) | ✅ | Stage 2(outgoing sync)는 파이프라인 밖 main()에서 수행 (기능 동등, Minor) |
| [Design] | OAuth 계약 (§4.2) | ✅ | — (유닛 테스트로 계약 고정) |
| [Design] | accountUuid identity 가드 | ⚠️→✅ | 구현은 교차 슬롯 verbatim 토큰 오염 감지 — Act-1에서 설계 문서를 실제 메커니즘으로 정정 |

---

## 1. Analysis Overview

- **방법**: 3-렌즈 병렬 분석(gap-detector / correctness / security) + Critical·Important 발견 건 전수 적대적 검증 (9 에이전트, 발견 12건 중 6건 확정)
- **분석 대상**: 신규 4모듈 + 수정 7파일 + 테스트 6파일

## 2. Gap Analysis 결과

### 2.1 Match Rate

| Axis | Rate | 비고 |
|------|:----:|------|
| Structural | 97% | Design §9.4/§11.1의 9개 모듈 전부 존재·책임 일치 |
| Functional | 89% | Stage 순서·선영속화·병합/원자적 쓰기·중단 경로 모두 구현 |
| Contract | 96% | OAuth 계약 §4.2 완전 일치 (엔드포인트 순서, 헤더, 병합 규칙, 에러 매핑) |
| **Overall (static)** | **93%** | 0.2×97 + 0.4×89 + 0.4×96 |

### 2.2 확정 발견 사항 및 Act-1 조치

| # | 심각도 | 발견 | Act-1 조치 | 검증 |
|---|--------|------|-----------|------|
| 1 | Important | `writeJsonAtomic`이 POSIX에서 `.credentials.json` 0600 권한을 0644로 다운그레이드 | 기존 파일 mode 보존 + 신규 생성 시 0o600, rename/폴백 양쪽 chmod | `io.test.cjs` 권한 보존 테스트 (win32 스킵) |
| 2 | Important | 백업 keep-3가 전체 `.bak` 대상이라 같은 스위치 안에서 `.claude.json` 백업이 즉시 삭제됨 (기존 버그) | per-basename 보존으로 변경 | `io.test.cjs` per-basename 테스트 |
| 3 | Important | identity 가드 스킵 시 `sync`가 "already matches" 출력 + exit 0 (침묵 실패) | `runSyncAction`에 skipped 분기 — 경고 + "store not updated" 출력 | `accounts.test.cjs` skipped 시맨틱 |
| 4 | Important | 설계(accountUuid 소유자 검증) vs 구현(verbatim 오염 감지) 편차 | Plan FR-03·Design §2.2/§3.2/§9.4를 실제 메커니즘으로 정정 + 한계 명시 | 문서 diff |
| 5 | Important | 회전 토큰 선영속화 순서의 통합 테스트 부재 | `tests/pipeline.test.cjs` 신설 — 스토어 선기록 시점 검증, 400 중단 시 무쓰기 검증 | 시나리오 3종 통과 |
| 6 | Minor | 5xx 시 폴백 엔드포인트 미시도 | `refresh.cjs`: ≥500도 폴백 계속 | 기존 폴백 테스트 경로 |
| 7 | Minor | `npm test` 글롭이 Node 21+ 전용 (engines >=18) | 명시적 파일 목록으로 변경 | Node 18+ 호환 |
| 8 | Minor | 크래시 시 토큰 포함 `.tmp` 잔존 가능 | 쓰기 실패 포함 전 경로에서 temp 제거 | `io.test.cjs` 잔존 파일 검사 |
| 9 | Minor | 손상된 credentials JSON 파싱 에러에 토큰 조각 노출 가능 | `readJson`이 파일명만 포함한 새니타이즈 에러로 변환 | `io.test.cjs` 비노출 테스트 |

수용(미조치): Windows에서 rename 실패 시 비원자적 폴백 창(대안 없음 — 스위치 실패보다 낫다고 판단), 네이티브 `claude.exe` 외 노드 기반 CC 프로세스 미감지(best-effort 설계).

### 2.3 테스트 결과

- **37 테스트 / 36 통과 / 1 스킵**(POSIX 권한 테스트, Windows 환경) / 0 실패
- 설치본 재설치 후 `sync` 스모크 통과 (identity 가드 경로 포함)
- 보너스 수정: `install.cjs`/`package.json`의 `rename.cjs` 누락 — 재설치 시 CLI 크래시 원인 해결

## 3. 결론

- 정적 Match Rate **93%** + 확정 발견 9건 전건 조치 완료 → Report 단계 진행 가능
- **잔여 항목 (사용자 실환경 검증, L3)**: 실제 계정으로 `cc-switch <n>` → Claude Code 재시작 → 재로그인 없음 확인 (SC-1/SC-2/SC-5)

---

| Version | Date | Changes | Author |
|---------|------|---------|--------|
| 0.1 | 2026-07-16 | Check(3-렌즈+적대검증) 결과 + Act-1 조치 기록 | trkim + Claude |
