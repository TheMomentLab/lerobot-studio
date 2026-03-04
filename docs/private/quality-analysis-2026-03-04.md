# LeStudio 종합 품질 분석

최종 갱신: 2026-03-04  
상태: 스냅샷 (Point-in-time)  
범위: UI/UX · 코드 품질 · OSS 필수요소 · 프로젝트 성장 가능성

---

## 1. UI/UX 분석

### 1-1. 현재 shipped UI 탭별 평가

| 탭 | 장점 | 개선 포인트 |
|---|---|---|
| Status | 4분할 카드, 색상 상태 도트, 컨텍스트 CTA 버튼 | 스크롤 없이 GPU/디스크 정보 미노출 |
| Record | Step 1/2/3 워크플로우 가이드, 라이브 카메라 피드 | 2컬럼이 좁은 해상도에서 밀림 |
| Dataset | Hub 검색 + 로컬 목록 통합 구성 | "No dataset selected" 빈 상태 공간 낭비 |
| Train | GPU 상태 + 체크포인트 브라우저 + 프리셋 버튼 우수 | Colab 안내 텍스트가 길고 무거움 |

### 1-2. uiux-audit/ — 발견된 대안 디자인

`uiux-audit/` 폴더에 현재 shipped UI와 구별되는 **스텝퍼 기반 대안 디자인**이 존재한다.

현재 shipped 방식과의 비교:

| 항목 | 현재 shipped | uiux-audit 방향 |
|---|---|---|
| 내비게이션 | 사이드바 9개 항목 | 상단 breadcrumb 스텝퍼 (`System Status › Camera Setup`) |
| 섹션 전환 | 탭 클릭 | 섹션별 탭 분리 (`Recording Plan \| Device \| Camera`) |
| 상태 표시 | 색상 도트 | N/M 카운터 (`2/3 linked`) |
| 콘솔 | 하단 드로어 | 하단 고정 프로세스 탭바 |

uiux-audit 방향이 신규 사용자 온보딩에 더 친화적이지만, 현재 shipped UI가 기능 밀도는 높다. 두 방향의 장점을 통합하는 것이 이상적이다.

### 1-3. 전체 UX 평가

**점수: B+**

강점:
- 다크 테마 일관성
- 프리플라이트 체크 (Teleop/Record 진입 전 상태 검증)
- 녹화 중 카메라 피드 실시간 가시성 (SHM 기반)
- READY/RUNNING 상태 배지 명확성
- 키보드 단축키 (Recording → 에피소드 저장/폐기/중단)
- 데스크톱 알림 (프로세스 완료/오류 시)

약점:
- 사이드바 9개 항목이 신규 사용자에게 과부하
- 빈 상태 처리 불일관 (`EmptyState` 컴포넌트 vs 인라인 `<p>`)
- 파괴적 액션(히스토리 삭제) 일부에 확인 없음
- 부트스트랩 로딩 중 UI 스켈레톤 없음 (빈 셸 노출)

---

## 2. 코드 품질 점검

### 2-1. Python 백엔드

**점수: B+**

#### 아키텍처 강점
- LeRobot import 경계 5개 파일 격리 완전 준수, CI에서 자동 검증
- `shell=True` 없음 — subprocess injection 위험 차단
- `create_app()` 팩토리 패턴으로 깔끔한 라우터 조립
- 프로세스 종료 시 카메라 lock 자동 해제 (`on_process_exit` 훅)
- `secrets.compare_digest` 사용 (타이밍 공격 방지)
- 학습/런타임 로그의 사용자 친화적 오류 번역 (`process_manager.py:45–69`)

#### 주요 기술 부채

**오류 처리 — 조용한 실패 패턴**
```python
# motor_monitor_bridge.py:159, 176, 183, 189 외 다수
except Exception:
    pass
```
오류를 삼키면 진단이 불가능해진다. 최소 `logger.debug()` 수준 기록 필요.

**API 응답 형식 비일관**
```python
# routes/process.py:52, 73, 95 — 실패를 200 OK로 반환
return {"ok": False, "error": "..."}

# routes/dataset/listing.py:82, 170 — 올바른 HTTP 코드 사용
return JSONResponse(status_code=404, ...)
```
같은 코드베이스에서 두 패턴이 혼재한다. Pydantic 모델 기반으로 통일 필요.

**커맨드 빌더 내 파일시스템 뮤테이션**
```python
# command_builders.py:18–29
# "인수 생성" 함수 안에서 캐시 디렉터리를 삭제 — 단일 책임 원칙 위반
def resolve_record_resume(...):
    shutil.rmtree(cache_dir)  # ← 부작용
    return args
```

