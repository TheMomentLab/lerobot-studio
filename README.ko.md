# LeStudio

[![CI](https://github.com/TheMomentLab/lestudio/actions/workflows/ci.yml/badge.svg)](https://github.com/TheMomentLab/lestudio/actions/workflows/ci.yml)
[![Docs](https://github.com/TheMomentLab/lestudio/actions/workflows/docs.yml/badge.svg)](https://themomentlab.github.io/lestudio/)
[![License](https://img.shields.io/badge/license-Apache%202.0-blue.svg)](LICENSE)
[![Python](https://img.shields.io/badge/python-3.10%2B-blue)](https://www.python.org/)

[Hugging Face LeRobot](https://github.com/huggingface/lerobot)을 위한 웹 기반 GUI 워크벤치 — 하드웨어 설정부터 정책 평가까지 전체 파이프라인을 지원합니다. CLI 중심의 LeRobot 워크플로우를 브라우저 인터페이스로 대체합니다.

**[문서](https://themomentlab.github.io/lestudio/)** · **[기여 가이드](CONTRIBUTING.md)** · **[변경 이력](CHANGELOG.md)**

> [English README](README.md)

## 스크린샷

| 상태 | 녹화 |
|---|---|
| ![Status](docs_public/assets/screenshot-status.png) | ![Record](docs_public/assets/screenshot-record.png) |

| 데이터셋 | 학습 |
|---|---|
| ![Dataset](docs_public/assets/screenshot-dataset.png) | ![Train](docs_public/assets/screenshot-train.png) |

## 기능

### 하드웨어 설정 & 운영
- **Status**: 실시간 CPU/RAM/Disk/GPU 모니터링과 함께 장치 및 프로세스 현황 표시.
- **Mapping**: 카메라 및 팔 udev 규칙 관리 — 생성, 미리보기, 적용, 검증, 삭제. Arm Identify Wizard(분리/재연결 diff 기반 팔 식별) 및 USB 대역폭 모니터링(피드별 실시간 fps/MB·s, 버스 사용률 바) 포함.
- **Motor Setup**: `lerobot_setup_motors`를 통한 모터 연결 및 설정.
- **Calibration**: 캘리브레이션 실행, 파일 관리, 삭제.

### 조작
- **Teleop**: 멀티카메라 원격 조작, preflight 점검, 실시간 카메라 피드(공유 메모리(SHM) 방식 — 텔레옵 실행 중에도 피드 유지).
- **Record**: 에피소드 녹화, 브라우저 키보드 브리지(next/abort), resume 지원, preflight 점검.

### 데이터
- **Dataset**: 로컬 데이터셋 조회, 에피소드 상세, 품질 검사, Hub push(진행률 추적).
- **Episode Replayer**: 멀티카메라 동기화 재생, 타임라인 스크러빙.
- **Episode Curation**: 에피소드별 삭제, 태그, 필터로 데이터 품질 관리.
- **Hub Search**: Hugging Face Hub에서 데이터셋 검색 및 다운로드.

### ML
- **Train**: LeRobot 학습 오케스트레이션 — CUDA preflight(호환 불가 빌드 자동 감지 + PyTorch 원클릭 재설치), 실시간 loss/LR 차트, ETA 추적, 하이퍼파라미터 프리셋(Quick / Standard / Full).
- **Checkpoint Browser**: 로컬 체크포인트 스캔 및 Eval 자동 연결.
- **Eval**: 정책 평가 실행, 실시간 프로세스 출력, 에피소드별 결과 추적.

### 일반
- **Global Console Drawer**: 프로세스별 stdout/stderr 통합 스트림 및 stdin 라우팅.
- **Error Translation**: CLI stderr 패턴 → 사용자 친화적 안내 메시지.
- **Session History**: 녹화, 학습, 평가 이벤트 타임라인.
- **Desktop Notifications**: 프로세스 완료 또는 오류 시 브라우저 알림.
- **다크/라이트 테마**: CSS 변수 기반 테마 전환.
- **반응형 레이아웃**: 데스크톱 사이드바, 태블릿 아이콘 레일, 모바일 서랍.

## 요구 사항

- Python 3.10+
- Linux (`udev` 규칙 및 `/dev/video*` 접근에 필요)
- `huggingface/lerobot`이 환경에 설치되어 있어야 함

### 선택 사항

- **udev 적용**: 패스워드 없는 `sudo` 또는 데스크톱 Polkit 인증 프롬프트(`pkexec`)가 있으면 원클릭으로 설치. SSH/헤드리스 환경에서는 LeStudio가 수동 명령을 제공.
- **Hub push / download**: `huggingface-cli login` 및 유효한 토큰 필요.
- **GPU 모니터링 / CUDA preflight**: 전체 Train 진단을 위해 CUDA 환경 및 `nvidia-smi` 필요.

## 설치

소스에서 설치:

```bash
git clone --recursive https://github.com/TheMomentLab/lestudio.git
cd lestudio
# 최초 1회 (필요 시): conda create -n lerobot python=3.10 -y
conda activate lerobot
make install
```

[커스텀 lerobot 포크](https://github.com/TheMomentLab/lerobot)는 git 서브모듈로 관리됩니다. `--recursive`로 자동으로 가져오며, `make install`이 두 패키지를 편집 가능 모드로 설치합니다.

## 실행

```bash
lestudio
```

서버는 `http://localhost:7860`에서 시작됩니다.

데스크톱 세션에서 브라우저를 자동으로 열려면 `--browser`를 사용하세요 (`lestudio --browser` 또는 `lestudio serve --browser`). SSH 또는 헤드리스 환경에서는 브라우저를 열지 않습니다.

### 커맨드라인 옵션

```
usage: lestudio [-h] {serve,install-udev} ...

서브커맨드:
  serve           LeStudio 웹 서버 시작 (서브커맨드 없이 실행 시 기본값)
  install-udev    sudo를 통해 udev 규칙 설치 (웹 UI 대신 CLI로 적용)

lestudio serve:
  --port PORT           서버 포트 (기본값: 7860)
  --host HOST           서버 호스트 (기본값: 127.0.0.1)
  --lerobot-path PATH   lerobot 소스 경로 (설치되어 있으면 자동 감지)
  --config-dir DIR      설정 디렉토리 (기본값: ~/.config/lestudio)
  --rules-path PATH     udev 규칙 파일 (기본값: /etc/udev/rules.d/99-lerobot.rules)
  --browser             시작 시 브라우저 자동 열기
  --no-browser          호환성 유지용 옵션(no-op); --browser를 주지 않으면 기본적으로 브라우저를 열지 않음
  --headless            --no-browser의 별칭
```

`serve`를 명시하지 않고도 플래그를 전달할 수 있습니다 — `lestudio --port 8080`은 `lestudio serve --port 8080`과 동일합니다.

### 네트워크 & CORS

- 기본 바인딩은 로컬 전용: `127.0.0.1`.
- LAN에 노출하려면: `lestudio serve --host 0.0.0.0`.
- 기본 CORS는 localhost 출처만 허용 (`localhost` / `127.0.0.1`).

환경 변수로 CORS를 재정의할 수 있습니다:

```bash
# 쉼표로 구분된 명시적 허용 목록
export LESTUDIO_CORS_ORIGINS="http://localhost:7860,https://studio.example.com"

# 선택적 정규식 재정의 (명시적 출처가 설정되지 않은 경우 사용)
export LESTUDIO_CORS_ORIGIN_REGEX='^https://(localhost|127\.0\.0\.1)(:\d+)?$'
```

개발 호환성을 위해 `LESTUDIO_CORS_ORIGINS="*"`도 지원되지만, 공유 네트워크에서는 권장하지 않습니다.

## 개발

```bash
conda activate lerobot
```

백엔드 검사:

```bash
python -m compileall -q src/lestudio
PYTEST_DISABLE_PLUGIN_AUTOLOAD=1 python -m pytest -q -m "not smoke_hw" tests
```

프론트엔드 검사:

```bash
cd frontend
npm ci
npx tsc --noEmit
npm run build
```

`npm run build`는 프론트엔드 번들을 `src/lestudio/static/`에 출력하며, FastAPI가 이 결과물을 직접 서빙합니다.

CI는 모든 push 시 이 검사를 자동으로 실행합니다: `.github/workflows/ci.yml`.

아키텍처 개요, PR 가이드라인, LeRobot import 경계 규칙은 [CONTRIBUTING.md](CONTRIBUTING.md)를 참조하세요.

하드웨어 스모크 테스트 (실제 장치 필요, 선택적):

```bash
LESTUDIO_RUN_HW_SMOKE=1 PYTEST_DISABLE_PLUGIN_AUTOLOAD=1 python -m pytest -q -m "smoke_hw" tests/smoke_hw
```

## 워크플로우 가이드

1. **Status** — 카메라와 팔이 감지되고 프로세스 상태가 정상인지 확인.
2. **Motor Setup** — 장치 매핑(udev 규칙), 팔 식별, 모터 설정, 캘리브레이션 실행.
3. **Camera Setup** — 카메라 스트림 및 USB 대역폭 확인.
4. **Teleop** — preflight 점검으로 동작 및 카메라 피드 검증.
5. **Record** — 목표 작업에 대한 에피소드 녹화.
6. **Dataset** — 에피소드 검토, 데이터 큐레이션, Hugging Face Hub push.
7. **Train** — 학습 시작 및 실시간 loss/메트릭 모니터링.
8. **Eval** — 정책 평가 실행으로 루프 완성.

## 라이선스

Apache 2.0 — [LICENSE](LICENSE) 참조.
