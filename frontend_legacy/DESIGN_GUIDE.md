# LeStudio Design Guide

Figma에서 LeStudio UI를 재현하기 위한 종합 디자인 가이드입니다.
코드에서 추출한 모든 색상, 타이포그래피, 간격, 컴포넌트 스펙을 포함합니다.

> **소스 기준**: `src/styles/variables.css`, `base.css`, `layout.css`, `components.css`, `tabs.css`

---

## 1. 소개

### 프로젝트 개요
LeStudio는 **LeRobot 로봇 제어 스튜디오**의 웹 프론트엔드입니다.
로봇 디바이스 설정, 캘리브레이션, 원격 조작, 데이터 수집, 학습, 평가까지
하나의 웹 UI에서 관리할 수 있습니다.

### 9개 탭 구성

| 그룹 | 탭 | 아이콘 | ID |
|------|------|--------|------|
| Setup | Status | 📊 | `status` |
| Setup | Device Mapping | 🔌 | `device-setup` |
| Setup | Motor Setup | ⚙️ | `motor-setup` |
| Setup | Calibration | 🎯 | `calibrate` |
| Operate | Teleop | 🎮 | `teleop` |
| Operate | Record | 🔴 | `record` |
| Data | Dataset | 📁 | `dataset` |
| ML | Train | 🧠 | `train` |
| ML | Eval | 📈 | `eval` |

### 기술 스택
- React 19 + Vite 7
- Zustand (상태 관리)
- 순수 CSS Variables (No Tailwind, No CSS-in-JS)
- WebSocket 실시간 통신

---

## 2. 색상 시스템

### 2.1 Dark Theme (기본)

| 변수 | Hex | 용도 |
|------|-----|------|
| `--bg` | `#0d1117` | 전체 배경 |
| `--bg2` | `#161b22` | 카드, 헤더, 사이드바 배경 |
| `--bg3` | `#21262d` | 입력 필드, 토글, 디바이스 아이템 배경 |
| `--border` | `#30363d` | 테두리 |
| `--text` | `#e6edf3` | 주요 텍스트 |
| `--text2` | `#8b949e` | 보조 텍스트, 라벨 |

### 2.2 Light Theme

| 변수 | Hex | 용도 |
|------|-----|------|
| `--bg` | `#ffffff` | 전체 배경 |
| `--bg2` | `#f6f8fa` | 카드, 헤더, 사이드바 배경 |
| `--bg3` | `#eaeef2` | 입력 필드, 토글 배경 |
| `--border` | `#d0d7de` | 테두리 |
| `--text` | `#1f2328` | 주요 텍스트 |
| `--text2` | `#57606a` | 보조 텍스트, 라벨 |

### 2.3 상태 색상

| 변수 | Dark | Light | 용도 |
|------|------|-------|------|
| `--accent` | `#58a6ff` | `#0969da` | 프라이머리, 활성 탭, 링크, 포커스 |
| `--green` | `#3fb950` | `#1a7f37` | 성공, 연결됨, 실행 중 |
| `--red` | `#f85149` | `#cf222e` | 에러, 위험, 삭제 |
| `--yellow` | `#d29922` | `#9a6700` | 경고, 주의, BETA 배지 |
| `--purple` | `#bc8cff` | `#8250df` | 누락된 의존성 |

### 2.4 color-mix 패턴

코드에서 반복적으로 사용되는 `color-mix(in srgb, ...)` 패턴입니다.
Figma에서는 **투명도(opacity)** 로 재현합니다.

#### 배경 강조 (Background Tint)

| CSS | Figma 재현 | 사용처 |
|-----|-----------|--------|
| `color-mix(in srgb, var(--accent) 10%, transparent)` | `--accent` 색상 10% 투명도 | Quick Guide 배경 |
| `color-mix(in srgb, var(--accent) 14%, transparent)` | `--accent` 색상 14% 투명도 | 활성 탭 배경 |
| `color-mix(in srgb, var(--accent) 20%, transparent)` | `--accent` 색상 20% 투명도 | 활성 토글 배경 |
| `color-mix(in srgb, var(--green) 16%, transparent)` | `--green` 색상 16% 투명도 | Running 배지 배경 |
| `color-mix(in srgb, var(--red) 15%, transparent)` | `--red` 색상 15% 투명도 | Stop 버튼 배경 |
| `color-mix(in srgb, var(--yellow) 10%, transparent)` | `--yellow` 색상 10% 투명도 | 경고 카드 배경 |

#### 테두리 강조 (Border Tint)

| CSS | Figma 재현 |
|-----|-----------|
| `color-mix(in srgb, var(--accent) 38%, var(--border))` | accent 38% + border 62% 혼합 |
| `color-mix(in srgb, var(--green) 45%, var(--border))` | green 45% + border 55% 혼합 |
| `color-mix(in srgb, var(--red) 45%, var(--border))` | red 45% + border 55% 혼합 |
| `color-mix(in srgb, var(--yellow) 35%, var(--border))` | yellow 35% + border 65% 혼합 |

> **Figma 팁**: `color-mix(in srgb, A X%, B)` = A 색상을 X%로 B에 혼합.
> Figma에서는 두 레이어를 겹치거나, 정확한 혼합 결과 Hex를 계산하여 사용합니다.
> 부록에서 자세한 변환법을 설명합니다.

### 2.5 터미널 고정 색상 (테마 무관)

| 값 | 용도 |
|-----|------|
| `#0a0c10` | 터미널 / 코드 박스 배경 |
| `#c9d1d9` | 터미널 기본 텍스트 (stdout) |
| `#fef3c7` | 터미널 번역 텍스트 |
| `rgba(245, 158, 11, 0.16)` | 번역 줄 배경 |
| `rgba(245, 158, 11, 0.35)` | 번역 줄 테두리 |

---

## 3. 타이포그래피

### 3.1 폰트 패밀리

| 변수 | 값 | 용도 |
|------|-----|------|
| `--font` | `system-ui, -apple-system, 'Segoe UI', sans-serif` | UI 전반 |
| `--mono` | `'SFMono-Regular', 'Cascadia Code', 'JetBrains Mono', Consolas, monospace` | 터미널, 코드, 모터 값, 퍼포먼스 수치 |

### 3.2 크기 스케일

