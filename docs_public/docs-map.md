# LeStudio Internal Docs

이 디렉토리는 LeStudio의 내부 기준 문서와 작업 문서를 보관한다.

## 기준 문서

- `roadmap.md` - 현재 우선순위와 단계별 계획
- `current-architecture.md` - 현재 구현 기준 아키텍처
- `feature-spec.md` - 현재 기능 목록과 제품 범위 기준 문서
- `api-and-streaming.md` - REST, WebSocket, 카메라 스트리밍 구조
- `ecosystem-current-gaps.md` - 생태계 확장을 막는 현재 제약 인벤토리
- `ecosystem-integration-plan.md` - 다중 로봇/플러그인 확장 설계
- `release-checklist.md` - 릴리스 전 검증 체크리스트

## 하위 디렉토리

- `operations/` - 개발 운영 가이드
  - `operations/dev-restart-guide.md` - 개발 중 재시작 판단 가이드
  - `operations/clean-env-test-guide.md` - 격리 환경 테스트 절차 (릴리스 전 필수)
- `proposals/` - 아직 구현되지 않았거나 검토 중인 제안서
  대표 문서: `proposals/architecture-hardening-plan.md` - 현재 구조적 취약점과 리팩터링 우선순위
  실행 분해: `proposals/architecture-hardening-work-items.md` - 구현 티켓 단위 작업 목록
- `research/` - 기술 조사 및 외부 분석 문서
- `archive/` - 시점성 스냅샷, 과거 작업 기록, 역사 보존 문서

## 정리 원칙

- 현재 상태를 설명하는 문서는 루트 `docs/`에 둔다.
- 미래 제안이나 확장 아이디어는 `docs/proposals/`로 보낸다.
- 일회성 분석과 과거 상태 스냅샷은 `docs/archive/`에 둔다.
- 공개 사용자 문서는 `docs_public/`에만 둔다.
- 사용자에게 보이는 기능이나 상위 제품 소개가 바뀌면 `docs_public/feature-spec.md`, `README.md`, `README.ko.md`를 같은 변경에서 함께 갱신한다.
