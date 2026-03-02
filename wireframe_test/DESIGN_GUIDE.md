# LeStudio — 와이어프레임 디자인 스타일 가이드

**목적**: 이 문서는 LeStudio 와이어프레임의 시각 디자인 토큰, 컴포넌트 패턴, 레이아웃 규칙을 정의합니다.
모든 페이지가 이 가이드를 준수하여 일관된 사용자 경험을 제공합니다.

> **⚠️ 원칙**: 와이어프레임 단계에서 최대한 통일된 시각 시스템을 유지합니다.
> 새 페이지나 컴포넌트를 추가할 때 반드시 이 가이드를 참조하세요.

최종 갱신: 2026-03-02

---

## 1. 컬러 시스템

### 1.1 기본 색상 (Zinc Monochrome)

모든 UI 요소의 기본 색상은 Zinc 계열입니다.

| 용도 | Light | Dark |
|---|---|---|
| 페이지 배경 | `bg-zinc-50` | `bg-zinc-950` |
| 카드/패널 배경 | `bg-white` | `bg-zinc-900` |
| 카드 헤더 배경 | `bg-zinc-50` | `bg-zinc-800/30` |
| 입력 필드 배경 | `bg-white` | `bg-zinc-800/50` |
| 기본 테두리 | `border-zinc-200` | `border-zinc-800` |
| 입력 필드 테두리 | `border-zinc-200` | `border-zinc-700` |
| 1차 텍스트 | `text-zinc-900` | `text-zinc-100` |
| 2차 텍스트 (제목) | `text-zinc-800` | `text-zinc-200` |
| 3차 텍스트 (설명) | `text-zinc-600` | `text-zinc-300` |
| 4차 텍스트 (부가) | `text-zinc-500` | `text-zinc-400` |
| 비활성 텍스트 | `text-zinc-400` | `text-zinc-500` |

### 1.2 시맨틱 색상

| 의미 | 텍스트 | 배경 (10%) | 테두리 (30%) |
|---|---|---|---|
| **Success / Running** | `emerald-400` | `emerald-500/10` | `emerald-500/30` |
| **Warning** | `amber-400` | `amber-500/10` | `amber-500/30` |
| **Error / Danger** | `red-400` | `red-500/10` | `red-500/30` |
| **Info (Hub 외부 ID만)** | `blue-400` / `blue-500` | `blue-500/10` | `blue-500/30` |

> **규칙**: `blue` 색상은 HuggingFace Hub ID 등 **외부 식별자** 표시에만 사용합니다.
> 그 외 모든 UI 강조는 `emerald`(긍정), `amber`(주의), `red`(위험), `zinc`(중립)을 사용합니다.

> **금지**: `-600` 변형 사용 금지. 항상 `-400` (텍스트) / `-500` (배경/테두리 기본) 사용.

### 1.3 StatusBadge 색상 매핑

```
running / ready  → emerald-400 텍스트, emerald-500/15 배경, emerald-500/30 테두리
warning          → amber-400 텍스트, amber-500/15 배경, amber-500/30 테두리
error / blocked  → red-400 텍스트, red-500/15 배경, red-500/30 테두리
idle             → zinc-400 텍스트, zinc-500/15 배경, zinc-600/30 테두리
```

### 1.4 상태 점 (Status Dot) 색상

```
connected / running / ready → bg-emerald-400
warning / unstable         → bg-amber-400
error / disconnected       → bg-red-400
idle / inactive            → bg-zinc-500 또는 bg-zinc-600
```

---

## 2. 타이포그래피

### 2.1 텍스트 크기

| 용도 | 클래스 | 비고 |
|---|---|---|
| 페이지 제목 | `text-base` (16px) | `PageHeader` 컴포넌트 |
| 섹션 제목 / 카드 헤더 | `text-sm` (14px) | `font-medium` 추가 |
| 본문 / 라벨 / 입력 | `text-xs` (12px) | **가장 많이 사용되는 기본 크기** |
| 코드 / ID / 수치 | `text-xs font-mono` | 모노스페이스 |