| px | 사용처 |
|-----|--------|
| **20px** | 로고 이모지 (`.logo`), 에피소드 번호 (`.ep-num`) |
| **18px** | 섹션 제목 (`h2`) |
| **16px** | 앱 제목 (`h1`), 프로필 더보기 버튼 |
| **15px** | HF 인증 아이콘 |
| **14px** | 카메라 이름, 사이드바 탭 아이콘 |
| **13px** | 일반 버튼, 입력 필드, 디바이스 이름, 사이드바 탭 텍스트, `.muted`, 드롭다운 메뉴 |
| **12px** | 라벨, 프로필 셀렉트, 콘솔 제목, 터미널, 퍼포먼스 필, Quick Guide 본문, 토스트, 필드 도움말, 모터 값 |
| **11px** | 진행률 텍스트, Stop/Goto 버튼, 배지, 상태칩, 서브 텍스트 (`.dsub`), 필드 도움말, 키보드 (`kbd`), USB 바 라벨, 규칙 섹션 제목, 규칙 키 |
| **10px** | BETA 배지, 사이드바 그룹 제목, 에피소드 상태 필 (`ep-state-pill`), 콘솔 쉐브론, 라이브 배지 |
| **9px** | 사이드바 상태 배지, 모터 라벨 (`.lbl`) |

### 3.3 굵기 (Font Weight)

| 값 | 용도 |
|-----|------|
| **700** | BETA 배지, 사이드바 상태 배지, 에피소드 상태 필, 상태 verdict, 충돌 배지, CTA strong |
| **650** | Dataset collapsible 제목 |
| **600** | 앱 제목, 섹션 제목, 카드 제목, 버튼 Primary/Danger, Primary-sm, 콘솔 제목, Running indicator, Stop 버튼, 퍼포먼스 필, Quick Guide 제목, CTA default |
| **500** | 디바이스 이름, 배지, 경고 텍스트, Goto 버튼, CTA minimal |
| **400** | 일반 텍스트 (기본값) |

### 3.4 기타 타이포그래피 속성

| 속성 | 값 | 사용처 |
|------|-----|--------|
| `letter-spacing` | `0.8px` | 사이드바 그룹 제목 (uppercase), 에피소드 카드 제목 |
| `letter-spacing` | `0.5px` | BETA 배지 |
| `letter-spacing` | `0.4px` | 에피소드 상태 필 |
| `letter-spacing` | `0.3px` | 앱 제목 `h1`, 사이드바 상태 배지, 콘솔 제목, 카드 제목 |
| `letter-spacing` | `0.2px` | 카드 h3, status verdict |
| `letter-spacing` | `0.1px` | CTA 기본 |
| `letter-spacing` | `0.15px` | CTA strong |
| `line-height` | `1.6` | 터미널 |
| `line-height` | `1.5` | Quick Guide 본문, 빈 상태 텍스트 |
| `line-height` | `1.45` | 토스트 메시지 |
| `line-height` | `1.4` | 사이드바 상태 배지, 필드 도움말, 경고 텍스트 |
| `line-height` | `1.35` | `.dsub` |
| `line-height` | `1.2` | 배지 (`.dbadge`) |
| `line-height` | `1.15` | Link/CTA 버튼 |
| `line-height` | `1` | 로고, 아이콘, 에피소드 번호 |
| `text-transform` | `uppercase` | 사이드바 그룹 제목, 에피소드 카드 제목, 에피소드 상태 필, 상태 배지, 모터 카드 헤더 |

---

## 4. 간격 및 레이아웃

### 4.1 Border Radius

| 값 | 사용처 |
|-----|--------|
| `50%` | 피드 닫기 버튼 (`20×20`), 스피너, 상태 도트, pulse 도트 |
| `999px` (pill) | Link/CTA 버튼, 배지, 에피소드 상태 필, 상태 verdict, HF 인증 아이콘, 퍼포먼스 필, 데이터셋 페이지 네비, 태그 버튼 |
| `12px` | BETA 배지 |
| `10px` | 모터 모니터 카드, 빈 상태 컨테이너 (dataset-empty) |
| `8px` (= `--radius`) | 카드, Quick Guide, 토스트, 프로필 메뉴, 경고/블로커 카드, Advanced Panel, 빈 상태 |
| `7px` | 사이드바 탭 버튼 |
| `6px` | 입력 필드, 버튼, 디바이스 아이템, 피드 카드, 카메라 카드, 에피소드 상태, 터미널 번역, 모터 라운지, 경고 텍스트, 코드 박스, info-box |
| `5px` | 프로필 메뉴 항목, 모터 모니터 버튼 |
| `4px` | 배지, Stop 버튼, Goto 버튼, 토스트 닫기, 키보드(`kbd`), 모터 위치 트랙, FPS 배지, 피드 오버레이 버튼, ep-bar, 모터 메트릭 |
| `3px` | 스크롤바 thumb, 복사 버튼, USB 바 트랙 |
| `2px` | 진행률 바 (progress-track, progress-fill), pulse 도트 |

### 4.2 패딩 값

| 컴포넌트 | 패딩 |
|----------|------|
| Header | `0 20px` (height 52px) |
| Sidebar | `14px 10px` |
| Sidebar Tab | `9px 10px` |
| Main Content | `20px` (하단 8px) |
| Card | `16px` |
| Episode Progress Card | `14px 16px` |
| Quick Guide | `12px` |
| Toast | `10px 12px` |
| Terminal Body | `12px 14px` |
| Terminal Header | `8px 14px` |
| Console Drawer Header | `6px 12px` |
| Blocker Card | `10px 12px` |
| Advanced Panel | `8px 10px` |
| Input Field | `7px 10px` |
| Button Primary / Danger | `8px 18px` |
| Button Small / Warn | `6px 12px` |
| Button XS | `2px 8px` |
| Link/CTA Button | `4px 10px` |
| Stop Button | `4px 12px` |
| Goto Button | `4px 10px` |
| Toggle Button | `5px 12px` |
| Device Item | `8px 12px` |
| Badge | `2px 7px` |
| Status Verdict | `2px 8px` |
| Status Issue Chip | `2px 8px` |
| Perf Pill | `4px 10px` |
| BETA Badge | `2px 6px` |
| Feed Label | `3px 7px` |
| Feed Live Badge | `2px 6px` |
| Profile Menu | `4px` (container), `7px 12px` (items) |
| Episode State Pill | `3px 9px` |
| KBD | `1px 5px` |
| Sticky Controls Bar | `4px 10px` + `env(safe-area-inset-bottom)` |

### 4.3 Gap 값

