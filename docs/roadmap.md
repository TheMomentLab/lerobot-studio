# LeRobot Studio — 구현 로드맵 (Implementation Roadmap)

## 현재 상태 (Current State)

사이드바 네비게이션 및 글로벌 콘솔 서랍(drawer)이 있는 워크벤치 스타일 웹 GUI:
**설정(상태/매핑/모터 설정/캘리브레이션) → 작동(원격 조작/녹화) → 데이터(데이터셋) → ML(학습/평가)**

백엔드: FastAPI + 하위 프로세스 생성(subprocess spawning) + WebSocket stdout 스트리밍  
프론트엔드: Vanilla HTML/JS/CSS, 프레임워크 없음

### 완료된 기능 (Completed Features)

| 기능 (Feature) | 설명 (Description) |
|---------|-------------|
| 스트림 상태 피드백 | 로딩 스피너, 재시도(Retry)가 있는 에러 카드, 끊긴 피드 감지(캔버스 픽셀 해시), LIVE 배지 |
| 품질 프리셋 (Quality presets) | 원격 조작(Teleop) 및 녹화(Record) 탭의 High / Medium / Low 버튼 — GET-then-PATCH를 통해 fps + jpeg_quality 조정 |
| 피드별 켜기/끄기 | × 버튼으로 개별 스트림 일시 중지; Resume(재개) 시 캐시 무효화(cache-busting)로 복구 |
| USB 대역폭 모니터링 | 피드 카드별 실시간 fps · MB/s; USB 버스 사용률 바(경고/위험 임계값) |
| 사이드바 워크벤치 레이아웃 | 상단 탭 바를 대체하여 설정/작동/데이터/ML로 그룹화된 왼쪽 내비게이션 |
| 글로벌 콘솔 서랍 | 통합 프로세스 로그 + stdin 입력 선택기 (`teleop/record/calibrate/motor_setup/train/eval`) |
| 내비게이션의 상태 배지 | `/ws` 상태, udev 상태, 의존성 검사, 장치 접근 결과를 기반으로 RUNNING / ERROR / NEEDS_ROOT / MISSING_DEP / NEEDS_DEVICE 배지 표시 |
| 가이드/고급 모드 | 데이터/ML 잠금 해제(데이터셋 존재 여부 + 학습 사전 검사)가 포함된 가이드(Guided) 기본값, 서브메뉴 그룹을 모두 표시하는 고급(Advanced) 모드 |
| 반응형 사이드바 동작 | 데스크톱 사이드바, 중간 크기의 아이콘 레일, 백드롭이 있는 모바일 서랍 |

---

## 1단계 (Phase 1) — 학습(Train) 탭

**목표**: 워크플로우 루프를 완성합니다. 데이터셋 녹화 → 정책 학습 → 배포의 모든 과정을 하나의 GUI에서 수행합니다.

**필요한 핵심 인프라**

| 항목 (Item) | 파일 (File) | 비고 (Notes) |
|------|------|-------|
| `build_train_args()` | `command_builders.py` | `python -m lerobot.scripts.train` 래핑 |
| `/api/train/start` | `server.py` | `/api/record/start`와 동일한 패턴 |
| `/api/train/stop` | `server.py` | `ProcessManager.stop("train")`을 통해 실행 |
| 학습 탭 UI | `index.html` + `main.js` | 새로운 `TrainTab` 클래스 |

**MVP UI 컨트롤**

- 정책(Policy) 유형 선택기: ACT / Diffusion / TDMPC2
- 데이터셋 레포지토리 ID 입력 (녹화 탭 설정에서 미리 채워짐)
- 학습 단계(steps) 수
- 장치(Device) 선택기: cuda / cpu (로드 시 GPU 자동 감지)
- 시작(Start) / 중지(Stop) 버튼 + 로그 출력 패널

**+α (MVP 이후 추가 사항)**

- 실시간 손실(loss) 곡선 차트 (stdout 파싱 → Chart.js 연동)
- GPU 사용률 모니터 (`/api/gpu/status`를 통한 `nvidia-smi` 폴링)
- 체크포인트 목록 및 체크포인트에서 재개
- 완료 시 HuggingFace Hub 자동 업로드

**알려진 제약 사항**

- LeRobot 학습은 Hydra 설정을 사용합니다 — 20개 이상의 모든 파라미터가 아닌 핵심 파라미터만 노출합니다.
- 감지된 GPU가 없으면 학습 탭을 숨기거나(또는 경고 표시) 합니다.
- 장기 실행 프로세스(수 시간~수 일) → 서버 재시작 시 프로세스가 종료되므로, 이 제한 사항을 명확히 문서화해야 합니다.

---

## 2단계 (Phase 2) — 오픈 소스(OSS) 준비

**목표**: LeRobot 커뮤니티에서 기여할 수 있는 프로젝트로 만듭니다.

- [ ] `CONTRIBUTING.md` — 설정 가이드, PR 흐름, 코드 스타일
- [ ] GitHub Actions CI — pylint + 기본 임포트/시작 테스트
- [ ] 이슈 템플릿 — 버그 리포트(Bug report), 기능 요청(Feature request)
- [ ] Docker 이미지 — 단일 명령(`docker run`) 시작
- [ ] LeRobot Discord / HuggingFace 포럼에 공지

---

## 3단계 (Phase 3) — 다중 로봇 & 플러그인 아키텍처

**목표**: 하드코딩 없이 SO-100/SO-101 이외의 로봇을 지원합니다.

- 로봇 유형을 설정 스키마로 추상화 (현재 `ROBOT_TYPES` 목록에 하드코딩됨)
- 플러그인 인터페이스: YAML 파일을 추가하여 새로운 로봇 유형 추가 지원
- 커뮤니티 기여 로봇 프로필 (Koch v1.1, Moss v1, Aloha 등)

---

## 4단계 (Phase 4) — 데이터셋 브라우저

**목표**: GUI를 벗어나지 않고 녹화된 에피소드를 검토하고 큐레이션합니다.

- `~/.cache/huggingface/lerobot/`의 로컬 데이터셋 목록 표시
- 에피소드 재생 (카메라 프레임 + 모터 위치 리플레이)
- 에피소드 삭제 / 태그 / 내보내기
- 기본 통계: 에피소드 수, 태스크 분포, 녹화 시간

---

## 5단계 (Phase 5) — 원격 조작 (Remote Operation)

**목표**: 네트워크를 통해 다른 머신에서 로봇을 조작합니다.

- WebRTC 카메라 스트리밍 (지연 시간 단축, MJPEG 대체)
- WebSocket을 통한 원격 조작 (브라우저에서 관절 명령 전송)
- 인증 레이어 (토큰 기반, 단일 사용자)

---

## 의존성 맵 (Dependency Map)

```
1단계 (학습)        — 독립적, 지금 구축 가능
2단계 (OSS)        — 독립적, 지금 구축 가능
3단계 (플러그인)    — 2단계의 커뮤니티 검증 필요
4단계 (데이터셋)    — 독립적, 1단계 이후 구축 가능
5단계 (원격 조작)   — 3단계의 안정성 확보 이후 가능
```