> **금지**: `text-[10px]`, `text-[11px]`, `text-[12px]` 등 임의 크기 사용 금지.
> 예외: 사이드바 그룹 라벨 (`fontSize: "10px" + uppercase tracking-wider`),
> 사이드바 뱃지 (`fontSize: "9px"`), 콘솔 로그 (`fontSize: "11px" font-mono`).
> 이 예외는 AppShell 내부에 한정되며, 페이지 콘텐츠에서는 사용하지 않습니다.

### 2.2 폰트 굵기

| 용도 | 클래스 |
|---|---|
| 기본 텍스트 | `font-normal` (400) |
| 버튼 라벨, 카드 헤더 | `font-medium` (500) |
| 강한 강조 (스코어 등) | `font-bold` (700) |
| 코드, ID, 수치 | `font-mono` |

---

## 3. 간격 시스템

### 3.1 페이지 레이아웃

```
페이지 래퍼: p-6 flex flex-col gap-6 max-w-[1600px] mx-auto w-full
페이지 전체 높이: flex flex-col h-full (Outlet 내부)
메인 스크롤 영역: flex-1 overflow-y-auto
```

### 3.2 기본 간격 스케일

| 토큰 | 값 | 용도 |
|---|---|---|
| `gap-0.5` | 2px | 네비게이션 항목 간격 |
| `gap-1` | 4px | 아이콘+텍스트 간격, 인라인 요소 |
| `gap-1.5` | 6px | 아이콘+라벨 (StatusBadge, Chip 등) |
| `gap-2` | 8px | 폼 필드 내부, 작은 요소 그룹 |
| `gap-3` | 12px | 폼 필드 행 사이, 카드 내부 컨텐츠 |
| `gap-4` | 16px | 섹션 사이 (카드 내부), 그리드 간격 |
| `gap-6` | 24px | **페이지 최상위 섹션 사이** (표준) |

### 3.3 카드 / 패널 패딩

```
카드 헤더: px-4 py-3 (Card 컴포넌트) 또는 px-3 py-2 (섹션 헤더)
카드 바디: p-4
필드 행: min-h-7 gap-2
```

---

## 4. 인터랙티브 요소

### 4.1 입력 필드 (표준: h-7, 28px)

**모든 입력 필드는 `h-7` (28px)을 사용합니다.**

```tsx
// WireInput / WireSelect 사용 (권장)
<WireInput value={...} onChange={...} placeholder="..." />
<WireSelect value={...} options={[...]} onChange={...} />

// 네이티브 input 직접 사용 시
<input className="w-full h-7 px-2 rounded border border-zinc-200 dark:border-zinc-700
  bg-white dark:bg-zinc-800/50 text-zinc-700 dark:text-zinc-300 text-xs outline-none" />

// 네이티브 select 직접 사용 시
<select className="w-full h-7 px-2 rounded border border-zinc-200 dark:border-zinc-700
  bg-white dark:bg-zinc-800/50 text-zinc-700 dark:text-zinc-300 text-xs outline-none cursor-pointer" />
```

> **금지**: `h-6` (24px), `h-8` (32px), `h-9` (36px) 등 다른 높이 사용 금지.
> 예외: 검색 입력 (`h-9`) — 돋보기 아이콘 공간이 필요한 경우에 한함.

### 4.2 버튼 스타일

**A. Primary 액션 (Emerald)**
```
px-3 py-1.5 rounded-lg text-xs border
border-emerald-500/50 bg-emerald-500/10 text-emerald-400
hover:bg-emerald-500/20 cursor-pointer
```

**B. Danger 액션 (Red)**
```
px-3 py-1.5 rounded-lg text-xs border
border-red-500/50 bg-red-500/10 text-red-400
hover:bg-red-500/20 cursor-pointer
```

**C. Secondary 액션 (Zinc)**
```
px-3 py-1.5 rounded-lg text-xs border
border-zinc-200 dark:border-zinc-700 text-zinc-500
hover:bg-zinc-50 dark:hover:bg-zinc-800 cursor-pointer
```

**D. Filled Dark (강한 강조)**
```
px-3 py-1.5 rounded-lg text-xs
bg-zinc-900 dark:bg-zinc-100 text-zinc-50 dark:text-zinc-900
```