| 값 | 사용처 |
|-----|--------|
| `1px` | 프로필 메뉴 항목 간격 |
| `3px` | 복사 액션 버튼 |
| `4px` | 콘솔 액션, 스텝 프리셋, 데이터셋 태그 액션, 모터 모니터 타겟 행, 모터 모니터 메트릭 |
| `6px` | 프로필 컨트롤, 모드 토글, 블로커 칩, 데이터셋 태그, WS 상태, HF 인증 도트, Link/CTA gap |
| `8px` | 버튼 행, 디바이스 리스트, 피드 그리드, 토스트 스택, 빈 상태, 캠 행, 규칙 행, 블로커 액션, 에피소드 컨트롤 행 |
| `10px` | 헤더 좌측, 브랜드, 사이드바 탭, 디바이스 아이템, 토스트, 진행률, 경고 카드, Quick Steps, Advanced Panel gap, Train/Eval main grid |
| `12px` | 콘솔 헤더/러닝 바, 카드 제목-콘텐츠, 섹션 헤더, 모터 리스트, 카메라 그리드, 콘솔 Running bar |
| `14px` | 상태 그리드, two-col, 사이드바 그룹, 카드 margin-bottom, 피드 그리드 margin |
| `16px` | 섹션 헤더 margin-bottom, 모터 행 gap, mapping-rules-grid, 모터 setup two-col |

### 4.4 Grid 패턴

| 그리드 | 열 구성 | Gap |
|--------|---------|-----|
| `status-grid` | `1fr 1fr` | 14px |
| `two-col` | `1fr 1fr` | 14px |
| `feed-grid` | `repeat(auto-fill, minmax(200px, 1fr))` | 8px |
| `device-camera-grid` | `repeat(auto-fill, minmax(200px, 1fr))` | 12px |
| `motor-mon-cards` | `repeat(auto-fill, minmax(180px, 1fr))` | 12px |
| `quick-steps` | `repeat(3, minmax(0, 1fr))` | 8px |
| `train-main-grid` / `eval-main-grid` | `minmax(340px, 1.3fr) minmax(280px, 1fr)` | 10px |
| `train-advanced-grid` | `1fr 1fr` | 8px |
| `eval-summary-grid` | `1fr 1fr` | 8px |
| `settings-grid` | `1fr 1fr` | 12px |
| `teleop-arm-grid` | `1fr 1fr` | 10px |
| `mapping-rules-grid` | `1fr 1fr` | 16px |
| `motor-row` | `130px 1fr 160px` | 16px |
| `rules-item` | `130px 1fr` | 8px |
| `cam-row` | `80px 1fr` | 8px |
| `dataset-secondary-fields` | `minmax(180px, 260px) minmax(220px, 1fr)` | 8px |
| `motor-setup two-col` | `1fr 1fr` | 16px |

### 4.5 반응형 Breakpoints

| Breakpoint | 동작 |
|------------|------|
| **> 1100px** | 전체 레이아웃: Sidebar 236px + Main |
| **800 ~ 1100px** | Sidebar 아이콘 전용 (68px), 텍스트 숨김, 상태 배지→도트 변환, train/eval main-grid 1열 |
| **< 800px** | Sidebar 오버레이 (fixed, 280px or 82vw), 헤더 축소 (h1 숨김), 모바일 메뉴 버튼 표시, status-grid 1열, two-col 1열, main padding 16px |
| **< 960px** | Record two-col 1열 |
| **< 900px** | motor-setup two-col 1열, dataset detail header 세로 배치 |
| **< 640px** | train-advanced-grid 1열, eval-summary-grid 1열, mapping-rules-grid 1열 |
| **< 600px** | teleop-arm-grid 1열 |

---

## 5. 컴포넌트 카탈로그

### 5.1 Buttons

#### Primary Button (`.btn-primary`)
```
Background: var(--accent)     // #58a6ff (dark) / #0969da (light)
Color:      #000
Padding:    8px 18px
Font:       13px, weight 600
Radius:     6px
Hover:      opacity 0.85
Disabled:   opacity 0.6, cursor not-allowed
Active:     opacity 0.7
```

#### Danger Button (`.btn-danger`)
```
Background: var(--red)        // #f85149 (dark) / #cf222e (light)
Color:      #fff
Padding:    8px 18px
Font:       13px, weight 600
Radius:     6px
```

#### Small Button (`.btn-sm`)
```
Background: var(--bg3)
Border:     1px solid var(--border)
Color:      var(--text)
Padding:    6px 12px
Font:       13px
Radius:     6px
```

#### XS Button (`.btn-xs`)
```
Background: transparent
Color:      var(--text2)
Padding:    2px 8px
Font:       12px
Radius:     6px
Hover:      bg → var(--bg3), color → var(--text)
```

#### Warn Button (`.btn-warn`)
```
Background: var(--yellow)
Color:      #000
Padding:    6px 12px
Font:       13px
Radius:     6px
```

#### Primary Small (`.btn-primary-sm`)
```
Background: var(--accent)
Color:      #000
Padding:    6px 12px
Font:       13px, weight 600
Radius:     6px
```

#### Toggle Button (`.toggle`)
```
Default:
  Background: var(--bg3)
  Border:     1px solid var(--border)
  Color:      var(--text2)
  Padding:    5px 12px
  Radius:     6px

Active (.toggle.active):
  Background: color-mix(accent 20%, transparent)
  Border:     accent solid
  Color:      var(--accent)
```

#### Link / CTA Button (`.link-btn`)
```
Background: var(--cta-bg)       // color-mix(accent 8%, transparent)
Border:     1px solid var(--cta-border)
Radius:     999px (pill)
Padding:    4px 10px
Color:      var(--accent)
Font:       12px, weight 600, letter-spacing 0.1px
Gap:        6px (icon + text)
Line-height: 1.15

Hover:
  Background: var(--cta-hover-bg)   // color-mix(accent 16%, transparent)
  Border:     var(--cta-hover-border)

Active:
  transform: translateY(0.5px)
```

**CTA 변형 (`data-cta-style`):**

| 스타일 | `--cta-bg` | `--cta-weight` | `--cta-letter` |
|--------|-----------|----------------|----------------|
| default | accent 8% | 600 | 0.1px |
| strong | accent 22% | 700 | 0.15px |
| minimal | transparent | 500 | 0 |

#### Stop Button (`.btn-stop`)
```
Background: color-mix(red 15%, transparent)
Border:     1px solid color-mix(red 40%, transparent)
Radius:     4px
Color:      var(--red)
Font:       11px, weight 600
Padding:    4px 12px
Hover:      bg → color-mix(red 25%, transparent)
```

#### Goto Button (`.btn-goto`)
```
Background: transparent
Border:     1px solid var(--border)
Radius:     4px
Color:      var(--text2)
Font:       11px, weight 500
Padding:    4px 10px
Hover:      bg → var(--bg3), color → var(--text), border → var(--text2)
```

### 5.2 Cards

#### Basic Card (`.card`)
```
Background: var(--bg2)
Border:     1px solid var(--border)
Radius:     8px (var(--radius))
Padding:    16px
Margin:     bottom 14px

Hover:      border → color-mix(accent 30%, border)

Title (h3):
  Font:     13px, weight 600
  Color:    var(--text2)
  Letter:   0.2px
  Margin:   bottom 12px
```

