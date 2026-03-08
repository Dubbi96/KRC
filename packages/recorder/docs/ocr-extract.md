# OCR Extract (`ocr_extract`) 스텝 가이드

이미지에서 텍스트를 추출하여 변수에 저장하는 자동화 스텝입니다.
캡차, OTP 코드, 영수증 번호 등 DOM에서 직접 읽을 수 없는 텍스트를 처리할 때 사용합니다.

---

## 목차

1. [사전 요구사항](#사전-요구사항)
2. [아키텍처 개요](#아키텍처-개요)
3. [대시보드에서 사용하기](#대시보드에서-사용하기)
4. [JSON 스크립트로 작성하기](#json-스크립트로-작성하기)
5. [설정 옵션 레퍼런스](#설정-옵션-레퍼런스)
6. [실행 파이프라인](#실행-파이프라인)
7. [변수 템플릿 바인딩](#변수-템플릿-바인딩)
8. [디버그 아티팩트](#디버그-아티팩트)
9. [HTML 리포트](#html-리포트)
10. [보안 고려사항](#보안-고려사항)
11. [활용 예시](#활용-예시)
12. [트러블슈팅](#트러블슈팅)

---

## 사전 요구사항

Tesseract OCR CLI가 시스템에 설치되어 있어야 합니다.

```bash
# macOS
brew install tesseract

# Ubuntu/Debian
sudo apt install tesseract-ocr

# 한국어 언어팩 추가
brew install tesseract-lang                    # macOS (전체 언어)
sudo apt install tesseract-ocr-kor             # Ubuntu (한국어만)
```

설치 확인:
```bash
tesseract --version
tesseract --list-langs   # 사용 가능한 언어 확인
```

---

## 아키텍처 개요

```
┌─────────────────────────────────────────────────────────┐
│                    ocr_extract 스텝                      │
│                                                         │
│  ┌──────────┐   ┌──────────┐   ┌──────────┐   ┌──────┐ │
│  │ 이미지   │──▶│ 전처리   │──▶│ Tesseract│──▶│ 후처리│ │
│  │ 캡처     │   │ (pngjs)  │   │ OCR      │   │      │ │
│  └──────────┘   └──────────┘   └──────────┘   └──┬───┘ │
│   element /      grayscale      spawnSync        │      │
│   viewport /     threshold      args배열         │      │
│   page           invert/scale                    ▼      │
│                                            vars[targetVar]
│                                            = processedText│
└─────────────────────────────────────────────────────────┘
```

**관련 소스 파일:**

| 파일 | 역할 |
|------|------|
| `src/types.ts` | `OcrExtractConfig`, `OcrResult`, `OcrPreprocess`, `OcrPostprocess` 타입 정의 |
| `src/engine/step-executors.ts` | `executeOcrExtract()`, `preprocessImage()`, `runTesseractOcr()` 실행 로직 |
| `src/web/replayer.ts` | `case 'ocr_extract'` 디스패치 |
| `src/engine/scenario-validator.ts` | 필수 필드 / 엔진 / regex 유효성 검사 |
| `src/editor/scenario-editor.ts` | `createEvent()` 기본값, `formatStep()` 표시 |
| `src/dashboard/dashboard-ui.ts` | STEP_FORMS 편집 폼, 삽입 모달, 요약/밸류 표시 |
| `src/reporter/generator.ts` | `buildOcrResult()` HTML 리포트 렌더링 |

---

## 대시보드에서 사용하기

### 스텝 추가

1. 대시보드에서 시나리오 열기
2. **"+ 스텝 삽입"** 버튼 클릭
3. **RPA** 카테고리에서 **`ocr_extract`** 선택
4. 편집 패널에서 설정 입력

### 편집 패널 필드 구성

대시보드의 OCR Extract 편집 패널(`STEP_FORMS` 레지스트리)은 아래 필드들로 구성됩니다:

```
┌─────────────────────────────────────────────┐
│  OCR Extract                    #14b8a6     │
├─────────────────────────────────────────────┤
│                                             │
│  캡처 방식*     [element ▼]                 │  ← source (element/viewport/page)
│                                             │
│  ── source=element일 때 ──                  │
│  대상 셀렉터    [#captcha-img          ]    │  ← selector (CSS 셀렉터)
│                                             │
│  ── source=viewport일 때 ──                 │
│  Region X  [0   ]  Region Y  [0   ]        │  ← region.x, region.y
│  Width     [200 ]  Height    [100 ]        │  ← region.width, region.height
│                                             │
│  결과 변수명*   [captchaText          ]     │  ← targetVar (필수)
│  OCR 엔진       [tesseract ▼]               │  ← engine (현재 tesseract만)
│  언어           [eng                  ]     │  ← language
│                                             │
│  ── 전처리 (Preprocess) ──                  │
│  ☑ 그레이스케일 전처리                      │  ← preprocess.grayscale
│  ☐ 이진화 (Threshold)                      │  ← preprocess.threshold
│  ☐ 색상 반전                                │  ← preprocess.invert
│  확대 배율      [2   ] (1~5)                │  ← preprocess.scale
│                                             │
│  ── 후처리 (Postprocess) ──                 │
│  후처리 Regex   [[0-9A-Za-z]{4,8}    ]     │  ← postprocess.regex
│  ☐ 공백 제거                                │  ← postprocess.stripSpaces
│  ☐ 대문자 변환                              │  ← postprocess.upper
│                                             │
│  ── 고급 설정 ──                            │
│  최소 신뢰도    [0.3 ] (0~1)                │  ← confidenceThreshold
│  타임아웃 (ms)  [15000]                     │  ← timeoutMs
│  ☑ 실패 시 전처리 변경 재시도               │  ← retryWithPreprocess
│                                             │
│  설명           [                     ]     │  ← description
│                                             │
└─────────────────────────────────────────────┘
```

> **조건부 표시**: `source=element`이면 셀렉터 필드만 표시, `source=viewport`이면 Region 좌표 필드만 표시됩니다 (`showWhen` 조건).

### 스텝 목록에서의 표시

| 위치 | 표시 형식 | 예시 |
|------|-----------|------|
| 타입 뱃지 | `badge-batch` 스타일 (청록색) | `ocr_extract` |
| 요약 (Summary) | `OCR {source} → {``{targetVar}``}` | `OCR element → {``{captchaText}``}` |
| 상세 (Detail) | `{selector}` 또는 `region(x,y)` 또는 `page` | `#captcha-img` |
| Value 열 | `{source} → {``{targetVar}``}` | `element → {``{captchaText}``}` |

### 타입 변환

기존 스텝에서 `ocr_extract`로 변환하거나, `ocr_extract`에서 다른 타입으로 변환할 수 있습니다.
변환 시 `ocrConfig` 기본값이 자동 설정됩니다:

```json
{
  "source": "element",
  "selector": "",
  "targetVar": "",
  "engine": "tesseract",
  "preprocess": { "grayscale": true, "scale": 2 },
  "postprocess": { "trimWhitespace": true },
  "confidenceThreshold": 0.3,
  "timeoutMs": 15000
}
```

---

## JSON 스크립트로 작성하기

시나리오 JSON 파일에 직접 `ocr_extract` 이벤트를 추가할 수 있습니다.

### 기본 형태

```json
{
  "type": "ocr_extract",
  "timestamp": 0,
  "description": "캡차 이미지에서 텍스트 추출",
  "ocrConfig": {
    "source": "element",
    "selector": "#captcha-image",
    "targetVar": "captchaText",
    "engine": "tesseract",
    "language": "eng",
    "preprocess": {
      "grayscale": true,
      "threshold": false,
      "invert": false,
      "scale": 2
    },
    "postprocess": {
      "regex": "[A-Za-z0-9]{4,8}",
      "stripSpaces": true,
      "upper": true,
      "trimWhitespace": true
    },
    "confidenceThreshold": 0.3,
    "timeoutMs": 15000,
    "retryWithPreprocess": true
  }
}
```

### source별 설정 예시

**element** — CSS 셀렉터로 특정 요소 캡처:
```json
{
  "source": "element",
  "selector": "img.captcha",
  "targetVar": "code"
}
```

**viewport** — 화면의 특정 좌표 영역 캡처:
```json
{
  "source": "viewport",
  "region": { "x": 100, "y": 200, "width": 300, "height": 50 },
  "targetVar": "otp"
}
```

**page** — 전체 페이지 캡처:
```json
{
  "source": "page",
  "targetVar": "fullText"
}
```

---

## 설정 옵션 레퍼런스

### OcrExtractConfig

| 필드 | 타입 | 필수 | 기본값 | 설명 |
|------|------|------|--------|------|
| `source` | `'element'` \| `'viewport'` \| `'page'` | ✅ | - | 이미지 캡처 방식 |
| `selector` | `string` | source=element | - | 대상 CSS 셀렉터 |
| `region` | `{x, y, width, height}` | source=viewport | - | 캡처 좌표 영역 |
| `targetVar` | `string` | ✅ | - | 추출 결과 저장 변수명 |
| `engine` | `'tesseract'` | - | `'tesseract'` | OCR 엔진 (현재 tesseract만 지원) |
| `language` | `string` | - | `'eng'` | Tesseract 언어 코드 |
| `preprocess` | `OcrPreprocess` | - | `{}` | 이미지 전처리 옵션 |
| `postprocess` | `OcrPostprocess` | - | `{}` | 텍스트 후처리 옵션 |
| `confidenceThreshold` | `number` | - | `0.0` | 최소 신뢰도 (0~1) |
| `timeoutMs` | `number` | - | `15000` | 타임아웃 ms |
| `retryWithPreprocess` | `boolean` | - | `true` | 신뢰도 미달 시 전처리 변경 재시도 |

### OcrPreprocess

| 필드 | 타입 | 기본값 | 설명 |
|------|------|--------|------|
| `grayscale` | `boolean` | `false` | RGB → 가중 평균 회색조 변환 (0.299R + 0.587G + 0.114B) |
| `threshold` | `boolean` | `false` | 이진화 (밝기 128 기준, 흑/백 변환) |
| `invert` | `boolean` | `false` | 색상 반전 (밝은 배경 + 어두운 글자 ↔ 역전) |
| `scale` | `number` | `1` | 이미지 확대 배율 (nearest neighbor, 2~3 권장) |

### OcrPostprocess

| 필드 | 타입 | 기본값 | 설명 |
|------|------|--------|------|
| `trimWhitespace` | `boolean` | `true` | 앞뒤 공백 제거 |
| `stripSpaces` | `boolean` | `false` | 모든 공백 제거 |
| `regex` | `string` | - | 정규식 필터 (첫 번째 캡처 그룹 추출) |
| `upper` | `boolean` | `false` | 대문자 변환 |
| `lower` | `boolean` | `false` | 소문자 변환 |

### language 값 참고

| 값 | 설명 |
|------|------|
| `eng` | 영어 (기본) |
| `kor` | 한국어 |
| `eng+kor` | 영어 + 한국어 동시 인식 |
| `jpn` | 일본어 |
| `chi_sim` | 중국어 (간체) |

> `+`로 여러 언어를 결합할 수 있습니다. 예: `eng+kor+jpn`

---

## 실행 파이프라인

`executeOcrExtract()`의 실행 흐름:

```
Step 1: 이미지 캡처
  ├─ source=element  → locator.screenshot()
  ├─ source=viewport → page.screenshot({ clip: region })
  └─ source=page     → page.screenshot()
           │
Step 2: 전처리 (preprocessImage)
  ├─ scale   → nearest neighbor 확대 (pngjs)
  ├─ grayscale → 가중 평균 회색조
  ├─ threshold → 128 기준 이진화
  └─ invert  → 픽셀 반전
           │
Step 3: OCR 수행 (runTesseractOcr)
  ├─ spawnSync('tesseract', [args...])
  ├─ TSV 출력 → 단어별 confidence 파싱
  └─ TSV 실패 시 → 일반 텍스트 모드 폴백
           │
Step 3.5: 재시도 (retryWithPreprocess=true 이고 confidence 미달 시)
  ├─ grayscale=true, threshold=true, scale 증가
  └─ 더 높은 confidence 결과 채택
           │
Step 4: 후처리 (postprocess)
  ├─ trimWhitespace → .trim()
  ├─ stripSpaces    → /\s+/g 제거
  ├─ regex          → 첫 캡처 그룹 추출
  ├─ upper          → .toUpperCase()
  └─ lower          → .toLowerCase()
           │
Step 5: 신뢰도 검사
  └─ confidence < threshold → 에러 (단, 결과는 변수에 저장됨)
           │
Step 6: 변수 저장
  └─ ctx.variables.set(targetVar, processedText)
           │
Step 7: 디버그 아티팩트 저장 (reportDir가 있을 때)
  ├─ out/ocr/step_001_{targetVar}.png  (전처리된 이미지)
  └─ out/ocr/step_001_{targetVar}.json (메타데이터)
```

---

## 변수 템플릿 바인딩

OCR로 추출한 텍스트는 `{{targetVar}}`로 후속 스텝에서 참조할 수 있습니다.

### 예시: 캡차 인증 자동화

```json
[
  {
    "type": "ocr_extract",
    "description": "캡차 이미지 OCR",
    "ocrConfig": {
      "source": "element",
      "selector": "#captcha-img",
      "targetVar": "captchaCode",
      "preprocess": { "grayscale": true, "threshold": true, "scale": 2 },
      "postprocess": { "stripSpaces": true, "upper": true }
    }
  },
  {
    "type": "fill",
    "selector": "#captcha-input",
    "value": "{{captchaCode}}"
  },
  {
    "type": "click",
    "selector": "#submit-btn"
  }
]
```

### 예시: OTP 코드 읽기 → API 요청에 사용

```json
[
  {
    "type": "ocr_extract",
    "ocrConfig": {
      "source": "viewport",
      "region": { "x": 200, "y": 300, "width": 150, "height": 40 },
      "targetVar": "otpCode",
      "postprocess": { "regex": "\\d{6}", "stripSpaces": true }
    }
  },
  {
    "type": "api_request",
    "apiRequest": {
      "method": "POST",
      "url": "https://api.example.com/verify",
      "body": { "otp": "{{otpCode}}" },
      "expectedStatus": 200
    }
  }
]
```

---

## 디버그 아티팩트

실행 시 `reportDir`가 설정되어 있으면 OCR 디버그 파일이 자동 생성됩니다.

```
out/
└── ocr/
    ├── step_001_captchaCode.png   ← 전처리 적용된 이미지
    └── step_001_captchaCode.json  ← 메타데이터
```

**JSON 메타데이터 예시:**
```json
{
  "rawText": "A B 3 K",
  "processedText": "AB3K",
  "confidence": 0.87,
  "engine": "tesseract",
  "preprocess": { "grayscale": true, "threshold": false, "scale": 2 },
  "postprocess": { "stripSpaces": true, "upper": true },
  "retryCount": 0,
  "source": "element",
  "selector": "#captcha-img"
}
```

> 전처리된 이미지를 직접 확인하여 OCR 정확도를 개선할 수 있습니다.

---

## HTML 리포트

실행 결과 HTML 리포트에서 OCR 스텝은 별도의 결과 블록으로 표시됩니다:

```
┌───────────────────────────────────────────┐
│  🔍 OCR Extract                           │
│                                           │
│  Raw:    A B 3 K                          │
│  Result: AB3K                             │
│  Confidence: 87.0%  Engine: tesseract     │
└───────────────────────────────────────────┘
```

- **Raw**: OCR 원본 출력 (후처리 전)
- **Result**: 후처리 적용 후 최종 텍스트 (bold)
- **Confidence**: 색상 코드로 신뢰도 시각화
  - 70%+ → 초록 (`#16a34a`)
  - 40~70% → 노랑 (`#eab308`)
  - 40% 미만 → 빨강 (`#ef4444`)
- 재시도 발생 시 `Retries: N` 표시

---

## 보안 고려사항

### Command Injection 방지

`language` 파라미터는 Tesseract CLI에 전달되므로, 아래 두 가지 방어가 적용됩니다:

1. **화이트리스트 검증**: `^[A-Za-z0-9+_]+$` 패턴만 허용
2. **Shell 해석 차단**: `spawnSync(args배열)` 사용 (문자열 보간 없음)

```
✅ eng, kor, eng+kor, chi_sim
❌ eng; rm -rf /, $(whoami), eng`id`
```

### Path Traversal 방지

`targetVar`가 아티팩트 파일명에 사용되므로:

1. **Sanitize**: `[^A-Za-z0-9_.-]` → `_`로 치환
2. **경로 검증**: `path.resolve()` 후 `ocrDir` 접두사 확인

```
../../../etc/passwd → .._.._.._etc_passwd (무력화)
```

---

## 활용 예시

### 1. 캡차 자동 입력

```json
{
  "source": "element",
  "selector": "img[alt='captcha']",
  "targetVar": "captcha",
  "preprocess": { "grayscale": true, "threshold": true, "scale": 3 },
  "postprocess": { "regex": "[A-Za-z0-9]+", "upper": true },
  "confidenceThreshold": 0.5
}
```

### 2. 영수증 번호 추출

```json
{
  "source": "viewport",
  "region": { "x": 50, "y": 400, "width": 300, "height": 30 },
  "targetVar": "receiptNo",
  "language": "eng",
  "postprocess": { "regex": "\\d{10,}", "stripSpaces": true }
}
```

### 3. 한국어 + 영어 혼합 텍스트

```json
{
  "source": "element",
  "selector": ".notice-text",
  "targetVar": "noticeContent",
  "language": "eng+kor",
  "preprocess": { "grayscale": true, "scale": 2 }
}
```

### 4. 어두운 배경의 밝은 글자 (반전 처리)

```json
{
  "source": "element",
  "selector": ".dark-badge",
  "targetVar": "badgeText",
  "preprocess": { "grayscale": true, "invert": true, "threshold": true, "scale": 2 }
}
```

---

## 트러블슈팅

### 신뢰도가 낮을 때

1. **전처리 옵션 조정**: `grayscale + threshold + scale:3` 조합 시도
2. **어두운 배경이면**: `invert: true` 추가
3. **글자가 작으면**: `scale` 값을 3~4로 올리기
4. **retryWithPreprocess** 활성화 (기본값)

### 빈 텍스트가 반환될 때

1. 디버그 아티팩트의 PNG 파일을 확인하여 전처리 결과 시각적 점검
2. `source`와 `selector`/`region`이 올바른 영역을 가리키는지 확인
3. Tesseract `language`가 대상 텍스트 언어와 일치하는지 확인

### Tesseract CLI 에러

```
tesseract CLI가 설치되어 있지 않습니다.
  macOS: brew install tesseract
  Ubuntu: sudo apt install tesseract-ocr
```

→ 시스템에 tesseract를 설치하고 `PATH`에 포함되어 있는지 확인하세요.

### Validator 경고

| 코드 | 메시지 | 해결 |
|------|--------|------|
| `MISSING_OCR_CONFIG` | ocrConfig가 정의되지 않음 | ocrConfig 객체 추가 |
| `MISSING_TARGET_VAR` | targetVar가 정의되지 않음 | 결과 변수명 입력 |
| `MISSING_SELECTOR` | source=element일 때 selector 필수 | CSS 셀렉터 입력 |
| `MISSING_REGION` | source=viewport일 때 region 필수 | 좌표 영역 입력 |
| `UNSUPPORTED_OCR_ENGINE` | engine이 tesseract가 아님 | engine을 'tesseract'로 변경 |
| `INVALID_OCR_REGEX` | postprocess.regex가 유효하지 않음 | 정규식 문법 수정 |
