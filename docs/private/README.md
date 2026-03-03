# docs/private 운영 가이드

최종 갱신: 2026-03-04

## 목적

`docs/private`는 현재 의사결정과 실행에 직접 쓰는 문서만 유지한다.  
완료/중단/참고용 문서는 `docs/private/archive/`로 이동해 문서 밀도를 관리한다.

## Active 문서 (현재 운영 기준)

- `roadmap.md` — 전체 단계/우선순위 기준
- `quality-improvement-plan.md` — 3.0 안정화 실행 기준
- `ecosystem-integration-plan.md` — 생태계 통합 설계 기준
- `docs-site-plan.md` — 공개 문서 사이트 실행안
- `strategy-competitive-analysis.md` — 포지셔닝/런칭 전략
- `oss-readiness-analysis.md` — OSS 공개 준비도 분석
- `language-selection-i18n.md` — i18n 의사결정 메모
- `uiux-regression-checklist.md` — UI/UX 회귀 점검 체크리스트
- `dataset-feature-adoption-plan.md` — Dataset 고도화 기능 도입 실행 계획
- `INDEX.md` — Active/Archive 문서 인덱스 + 소스 오브 트루스
- `refactoring-plan.md` — 코드 품질 개선 리팩토링 계획
- `plan_mobile.md` — 모바일 앱 제품 전략
- `release-checklist.md` — 릴리즈 코드 품질 게이트 체크리스트
- `license-audit-lerobot-ws-2026-02-26.md` — lerobot_ws OSS 라이선스 스냅샷 (2026-02-26)

## Archive 문서

- 위치: `docs/private/archive/`
- 원칙:
  - 실행 기준에서 제외된 문서
  - 증적 유실로 신뢰하기 어려운 회고/감사 문서
  - 이슈 트래커로 이전되어 유지 필요가 낮아진 상세 티켓 문서

## 유지보수 규칙

1. 새 문서는 기본적으로 `Active`에 넣되, 2주 이상 업데이트가 없고 실행 참조가 없으면 `archive` 이동을 검토한다.
2. `roadmap.md`와 `quality-improvement-plan.md`는 항상 최신 코드 기준으로 동기화한다.
3. 증적 링크는 저장소 상대경로만 허용한다. 절대경로 증적은 금지한다.