#### Quick Guide (`.quick-guide`)
```
Background: color-mix(accent 10%, transparent)
Border:     1px solid color-mix(accent 35%, border)
Radius:     8px
Padding:    12px
Margin:     bottom 14px

Title (h3): 13px, color var(--text)
Body (p):   12px, color var(--text2), line-height 1.5

Quick Steps Grid:
  Columns:  repeat(3, minmax(0, 1fr))
  Gap:      8px
  Step:     bg color-mix(bg3 70%, bg), border 1px solid border, radius 6px, padding 8px
```

#### Advanced Panel (`<details class="advanced-panel">`)
```
Border:     1px solid var(--border)
Radius:     8px
Padding:    8px 10px
Background: color-mix(bg3 68%, transparent)

Summary:    12px, weight 600, color var(--text2)
Open:       summary color → var(--text)
```

#### Blocker / Warning Card
```
Border:     1px solid color-mix(yellow 35%, border)
Radius:     8px
Padding:    10px 12px
Background: color-mix(yellow 10%, transparent)
Margin:     bottom 12px
```

#### Info Box (`.info-box`)
```
Background: color-mix(accent 10%, transparent)
Border:     1px solid color-mix(accent 30%, transparent)
Radius:     6px
Padding:    10px 12px
Font:       12px, color var(--text2), line-height 1.5
```

### 5.3 Forms

#### Input / Select
```
Background: var(--bg3)
Border:     1px solid var(--border)
Radius:     6px
Padding:    7px 10px
Color:      var(--text)
Font:       13px, var(--font)

Focus:      border → var(--accent)
Focus-visible: outline 2px solid color-mix(accent 60%, transparent), offset 2px
```

#### Label
```
Font:       12px
Color:      var(--text2)
Margin:     8px 0 4px
Display:    block
```

#### Range Input
```
accent-color: var(--accent)
Width:       100%
```

#### Checkbox
```
(system default checkbox styled with accent-color)
```

#### Field Help (`.field-help`)
```
Font:       11px
Color:      var(--text2)
Margin:     top 4px, bottom 6px
Line-height: 1.4
```

### 5.4 Device Items & Badges

#### Device Item (`.device-item`)
```
Display:    flex, align center
Gap:        10px
Padding:    8px 12px
Background: var(--bg3)
Radius:     6px
Font:       13px

Name (.dname): weight 500, flex 1
Sub (.dsub):   11px, color var(--text2), mono font, line-height 1.35

Selected:
  bg → color-mix(accent 12%, bg3)
  outline: 1px solid color-mix(accent 40%, transparent)
```

#### Badge (`.dbadge`)
```
Font:       11px, weight 500
Padding:    2px 7px
Radius:     4px
Line-height: 1.2
Display:    inline-flex, align center
```

| 상태 | 배경 | 색상 |
|------|------|------|
| `.badge-ok` | `color-mix(green 20%, transparent)` | `var(--green)` |
| `.badge-warn` | `color-mix(yellow 20%, transparent)` | `var(--yellow)` |
| `.badge-err` | `color-mix(red 20%, transparent)` | `var(--red)` |
| `.badge-run` | `color-mix(accent 20%, transparent)` | `var(--accent)` |
| `.badge-idle` | `var(--bg3)` | `var(--text2)` |

### 5.5 Toast

```
Position:   fixed, right 18px, bottom 18px
Z-index:    9999

Container:
  Min-width: 220px
  Max-width: 360px
  Radius:    8px
  Border:    1px solid var(--border)
  Background: var(--bg2)
  Padding:   10px 12px
  Font:      12px
  Shadow:    0 8px 18px rgba(0,0,0,0.25)
  Gap:       10px (icon + message + close)

Message: line-height 1.45, flex 1

Close Button:
  Size:     20×20px
  Radius:   4px
  Font:     14px
  Color:    var(--text2) → hover var(--text)

Animation (show):
  opacity 0 → 1
  translateY(8px) → 0
  duration 0.15s

Variants:
  success: border color-mix(green 45%, border), bg color-mix(green 14%, bg2)
  error:   border color-mix(red 45%, border),   bg color-mix(red 14%, bg2)
  info:    (default styling)
```

### 5.6 Terminal / Console Drawer

#### Terminal Card
```
Header:
  Padding:   8px 14px
  Border:    bottom 1px solid var(--border)
  Font:      12px, color var(--text2)

Body (.terminal):
  Background: #0a0c10 (고정)
  Color:      #c9d1d9 (고정)
  Font:       var(--mono), 12px, line-height 1.6
  Padding:    12px 14px
  Height:     240px
  Overflow:   scroll-y
  White-space: pre-wrap
  Word-break:  break-all

Line Colors:
  stdout:      #c9d1d9
  error:       var(--red)
  info:        var(--yellow)
  translation: #fef3c7, bg rgba(245,158,11,0.16), border rgba(245,158,11,0.35)

Stdin Row:
  Padding: 8px 14px
  Border:  top 1px solid var(--border)
  Gap:     8px
```

#### Console Drawer
```
Background: var(--bg2)
Border:     top 1px solid var(--border)

Resize Handle:
  Height: 5px
  Cursor: ns-resize
  Hover/Active: bg → var(--accent)

Header:
  Padding: 6px 12px
  Border:  bottom 1px solid var(--border)
  Cursor:  pointer

Title:  12px, weight 600, color var(--text2), letter-spacing 0.3px
Chevron: 10px, color var(--text2), rotate(-180deg) when collapsed

Process Select:
  Height: 28px
  Min-width: 140px
  Padding: 3px 8px
  Font: 12px
```

#### Running Bar (Global Process Status)
```
Background: color-mix(accent 6%, bg2)
Border:     top 1px solid color-mix(accent 25%, transparent)
Padding:    6px 12px
Gap:        12px
Animation:  running-bar-fadein 0.25s ease

Pulse Dot:
  Size:   7×7px
  Radius: 50%
  Color:  var(--accent)
  Anim:   pulse-dot 1.5s ease-in-out infinite

Progress Track:
  Height: 4px
  Background: var(--bg3)
  Radius: 2px

Progress Fill:
  Background: var(--accent)
  Transition: width 0.5s ease

Progress Text:
  Font: 11px, var(--mono), color var(--text2)
```

### 5.7 Progress Bars

#### Episode Progress Bar (`.ep-bar-wrap`)
```
Track:
  Height: 6px
  Background: var(--bg)
  Radius: 4px
  Shadow: inset 0 1px 2px rgba(0,0,0,0.5)
  Margin: 8px 2px 2px

Fill:
  Background: var(--accent)
  Radius: 4px
  Transition: width 0.4s ease
```

