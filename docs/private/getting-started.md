# LeStudio 처음 시작하기

처음 클론부터 서버 실행까지의 전체 과정을 다룹니다.

## 사전 요구사항

| 항목 | 필수 여부 | 비고 |
|---|---|---|
| Linux (Ubuntu 22.04+) | 필수 | udev, `/dev/video*` 접근 필요. macOS/Windows 미지원 |
| Python 3.10+ | 필수 | conda 환경 권장 |
| Node.js 20+ | 필수 | 프론트엔드 빌드용 |
| Git | 필수 | 서브모듈 포함 클론 |
| 카메라 / 로봇 암 | 선택 | 없어도 서버 자체는 정상 동작 |
| CUDA + nvidia-smi | 선택 | Train 탭 GPU 학습 시 필요 |
| HuggingFace 토큰 | 선택 | Hub push/download 시 `huggingface-cli login` 필요 |

## Step 1: 클론

```bash
git clone --recursive https://github.com/TheMomentLab/lestudio.git
cd lestudio
```

> `--recursive` 필수 — `lerobot/` 디렉토리가 git submodule(TheMomentLab fork)로 포함되어 있습니다.
> 이미 클론한 후 서브모듈이 비어 있다면: `git submodule update --init --recursive`

## Step 2: Conda 환경 생성

```bash
conda create -n lerobot python=3.10 -y
conda activate lerobot
```

## Step 3: 디바이스 권한 설정 (하드웨어 사용 시)

카메라나 로봇 암을 연결해서 사용할 경우, 현재 사용자에게 디바이스 접근 권한이 필요합니다.

```bash
sudo usermod -aG video,dialout $USER
```

> **적용을 위해 로그아웃 후 재로그인** (또는 재부팅) 필요합니다.
> 하드웨어 없이 소프트웨어만 테스트하는 경우 이 단계는 생략 가능합니다.

| 그룹 | 대상 디바이스 | 용도 |
|---|---|---|
| `video` | `/dev/video*` | 카메라 접근 |
| `dialout` | `/dev/ttyUSB*`, `/dev/ttyACM*` | 로봇 암 시리얼 포트 |

## Step 4: 패키지 설치

두 가지 옵션이 있습니다:

### 옵션 A: `make install` (가벼운 설치)

```bash
make install
```

- lerobot을 `--no-deps`로 설치 (의존성 없이 코드만)
- **torch 등 lerobot 의존성이 이미 환경에 있어야** teleop/train 등이 동작
- 빠르고 기존 환경을 건드리지 않음

### 옵션 B: `make install-full` (전체 설치, 권장)

```bash
make install-full
```

- lerobot 의존성을 전부 설치
- 처음 시작하는 경우 이 옵션 권장
- **주의**: torch 버전이 변경될 수 있음 (CUDA 버전과 맞는지 확인 필요)

### 내부 동작

```
make install-full 은 다음을 순서대로 실행합니다:
1. git submodule update --init --recursive
2. pip install -e lerobot          # lerobot 패키지 (editable + 전체 의존성)
3. pip install -e .                # lestudio 패키지 (editable)
```

## Step 5: 프론트엔드 빌드

```bash
make build-frontend
```

내부적으로 `cd frontend && npm ci && npm run build`를 실행합니다.
빌드 결과물이 `src/lestudio/static/`에 배치되며, 이 파일이 없으면 서버가 빈 페이지를 서빙합니다.

## Step 6: 설치 검증

### 6-1. 백엔드 컴파일 체크

```bash
python -m compileall -q src/lestudio
```

import 에러나 문법 오류가 있으면 여기서 잡힙니다.

### 6-2. 유닛 테스트 (하드웨어 불필요)

```bash
PYTEST_DISABLE_PLUGIN_AUTOLOAD=1 python -m pytest -q -m "not smoke_hw" tests
```

또는 Makefile 단축 명령:

```bash
make test
```

### 6-3. 린터 & 타입 체크 (선택)

```bash
# 린터
pip install ruff
ruff check src/lestudio

# 타입 체크
pip install mypy
mypy src/lestudio --ignore-missing-imports
```

### 6-4. 프론트엔드 타입 체크 (선택)

```bash
cd frontend && npx tsc --noEmit
```