**E. Disabled 상태**
```
disabled:opacity-50 disabled:cursor-not-allowed
— 또는 —
border-zinc-600 text-zinc-500 cursor-not-allowed
```

**F. Warning 액션 (Amber)**
```
px-3 py-1.5 rounded border
border-amber-500/50 bg-amber-500/10 text-amber-400
```

**G. ProcessButtons 컴포넌트**
- 일반: `px-4 py-1.5 rounded text-sm`
- 컴팩트: `px-4 py-1.5 rounded text-xs`
- Start: emerald 계열
- Stop: red 계열

> **규칙**: 모든 커스텀 버튼에 `cursor-pointer` 필수. disabled에 `cursor-not-allowed`.

### 4.3 토글 스위치

```
WireToggle 컴포넌트 사용
- 트랙: w-8 h-4 rounded-full
- ON: bg-emerald-500
- OFF: bg-zinc-300 dark:bg-zinc-700
- 썸: size-3 rounded-full bg-white
```

---

## 5. 아이콘 크기 규칙

Lucide React 아이콘은 용도에 따라 크기가 결정됩니다.

| 용도 | 크기 | 예시 |
|---|---|---|
| 토글 화살표 (Chevron) | `size={10}` | 고급 설정 펼침/접힘 |
| 버튼 내부 아이콘 | `size={12}` | Trash2, RotateCcw, Download, Copy 등 |
| 상태/프로세스 아이콘 | `size={12}` ~ `size={14}` | CheckCircle2, AlertTriangle, Loader2 |
| ProcessButtons 내 Play/Stop | `size={13}` / `size={11}` | Play, Square |
| 헤더 액션 아이콘 | `size={14}` | RefreshCw, Sun, Moon |
| 원형 컨테이너 내 아이콘 (size-7) | `size={14}` | Camera, Monitor 등 |
| 네비게이션 아이콘 | `size={14}` | 사이드바 메뉴 아이콘 |
| 헤더 메뉴 버튼 | `size={15}` | Menu (햄버거) |
| 큰 상태 아이콘 | `size={16}` | CheckCircle2 (완료 배너) |
| 로딩 스피너 (대형) | `size={32}` | Loader2 (전체 화면 로딩) |
| 빈 상태 아이콘 | `size={28}` | Ruler, Camera 등 |

> **규칙**:
> - 인라인 텍스트 옆 아이콘: `size={10}`~`size={12}`
> - 버튼 내부 아이콘: `size={12}` (표준)
> - 토글 chevron: `size={10}`
> - `size={9}`, `size={11}` 사용 지양 → `size={10}` 또는 `size={12}`로 통일

---

## 6. 카드 & 패널

### 6.1 표준 카드 (Card 컴포넌트)

```
외곽: rounded-lg border border-zinc-200 dark:border-zinc-800
배경: bg-white dark:bg-zinc-900
헤더: px-4 py-3 border-b border-zinc-200 dark:border-zinc-800
  → 제목: text-sm font-medium text-zinc-800 dark:text-zinc-200
  → step 뱃지: size-5 rounded bg-zinc-200 dark:bg-zinc-700
바디: p-4
```

### 6.2 섹션 패널 (네이티브)

```
외곽: rounded-lg border border-zinc-200 dark:border-zinc-800 overflow-hidden
헤더: px-3 py-2 bg-zinc-50 dark:bg-zinc-800/30 border-b border-zinc-200 dark:border-zinc-800
  → 제목: text-xs font-medium text-zinc-600 dark:text-zinc-300
바디: p-4
```

### 6.3 상태 배너

```
Success: rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-4
Warning: rounded-lg border border-amber-500/30 bg-amber-500/5 p-4
Error:   rounded-lg border border-red-500/30 bg-red-500/5 p-4
```

### 6.4 BlockerCard (Start 불가 경고)

```
rounded-lg border border-amber-500/30 bg-amber-500/5 p-4
이유 칩: px-2 py-0.5 rounded text-xs border border-amber-500/30 text-amber-400 bg-amber-500/10
```