#### USB Bus Bar
```
Track:
  Height: 5px
  Background: var(--bg)
  Radius: 3px
  Border: 1px solid var(--border)

Fill:
  Default:  var(--green)
  Warn:     var(--yellow)
  Danger:   var(--red)
  Transition: width 1.5s ease, background 0.4s
```

### 5.8 Status Dot (`.dot`)
```
Size:   9×9px
Radius: 50%

Colors + Glow:
  .green:  bg var(--green),  shadow 0 0 6px var(--green)
  .red:    bg var(--red),    shadow 0 0 6px var(--red)
  .yellow: bg var(--yellow), shadow 0 0 6px var(--yellow)
  .gray:   bg var(--text2),  shadow none

Pulse Animation (.dot.pulse):
  opacity 1 → 0.35 → 1
  Duration: 1.5s ease infinite
```

### 5.9 Perf Pill (`.perf-pill`)
```
Border:    1px solid var(--border)
Radius:    999px
Padding:   4px 10px
Font:      11px, weight 600, var(--mono), line-height 1
```

| 상태 | 색상 | 배경 | 테두리 |
|------|------|------|--------|
| `.idle` | `var(--text2)` | `var(--bg3)` | `var(--border)` |
| `.good` | `var(--green)` | `green 16%` | `green 35% + border` |
| `.warn` | `var(--yellow)` | `yellow 16%` | `yellow 35% + border` |
| `.bad` | `var(--red)` | `red 16%` | `red 35% + border` |

### 5.10 Camera Feed Card (`.feed-card`)
```
Background: #000
Radius:     6px
Overflow:   hidden
Aspect:     16:9

Image: width/height 100%, object-fit contain

Label (.feed-label):
  Position:   absolute bottom
  Background: rgba(0,0,0,0.65)
  Color:      #fff
  Font:       11px, var(--mono)
  Padding:    3px 7px

Live Badge (.feed-live-badge):
  Position: absolute top 5px left 5px
  Background: rgba(0,0,0,0.6)
  Radius:   4px
  Font:     10px, weight 600, color var(--green)
  Dot:      5×5px, green, pulse 1.2s

FPS Badge (.feed-fps-badge):
  Position: absolute top 6px right 30px
  Background: rgba(0,0,0,0.55)
  Radius:   4px
  Font:     11px, weight 600, color #fff

Close Button (.feed-close-btn):
  Position: absolute top 4px right 4px
  Size:     20×20px
  Radius:   50%
  Background: rgba(0,0,0,0.6)
  Color:    rgba(255,255,255,0.65)
  Hover:    bg rgba(0,0,0,0.9), color #fff
```

### 5.11 Motor Monitor Card (`.motor-mon-card`)
```
Border:     1px solid var(--border)
Radius:     10px
Padding:    14px 12px 12px
Gap:        8px (flex column)
Hover:      border → var(--accent)

Header:
  Font: 0.78rem, weight 600, uppercase, letter-spacing 0.05em
  Color: var(--text2)

Position Display:
  Font: 2rem, weight 700, mono
  Color: var(--green) (normal), var(--red) (error), var(--text2) (unknown)

Move Button:
  Background: color-mix(green 15%, transparent)
  Border:     1px solid color-mix(green 40%, border)
  Radius:     6px
  Color:      var(--green)
  Weight:     600

Step Button:
  Size:   28×28px
  Radius: 5px
  Border: 1px solid var(--border)

Collision State:
  border-color: var(--red) !important
  bg: color-mix(red 6%, surface) !important
  Badge: 0.72rem, weight 700, red, pulse animation

Metric Pill (.motor-mon-metric):
  Font: 0.75rem, mono
  Padding: 2px 6px
  Radius: 4px
  Variants: ok (green), warn (yellow), danger (red + weight 700)
```

### 5.12 Profile Menu (`.profile-more-menu`)
```
Position: absolute, top calc(100% + 6px), right 0
Z-index:  1000
Min-width: 140px
Background: var(--bg2)
Border:    1px solid var(--border)
Radius:    8px
Shadow:    0 8px 24px rgba(0,0,0,0.45)
Padding:   4px
Gap:       1px (items)

Menu Item:
  Padding: 7px 12px
  Font:    13px
  Radius:  5px
  Hover:   bg var(--bg3)

Danger Item:
  Color:  var(--red)
  Hover bg: rgba(248,81,73,0.15)

Separator (hr):
  border-top 1px solid var(--border)
  margin 4px 0
```

### 5.13 Status Verdict (`.status-verdict`)
```
Display:   inline-flex, align center
Font:      11px, weight 700, letter-spacing 0.2px
Radius:    999px
Padding:   2px 8px

.ready:
  Color:  var(--green)
  Bg:     color-mix(green 16%, transparent)
  Border: 1px solid color-mix(green 35%, border)

.warn:
  Color:  var(--yellow)
  Bg:     color-mix(yellow 16%, transparent)
  Border: 1px solid color-mix(yellow 35%, border)
```

### 5.14 Status Issue Chip (`.status-issue-chip`)
```
Display:   inline-flex, align center
Radius:    999px
Border:    1px solid color-mix(yellow 35%, border)
Background: color-mix(yellow 16%, transparent)
Color:     var(--yellow)
Font:      11px, weight 600
Padding:   2px 8px
```

### 5.15 Episode State Pill (`.ep-state-pill`)
```
Radius:    999px
Border:    1px solid var(--border)
Padding:   3px 9px
Font:      10px, weight 700, letter-spacing 0.4px, uppercase

.idle:
  Color:  var(--text2)
  Bg:     color-mix(bg3 80%, transparent)

.running:
  Color:  var(--green)
  Border: color-mix(green 35%, border)
  Bg:     color-mix(green 14%, transparent)
```

### 5.16 Sidebar Tab State Badge
```
Radius:    999px
Border:    1px solid var(--border)
Padding:   1px 6px
Font:      9px, weight 700, letter-spacing 0.3px, uppercase
Line-height: 1.4

State Colors (동일 패턴):
  running:     color green,  border green 45%+border,  bg green 16%
  error:       color red,    border red 45%+border,    bg red 16%
  needs-root:  color yellow, border yellow 45%+border, bg yellow 16%
  needs-udev:  color accent, border accent 45%+border, bg accent 16%
  missing-dep: color purple, border purple 45%+border, bg purple 16%
  needs-device: color yellow, border yellow 45%+border, bg yellow 16%
```

