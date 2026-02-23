# LeStudio UI/UX 감사 리포트

감사일: 2026-02-23
감사 범위: 전체 9개 탭 + 라이트/다크 모드 + 반응형(768px)

---

## 2026-02-23 추가 감사 (Playwright 실사용 탭 순회)

### 점검 방식

- **실행 URL**: `http://127.0.0.1:7860/`
- **탭 순회**: `Status -> Mapping -> Motor Setup -> Calibration -> Teleop -> Record -> Dataset -> Train -> Eval`
- **뷰포트**: Desktop `1440x900`, Mobile `390x844`
- **관찰 포인트**: 로딩/오류 피드백, 정보 구조, 접근성(label/aria), 반응형 오버플로우

### 🔴 High (즉시 개선 권장)

#### H-1. 모바일 헤더 오버플로우로 주요 액션 접근 불가

- **증상**: `bodyScrollWidth=853`, `viewport=390` 환경에서 `Save`, `Guided/Advanced`, `🌙`가 우측 화면 밖으로 밀림
- **영향**: 모바일에서 핵심 제어(저장/모드/테마) 접근 실패
- **수정**: 헤더 우측 액션을 오버플로우 메뉴(또는 2행)로 재배치, 모바일 전용 레이아웃 분기

#### H-2. "Connected" 표시와 실제 부분 장애 상태 불일치

- **증상**: UI 상단은 Connected인데 콘솔에는 `404 /api/system/resources`, `404 /api/history` 반복
- **영향**: 사용자가 시스템 정상 여부를 오판
- **수정**: 연결 상태를 `Connected / Degraded / Disconnected`로 구분하고 실패 API를 배지/배너로 노출

### 🟠 Major (작업 흐름 마찰)

#### M-1. 입력 필드의 label-for 연결 부족

- **증상**: `ms-port`, `cal-id`, `cal-port`, `record-*`, `train-*`, `eval-*` 등 다수 input이 인접 텍스트만 있고 명시적 `label[for]` 연결이 약함
- **영향**: 스크린리더/키보드 내비게이션 품질 저하, 폼 오류 추적 어려움
- **수정**: 모든 입력에 `id` + `label for`를 명시 연결, 힌트는 `aria-describedby`로 연결

#### M-2. 10-11px 저가독성 텍스트 과다

- **증상**: 상태 배지/보조 정보/액션 라벨에 10-11px 텍스트 다수
- **영향**: 장시간 작업 시 피로 증가, 오류/상태 인지 저하
- **수정**: 보조 텍스트 최소 12px, 상태/경고성 텍스트 13px 이상으로 상향

### 탭별 관찰 결과 (이번 순회 기준)

#### Status

- **문제**: 카드 내부에 `Could not load system resources`, `Session history temporarily unavailable`가 표시되는데 상단 전역 상태는 Connected
- **개선**: "부분 장애" 요약을 탭 상단에 통합 표시

#### Mapping

- **문제**: 기능은 풍부하지만 첫 사용자에게 우선순위가 평면적으로 보임
- **개선**: 상단에 필수 흐름(`1. 규칙 생성 -> 2. 적용 -> 3. 검증`) 고정

#### Motor Setup

- **문제**: 포트 입력 실수 예방 장치 부족
- **개선**: 포트 자동완성/유효성 즉시 피드백 추가

#### Calibration

- **문제**: 아이콘 단독 `↺` 버튼 의미가 약하고, `Delete...` 반복 배치로 오조작 위험
- **개선**: 아이콘 버튼 `aria-label`/tooltip 추가, 삭제 확인 모달에 파일명 강조

#### Teleop

- **문제**: 필수 설정과 고급 설정이 한 화면에 혼재
- **개선**: 필수/고급 섹션 분리(아코디언 또는 접기)

#### Record

- **문제**: Save/Discard/End 버튼이 비활성일 때 이유가 약하게 전달됨
- **개선**: 버튼 근처에 상태 기반 설명(녹화 시작 후 활성) 고정

#### Dataset

- **문제**: 리스트 항목마다 `Quality/Push/Delete` 반복 노출로 시각적 밀도 과다
- **개선**: hover 액션 + `More` 메뉴로 압축, Delete는 분리 강조

#### Train

- **문제**: `Install Needed`/`BLOCKED` 상태의 원인과 해결 경로가 분산
- **개선**: 원인/해결 버튼/다음 단계의 단일 안내 카드 제공

#### Eval

- **문제**: 초기 상태 placeholder(`--`) 중심으로 의미 전달 약함
- **개선**: 실행 전 체크리스트(체크포인트/데이터셋/에피소드) 표시

### 우선 적용 순서 (제안)

1. 모바일 헤더 오버플로우 해결
2. Connected 상태와 부분 장애 상태 분리
3. 폼 접근성(label-for/aria) 정리

---

## 🔴 Critical (사용성에 직접적 영향)

### C-1. 헤더 과부하 — 인지 부하 심각

- **위치**: `<header>` (index.html L14-53)
- **문제**: 프로필 select + Active 배지 + Save + ⋮ 메뉴 + Drop Zone + Guided/Advanced 토글 + 테마 + GitHub + WS 상태가 한 줄에 모두 배치
- **결과**: 768px 이하에서 헤더 오버플로우. "Drop Profile JSON" 드롭존은 저빈도 기능인데 상시 노출
- **수정**: Drop Zone 제거 (Import 버튼이 ⋮ 메뉴에 이미 존재), 프로필 영역 정리