**중복 라인 (버그 소지)**
- `process_manager.py:289, 291` — 동일 poll 조건 중복
- `routes/training.py:6, 7` — `import json` 중복
- `routes/dataset/hub.py:194, 195` — 중복 return

**보안 고려사항**
- localhost 신뢰 기반 auth bypass (`_auth.py:51–63`) — 리버스 프록시 환경에서 footgun 가능
- HF 토큰 평문 파일 저장 (chmod best-effort)
- CORS 와일드카드 env 허용 (`_cors.py:28–29`) — 공유 네트워크에서 위험

**타입 안전성**
- 고영향 엔드포인트에 raw `dict` body 수용 (Pydantic 미적용)
- `command_builders.py`, 다수 라우터에 `dict/Any` 페이로드 만연
- Pydantic 부분 도입 (`routes/models.py`)되었으나 미완

### 2-2. React 프론트엔드

**점수: B+**

#### 타입 안전성: 탁월

```
any 타입 사용: 0건
@ts-ignore / @ts-expect-error: 0건
```

`contracts.ts`의 `getString()`/`getNumber()`/`asRecord()` 런타임 정규화 레이어는 백엔드 unknown 페이로드를 안전하게 처리하는 모범 사례다.

#### God Component 문제 — 최대 우선순위

| 파일 | 라인 수 | 심각도 |
|---|---|---|
| `DatasetManagement.tsx` | 1,840 | 🔴 Critical |
| `MotorSetup.tsx` | 1,375 | 🔴 Critical |
| `Training.tsx` | 1,214 | 🔴 Critical |
| `AppShell.tsx` | 1,044 | 🔴 Critical |
| `Evaluation.tsx` | 1,017 | 🔴 Critical |
| `Recording.tsx` | 749 | 🟡 Warning |
| `Teleop.tsx` | 599 | 🟡 Warning |
| `Calibration.tsx` | 575 | 🟡 Warning |

MotorSetup은 5개 서브탭 + `useState` 38개, DatasetManagement는 `useState` 43개. 분리가 시급하다.

#### 상태 관리

store(`store/index.ts`)는 `useSyncExternalStore`를 직접 구현한 방식으로, Zustand 없이도 깔끔하게 설계되었다. 전역 스토어 자체는 양호하나 로컬 상태 과잉이 문제:

| 페이지 | `useState` 수 | API 호출 수 |
|---|:-:|:-:|
| DatasetManagement | 43 | 25 |
| MotorSetup | 38 | 17 |
| Training | 33 | 15 |
| Recording | 29 | 10 |
| Teleop | 23 | 7 |

`LeStudioConfig = Record<string, unknown>` — 가장 중요한 타입이 완전히 비어있어 ~50곳에서 `as string` 캐스팅이 반복된다.

#### 중복 패턴

Teleop, Recording, Calibration이 각각 동일한 디바이스+캘리브레이션 로딩 코드를 복붙:
```typescript
// 3개 파일에 동일 패턴 존재 — useDevicesAndCalibration() 훅으로 추출 필요
const res = await apiGet("/api/devices");
const cameras = res.cameras.filter(...);
const armIds = await apiGet("/api/calibrate/list");
```

`ActionResponse`, `ArmDevice`, `DevicesResponse`, `CalibFile` 타입이 3–6개 파일에 개별 정의.  
→ 중앙 `types/api.ts`로 통합 필요.

#### AGENTS.md 스테일 문제

현재 AGENTS.md가 실제 구조와 불일치한다:

| AGENTS.md 기술 | 실제 |
|---|---|
| `tabs/XxxTab.tsx` | `pages/` (CameraSetup, MotorSetup...) |
| "Zustand" | `useSyncExternalStore` 직접 구현 |
| "plain CSS (no Tailwind)" | Tailwind CSS 4 + ShadCN UI |
| `hooks/useConfig.ts` 등 | 실제로는 다른 4개 훅 |

#### 강점

- `useSyncExternalStore` 직접 구현으로 프레임워크 의존성 제거
- Dataset/Training/Evaluation 3개 heavy page 모두 lazy loading 적용 (`routes.ts`)
- `App.tsx`에서 `Promise.allSettled()`로 5개 병렬 부트스트랩 (graceful degradation)
- `services/contracts.ts` — 백엔드-프론트엔드 anti-corruption 레이어
- `services/notifications.ts` — cooldown 중복제거 포함 데스크톱 알림

---

## 3. OSS 필수요소 점검

### 3-1. 체크리스트