---

## 7. Chip / Tag / Badge

### 7.1 Chip 컴포넌트 (표준)

```
inline-flex items-center gap-1 px-2 py-0.5 rounded border text-xs
```

**색상 변형:**

| 변형 | 클래스 |
|---|---|
| default | `bg-zinc-100 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400 border-zinc-200 dark:border-zinc-700` |
| green | `bg-emerald-500/10 text-emerald-500 border-emerald-500/30` |
| amber | `bg-amber-500/10 text-amber-500 border-amber-500/30` |
| blue | `bg-blue-500/10 text-blue-400 border-blue-500/30` |
| red | `bg-red-500/10 text-red-400 border-red-500/30` |

### 7.2 StatusBadge 컴포넌트

```
inline-flex items-center gap-1.5 px-2 py-0.5 rounded border text-xs font-mono
```

> **규칙**: 칩/태그에 `text-[10px]`, `text-[11px]`, `rounded-full`, `px-1.5` 사용 금지.
> 항상 `text-xs`, `rounded`, `px-2` 사용.

---

## 8. 탭 & 네비게이션

### 8.1 Pill 탭 (인라인 탭 전환)

```tsx
// 컨테이너
<div className="flex gap-1 bg-zinc-100 dark:bg-zinc-800/50 p-1 rounded-lg w-fit">

// 비활성 탭
<button className="px-3.5 py-1.5 rounded-md text-xs font-medium transition-all
  text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300" />

// 활성 탭
<button className="px-3.5 py-1.5 rounded-md text-xs font-medium transition-all
  bg-white dark:bg-zinc-700 text-zinc-900 dark:text-zinc-100 shadow-sm" />
```

### 8.2 상단 네비게이션 바 (Breadcrumb)

```
컨테이너: flex items-center justify-between px-6 py-2 border-b border-zinc-200 dark:border-zinc-800
  bg-white dark:bg-zinc-950 text-xs text-zinc-400
구분자: text-zinc-300 dark:text-zinc-600 › 문자
현재 페이지: text-zinc-700 dark:text-zinc-200 font-medium
링크: hover:text-zinc-600 dark:hover:text-zinc-200 transition-colors
```

### 8.3 ModeToggle (토글 버튼 그룹)

```
외곽: inline-flex rounded border border-zinc-200 dark:border-zinc-700 p-0.5 gap-0.5
비활성: px-3 py-1 rounded text-xs text-zinc-400
활성: px-3 py-1 rounded text-xs bg-zinc-200 dark:bg-zinc-700 text-zinc-800 dark:text-zinc-200
```

---

## 9. 진행률 & 시각화

### 9.1 프로그레스 바

```
트랙: h-2.5 rounded-full bg-zinc-200 dark:bg-zinc-700 overflow-hidden
바:   h-full rounded-full transition-all duration-500
      bg-zinc-800 dark:bg-zinc-200 (일반 진행률)
      bg-emerald-500 (성공/녹화)
```

### 9.2 리소스 바 (ResourceBar 컴포넌트)

```
트랙: h-1.5 rounded-full bg-zinc-200 dark:bg-zinc-700 overflow-hidden
바 색상:
  < 70%:  bg-emerald-500
  >= 70%: bg-amber-500
  >= 90%: bg-red-500
라벨: text-xs text-zinc-400
```

### 9.3 로딩 시퀀스 (Starting Steps)

```
Loader2 size={32} animate-spin → 전체 화면 중앙
완료 단계: CheckCircle2 size={14} text-emerald-400
현재 단계: Loader2 size={14} animate-spin text-zinc-400
대기 단계: size-3.5 rounded-full border border-zinc-600
```

---

## 10. 오버레이 & 모달

### 10.1 비디오 오버레이 뱃지

```
position: absolute top-2 left-2
배경: px-1.5 py-0.5 rounded bg-black/50 backdrop-blur
텍스트: text-white text-xs font-mono (또는 text-[10px]은 오버레이 한정 허용)
```

### 10.2 닫기 버튼 (플로팅)