### 5.17 BETA Badge (`.beta-badge`)
```
Font:       10px, weight 700
Color:      var(--yellow)
Border:     1px solid color-mix(yellow 50%, transparent)
Radius:     12px
Padding:    2px 6px
Letter:     0.5px
Line-height: 1
Background: color-mix(yellow 10%, transparent)
```

### 5.18 Kbd Element
```
Background: var(--bg3)
Border:     1px solid var(--border)
Radius:     4px
Padding:    1px 5px
Font:       var(--mono), 11px
```

### 5.19 Empty State
```
Display:    flex column, align center, text center
Gap:        8px
Padding:    10px 12px (device) / 14px 12px (camera) / 28px 20px (dataset)
Border:     1px dashed color-mix(border 80%, transparent)
Radius:     8px / 10px (dataset)
Background: color-mix(bg3 45%, transparent)
Color:      var(--text2)
Font:       12px, line-height 1.5

Dataset Empty:
  Icon:  36px, opacity 0.5
  Title: 13px, weight 600, color var(--text)
  Hint:  12px, max-width 280px
```

### 5.20 Sticky Controls Bar (Record/Train/Eval/Teleop footer)
```
Position:   sticky bottom 0
Z-index:    5
Display:    flex wrap
Align:      center
Justify:    flex-end
Gap:        4px
Margin:     0 -20px
Padding:    4px 10px (+ safe-area-inset-bottom)
Border-top: 1px solid color-mix(accent 25%, transparent)
Background: color-mix(bg3 92%, transparent)
Backdrop:   blur(4px)

내부 Primary/Danger 버튼: padding 4px 14px, font 12px
내부 Small 버튼: padding 4px 10px, font 12px
```

---

## 6. 아이콘

### 6.1 탭 아이콘 (이모지)

| 탭 | 이모지 | 비고 |
|-----|-------|------|
| Status | 📊 | |
| Device Mapping | 🔌 | |
| Motor Setup | ⚙️ | |
| Calibration | 🎯 | |
| Teleop | 🎮 | |
| Record | 🔴 | |
| Dataset | 📁 | |
| Train | 🧠 | |
| Eval | 📈 | |

### 6.2 프로세스 아이콘 (Console)

| 프로세스 | 이모지 |
|----------|--------|
| teleop | 🎮 |
| record | 🔴 |
| calibrate | 🎯 |
| motor_setup | ⚙️ |
| train | 🧠 |
| eval | 📈 |

### 6.3 UI 내 이모지

| 이모지 | 용도 |
|--------|------|
| ✅ | 권한 확인 (r/w) |
| ✓ | udev 규칙 설치 완료 |
| ⚠️ | 경고 아이콘 (Teleop, Train) |
| ⏳ | 로딩/시작 중 |
| × | 닫기/일시정지 버튼 |

---

## 7. 애니메이션

### 7.1 키프레임

| 이름 | 효과 | 지속 시간 | 사용처 |
|------|------|-----------|--------|
| `fadeIn` | opacity 0→1, translateY(4px→0) | 0.15s ease | 탭 전환 |
| `pulse` | opacity 1→0.35→1 | 1.5s ease infinite | 상태 도트, 라이브 도트 |
| `pulse-dot` | opacity 1→0.3→1 | 1.5s ease-in-out infinite | 러닝 바 pulse dot |
| `spin` | rotate(0→360deg) | 0.75s linear infinite | 피드 스피너 |
| `running-bar-fadein` | opacity 0→1, translateY(4px→0) | 0.25s ease | 러닝 바 진입 |
| `collision-pulse` | opacity 1→0.4→1 | 1s ease-in-out infinite | 모터 충돌 배지 |

### 7.2 Transition 타이밍

| 대상 | 속성 | 시간 |
|------|------|------|
| 테마 전환 (body, header, card 등) | background-color | 0.2s ease |
| 테마 전환 | color, border-color | 0.15s ease |
| 입력 필드 focus | border-color | 0.15s |
| 버튼 hover | opacity, background | 0.15s |
| 사이드바 탭 | color, border-color, background | 0.15s |
| 토스트 show | opacity, transform | 0.15s |
| 진행률 바 (running) | width | 0.5s ease |
| 에피소드 바 | width | 0.4s ease |
| USB 바 | width 1.5s ease, background 0.4s |
| 콘솔 drawer | height | 0.2s ease |
| 콘솔 chevron | transform | 0.2s ease |
| 사이드바 (모바일) | transform | 0.18s ease |
| 피드 라이브/FPS 배지 | opacity | 0.3s |
| HF 인증 링크 | color, border-color, bg | 0.2s ease |
| 모터 위치 thumb | left | 0.1s ease |
| 프로필 메뉴 항목 hover | background | 0.12s |

---

## 8. 레이아웃 구조

### 8.1 전체 앱 구조

```
┌─────────────────────────────────────────────────────────────┐
│  Header (52px, bg2)                                        │
│  [🤖 Logo] [h1 Title] [BETA]    [Profile] [🔗] [HF] [☀️] │
├──────────┬──────────────────────────────────────────────────┤
│          │                                                  │
│ Sidebar  │  Main Content Area                              │
│ (236px)  │  (flex: 1, overflow-y: auto)                    │
│          │  padding: 20px                                   │
│ bg2      │                                                  │
│ border-r │  ┌─────────────────────────────────────────────┐ │
│          │  │  Section Header (h2 + mode toggle)          │ │
│ ┌──────┐ │  ├─────────────────────────────────────────────┤ │
│ │Setup │ │  │                                             │ │
│ │ 📊   │ │  │  Card Grid (status-grid / two-col)         │ │
│ │ 🔌   │ │  │  ┌──────────┐  ┌──────────┐               │ │
│ │ ⚙️   │ │  │  │  Card    │  │  Card    │               │ │
│ │ 🎯   │ │  │  │  (bg2)   │  │  (bg2)   │               │ │
│ ├──────┤ │  │  └──────────┘  └──────────┘               │ │
│ │Oper. │ │  │                                             │ │
│ │ 🎮   │ │  └─────────────────────────────────────────────┘ │
│ │ 🔴   │ │                                                  │
│ ├──────┤ │                                                  │
│ │Data  │ │                                                  │
│ │ 📁   │ │                                                  │
│ ├──────┤ │                                                  │
│ │ML    │ │                                                  │
│ │ 🧠   │ │                                                  │
│ │ 📈   │ │                                                  │
│ └──────┘ │                                                  │
├──────────┴──────────────────────────────────────────────────┤
│  Running Bar (optional, accent tint bg)                     │
│  [● Running] [━━━━━━━━━━━━ 67%] [Stop] [Goto Tab]         │
├─────────────────────────────────────────────────────────────┤
│  Console Drawer Header  [▼ Console] [process ▾] [actions]  │
│  Console Drawer Body (resizable, terminal-style log)        │
│  ┌─────────────────────────────────────────────────────────┐│
│  │  #0a0c10 background, monospace 12px                     ││
│  │  stdout / stderr / info lines                           ││
│  └─────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────┘
```