| 항목 | 상태 | 비고 |
|---|---|---|
| LICENSE (Apache-2.0) | ✅ | 로보틱스 생태계 적합, 기업 채택 용이 |
| README.md | ✅ | 스크린샷·기능 목록·설치·워크플로우 가이드 포함 |
| README.ko.md | ✅ | 한국어 대응 |
| CONTRIBUTING.md | ⚠️ | adapter 파일 수 4개 기술 → 실제로 5개 |
| CHANGELOG.md | ✅ | Keep a Changelog 형식, README 링크는 잘못된 파일 지목 |
| CODE_OF_CONDUCT.md | ✅ | Contributor Covenant 2.1 |
| SECURITY.md | ✅ | |
| CI/CD 백엔드 | ✅ | lint(ruff) + mypy + test + import 경계 검사 |
| CI/CD 프론트엔드 | ✅ | tsc + build |
| Import 경계 CI 자동 검사 | ✅ | `rg`로 위반 탐지 — 희귀한 강점 |
| Issue 템플릿 | ⚠️ | YAML + Markdown 중복 존재 (통일 필요) |
| PR 템플릿 | ✅ | |
| Dockerfile | ✅ | 멀티스테이지 |
| MkDocs 문서 사이트 | ✅ | GitHub Pages 자동 배포 |
| 백엔드 테스트 | ✅ | 12개 파일, smoke_hw 분리 |
| **프론트엔드 테스트** | ❌ | `.test.ts(x)` 파일 전무 |
| **API 문서** | ❌ | FastAPI `/docs` 언급 없음, 별도 레퍼런스 없음 |
| pyproject.toml | ⚠️ | `mypy`, `httpx` dev deps 중복 |
| **frontend/package.json** | 🔴 | `lint`/`test` 스크립트 없으나 README·CONTRIBUTING·PR 템플릿에서 요구 |
| **frontend/README.md** | 🔴 | Figma 자동생성 보일러플레이트 그대로 (`HelloWorld` 제목) |
| README changelog 링크 | ⚠️ | `CHANGELOG.md` 아닌 `docs/release-checklist.md`를 지목 |

**OSS 필수요소 종합 점수: A-**

문서·라이선스·CI 기반은 탄탄하다. 프론트엔드 테스트 부재, 커맨드 drift(문서 ↔ 실제 스크립트 불일치), AGENTS.md 스테일이 신규 컨트리뷰터 온보딩 마찰의 주원인이다.

### 3-2. 신규 컨트리뷰터 첫 1시간 마찰 포인트

1. `frontend/package.json`에 `lint` 스크립트가 없는데 `CONTRIBUTING.md`가 `npm run lint`를 요구
2. `AGENTS.md`가 존재하지 않는 디렉터리 구조를 기술 → 코드 탐색 혼란
3. `frontend/README.md`가 "HelloWorld" Figma 보일러플레이트 → 프론트 진입점 설명 없음
4. `docs/private/`와 `docs_public/`의 분리 기준이 신규자 입장에서 불명확

---

## 4. 프로젝트 컨셉 및 성장 가능성

### 4-1. 컨셉 평가

LeRobot은 의도적으로 CLI-first로 설계되어 있으며, 하드웨어 셋업(udev, 캘리브레이션, teleop)이 모두 터미널 명령이다. LeStudio는 이 마찰을 정확히 겨냥한다:

- **타겟 사용자**: 로봇공학 연구자 / ML 엔지니어 (CLI 거부감이 있는 사용자층)
- **핵심 가치**: 전체 파이프라인(하드웨어 셋업 → 학습 → 평가)을 GUI 단일 창으로
- **차별점**: 단순 wrapper가 아닌 SHM 기반 카메라 공유, 키보드 브리지, 프리플라이트 체크 등 실제 운영 문제를 해결

이 포지션은 `oss-readiness-analysis.md`에서 이미 Automatic1111 패턴과의 유사성으로 분석된 바 있으며, 그 판단이 여전히 유효하다.

### 4-2. 성장 가능성 요인

| 요인 | 평가 | 비고 |
|---|---|---|
| 시장 타이밍 | 🟢 | LeRobot 생태계 폭발 성장 중 (SO-100/SO-101 커뮤니티) |
| 기술 완성도 | 🟢 | SHM 공유·프로세스 관리 등 LeRobot 내부 구조 이해 기반 |
| 파이프라인 완성도 | 🟢 | Setup → Eval 전체 커버 — 경쟁 도구 대부분 부분 커버 |
| 라이선스 | 🟢 | Apache-2.0, 기업 채택 용이 |
| 플랫폼 제약 | 🟡 | Linux 전용 (udev 의존) — Windows/macOS 배제 |
| 생태계 종속성 | 🟡 | HuggingFace LeRobot 의사결정에 바인딩 |
| 프론트엔드 테스트 | 🔴 | 테스트 없음 → 기능 성장 시 회귀 위험 증가 |

