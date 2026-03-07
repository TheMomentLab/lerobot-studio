# Developer Manual: Restart Guide (Frontend/Backend)

이 문서는 LeStudio 개발 중에 "어떤 변경에 어떤 프로세스를 재시작해야 하는지"를 빠르게 판단하기 위한 운영 가이드입니다.

## Dev Mode vs Production Mode

LeStudio는 두 가지 실행 방식이 있습니다.

### 1. Production Mode (실제 로봇 사용)

백엔드만 실행하면 됩니다. 프론트엔드는 `npm run build`로 빌드된 정적 파일을 FastAPI가 서빙합니다.

```bash
conda activate lerobot
lestudio serve --port 8000
# 브라우저에서 http://localhost:8000 접속
```

- 프론트 코드를 수정했으면 `cd frontend && npm run build` 후 브라우저 새로고침 필요
- 백엔드가 실제 API에 응답하므로 실제 로봇/데이터와 연동됩니다

### 2. Dev Mode (개발/UI 작업)

프론트엔드 Vite dev 서버와 백엔드를 함께 띄웁니다.

```bash
# Terminal A (Backend)
conda activate lerobot
lestudio serve --port 8000

# Terminal B (Frontend) — 백엔드와 연동 (passthrough 모드)
cd frontend
npm run dev
```

- 프론트 개발 서버: `http://localhost:5173`
- 백엔드 API/WS: `http://localhost:8000`
- Vite가 `/api`, `/ws`를 백엔드로 프록시합니다

### 3. Mock Mode (백엔드 없이 UI만 개발)

백엔드 없이 프론트엔드만 실행합니다. 모든 API 요청은 `frontend/src/mock-api/handlers.ts`의 가짜 데이터로 처리됩니다.

```bash
cd frontend
npm run dev -- --mode mock
# 또는 .claude/launch.json 설정 사용 시 자동으로 mock 모드로 시작됨
```

- 백엔드 없이도 UI 전체를 탐색할 수 있습니다
- **주의:** mock 모드에서는 백엔드를 켜도 API 요청이 백엔드로 가지 않습니다. 실제 연동 테스트는 반드시 passthrough 모드(위의 Dev Mode)를 사용하세요.
- `VITE_API_TRANSPORT_MODE=mock`으로 제어됩니다 (`frontend/.env.mock` 참고)

## Restart Matrix

| 변경 대상 | 재시작 대상 | 이유/메모 |
|---|---|---|
| `frontend/src/**/*.tsx`, `frontend/src/**/*.ts`, `frontend/src/**/*.css` | 없음 (대부분) | `npm run dev`(Vite)에서 HMR/라이브 리로드로 즉시 반영 |
| `frontend/vite.config.ts` | Frontend만 | Vite 서버 설정은 프로세스 시작 시 로드됨 |
| `frontend/package.json`, 락파일, 의존성 설치(`npm i`, `npm ci`) | Frontend만 | 모듈 그래프/의존성이 바뀌면 dev 서버 재시작 필요 |
| `src/lestudio/**/*.py` (routes, `server.py`, `process_manager.py`, `command_builders.py` 등) | Backend만 | 현재 `lestudio serve`는 `uvicorn.run(..., reload=...)`를 사용하지 않아 자동 리로드가 없음 |
| 백엔드 실행 플래그/환경변수 변경 (`--host`, `--port`, CORS/토큰 환경변수 등) | Backend만 | 서버 부팅 시점에 반영되는 설정 |
| 프론트와 백엔드를 동시에 수정 | 기본: Backend만, Frontend는 상황별 | 프론트가 `src/` 코드만 변경이면 재시작 불필요. 단, Vite 설정/의존성 변경이면 Frontend도 재시작 |

## Static Serve Mode (Vite 없이 FastAPI만 실행)

`npm run dev`를 쓰지 않고 FastAPI가 `src/lestudio/static`을 직접 서빙하는 모드에서는 아래 규칙을 따릅니다.

1. 프론트 코드 수정 후 `cd frontend && npm run build` 실행
2. 브라우저 새로고침
3. 일반적으로 Backend 재시작은 불필요

## Quick Commands

### 서버 시작

```bash
# Frontend (mock 모드)
cd frontend && npm run dev -- --mode mock

# Frontend (passthrough 모드 — 백엔드 연동)
cd frontend && npm run dev

# Backend
conda activate lerobot
lestudio serve --port 8000
```

### 서버 종료

```bash
# 터미널에서 직접 실행 중인 경우
Ctrl+C

# 백그라운드 프로세스로 실행 중인 경우 포트로 찾아서 종료
lsof -ti :5173 | xargs kill   # Frontend (Vite)
lsof -ti :8000 | xargs kill   # Backend (FastAPI)

# 포트를 모를 때 — 프로세스 이름으로 찾기
# 주의: `pgrep -a node`는 VS Code, TypeScript 서버 등 무관한 프로세스도 함께 나옴
pgrep -af "vite"       # Vite dev 서버만 필터링
pgrep -a uvicorn       # FastAPI 백엔드
pgrep -a lestudio      # lestudio CLI로 실행한 경우

# 찾은 PID로 종료
kill <PID>

# 한번에 이름으로 종료
pkill -f "vite"        # Frontend
pkill -f "uvicorn"     # Backend
```

### 재시작

```bash
# Frontend만 재시작
Ctrl+C
npm run dev          # passthrough 모드 (백엔드 연동)
# 또는
npm run dev -- --mode mock  # mock 모드 (백엔드 없이)

# Backend만 재시작
Ctrl+C
conda activate lerobot
lestudio serve --port 8000
```

### 프론트 빌드 후 Production 반영

```bash
cd frontend
npm run build
# → src/lestudio/static/ 에 빌드 결과 출력
# → 백엔드 재시작 없이 브라우저 새로고침만으로 반영됨
```

## Source of Truth (Repository Evidence)

- Frontend dev 스크립트: `frontend/package.json`
- Vite 프록시(`/api`, `/ws`)와 빌드 출력 경로(`../src/lestudio/static`): `frontend/vite.config.ts`
- Mock 모드 환경변수 설정: `frontend/.env.mock` (`VITE_API_TRANSPORT_MODE=mock`)
- Mock API 핸들러: `frontend/src/mock-api/handlers.ts`
- Claude Code dev server 설정 (mock 모드 포함): `.claude/launch.json`
- Backend 개발 실행 명령 예시: `CONTRIBUTING.md`
- Backend 실행 구현(`uvicorn.run(...)`): `src/lestudio/cli.py`
- FastAPI 정적 파일 서빙 마운트(`StaticFiles(..., html=True)`): `src/lestudio/server.py`
