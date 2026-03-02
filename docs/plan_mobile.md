# LeStudio Native Mobile App Strategy

최종 갱신: 2026-03-02

## 1) 전략 요약

- 모바일 클라이언트는 iOS/Android 네이티브 앱으로 제공한다.
- 앱의 1차 목표는 `모니터링 + 저위험 제어(pause/resume/stop)`이다.
- 하드웨어 직접 제어, 대규모 설정 편집, 터미널 작업은 PC Web UX로 유지한다.

## 2) 구현 방향

### 권장 기술 선택

- 클라이언트: React Native + Expo
- 실시간 통신: 기존 LeStudio WebSocket(`ws`) + REST API 재사용
- 푸시: APNs/FCM (Expo Notifications 또는 직접 연동)

### 채택 이유

- 현재 LeStudio가 React 기반이므로 개발팀의 생산성과 일관성이 높다.
- 네이티브 푸시/배경 동작/스토어 배포 요구를 충족할 수 있다.
- Swift/Kotlin 완전 분리 대비 개발 및 유지보수 비용을 낮출 수 있다.

## 3) MVP 범위 (4~6주)

### 포함 (P0)

- 서버 등록/연결: LAN 또는 Tailscale 주소 등록, 토큰 인증
- 실험 목록: running/queued/completed/failed 상태 카드
- 런 상세: step, epoch, loss, val loss, ETA, GPU/VRAM, 최근 업데이트 시각
- 로그: 최근 로그 tail, `error/warn/info` 필터, 자동 갱신
- 안전 제어: `pause`, `resume`, `stop` (이중 확인 모달 필수)
- 알림: 학습 완료/실패/중단/OOM 푸시

### 제외 (MVP 비범위)

- Teleop 실시간 영상/조이스틱 제어
- YAML/고급 하이퍼파라미터 전체 편집
- 터미널 직접 입력/실행
- 모델 아티팩트 대용량 업로드/다운로드

## 4) 앱 화면 정보구조 (4화면)

### A. Home

- 현재 활성 런 요약 카드(상태, ETA, loss, GPU)
- 최근 이벤트 타임라인(완료/실패/중단)
- 서버 연결 상태(Online/Degraded/Offline)

### B. Run Detail

- 실시간 메트릭(손실 곡선, step/epoch)
- 시스템 지표(GPU/VRAM/CPU)
- 로그 스트림 + 필터
- 제어 버튼(`pause/resume/stop`) + 이중 확인

### C. History

- 최근 실험 목록(검색/태그/상태 필터)
- 실험 2~3개 핵심 지표 비교
- best checkpoint 및 메모 확인

### D. Settings

- 서버 목록/토큰 관리
- 푸시 알림 온보딩 및 토픽 설정
- 앱 로그아웃/세션 초기화

## 5) API 계약 (네이티브 앱용)

### REST

- `GET /api/mobile/runs`
- `GET /api/mobile/runs/:runId`
- `GET /api/mobile/runs/:runId/logs?cursor=<token>&level=error,warn,info`
- `POST /api/mobile/runs/:runId/actions` body: `{ "action": "pause|resume|stop" }`
- `POST /api/mobile/notifications/device-token`

### WebSocket

- `WS /api/mobile/runs/:runId/stream`
- 이벤트 타입: `status`, `metric`, `log`, `resource`, `event`

### 공통 필드(초안)

- `runId`, `status`, `step`, `totalSteps`, `epoch`, `loss`, `valLoss`
- `etaSec`, `gpuUtil`, `vramUsedMb`, `updatedAt`

## 6) 보안/권한 원칙

- 기본 권한은 `viewer`(읽기 전용)
- 제어 액션은 `operator-mobile` 권한 + 재확인 모달
- 인증 토큰은 기기 보안 저장소(Keychain/Keystore)에 저장
- 민감값(환경변수/경로/토큰) 마스킹
- 액션 감사 로그: 누가/언제/무엇을 실행했는지 기록

## 7) 연결/배포 방식

- 내부 테스트: LAN 연결 + 사내 계정
- 외부 접속: Tailscale 우선, 필요 시 Cloudflare Tunnel 대안
- 배포: iOS TestFlight, Android Internal/Closed Testing
- 공개 인터넷 포트 직접 오픈은 기본 비권장

## 8) 푸시 알림 이벤트

- `run.completed`
- `run.failed`
- `run.paused`
- `run.stopped`
- `run.oom_detected`

알림 payload 예시:

```json
{
  "event": "run.failed",
  "runId": "train_20260302_1015",
  "title": "Training failed",
  "message": "OOM detected at step 12400",
  "timestamp": "2026-03-02T10:15:33+09:00"
}
```

## 9) P0/P1 백로그

### P0 (MVP)

1. React Native 앱 골격(Expo, navigation, auth bootstrap)
2. 모바일 전용 read API + run stream endpoint 정리
3. Home/Run Detail/History/Settings 4화면 구현
4. pause/resume/stop 액션 가드(권한/이중확인/감사로그)
5. APNs/FCM 푸시 토큰 등록 및 완료/실패/OOM 이벤트 연동
6. TestFlight/Closed Testing 배포 파이프라인 구축

### P1 (후속)

1. 실험 비교 강화(커스텀 메트릭/기간 필터)
2. 체크포인트 링크 공유/리포트 공유
3. 알림 채널 확장(Telegram/Slack)
4. Capacitor 또는 네이티브 모듈 검토(특수 하드웨어 연동 시)

## 10) 성공 기준 (MVP 완료 정의)

- iOS/Android에서 실행 중 런 1개 이상 실시간 모니터링 가능
- 상태/메트릭/로그 갱신 지연 3초 이내(일반 네트워크 기준)
- pause/resume/stop 액션이 권한 검증 및 감사 로그와 함께 동작
- 완료/실패 이벤트가 네이티브 푸시로 수신됨
- TestFlight/Android Closed track에서 내부 QA 통과