### 4-3. 주요 성장 기회

1. **LeRobot 공식 채널 언급** — Discord/문서에서 "recommended GUI"로 포지셔닝
2. **Windows/WSL 지원** — udev 없이도 기본 기능(카메라 확인, 데이터셋 관리, 학습)이 동작하면 잠재 사용자 대폭 확대
3. **플러그인 아키텍처 공식화** — 5파일 경계 구조가 이미 어댑터 교체를 설계적으로 지원. 커뮤니티가 직접 로봇 어댑터를 기여할 수 있는 공식 인터페이스로 문서화
4. **uiux-audit 아이디어 통합** — 스텝퍼 기반 안내 흐름이 신규 사용자 온보딩 경험을 크게 개선할 수 있음

---

## 5. 액션 아이템 요약

### P0 — 즉시 수정 (문서 drift 해소)

| # | 항목 | 파일 |
|---|---|---|
| 1 | `frontend/package.json`에 `lint`/`test` 스크립트 추가 | `frontend/package.json` |
| 2 | `AGENTS.md` 실제 구조로 업데이트 (5개 adapter, `pages/`, Tailwind, 실제 훅 이름) | `AGENTS.md` |
| 3 | `frontend/README.md` Figma 보일러플레이트 제거 | `frontend/README.md` |
| 4 | `CONTRIBUTING.md` adapter 파일 수 4 → 5 수정 | `CONTRIBUTING.md` |
| 5 | `README.md` changelog 링크 수정 (`docs/release-checklist.md` → `CHANGELOG.md`) | `README.md` |

### P1 — 단기 개선 (코드 품질)

| # | 항목 | 파일 |
|---|---|---|
| 6 | `LeStudioConfig = Record<string, unknown>` → 타입드 인터페이스 교체 | `store/types.ts` |
| 7 | `ActionResponse`, `ArmDevice`, `DevicesResponse` → 중앙 `types/api.ts` 통합 | 신규 파일 |
| 8 | `useDevicesAndCalibration()` 공통 훅 추출 (Teleop/Recording/Calibration 중복 제거) | 신규 훅 |
| 9 | `MotorSetup.tsx` 5개 서브탭 → 별도 컴포넌트 파일 분리 | `MotorSetup.tsx` |
| 10 | `motor_monitor_bridge.py`의 `except Exception: pass` → logging으로 교체 | `motor_monitor_bridge.py` |
| 11 | Issue 템플릿 YAML + Markdown 중복 → 하나로 통일 | `.github/ISSUE_TEMPLATE/` |
| 12 | `pyproject.toml` dev deps 중복 제거 (`mypy`, `httpx`) | `pyproject.toml` |
| 13 | 에러 바운더리(`<ErrorBoundary>`) 추가 | `App.tsx` |
| 14 | 프론트엔드 기본 테스트 추가 (store + 핵심 훅) | `frontend/src/` |

### P2 — 중기 개선 (UX + 아키텍처)

| # | 항목 |
|---|---|
| 15 | 백엔드 API 응답 형식 통일 (HTTP 상태 코드 vs `{"ok": false}`) |
| 16 | `uiux-audit` 스텝퍼 아이디어의 핵심 요소(breadcrumb, N/M 카운터) 현재 UI에 통합 |
| 17 | `DatasetManagement.tsx`, `Training.tsx`, `Evaluation.tsx` 서브컴포넌트 분리 |
| 18 | 부트스트랩 로딩 스켈레톤 추가 |
| 19 | FastAPI `/docs` 엔드포인트 README에 명시 또는 별도 API 레퍼런스 작성 |

---

## 6. 관련 문서

- 경쟁 환경 전략: [`strategy-competitive-analysis.md`](strategy-competitive-analysis.md)
- OSS 공개 준비도 (이전 스냅샷): [`oss-readiness-analysis.md`](oss-readiness-analysis.md)
- 3.0 품질 게이트: [`quality-improvement-plan.md`](quality-improvement-plan.md)
- 리팩터링 계획: [`refactoring-plan.md`](refactoring-plan.md)
- UI/UX 회귀 체크리스트: [`uiux-regression-checklist.md`](uiux-regression-checklist.md)
- 생태계 통합 설계: [`ecosystem-integration-plan.md`](ecosystem-integration-plan.md)