### 8.2 헤더 상세

```
Header (height: 52px, bg: var(--bg2), border-bottom: 1px solid var(--border))
├── .header-left (flex, align center, gap 10px)
│   ├── #sidebar-menu-btn (모바일 전용, 30×30, hidden by default)
│   ├── .brand-link
│   │   ├── .logo (20px emoji)
│   │   └── h1 (16px, weight 600, letter-spacing 0.3px)
│   └── .beta-badge
├── .header-right (flex, align center, gap 8px, font 12px)
│   ├── .header-profile-controls (gap 6px)
│   │   ├── #profile-select (min-width 150px, height 30px, font 12px)
│   │   └── .profile-more-btn (16px)
│   ├── .ws-status (gap 6px)
│   ├── .colab-quick-link (30×30, radius 999px)
│   ├── .hf-auth-link (30×30, radius 999px)
│   ├── .github-link
│   └── #theme-toggle-btn
```

### 8.3 사이드바 상세

```
#sidebar-nav (width: 236px, bg: var(--bg2), border-right, padding: 14px 10px)
├── .sidebar-group (margin-bottom: 14px)
│   ├── .sidebar-group-title (10px, uppercase, letter-spacing 0.8px, margin 0 8px 6px)
│   └── .tab-btn (padding 9px 10px, radius 7px, gap 8px, margin-bottom 2px)
│       ├── .tab-icon (14px)
│       ├── .tab-text (flex 1, ellipsis)
│       └── .tab-state-badge (9px, uppercase) 또는 .tab-state-dot (7×7px)
```

### 8.4 반응형 동작

| 화면 | Sidebar | Header | Main |
|------|---------|--------|------|
| > 1100px | 236px, 텍스트+아이콘+배지 | 풀 | padding 20px |
| 800-1100px | 68px, 아이콘만, 도트 표시 | 풀 | padding 20px |
| < 800px | 오버레이 (fixed, 280px/82vw), backdrop | 축소 (h1 숨김), 메뉴 버튼 | padding 16px |

---

## 9. 상태 패턴

### 9.1 인터랙션 상태

| 상태 | 스타일 |
|------|--------|
| **Hover (버튼)** | `opacity: 0.85` |
| **Hover (카드)** | `border-color: color-mix(accent 30%, border)` |
| **Hover (사이드바 탭)** | `color: var(--text)`, `bg: color-mix(bg3 70%, transparent)` |
| **Active (버튼)** | `opacity: 0.7` |
| **Active (CTA)** | `transform: translateY(0.5px)` |
| **Focus-visible** | `outline: 2px solid color-mix(accent 60%, transparent)`, `offset: 2px` |
| **Disabled** | `opacity: 0.6`, `cursor: not-allowed` |
| **Active Tab** | `color: var(--accent)`, `border: accent 38%+border`, `bg: accent 14%` |

### 9.2 로딩 상태

| 패턴 | 스타일 |
|------|--------|
| **Feed Spinner** | 22×22px 원, border 2px (border + accent top), spin 0.75s |
| **Feed Loading** | 전체 오버레이, #000, flex center |
| **Stalled Feed** | 오버레이 rgba(0,0,0,0.75), 11px yellow 텍스트 |
| **Paused Feed** | 오버레이 rgba(0,0,0,0.75), 12px text2 텍스트 |
| **Starting** | `⏳ Starting...` 텍스트 |

### 9.3 경고 & 차단 카드 패턴 (공통)

여러 탭에서 반복 사용되는 blocker/warning 카드 패턴:

```
Container:
  margin-bottom: 12px
  padding: 10px 12px
  border-radius: 8px
  border: 1px solid color-mix(yellow 35%, border)
  background: color-mix(yellow 10%, transparent)

Chip Row (내부):
  display: flex, gap 6px, flex-wrap wrap
  Chip: radius 999px, font 11px weight 600, padding 2px 8px
        yellow 색상 계열 (border, bg, text)

Actions Row:
  display: flex, gap 8px, flex-wrap wrap, margin-top 8px
  (Link/CTA 버튼 또는 Small 버튼)
```

사용 탭: Status Issues, Record Blocker, Train Blocker, Eval Blocker, Teleop Guard, Calibrate Blocker, Motor Setup Blocker, Mapping Blocker

### 9.4 에러 상태

| 패턴 | 스타일 |
|------|--------|
| **Red border card** | `border: 1px solid color-mix(red 40%, border)`, `bg: color-mix(red 10%, transparent)` |
| **Error text** | `color: var(--red)` 또는 `#f87171` |
| **Error badge** | `.badge-err`: `bg: red 20%`, `color: var(--red)` |
| **Terminal error line** | `color: var(--red)` |

### 9.5 Z-Index 레이어링

| Z-index | 요소 |
|---------|------|
| `9999` | Toast 컨테이너 |
| `1000` | 프로필 더보기 메뉴 |
| `40` | 사이드바 (모바일 오버레이) |
| `35` | 사이드바 backdrop (모바일) |
| `6` | 피드 닫기 버튼 |
| `5` | 라이브/FPS 배지, 디바이스 액션 패널, 스티키 컨트롤 바 |
| `3` | 피드 stalled/paused 오버레이 |
| `2` | 피드 로딩 오버레이, 모터 위치 thumb |

### 9.6 Box Shadow 패턴

| 사용처 | Shadow |
|--------|--------|
| 프로필 메뉴 | `0 8px 24px rgba(0,0,0,0.45)` |
| Toast | `0 8px 18px rgba(0,0,0,0.25)` |
| 사이드바 (모바일) | `0 8px 22px rgba(0,0,0,0.45)` |
| 디바이스 액션 패널 | `0 8px 20px rgba(0,0,0,0.35)` |
| 상태 도트 glow | `0 0 6px <color>` |
| HF 인증 도트 glow | `0 0 5px <color>` |
| 에피소드 진행 바 | `inset 0 1px 2px rgba(0,0,0,0.5)` |
| 모터 트랙 | `inset 0 1px 3px rgba(0,0,0,0.5)` |
| 모터 위치 thumb | `0 1px 4px rgba(0,0,0,0.8)` |
| ep-flash-save | `0 0 0 1px color-mix(green 22%), 0 8px 22px rgba(0,0,0,0.22)` |
| ep-flash-discard | `0 0 0 1px color-mix(red 22%), 0 8px 22px rgba(0,0,0,0.22)` |
| 사이드바 도트 (중간 뷰) | `0 0 0 1px var(--bg2)` |