```
absolute top-2 right-2 size-6 rounded bg-black/50
flex items-center justify-center cursor-pointer hover:bg-black/70
```

### 10.3 모바일 사이드바 오버레이

```
fixed inset-0 z-50
배경: bg-black/50
```

---

## 11. 레이아웃 패턴

### 11.1 앱 쉘

```
루트: h-screen flex flex-col bg-zinc-50 dark:bg-zinc-950 overflow-hidden
헤더: h-11 flex-none
메인 영역: flex flex-1 overflow-hidden
  사이드바: w-52 (펼침) / w-12 (접힘)
  콘텐츠: flex-1 overflow-y-auto
콘솔: flex-none (하단 고정)
```

### 11.2 페이지 표준 구조

```tsx
<div className="flex flex-col h-full">
  {/* 상단 네비게이션 바 */}
  <div className="flex items-center justify-between px-6 py-2 border-b ...">
    ...
  </div>

  {/* 스크롤 영역 */}
  <div className="flex-1 overflow-y-auto">
    <div className="p-6 flex flex-col gap-6 max-w-[1600px] mx-auto w-full">
      <PageHeader ... />
      {/* 컨텐츠 */}
    </div>
  </div>

  {/* 하단 고정 제어 바 */}
  <StickyControlBar>
    ...
  </StickyControlBar>
</div>
```

### 11.3 StickyControlBar

```
sticky bottom-0 mt-auto
border-t border-zinc-200 dark:border-zinc-800
bg-white/95 dark:bg-zinc-950/95 backdrop-blur
px-6 py-2
flex items-center justify-between gap-4
```

### 11.4 반응형 그리드

```
1:1 분할: grid grid-cols-1 lg:grid-cols-2 gap-6
3열: grid grid-cols-1 md:grid-cols-3 gap-4
사이드바 레이아웃: grid grid-cols-1 xl:grid-cols-[320px_1fr] gap-6
카메라 그리드: grid grid-cols-1 sm:grid-cols-2 gap-3
```

---

## 12. 빈 상태 & 피드백

### 12.1 EmptyState 컴포넌트

```
flex flex-col items-center justify-center py-8 gap-3 text-center
아이콘: text-3xl opacity-30
메시지: text-xs text-zinc-400 max-w-xs
```

### 12.2 전체 화면 로딩

```
flex-1 flex flex-col items-center justify-center py-16 gap-6
Loader2 size={32} animate-spin text-zinc-400
```

---

## 13. 구분선 & 간격

| 패턴 | 클래스 |
|---|---|
| 수직 구분선 | `h-4 w-px bg-zinc-200 dark:bg-zinc-700` |
| 좌측 인덴트 보더 | `border-l-2 border-zinc-100 dark:border-zinc-800 pl-2` |
| 리스트 구분 | `divide-y divide-zinc-100 dark:divide-zinc-800/50` |

---

## 14. 트랜지션 & 애니메이션

| 용도 | 클래스 |
|---|---|
| 색상 전환 | `transition-colors` |
| 모든 속성 | `transition-all` |
| 변형 (크기/위치) | `transition-transform` |
| 투명도 | `transition-opacity` |
| 기본 시간 | `duration-300` (0.3s) |
| 프로그레스 바 | `duration-500` (0.5s) |

| 애니메이션 | 용도 |
|---|---|
| `animate-spin` | 로딩 스피너 (Loader2) |
| `animate-ping` | 실행 중 상태 점 |
| `animate-pulse` | 부드러운 연결 상태 점 |

---

## 15. 고급 설정 토글

모든 "고급 설정" 섹션은 동일한 패턴을 따릅니다:

```tsx
<button className="flex items-center gap-1.5 text-xs text-zinc-400
  hover:text-zinc-500 dark:hover:text-zinc-300 transition-colors cursor-pointer w-fit">
  {open ? <ChevronUp size={10} /> : <ChevronDown size={10} />}
  고급 설정
</button>

{open && (
  <div className="pl-3 border-l-2 border-zinc-100 dark:border-zinc-800">
    {/* 고급 설정 필드들 */}
  </div>
)}
```

---

## 16. 선택 상태 (리스트 항목)