## Step 7: 서버 실행

```bash
lestudio
```

- 기본 주소: `http://localhost:7860`
- 브라우저가 자동으로 열립니다 (SSH 환경에서는 자동 열림 생략)

### 주요 옵션

```bash
# 브라우저 자동 열기 비활성화
lestudio --no-browser

# 포트 변경
lestudio --port 8080

# LAN 노출 (같은 네트워크의 다른 기기에서 접속)
lestudio --host 0.0.0.0

# 모든 옵션 조합
lestudio serve --port 8080 --host 0.0.0.0 --no-browser
```

## Step 8: 디바이스 매핑 & udev 규칙 적용 (하드웨어 사용 시)

카메라와 로봇 암을 안정적인 이름(`top_cam_1`, `follower_arm_1` 등)으로 바인딩합니다.

### 방법 A: 웹 UI (권장)

1. 브라우저에서 **Mapping** 탭 진입
2. 카메라/암 역할 매핑 설정
3. **Apply** 버튼 클릭 (sudo 또는 pkexec로 권한 상승)

### 방법 B: CLI

웹 UI에서 매핑을 저장한 뒤, 터미널에서 적용:

```bash
# 적용할 명령 미리 확인
lestudio install-udev --dry-run

# 실제 적용
lestudio install-udev
```

> headless/SSH 환경에서 pkexec를 사용할 수 없을 때 유용합니다.

## 개발 모드 (프론트엔드 HMR)

프론트엔드를 수정하면서 실시간 반영을 보려면 터미널 2개를 사용합니다:

**터미널 1 — 백엔드:**

```bash
conda activate lerobot
lestudio serve --port 8000 --no-browser
```

**터미널 2 — 프론트엔드 (Vite dev server):**

```bash
cd frontend
npm run dev
```

Vite dev server(`http://localhost:5173`)에서 접속하면 코드 변경이 즉시 반영됩니다.

## 워크플로우 순서

서버 실행 후 웹 UI에서 다음 순서로 진행합니다:

1. **Status** — 카메라/암 인식 및 시스템 상태 확인
2. **Mapping** — 디바이스를 안정적 이름으로 매핑 + udev 규칙 적용
3. **Motor Setup** — 모터 셋업 (하드웨어에 따라 필요)
4. **Calibration** — follower/leader 암 캘리브레이션
5. **Teleop** — 원격 조작 테스트 (preflight 체크 포함)
6. **Record** — 에피소드 녹화
7. **Dataset** — 데이터 확인, 큐레이션, Hub push
8. **Train** — 학습 시작 및 실시간 모니터링
9. **Eval** — 정책 평가

## 트러블슈팅

### `make install-full` 중 torch 충돌

CUDA 버전에 맞는 torch를 먼저 설치한 뒤 `make install`(no-deps)을 사용하세요:

```bash
# 예: CUDA 12.1
pip install torch torchvision --index-url https://download.pytorch.org/whl/cu121
make install
```

### 카메라가 인식되지 않음

```bash
# 디바이스 존재 확인
ls /dev/video*

# 권한 확인
groups $USER | grep video

# 임시 권한 부여 (테스트용)
sudo chmod 666 /dev/video0
```

### lerobot을 찾을 수 없음

```bash
# 서브모듈 초기화 확인
git submodule update --init --recursive

# 설치 확인
pip list | grep lerobot
```

### 프론트엔드가 빈 페이지

`src/lestudio/static/` 디렉토리에 빌드 결과물이 있는지 확인:

```bash
ls src/lestudio/static/
# index.html, assets/ 등이 있어야 합니다
make build-frontend
```

### 포트 충돌

```bash
# 7860 포트를 사용 중인 프로세스 확인
lsof -i :7860

# 다른 포트로 실행
lestudio --port 8080
```

## 빠른 검증 체크리스트

하드웨어 없이 소프트웨어만 검증할 때:

```bash
conda activate lerobot
make install-full                    # 패키지 설치
python -m compileall -q src/lestudio # 컴파일 체크
make test                            # 유닛 테스트
make build-frontend                  # 프론트엔드 빌드
lestudio --no-browser &              # 서버 기동
curl -s http://localhost:7860/api/status | head -c 200  # API 응답 확인
kill %1                              # 서버 종료
```