---

## 10. 부록: Figma 팁

### 10.1 color-mix → Figma 변환

CSS `color-mix(in srgb, A X%, B)` 는 A 색상을 X% 비율로 B와 혼합합니다.

#### 케이스 1: `color-mix(A X%, transparent)`
Figma에서 A 색상에 **opacity X%** 를 적용하면 됩니다.

```
CSS:   color-mix(in srgb, #58a6ff 14%, transparent)
Figma: #58a6ff, Opacity 14%
```

#### 케이스 2: `color-mix(A X%, B)`
정확한 색상 계산이 필요합니다. 각 채널을 다음 공식으로 계산:

```
Result.R = A.R × (X/100) + B.R × (1 - X/100)
Result.G = A.G × (X/100) + B.G × (1 - X/100)
Result.B = A.B × (X/100) + B.B × (1 - X/100)
```

또는 Figma에서 **두 레이어 겹치기**로 근사 재현:
1. 하단 레이어: B 색상 (100% opacity)
2. 상단 레이어: A 색상 (X% opacity)

#### 자주 사용되는 혼합 결과 (Dark Theme 기준)

| CSS 표현 | 계산 결과 |
|----------|-----------|
| `color-mix(#58a6ff 38%, #30363d)` (active tab border) | `#3E6487` |
| `color-mix(#58a6ff 14%, transparent)` (active tab bg) | `#58a6ff` at 14% |
| `color-mix(#3fb950 45%, #30363d)` (green badge border) | `#377D46` |
| `color-mix(#f85149 45%, #30363d)` (red badge border) | `#8D4543` |
| `color-mix(#d29922 35%, #30363d)` (yellow badge border) | `#6A622E` |
| `color-mix(#58a6ff 8%, transparent)` (CTA bg) | `#58a6ff` at 8% |
| `color-mix(#58a6ff 60%, transparent)` (focus outline) | `#58a6ff` at 60% |

### 10.2 CSS Variable → Figma Local Styles 매핑

Figma에서 **Local Styles** 또는 **Variables** 로 관리하면 테마 전환이 편리합니다.

#### Color Variables (2개 모드: Dark / Light)

| Variable Name | Dark Mode | Light Mode |
|---------------|-----------|------------|
| `bg` | `#0d1117` | `#ffffff` |
| `bg2` | `#161b22` | `#f6f8fa` |
| `bg3` | `#21262d` | `#eaeef2` |
| `border` | `#30363d` | `#d0d7de` |
| `text` | `#e6edf3` | `#1f2328` |
| `text2` | `#8b949e` | `#57606a` |
| `accent` | `#58a6ff` | `#0969da` |
| `green` | `#3fb950` | `#1a7f37` |
| `red` | `#f85149` | `#cf222e` |
| `yellow` | `#d29922` | `#9a6700` |
| `purple` | `#bc8cff` | `#8250df` |

#### Text Styles

| Style Name | Font | Size | Weight | Letter Spacing |
|------------|------|------|--------|----------------|
| `heading/h1` | System UI | 16px | 600 | 0.3px |
| `heading/h2` | System UI | 18px | 600 | — |
| `heading/h3-card` | System UI | 13px | 600 | 0.2px |
| `body/default` | System UI | 13px | 400 | — |
| `body/small` | System UI | 12px | 400 | — |
| `body/xs` | System UI | 11px | 400 | — |
| `label/default` | System UI | 12px | 400 | — |
| `label/uppercase` | System UI | 10px | 700 | 0.8px |
| `mono/default` | SF Mono | 12px | 400 | — |
| `mono/large` | SF Mono | 20px | 600 | — |
| `badge/default` | System UI | 11px | 600 | 0.3px |
| `button/default` | System UI | 13px | 600 | — |
| `button/small` | System UI | 12px | 600 | — |
| `button/cta` | System UI | 12px | 600 | 0.1px |

#### Effect Styles

| Style Name | Type | Values |
|------------|------|--------|
| `shadow/menu` | Drop Shadow | `0 8px 24px rgba(0,0,0,0.45)` |
| `shadow/toast` | Drop Shadow | `0 8px 18px rgba(0,0,0,0.25)` |
| `shadow/card-flash` | Box Shadow | `0 0 0 1px <color> 22%, 0 8px 22px rgba(0,0,0,0.22)` |
| `glow/status-dot` | Drop Shadow | `0 0 6px <status-color>` |
| `inset/progress-bar` | Inner Shadow | `inset 0 1px 2px rgba(0,0,0,0.5)` |

### 10.3 컴포넌트 구성 권장

Figma 컴포넌트를 다음 계층으로 구성하면 CSS 구조와 일치합니다:

```
📁 Primitives
  ├── Colors (Variables, 2 modes)
  ├── Typography (Text Styles)
  └── Effects (Shadow/Blur Styles)

📁 Atoms
  ├── Button / Primary
  ├── Button / Danger
  ├── Button / Small
  ├── Button / XS
  ├── Button / CTA (link-btn, 3 variants)
  ├── Button / Toggle (default, active)
  ├── Button / Stop
  ├── Button / Goto
  ├── Badge (ok, warn, err, run, idle)
  ├── Status Dot (green, red, yellow, gray + pulse)
  ├── Perf Pill (idle, good, warn, bad)
  ├── Status Verdict (ready, warn)
  ├── Issue Chip
  ├── Episode State Pill (idle, running)
  ├── BETA Badge
  ├── KBD
  ├── Input
  ├── Select
  ├── Label
  └── Checkbox

📁 Molecules
  ├── Device Item (+ badge variants)
  ├── Card (basic, with title)
  ├── Quick Guide (with steps)
  ├── Advanced Panel (details/summary)
  ├── Blocker Card (with chips + actions)
  ├── Info Box
  ├── Toast (success, error, info)
  ├── Feed Card (with overlays)
  ├── Motor Monitor Card
  ├── Profile Menu (dropdown)
  ├── Episode Progress Card
  ├── Progress Bar (episode, USB, running)
  ├── Terminal Card
  └── Empty State (device, camera, dataset)

📁 Organisms
  ├── Header
  ├── Sidebar (with tab groups)
  ├── Console Drawer (with running bar)
  └── Sticky Controls Bar

📁 Templates
  └── App Shell (Header + Sidebar + Main + Console)
```

---

*이 문서는 LeStudio 프론트엔드 소스코드에서 자동 추출된 값을 기반으로 작성되었습니다.*
*CSS 파일 수정 시 이 문서도 함께 업데이트해 주세요.*