```tsx
// 선택됨
className="bg-zinc-100 dark:bg-zinc-800/50 border border-zinc-300 dark:border-zinc-600"

// 미선택
className="hover:bg-zinc-50 dark:hover:bg-zinc-800/50 border border-transparent"

// 호버 시 삭제 아이콘 표시
className="opacity-0 group-hover:opacity-100"
```

---

## 17. 키보드 단축키 표시

```tsx
<kbd className="px-1.5 py-0.5 rounded border border-zinc-200 dark:border-zinc-700
  font-mono text-zinc-500 bg-zinc-50 dark:bg-zinc-900">
  {key}
</kbd>
```

---

## 18. 공유 컴포넌트 목록

`components/wireframe/index.tsx`에서 제공하는 공유 컴포넌트:

| 컴포넌트 | 용도 |
|---|---|
| `PageHeader` | 페이지 상단 제목 + 상태 뱃지 |
| `Card` | 표준 카드 (제목 + 바디) |
| `SectionHeader` | 독립 섹션 제목 |
| `StatusBadge` | 상태 표시 뱃지 |
| `ProcessButtons` | Start/Stop 버튼 |
| `StickyControlBar` | 하단 고정 제어 바 |
| `WireInput` | 표준 텍스트 입력 |
| `WireSelect` | 표준 선택 드롭다운 |
| `WireToggle` | 토글 스위치 |
| `FieldRow` | 라벨 + 입력 행 |
| `Chip` | 태그/칩 |
| `ModeToggle` | 토글 버튼 그룹 |
| `WireBox` | 회색 플레이스홀더 영역 |
| `ResourceBar` | 리소스 사용률 바 |
| `BlockerCard` | Start 불가 경고 |
| `EmptyState` | 빈 상태 메시지 |

> **규칙**: 공유 컴포넌트가 존재하는 경우, 네이티브 HTML 대신 컴포넌트를 사용합니다.
> 특히 `WireInput` / `WireSelect`를 네이티브 `<input>` / `<select>` 대신 사용하세요.

---

## 19. 체크리스트 (자가 검증용)

새 페이지나 컴포넌트를 만들 때 이 체크리스트를 확인하세요:

- [ ] 입력 높이가 `h-7` (28px)인가?
- [ ] 버튼에 `cursor-pointer` / `cursor-not-allowed`가 있는가?
- [ ] 버튼 모서리가 `rounded-lg`인가? (ProcessButtons 제외)
- [ ] 커스텀 텍스트 크기 (`text-[Npx]`)를 사용하지 않았는가?
- [ ] 아이콘 크기가 규칙 (5장)을 따르는가?
- [ ] 색상 토큰이 `-400` / `-500` 변형만 사용하는가?
- [ ] 페이지 래퍼가 `p-6 gap-6 max-w-[1600px] mx-auto`인가?
- [ ] `StickyControlBar`가 하단에 있는가?
- [ ] 상단 네비게이션 바 (breadcrumb)가 있는가?
- [ ] Dark 모드 대응 (`dark:` prefix)이 모든 색상에 있는가?
- [ ] `blue` 색상이 외부 ID 표시에만 사용되었는가?

---

## 20. 컷오버 문서 연계 (유지보수 규칙)

디자인 변경이 런타임 동작/운영 UX(콘솔, 프로세스 제어, 탭 워크플로우)에 영향을 주면 아래 문서를 같은 변경 세트에서 함께 갱신합니다.

- 기준 문서: `docs/wireframe/coverage-cutover.md`
- 검증 스크립트: `wireframe_test/workflow_audit.mjs`, `wireframe_test/verify_fixes.mjs`

필수 동기화 규칙:

- 탭 구조/핵심 CTA/상태 배지 위계가 변하면 `coverage-cutover.md`의 3), 4), 6) 체크를 다시 검증한다.
- 콘솔/프로세스/API/WS 계약이 변하면 `coverage-cutover.md`의 5), 8) 게이트를 다시 검증한다.
- 컷오버 직전에는 위 검증 스크립트를 다시 실행하고 결과를 8.3/9) 섹션에 반영한다.
