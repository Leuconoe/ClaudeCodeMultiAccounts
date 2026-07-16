# account-switch-relogin-fix Completion Report

> **Project**: claude-code-multi-accounts
> **Version**: 0.3.10
> **Author**: trkim (with Claude)
> **Date**: 2026-07-16
> **Status**: Completed (실환경 검증 통과)
>
> **Docs**: [Plan](../01-plan/features/account-switch-relogin-fix.plan.md) · [Design](../02-design/features/account-switch-relogin-fix.design.md) · [Analysis](../03-analysis/account-switch-relogin-fix.analysis.md)

---

## Executive Summary

| Perspective | Content |
|-------------|---------|
| **Problem** | CC 2026-04~06 업데이트(리프레시 토큰 회전+서버 폐기, 자격증명 충돌 시 강제 로그아웃, 토큰↔계정 identity 검증)로 스냅샷 복원 방식 스위치가 매번 재로그인을 유발 |
| **Solution** | 복원 직전 만료 토큰만 OAuth 리프레시로 갱신(회전 토큰 스토어 선영속화), 죽은 슬롯은 라이브 무손상 중단+/login 안내, 교차 슬롯 오염 감지, 원자적·병합 쓰기, 실행 중 세션 경고 |
| **Function/UX Effect** | 재로그인 없는 원클릭 계정 전환 복구 — 실환경 검증 통과. 실패 시에도 원인·복구 절차가 명확 |
| **Core Value** | 최신 CC(2.1.211+) 인증 모델과 호환되는 유일한 안전 전환 경로 확보 + 잠복 버그 3건 제거 |

### Value Delivered

| 지표 | 결과 |
|------|------|
| 재로그인 발생 | 매 스위치 → **0회** (사용자 실환경 확인) |
| Gap Match Rate | 93% (Act-1 후 확정 발견 9건 전건 조치) |
| 테스트 | 0개 → 37개 (36 통과 / 1 Windows 스킵, 의존성 0) |
| 잠복 버그 수정 | 재설치 크래시(rename.cjs 누락), 백업 자기잠식(keep-3 전역 정리), sync 침묵 실패 |

---

## 1. Key Decisions & Outcomes

| Source | Decision | Followed | Outcome |
|--------|----------|:--------:|---------|
| Plan | 리프레시+가드 접근 (Checkpoint 2) | ✅ | 만료 시에만 리프레시 — 불필요한 토큰 회전 없음 |
| Plan | 실행 중 세션 경고 후 진행 | ✅ | best-effort 감지, UX 마찰 없음 |
| Plan | 재설치 포함 | ✅ | v0.2.9 설치본 → 최신 갱신, sync 스모크 통과 |
| Design | Option B 클린 아키텍처 (Checkpoint 3) | ✅ | auth/proc/pipeline 분리 — guard 순수 함수로 테스트 용이 |
| Design | OAuth 계약: platform.claude.com + 공개 client_id, 병합 규칙 | ✅ | 유닛 테스트로 계약 고정, 5xx/404 폴백 |
| Design | accountUuid identity 가드 | ⚠️→✅ | 로컬 검증 한계로 verbatim 오염 감지로 구현, Act-1에서 문서 정정 |

## 2. Success Criteria Final Status

| # | Criteria | Status | Evidence |
|---|----------|:------:|----------|
| SC-1 | 오래된 슬롯 스위치 → 재로그인 없음 | ✅ Met | 사용자 실환경 확인 (2026-07-16) |
| SC-2 | 신선한 슬롯 스위치 → 재로그인 없음 | ✅ Met | 사용자 실환경 확인 |
| SC-3 | 죽은 슬롯 → 라이브 무손상 + /login 안내 | ✅ Met | cli-switch.test.cjs (바이트 동일, exit 1) |
| SC-4 | 오염 sync 거부 | ✅ Met | accounts/guard 테스트 |
| SC-5 | 설치본 최신화 + 실환경 재현 | ✅ Met | install 재실행 + 실사용 확인 |

**Success Rate: 5/5**

## 3. Lessons Learned

- CC의 인증은 **행동 계약이 자주 바뀌는 영역** — 저장 위치(가설 H4)가 아닌 토큰 생명주기(H1/H2)가 원인이었음. 외부 도구는 스냅샷-복원이 아니라 "복원 시점 유효성 보장" 모델이어야 함
- 회전형 단일사용 토큰을 다루는 도구는 **새 토큰의 디스크 선영속화**가 유일한 유실 방지책
- 공유 백업 디렉터리의 전역 keep-N 정리는 파일별 정리로 착각하기 쉬운 함정 (실증으로만 발견됨)

## 4. Follow-ups (Out of Scope)

- macOS Keychain 지원 (파일 스와프 원리상 불가 — 별도 과제)
- 스토어 평문 토큰 암호화
- 계정별 CLAUDE_CONFIG_DIR 격리 아키텍처 검토

---

| Version | Date | Changes | Author |
|---------|------|---------|--------|
| 0.1 | 2026-07-16 | 실환경 검증 통과 후 완료 보고 | trkim + Claude |