### C-2. 에러 상태 표시가 사용자 불친절

- **위치**: Status 탭 System Resources / Session History
- **문제**: API 404 시 `Error: unavailable`, `History unavailable`만 표시. 콘솔에 404 에러 누적 (53회+)
- **수정**: graceful fallback 메시지 + 폴링 시 exponential backoff

### C-3. WebSocket 상태 dot/label 불일치

- **위치**: `workbench_streams.js` WS.connect() (L161-171)
- **문제**: `ws-dot` title 속성과 `ws-label` 텍스트가 불일치할 수 있음 (`title`은 초기 HTML에 고정, JS는 textContent만 변경)
- **수정**: title 속성도 동기 업데이트

### C-4. NEEDS_DEVICE / MISSING_DEP 뱃지 의미 불명

- **위치**: `workbench_api.js` SidebarNav._setBadgeState() 내부 stateMap
- **문제**: 기술 내부 용어가 그대로 사용자에게 노출 (NEEDS_DEVICE, MISSING_DEP, NEEDS_ROOT 등)
- **수정**: 자연어 라벨로 변경 (예: "장치 필요" / "설치 필요" / "권한 필요")

---

## 🟠 Major (사용 흐름에 마찰)

### M-5. Guided 모드에서 ML 탭 완전 소실

- **위치**: `workbench_mode_signals.js` ModeManager.applyMode() (L68-73)
- **문제**: `hidden` 클래스로 완전히 숨김 → 사용자가 Train/Eval 존재 자체를 모를 수 있음
- **수정**: 비활성(dimmed) 상태로 보여주고, 클릭 시 안내 표시

### M-6. Status 탭 3열 그리드 카드 높이 불균형

- **위치**: `style.css` `.status-grid` (L764)
- **문제**: 카드 내용량 차이가 커서 높이 극심 불균형
- **수정**: 2열 레이아웃으로 전환, Processes 카드를 span 2로 확장

### M-7. Episode Progress 카드가 two-col 그리드에서 반쪽만 차지

- **위치**: `index.html` Teleop (L217-231) / Record (L353-379), `style.css` `.two-col` (L540)
- **문제**: 2열 그리드에 3번째 아이템으로 들어가면서 좌측 50%만 차지
- **수정**: `grid-column: 1 / -1` 추가

### M-8. Record 탭 핵심 컨트롤이 페이지 맨 아래

- **위치**: `index.html` Record section (L236-381)
- **문제**: Step 1/2/3 카드 후 Episode Progress가 맨 아래에 위치
- **수정**: Episode Progress 카드에 sticky positioning 적용

### M-9. 카메라 설정 — Mapped-Only 카메라 시스템

- **위치**: `workbench_helpers.js`, `workbench_teleop.js`, `workbench_record.js`, `index.html`
- **문제**: Teleop/Record 탭에서 동일한 카메라 설정이 각각 수동 관리되어 중복·불일치 발생
- **수정**: Mapping 탭의 udev symlink 카메라만 사용하는 mapped-only 시스템으로 전환. 수동 카메라 추가/삭제/편집 UI 제거. 매핑된 카메라가 없으면 Mapping 탭으로 안내하는 empty state 표시

### M-10. Calibration Live Motor Ranges 고정 폭 480px

- **위치**: `index.html` L443 (`style="width: 480px; flex-shrink: 0"`)
- **문제**: 반응형 깨짐
- **수정**: `max-width: 480px; width: 100%`로 변경

---

## 🟡 Minor (시각적 개선)

### m-11. 인라인 스타일 남용

- **위치**: index.html 전반
- **문제**: 거의 모든 요소에 인라인 style 속성 → 유지보수 어려움, 테마 전환 시 일부 색상 미적용
- **수정**: 점진적으로 CSS 클래스로 전환

### m-12. 접근성 ARIA 속성 부재

- **위치**: 사이드바 tab-btn, sidebar-menu-btn
- **문제**: `role="tab"`, `aria-selected`, `aria-expanded` 없음
- **수정**: ARIA 속성 추가

### m-13. Dataset 빈 상태 UX

- **위치**: `index.html` L775-777
- **문제**: 데이터셋 미선택 시 우측 카드에 한 줄 텍스트만 → 빈 공간 거대
- **수정**: 일러스트/가이드 텍스트가 포함된 empty state 디자인

### m-14. 버튼 스타일 일관성

- **위치**: `style.css` btn-primary/btn-xs
- **문제**: btn-xs는 transparent 배경에 hover 시 opacity만 변경 → 클릭 가능 여부 불분명
- **수정**: hover 시 배경색 변경 추가

### m-15. Train Checkpoints 카드 HTML 닫는 태그 누락 의심

- **위치**: `index.html` L672
- **문제**: `</div>` 하나 부족 → Checkpoints 카드가 two-col 바깥으로 빠져나옴
- **수정**: HTML 구조 검증 및 수정

### m-16. Console Drawer 헤더 전체 클릭 영역

- **위치**: `index.html` L877
- **문제**: 헤더 div 전체에 onclick → 내부 select/button과 충돌 가능
- **수정**: 클릭 영역을 title+chevron으로 한정

### m-17. 폰트 fallback 미설치

- **위치**: `style.css` L17-18
- **문제**: JetBrains Mono, Segoe UI 웹폰트 미로딩 → 시스템 기본 폰트로 표시
- **수정**: system-ui 우선 + 모노 폰트 fallback 개선
