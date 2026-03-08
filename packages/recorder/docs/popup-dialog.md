# Popup & Dialog 자동화 가이드

팝업(새 탭/윈도우)과 JS 다이얼로그(alert/confirm/prompt/beforeunload)를
녹화하고 재생하는 기능입니다.
OAuth 인증 플로우, 본인인증 팝업, window.open, target=\_blank 링크 등
다중 페이지 시나리오를 처리할 때 사용합니다.

---

## 목차

1. [개요](#개요)
2. [아키텍처 개요](#아키텍처-개요)
3. [이벤트 타입 레퍼런스](#이벤트-타입-레퍼런스)
4. [대시보드에서 사용하기](#대시보드에서-사용하기)
5. [JSON 시나리오로 작성하기](#json-시나리오로-작성하기)
6. [녹화 파이프라인](#녹화-파이프라인)
7. [재생 파이프라인](#재생-파이프라인)
8. [pageId 규칙과 PageRegistry](#pageid-규칙과-pageregistry)
9. [Dialog 번들링 패턴](#dialog-번들링-패턴)
10. [시나리오 편집기에서 수정하기](#시나리오-편집기에서-수정하기)
11. [활용 예시](#활용-예시)
12. [트러블슈팅](#트러블슈팅)

---

## 개요

Katab 레코더는 단일 페이지 자동화뿐 아니라 **다중 페이지** 시나리오를 지원합니다.

| 기능 | 설명 |
|------|------|
| **팝업 녹화/재생** | `window.open`, `target=_blank`, OAuth 리다이렉트 등으로 열리는 새 탭/윈도우의 모든 이벤트를 `pageId`로 구분하여 기록 |
| **다이얼로그 녹화/재생** | `alert`, `confirm`, `prompt`, `beforeunload` 다이얼로그의 타입, 메시지, 사용자 응답을 기록하고 동일하게 재현 |
| **액션+다이얼로그 번들링** | 클릭 직후 다이얼로그가 나타나는 패턴을 감지하여 핸들러를 사전 등록 — Playwright auto-dismiss 방지 |

---

## 아키텍처 개요

```
┌────────────────────────────────────────────────────────────────┐
│                      WebRecorder                               │
│                                                                │
│  ┌──────────────┐   ┌────────────────┐   ┌──────────────────┐ │
│  │ context.on   │──▶│ setupPage      │──▶│ recordEvent      │ │
│  │ ('page')     │   │ Listeners      │   │ (popup_opened)   │ │
│  │ 팝업 감지     │   │ exposeFunction │   │ (popup_closed)   │ │
│  └──────────────┘   │ + dialog 핸들러 │   │ (dialog)         │ │
│                     └────────────────┘   └──────┬───────────┘ │
│                                                  │             │
│                                     scenario.events[]에 추가    │
│                                     meta.pageId로 페이지 구분    │
└────────────────────────────────────────────────────────────────┘

┌────────────────────────────────────────────────────────────────┐
│                      WebReplayer                               │
│                                                                │
│  ┌──────────────┐   ┌────────────────┐   ┌──────────────────┐ │
│  │ popup_opened │──▶│ 3-Stage Popup  │──▶│ replayEvent      │ │
│  │ 스텝 만남     │   │ Detection      │   │ (해당 page에서)   │ │
│  │              │   │ 1. registry    │   │                  │ │
│  │ dialog 스텝  │   │ 2. context     │   │ dialog handler   │ │
│  │ 만남         │   │    .pages()    │   │ accept/dismiss   │ │
│  │              │   │ 3. waitFor     │   │                  │ │
│  └──────────────┘   │    Event       │   └──────────────────┘ │
│                     └────────────────┘                         │
│                                                                │
│  resolvePageForEvent(event, fallbackPage)                      │
│  → meta.pageId로 올바른 Page 객체를 찾아 이벤트 실행            │
└────────────────────────────────────────────────────────────────┘
```

**관련 소스 파일:**

| 파일 | 역할 |
|------|------|
| `src/types.ts` | `RecordingEventType`에 `popup_opened` / `popup_closed` / `dialog` 추가, `DialogConfig` 인터페이스 |
| `src/web/page-registry.ts` | `PageRegistry` 클래스 — `pageId` ↔ Playwright `Page` 매핑 관리 |
| `src/web/recorder.ts` | `setupPopupListener()`, `setupPageListeners()` — 팝업/다이얼로그 녹화 로직 |
| `src/web/replayer.ts` | 3-Stage popup 감지, standalone/bundled dialog 재생, `resolvePageForEvent()` |
| `src/engine/event-optimizer.ts` | 새 이벤트 타입의 `buildDescription()`, auto-wait 스킵 처리 |
| `src/engine/scenario-validator.ts` | `dialog` 필수 필드 검증, `popup_opened/closed` pass-through |
| `src/editor/scenario-editor.ts` | `createEvent()` 기본값, `formatStep()` 표시 |
| `src/dashboard/dashboard-ui.ts` | 이벤트 요약 표시, 기본 어설션 제안 |

---

## 이벤트 타입 레퍼런스

### `popup_opened`

새 탭 또는 윈도우가 열렸을 때 기록됩니다.

| 필드 | 타입 | 필수 | 설명 |
|------|------|------|------|
| `type` | `'popup_opened'` | O | 이벤트 타입 |
| `url` | `string` | - | 팝업 페이지의 초기 URL |
| `meta.pageId` | `string` | O | 팝업 식별자 (`popup_1`, `popup_2`, ...) |
| `meta.openerPageId` | `string` | - | 팝업을 연 부모 페이지 ID (`main` 또는 `popup_N`) |

### `popup_closed`

팝업 탭이 닫혔을 때 기록됩니다.

| 필드 | 타입 | 필수 | 설명 |
|------|------|------|------|
| `type` | `'popup_closed'` | O | 이벤트 타입 |
| `meta.pageId` | `string` | O | 닫힌 팝업의 식별자 |

### `dialog`

JS 다이얼로그가 나타났을 때 기록됩니다.

| 필드 | 타입 | 필수 | 설명 |
|------|------|------|------|
| `type` | `'dialog'` | O | 이벤트 타입 |
| `dialogConfig.dialogType` | `'alert' \| 'confirm' \| 'prompt' \| 'beforeunload'` | O | 다이얼로그 종류 |
| `dialogConfig.message` | `string` | O | 다이얼로그에 표시된 메시지 |
| `dialogConfig.defaultValue` | `string` | - | `prompt`의 기본 입력값 |
| `dialogConfig.action` | `'accept' \| 'dismiss'` | O | 수행할 액션 |
| `dialogConfig.promptText` | `string` | - | `prompt` accept 시 입력할 텍스트 |

---

## 대시보드에서 사용하기

### 팝업 이벤트 표시

대시보드 시나리오 뷰에서 팝업 이벤트는 다음과 같이 표시됩니다.

| 이벤트 | 요약 표시 | 상세 표시 |
|--------|-----------|-----------|
| `popup_opened` | `Popup open: popup_1` | 팝업 URL |
| `popup_closed` | `Popup close: popup_1` | - |
| `dialog` | `alert: accept` | 다이얼로그 메시지 (최대 40자) |

### 기본 어설션 제안

| 이벤트 | 자동 제안 어설션 |
|--------|-----------------|
| `popup_opened` | `url_contains` — 팝업 URL 포함 여부 확인 |
| `dialog` | `element_exists` — 다이얼로그 처리 후 특정 요소 존재 확인 |

### 시나리오 편집기에서 추가

시나리오 편집기 > **스텝 추가** 드롭다운에서 다음 이벤트를 수동으로 추가할 수 있습니다:

- **popup_opened** — 기본값: `pageId=popup_1`, `openerPageId=main`
- **popup_closed** — 기본값: `pageId=popup_1`
- **dialog** — 기본값: `dialogType=alert`, `action=accept`

---

## JSON 시나리오로 작성하기

### 팝업 시나리오 예시: OAuth 로그인

```jsonc
{
  "events": [
    // 1. 메인 페이지에서 "Google 로그인" 버튼 클릭
    {
      "type": "click",
      "selector": "#btn-google-login",
      "meta": { "pageId": "main" }
    },
    // 2. OAuth 팝업 열림 대기
    {
      "type": "popup_opened",
      "url": "https://accounts.google.com/...",
      "meta": { "pageId": "popup_1", "openerPageId": "main" }
    },
    // 3. 팝업에서 이메일 입력
    {
      "type": "fill",
      "selector": "#identifierId",
      "value": "{{email}}",
      "meta": { "pageId": "popup_1" }
    },
    // 4. 팝업에서 "다음" 클릭
    {
      "type": "click",
      "selector": "#identifierNext button",
      "meta": { "pageId": "popup_1" }
    },
    // 5. 팝업 자동 닫힘 (인증 완료 시)
    {
      "type": "popup_closed",
      "meta": { "pageId": "popup_1" }
    },
    // 6. 메인 페이지에서 결과 확인
    {
      "type": "wait_for",
      "waitForConfig": { "waitType": "element", "selector": "#user-profile" },
      "meta": { "pageId": "main" }
    }
  ]
}
```

### 다이얼로그 시나리오 예시

```jsonc
{
  "events": [
    // 1. 삭제 버튼 클릭 → confirm 다이얼로그 트리거
    {
      "type": "click",
      "selector": "#btn-delete",
      "meta": { "pageId": "main" }
    },
    // 2. confirm 다이얼로그 처리 (click 직후이므로 번들링 자동 적용)
    {
      "type": "dialog",
      "dialogConfig": {
        "dialogType": "confirm",
        "message": "정말 삭제하시겠습니까?",
        "action": "accept"
      },
      "meta": { "pageId": "main" }
    },
    // 3. prompt 다이얼로그 — 사유 입력
    {
      "type": "dialog",
      "dialogConfig": {
        "dialogType": "prompt",
        "message": "삭제 사유를 입력하세요",
        "defaultValue": "",
        "action": "accept",
        "promptText": "테스트 데이터 정리"
      },
      "meta": { "pageId": "main" }
    }
  ]
}
```

---

## 녹화 파이프라인

### 팝업 녹화 흐름

```
사용자가 링크 클릭 (target=_blank)
          │
          ▼
context.on('page') 발생  ──▶  WebRecorder.setupPopupListener()
          │
          ▼
1. pageId 발급 (popup_N)
2. setupPageListeners(popup, pageId)
   ├── exposeFunction('__katabRecordEvent')
   ├── page.on('load')  → navigate 이벤트 기록
   └── page.on('dialog') → dialog 이벤트 기록
3. waitForLoadState('domcontentloaded')  ← 이벤트 수집 준비 보장
4. popup_opened 이벤트 기록
5. popup.on('close') → popup_closed 이벤트 기록 + registry 제거
```

### 다이얼로그 녹화 흐름

```
JS 코드가 alert/confirm/prompt 호출
          │
          ▼
page.on('dialog') 발생  ──▶  Recorder dialog handler
          │
          ▼
1. dialogType, message, defaultValue 캡처
2. dialogConfig 이벤트 기록 (action: 'accept' 고정)
3. dialog.accept() 호출 (페이지 멈춤 방지)
```

> **참고:** 녹화 중 모든 다이얼로그는 `accept`로 처리됩니다.
> `confirm`에서 "취소"를 눌러야 하는 시나리오는 녹화 후 시나리오 편집기에서
> `dialogConfig.action`을 `"dismiss"`로 변경하면 됩니다.

---

## 재생 파이프라인

### 팝업 재생: 3-Stage Detection

팝업은 Playwright 이벤트 순서상 이미 열렸거나 아직 안 열렸을 수 있어서,
3단계로 탐색합니다:

```
popup_opened 스텝 실행
          │
          ▼
1단계: PageRegistry에서 pageId 조회
       (context.on('page')가 이미 등록했을 수 있음)
          │ 없으면
          ▼
2단계: context.pages()에서 미등록 페이지 탐색
       (popup이 이미 열렸지만 registry 등록이 안 된 경우)
          │ 없으면
          ▼
3단계: context.waitForEvent('page', timeout: 15초)
       (아직 열리지 않은 popup 대기)
          │
          ▼
팝업 찾음 → registry에 등록 + domcontentloaded 대기
          │
          ▼
이후 이벤트에서 meta.pageId로 해당 페이지 사용
```

### 다이얼로그 재생: 번들링 패턴

```
현재 이벤트: click     다음 이벤트: dialog
          │                    │
          ▼                    ▼
        번들링 감지 (nextEvent.type === 'dialog')
          │
          ▼
1. dialog handler를 먼저 등록 (page.once('dialog', handler))
2. click 액션 실행 → 다이얼로그 트리거
3. handler가 accept/dismiss 처리
4. dialog 스텝은 이미 처리됨 → i++ 스킵
```

---

## pageId 규칙과 PageRegistry

### pageId 명명 규칙

| ID | 의미 |
|----|------|
| `main` | 녹화/재생을 시작한 최초 페이지 |
| `popup_1` | 첫 번째 팝업 |
| `popup_2` | 두 번째 팝업 |
| `popup_N` | N번째 팝업 (순서대로 자동 증가) |

### PageRegistry API

`PageRegistry`는 Recorder와 Replayer 양쪽에서 사용하는 유틸리티 클래스입니다.

| 메서드 | 설명 |
|--------|------|
| `registerMain(page)` | 메인 페이지를 `'main'` ID로 등록 |
| `registerPopup(page)` | 팝업 등록 — `'popup_N'` ID를 자동 부여하고 반환 |
| `register(pageId, page)` | 지정 ID로 등록 (replayer에서 녹화된 pageId 재사용) |
| `get(pageId)` | pageId로 Page 객체 조회 |
| `remove(pageId)` | 페이지 제거 (닫힘 시) |
| `findId(page)` | Page 객체로 pageId 역조회 |
| `getAll()` | 등록된 모든 페이지 Map 반환 |
| `clear()` | 레지스트리 초기화 |

### resolvePageForEvent 폴백 정책

Replayer에서 `meta.pageId`로 Page를 찾지 못할 때의 폴백 순서:

1. registry에 등록된 닫히지 않은 마지막 페이지
2. 모든 페이지가 닫혔으면 → 메인(fallback) 페이지
3. 경고 로그 출력: `[WebReplayer] pageId "..." not found in registry`

---

## Dialog 번들링 패턴

### 왜 번들링이 필요한가?

Playwright는 `page.on('dialog')` 핸들러가 없으면 다이얼로그를 **자동 dismiss**합니다.
클릭 → 다이얼로그 순서에서 핸들러 등록이 늦으면 다이얼로그가 이미 사라질 수 있습니다.

### 번들링 조건

다음 조건이 모두 충족되면 자동 번들링:

1. 현재 이벤트가 `click`, `fill`, `navigate` 등 액션 이벤트
2. **바로 다음** 이벤트가 `type: 'dialog'`
3. 다음 이벤트의 `dialogConfig`가 존재
4. 다음 이벤트가 `disabled`가 아님

### 번들링 vs 단독 실행

| 상황 | 처리 방식 |
|------|-----------|
| click 직후 dialog | **번들링** — handler 먼저 등록, click 실행, 대기(5초) |
| 페이지 로드 중 자동 dialog | **단독 실행** — handler 등록 + 타임아웃(10초) 대기 |

---

## 시나리오 편집기에서 수정하기

### dialog action 변경

녹화 시 모든 다이얼로그는 `accept`로 기록됩니다.
`confirm` 다이얼로그에서 "취소"가 필요한 경우:

1. 시나리오 편집기에서 해당 `dialog` 스텝 선택
2. `dialogConfig.action`을 `"dismiss"`로 변경
3. 저장

### prompt 응답 변경

녹화 시 prompt에는 기본값이 입력됩니다. 다른 값을 입력해야 하는 경우:

1. `dialogConfig.promptText`를 원하는 값으로 수정
2. 변수 템플릿 사용 가능: `"promptText": "{{user_input}}"`

### 팝업 pageId 변경

보통 변경할 필요 없지만, 팝업 순서가 달라진 경우:

1. `popup_opened`의 `meta.pageId` 수정
2. 해당 팝업 내 모든 이벤트의 `meta.pageId`를 동일하게 수정
3. `popup_closed`의 `meta.pageId`도 일치시키기

---

## 활용 예시

### 1. Apple 소셜 로그인

```jsonc
{
  "events": [
    { "type": "click", "selector": "#apple-login-btn", "meta": { "pageId": "main" } },
    { "type": "popup_opened", "url": "https://appleid.apple.com/auth/...", "meta": { "pageId": "popup_1" } },
    { "type": "fill", "selector": "#account_name_text_field", "value": "{{apple_id}}", "meta": { "pageId": "popup_1" } },
    { "type": "click", "selector": "#sign-in", "meta": { "pageId": "popup_1" } },
    { "type": "popup_closed", "meta": { "pageId": "popup_1" } },
    { "type": "wait_for", "waitForConfig": { "waitType": "element", "selector": ".logged-in" }, "meta": { "pageId": "main" } }
  ]
}
```

### 2. 본인인증 팝업

```jsonc
{
  "events": [
    { "type": "click", "selector": "#btn-verify-phone", "meta": { "pageId": "main" } },
    { "type": "popup_opened", "meta": { "pageId": "popup_1" } },
    { "type": "fill", "selector": "#phone-number", "value": "{{phone}}", "meta": { "pageId": "popup_1" } },
    { "type": "click", "selector": "#btn-send-code", "meta": { "pageId": "popup_1" } },
    { "type": "dialog", "dialogConfig": { "dialogType": "alert", "message": "인증번호가 발송되었습니다", "action": "accept" }, "meta": { "pageId": "popup_1" } },
    { "type": "fill", "selector": "#verification-code", "value": "{{otp_code}}", "meta": { "pageId": "popup_1" } },
    { "type": "click", "selector": "#btn-confirm", "meta": { "pageId": "popup_1" } },
    { "type": "popup_closed", "meta": { "pageId": "popup_1" } }
  ]
}
```

### 3. confirm 취소 → 삭제 방지

```jsonc
{
  "events": [
    { "type": "click", "selector": "#btn-delete-account", "meta": { "pageId": "main" } },
    {
      "type": "dialog",
      "dialogConfig": {
        "dialogType": "confirm",
        "message": "계정을 삭제하시겠습니까?",
        "action": "dismiss"
      },
      "meta": { "pageId": "main" }
    },
    { "type": "wait_for", "waitForConfig": { "waitType": "element", "selector": "#user-profile" }, "meta": { "pageId": "main" } }
  ]
}
```

---

## 트러블슈팅

### 팝업이 시간 내에 감지되지 않음

```
Error: 팝업 "popup_1" 이(가) 시간 내에 나타나지 않음
```

**원인:** 팝업이 15초 내에 열리지 않았거나, 팝업이 아닌 iframe으로 열림

**해결:**
- 네트워크 속도가 느린 환경이면 시나리오 앞에 `wait` 스텝 추가
- iframe인 경우 popup 이벤트가 아닌 frame 기반 처리 필요 (현재 미지원)
- 브라우저의 팝업 차단이 비활성화되어 있는지 확인

### 다이얼로그가 나타나지 않음

```
Error: alert 다이얼로그가 10초 내에 나타나지 않음
```

**원인:** 이전 액션이 다이얼로그를 트리거하지 않았거나, 다이얼로그가 이미 자동 dismiss됨

**해결:**
- 다이얼로그를 트리거하는 액션(click 등) **바로 뒤에** dialog 스텝이 있는지 확인
  (중간에 다른 스텝이 있으면 번들링이 안 됨)
- `headless: false`로 실행하여 실제로 다이얼로그가 나타나는지 확인

### pageId 미스매치 경고

```
[WebReplayer] pageId "popup_2" not found in registry, using fallback
```

**원인:** popup이 자동으로 닫혔거나, 리다이렉트로 Page 객체가 교체됨

**해결:**
- 팝업이 녹화 중 닫힌 시점과 다르게 재생 중에 먼저 닫히는 경우 발생
- 해당 이벤트의 `meta.pageId`를 실제 열려 있는 page의 ID로 수정
- 또는 `popup_closed` 스텝의 위치를 조정

### 녹화 중 팝업 이벤트가 누락됨

**원인:** 팝업이 열리자마자 닫히거나, `exposeFunction` 등록 전에 이벤트 발생

**해결:**
- RECORDING_SCRIPT에 `typeof window.__katabRecordEvent === 'function'` guard가 있어,
  함수 등록 전 이벤트는 무시됩니다 (의도된 동작)
- 매우 빠르게 닫히는 팝업의 경우 `popup_opened`만 기록되고 내부 이벤트는 캡처되지 않을 수 있음
