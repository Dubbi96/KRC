// ─── Platform ─────────────────────────────────────────────
export type Platform = 'web' | 'ios' | 'android';

// ─── Web Device Emulation ─────────────────────────────────
export type WebDeviceType =
  | 'desktop'
  | 'iphone-14'
  | 'iphone-14-pro-max'
  | 'iphone-15-pro'
  | 'pixel-7'
  | 'galaxy-s24';

export interface DeviceEmulationConfig {
  deviceType: WebDeviceType;
  viewport: { width: number; height: number };
  userAgent?: string;
  deviceScaleFactor?: number;
  isMobile?: boolean;
  hasTouch?: boolean;
}

// ─── Event Types ──────────────────────────────────────────
export type RecordingEventType =
  // Browser interactions
  | 'click' | 'fill' | 'select' | 'navigate' | 'wait'
  // Mobile interactions
  | 'tap' | 'swipe' | 'scroll' | 'type' | 'longPress' | 'home' | 'back'
  | 'clear_app'       // 앱 캐시/데이터 초기화
  // Advanced steps (편집기에서 삽입)
  | 'wait_for_user'   // 캡차, SMS 인증 등 수동 대기
  | 'check_email'     // IMAP 이메일 수신 확인 + 인증 링크 추출
  | 'api_request'     // HTTP API 호출
  | 'assert'          // 어설션 전용 step
  | 'run_script'      // JS/Shell 스크립트 실행
  | 'set_variable'    // 변수 설정/계산
  // RPA 확장
  | 'extract_data'    // 요소 데이터 추출 → 변수 저장
  | 'keyboard'        // 키보드 단축키 (Ctrl+A, Enter 등)
  | 'hover'           // 마우스 호버
  | 'wait_for'        // 자동 대기 조건 (element_visible, network_idle 등)
  | 'image_match'     // 화면 이미지 매칭 (DOM 없는 웹뷰/하이브리드 앱용)
  | 'ocr_extract'     // 이미지/요소에서 OCR로 텍스트 추출 → 변수 저장
  | 'for_each_start'  // 반복 시작 마커
  | 'for_each_end'    // 반복 종료 마커
  | 'if_start'        // 조건 시작 마커
  | 'if_end'          // 조건 종료 마커
  | 'block_start'     // 블록(컨테이너) 시작 마커 — Power Automate style scope
  | 'block_end'       // 블록(컨테이너) 종료 마커
  // iOS 시스템 알럿
  | 'ios_alert_accept'   // iOS 시스템 알럿 확인 버튼 클릭
  | 'ios_alert_dismiss'  // iOS 시스템 알럿 취소 버튼 클릭
  // Multi-page & dialog
  | 'popup_opened'    // 새 탭/윈도우 열림 (window.open, target=_blank, OAuth 등)
  | 'popup_closed'    // 팝업 탭 닫힘
  | 'dialog';         // JS alert/confirm/prompt/beforeunload

// ─── Assertion ────────────────────────────────────────────
export type AssertionType =
  | 'url_contains'
  | 'url_equals'
  | 'url_matches'              // regex
  | 'element_exists'
  | 'element_not_exists'
  | 'element_visible'
  | 'text_contains'
  | 'text_equals'
  | 'element_text_contains'
  | 'element_text_equals'
  | 'element_attribute_equals'
  | 'http_status'
  | 'response_body_contains'
  | 'variable_equals'
  | 'video_playing'            // <video> 요소가 실제 재생 중인지 검증 (currentTime 증가 + paused=false)
  | 'video_no_error'           // <video> 요소에 에러가 없는지 검증
  | 'video_auto'               // video_playing 시도 → video 없으면 stream_segments_loaded로 폴백
  | 'video_visual'             // 시각적 프레임 비교로 영상 재생 감지 (canvas/iframe 환경 대응)
  | 'stream_segments_loaded'   // 네트워크 기반 HLS/DASH 스트림 세그먼트 로드 검증
  | 'custom'                   // JS expression
  // iOS assertions (pageSource XML 기반)
  | 'ios_element_visible'      // XCUIElement가 화면에 보이는지 (accessibilityId/name/xpath)
  | 'ios_element_not_exists'   // XCUIElement가 존재하지 않는지
  | 'ios_text_contains'        // pageSource에 특정 텍스트 포함 여부
  | 'ios_text_absent'          // pageSource에 특정 텍스트가 없어야 함 (오류/실패 탐지)
  | 'ios_element_value_equals' // XCUIElement value 속성 비교
  | 'ios_list_count'           // 특정 타입/셀렉터 요소의 visible 개수 >= expected (리스트 존재 확인)
  | 'ios_no_alert'             // 시스템 알럿/권한 팝업 부재 검증
  | 'ios_screen_changed'       // 이전 pageSource와 현재가 달라야 함 (화면 전환 확인)
  // Network assertions (프록시/네트워크 로그 기반)
  | 'network_request_sent'     // 특정 URL 패턴의 요청이 발생했는지 검증
  | 'network_response_status'  // 특정 URL 패턴 요청의 응답 상태 코드 검증
  | 'network_response_json'    // 응답 JSON body에서 JSONPath 조건 검증
  | 'network_image_loads'      // 이미지 URL들이 정상 로드(200)되는지 샘플링 검증
  | 'network_no_errors'        // 네트워크 에러(4xx/5xx/timeout)가 없는지 검증
  // Android assertions (UIAutomator XML 기반)
  | 'android_element_visible'       // UIAutomator 요소가 화면에 보이는지 (resource-id/content-desc/text)
  | 'android_element_not_exists'    // UIAutomator 요소가 존재하지 않는지
  | 'android_text_contains'         // UIAutomator dump에 특정 텍스트 포함 여부
  | 'android_element_text_equals';  // UIAutomator 요소 text 속성 비교

export interface Assertion {
  type: AssertionType;
  target?: string;             // selector, URL, variable name
  expected: string;            // expected value or pattern
  attribute?: string;          // for element_attribute_equals
  message?: string;            // custom failure message
  optional?: boolean;          // true면 실패해도 step은 pass
  videoConfig?: {              // video_playing / video_no_error / video_auto 전용
    observeMs?: number;        // 관측 시간 ms (기본 2000)
    minTimeAdvance?: number;   // 최소 currentTime 증가량 초 (기본 0.5)
    requireDimension?: boolean;  // videoWidth/Height > 0 체크 (기본 true)
  };
  visualConfig?: {             // video_visual 전용
    observeMs?: number;        // 두 프레임 사이 대기 시간 ms (기본 1500)
    changeThreshold?: number;  // 변화 판정 비율 0~1 (기본 0.005 = 0.5%)
    clip?: { x: number; y: number; width: number; height: number };  // 특정 영역만 비교
  };
  iosSelector?: {              // iOS assertion 전용: XCUIElement 셀렉터
    strategy: 'accessibility_id' | 'name' | 'label' | 'xpath';
    value: string;
  };
  androidSelector?: {          // Android assertion 전용: UIAutomator 셀렉터
    strategy: 'resource_id' | 'content_desc' | 'text' | 'xpath';
    value: string;
  };
  streamConfig?: {             // stream_segments_loaded / video_auto 전용
    manifestPattern?: string;  // manifest URL 패턴 (기본: '\\.(m3u8|mpd)(\\?|$)')
    segmentPattern?: string;   // segment URL 패턴 (기본: '\\.(ts|m4s|mp4)(\\?|$)')
    windowMs?: number;         // 모니터링 윈도우 ms (기본 5000)
    minSegmentResponses?: number;  // 최소 세그먼트 응답 수 (기본 2)
    minManifestResponses?: number; // 최소 매니페스트 응답 수 (기본 1)
    allowedStatus?: number[];  // 허용 HTTP 상태 코드 (기본 [200, 206])
    requireSegmentBytes?: number;  // 최소 세그먼트 바이트 수 (기본 1000)
  };
  iosListConfig?: {            // ios_list_count 전용
    elementType?: string;      // 카운트할 XCUIElementType (기본: 'Cell')
    minCount?: number;         // 최소 개수 (기본: 1)
  };
  iosAbsentTexts?: string[];   // ios_text_absent 전용: 없어야 하는 텍스트 목록 (기본: expected 하나만)
  previousPageSource?: string; // ios_screen_changed 전용: 이전 pageSource (런타임에 자동 설정)
  networkConfig?: {            // network_* assertion 전용
    urlPattern: string;        // URL 매칭 패턴 (부분 문자열 또는 정규식)
    urlIsRegex?: boolean;      // true면 urlPattern을 정규식으로 처리 (기본: false = 부분 문자열)
    method?: string;           // HTTP method 필터 (GET, POST 등, 기본: any)
    expectedStatus?: number;   // network_response_status용: 기대 상태 코드 (기본: 200)
    jsonPath?: string;         // network_response_json용: JSONPath (e.g. "$.items.length", "$.data.id")
    jsonOp?: '>' | '>=' | '<' | '<=' | '==' | '!=' | 'exists' | 'not_empty';  // 비교 연산자
    jsonValue?: string | number;  // 비교 대상 값
    sampleCount?: number;      // network_image_loads용: 샘플 URL 수 (기본: 3)
    imageUrlJsonPath?: string; // network_image_loads용: 이미지 URL 추출 JSONPath (e.g. "$.items[*].thumbnailUrl")
    windowMs?: number;         // 로그 검색 윈도우 ms (기본: 30000)
    allowedErrorStatus?: number[]; // network_no_errors용: 허용할 상태 코드 (기본: [])
  };
}

export interface AssertionResult {
  assertion: Assertion;
  passed: boolean;
  actual?: string;
  error?: string;
}

// ─── Network Log Entry (스트림 검증 + 네트워크 assertion 공용) ──
export interface NetworkLogEntry {
  url: string;
  method?: string;               // HTTP method (GET, POST, etc.)
  status: number;
  contentType: string;
  contentLength: number;         // bytes (-1 if unknown)
  timestamp: number;             // Date.now()
  responseBody?: string;         // 응답 body (JSON string, 캡처 시에만)
  requestBody?: string;          // 요청 body (캡처 시에만)
  duration?: number;             // 요청-응답 소요 시간 ms
  error?: string;                // 네트워크 에러 메시지 (timeout, DNS 등)
}

// ─── API Request ──────────────────────────────────────────
export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export interface ApiRequestConfig {
  method: HttpMethod;
  url: string;                                // {{변수}} 지원
  headers?: Record<string, string>;           // {{변수}} 지원
  body?: string | Record<string, any>;        // {{변수}} 지원
  timeout?: number;                           // ms, default 30000
  captureResponseAs?: string;                 // 응답 body를 변수에 저장
  captureHeaders?: Record<string, string>;    // header → 변수 매핑
  captureJsonPath?: Record<string, string>;   // JSON path → 변수 매핑 (e.g. {"$.data.id": "orderId"})
  captureExpression?: string;                 // JS 표현식으로 응답 가공 후 변수 저장 (e.g. "res => res.find(x=>x.Name==='test').Id")
  captureExpressionAs?: string;               // captureExpression 결과를 저장할 변수명
  expectedStatus?: number;                    // e.g. 200
  successCondition?: {
    jsonPath: string;           // 응답 body에서 평가할 경로 (e.g. "$.ResultCode", "$.success", "$.Message")
    operator: '==' | '!=' | '>' | '>=' | '<' | '<=' | 'contains' | 'not_contains';
    expected: string;           // 비교 대상 값 (문자열, {{변수}} 지원)
  };
  usePageCookies?: boolean;                   // true면 Playwright 컨텍스트 쿠키를 자동으로 Cookie 헤더에 추가
}

// ─── Wait For User ────────────────────────────────────────
export interface WaitForUserConfig {
  message: string;                 // 화면에 표시할 안내 메시지
  timeout?: number;                // 최대 대기 시간 ms (0 = 무한)
  resumeOn?: 'keypress' | 'url_change' | 'element_appear';
  resumeSelector?: string;         // element_appear 감지용 selector
  resumeUrlPattern?: string;       // url_change 감지용 패턴
}

// ─── Check Email (IMAP 이메일 인증) ─────────────────────
export type EmailProvider = 'gmail' | 'naver' | 'outlook' | 'custom';

export interface CheckEmailConfig {
  provider: EmailProvider;          // 프리셋 (host/port 자동 설정)
  host?: string;                    // custom일 때
  port?: number;                    // custom일 때 (기본 993)
  user: string;                     // {{변수}} 지원
  pass: string;                     // 앱 비밀번호 ({{변수}} 지원)
  from?: string;                    // 발신자 필터
  subject?: string;                 // 제목 포함 검색
  linkPattern?: string;             // URL 추출 정규식 (기본: 일반 URL 패턴)
  linkIndex?: number;               // 여러 링크 중 몇 번째 (기본 0)
  captureUrlAs?: string;            // 추출 URL → 변수 저장
  navigateToLink?: boolean;         // 브라우저에서 링크 열기 (기본 true)
  timeout?: number;                 // 전체 타임아웃 ms (기본 60000)
  pollInterval?: number;            // 폴링 간격 ms (기본 5000)
  deleteAfterRead?: boolean;        // 읽은 후 삭제 (기본 false)
}

// ─── Script ───────────────────────────────────────────────
export interface ScriptConfig {
  language: 'javascript' | 'shell';
  code: string;                    // {{변수}} 지원
  captureOutputAs?: string;        // 결과를 변수에 저장
  timeout?: number;                // ms, default 10000
}

// ─── Extract Data ────────────────────────────────────────
export type ExtractTransformType = 'trim' | 'regex' | 'replace' | 'number_only' | 'jsonPath';

export interface ExtractTransform {
  type: ExtractTransformType;
  pattern?: string;                              // regex: 캡처 그룹 패턴, replace: 검색 패턴, jsonPath: JSON path
  replacement?: string;                          // replace: 교체 문자열
  group?: number;                                // regex: 캡처 그룹 인덱스 (기본: 1)
}

export interface ExtractDataConfig {
  selector: string;                              // 대상 요소 CSS 셀렉터
  extractType: 'text' | 'attribute' | 'innerHTML' | 'value' | 'table' | 'list' | 'count' | 'url_param' | 'url_path';
  attribute?: string;                            // extractType='attribute' 일 때 속성명
  captureAs: string;                             // 결과 저장 변수명
  rowSelector?: string;                          // table 옵션: 행 셀렉터 (기본 'tr')
  cellSelector?: string;                         // table 옵션: 셀 셀렉터 (기본 'td,th')
  transform?: ExtractTransform[];                // 추출 후 변환 파이프라인
  assertNotEmpty?: boolean;                      // true면 빈 값 시 실패
  urlParam?: string;                             // url_param: 추출할 쿼리 파라미터 이름
  urlPathIndex?: number;                         // url_path: 추출할 path 세그먼트 인덱스 (0-based)
}

// ─── Keyboard ────────────────────────────────────────────
export interface KeyboardConfig {
  key: string;                                   // Playwright 키 이름: 'Enter', 'Tab', 'Control+a' 등
  selector?: string;                             // 포커스 대상 (없으면 현재 포커스)
}

// ─── Wait For (자동 대기) ────────────────────────────────
export interface WaitForConfig {
  waitType: 'element_visible' | 'element_hidden' | 'url_change' | 'network_idle'
    | 'ios_element_visible' | 'ios_element_not_exists' | 'ios_text_contains';
  selector?: string;                             // element_visible/hidden 용 (웹 CSS 셀렉터)
  iosSelector?: {                                // iOS 요소 대기용 셀렉터
    strategy: 'accessibility_id' | 'name' | 'label' | 'xpath';
    value: string;
  };
  iosExpectedText?: string;                      // ios_text_contains용 대기 텍스트
  urlPattern?: string;                           // url_change 용
  timeout?: number;                              // ms, default 30000
  pollInterval?: number;                         // iOS 폴링 간격 ms (default 1000)
  waitUntil?: 'domcontentloaded' | 'load' | 'networkidle';  // url_change 시 대기 기준 (default: domcontentloaded)
}

// ─── For Each (반복) ─────────────────────────────────────
export interface ForEachConfig {
  selector: string;                              // 반복 대상 요소 셀렉터
  itemVariable?: string;                         // 현재 인덱스 변수명 (기본: '__index')
  countVariable?: string;                        // 총 개수 변수명 (기본: '__count')
  maxIterations?: number;                        // 최대 반복 횟수 (무한루프 방지, 기본: 100)
}

// ─── If Condition (조건) ─────────────────────────────────
export interface IfConditionConfig {
  conditionType: 'element_exists' | 'element_visible' | 'variable_equals'
    | 'variable_contains' | 'url_contains' | 'custom'
    | 'ios_element_visible' | 'ios_element_exists'
    | 'ios_alert_present';
  selector?: string;                             // element_exists/visible 용 (web)
  variable?: string;                             // variable_equals/contains 용
  expected?: string;                             // 비교 대상 값 ({{변수}} 지원)
  expression?: string;                           // custom JS expression
  iosSelector?: { strategy: string; value: string };  // ios_element_visible/exists 용
  iosElementType?: string;                       // iOS 요소 타입 (TextField, Button 등) — predicate 정확도 향상
}

// ─── Block (컨테이너 블록) ───────────────────────────────
export interface BlockConfig {
  name: string;                                // 블록 이름 (예: "로그인", "결제 플로우")
  description?: string;                        // 블록 설명
  parentId?: string;                           // 중첩 블록일 때 부모 블록 ID (트리 구조)
  color?: string;                              // UI 표시 색상 (기본: #8b5cf6)
}

// ─── OCR Extract (이미지 텍스트 추출) ────────────────────
export type OcrSource = 'element' | 'viewport' | 'page';
export type OcrEngine = 'tesseract' | 'claude_vision';  // tesseract: 로컬 OCR, claude_vision: Claude API (ANTHROPIC_API_KEY 필요)

export interface OcrPreprocess {
  grayscale?: boolean;                   // 그레이스케일 변환
  threshold?: boolean;                   // 이진화 (흑백 임계값)
  invert?: boolean;                      // 색상 반전
  scale?: number;                        // 이미지 확대 배율 (기본 1, 2면 2배 확대)
}

export interface OcrPostprocess {
  regex?: string;                        // 정규식 필터 (매칭되는 첫 그룹 추출)
  stripSpaces?: boolean;                 // 공백 제거
  upper?: boolean;                       // 대문자 변환
  lower?: boolean;                       // 소문자 변환
  trimWhitespace?: boolean;              // 앞뒤 공백 제거
}

export interface OcrExtractConfig {
  source: OcrSource;                     // 캡처 방식: element(셀렉터), viewport(영역), page(전체)
  selector?: string;                     // source='element' 시 대상 CSS 셀렉터
  region?: {                             // source='viewport' 시 크롭 영역
    x: number;
    y: number;
    width: number;
    height: number;
  };
  targetVar: string;                     // 추출된 텍스트를 저장할 변수명
  engine?: OcrEngine;                    // OCR 엔진 (기본 'tesseract', 현재 tesseract만 지원)
  preprocess?: OcrPreprocess;            // 전처리 옵션
  postprocess?: OcrPostprocess;          // 후처리 옵션
  confidenceThreshold?: number;          // 최소 신뢰도 (0~1, 기본 0.0)
  timeoutMs?: number;                    // OCR 타임아웃 ms (기본 15000)
  language?: string;                     // OCR 언어 (예: 'eng', 'kor', 'eng+kor')
  retryWithPreprocess?: boolean;         // 실패 시 전처리 옵션 변경 후 재시도 (기본 true)
  psm?: number;                          // Tesseract PSM 모드 (기본 6, 캡차용 7 권장)
  charWhitelist?: string;                // Tesseract 문자 제한 (예: '0123456789' → 숫자만 인식)
}

// ─── OCR Result (실행 결과) ──────────────────────────────
export interface OcrResult {
  rawText: string;                       // OCR 원본 텍스트
  processedText: string;                 // 후처리 적용 후 텍스트
  confidence: number;                    // 신뢰도 (0~1)
  engine: string;                        // 사용된 엔진
  imagePath?: string;                    // 디버그용 캡처 이미지 경로
  preprocessApplied?: OcrPreprocess;     // 적용된 전처리
  retryCount?: number;                   // 재시도 횟수
}

// ─── Image Match (화면 이미지 비교) ─────────────────────
export interface ImageMatchConfig {
  templateBase64: string;              // 기준 이미지 (base64 PNG) — 대시보드에서 캡처
  threshold?: number;                  // pixelmatch 임계값 (0~1, 기본 0.1)
  maxDiffPercent?: number;             // 허용 diff 비율 (0~100, 기본 5)
  timeout?: number;                    // 대기 최대 시간 ms (기본 10000)
  pollInterval?: number;               // 재시도 간격 ms (기본 500)
  clip?: { x: number; y: number; width: number; height: number }; // 화면 일부만 비교
}

// ─── Preferred Locator (풍부한 로케이터 후보) ────────────
export type PreferredLocatorKind =
  | 'testid'
  | 'role'
  | 'label'
  | 'placeholder'
  | 'text'
  | 'title'
  | 'css'
  | 'xpath';

export interface PreferredLocator {
  kind: PreferredLocatorKind;
  value: string;                          // testid, label, placeholder, title, text의 값 또는 css/xpath 셀렉터
  role?: string;                          // kind='role'일 때 ARIA role
  name?: string;                          // kind='role'일 때 accessible name
  exact?: boolean;                        // 정확한 매칭 여부 (기본: false)
}

// ─── Self-Heal Result (복구된 로케이터 이력) ─────────────
export interface HealedLocator {
  locator: PreferredLocator;              // 복구에 성공한 로케이터
  healedAt: number;                       // 복구 시점 timestamp
  successCount: number;                   // 이 로케이터로 성공한 횟수
  originalSelector?: string;              // 원래 실패했던 셀렉터
  strategy: string;                       // 복구에 사용된 전략 (예: 'role-name-similarity', 'label-input', 'bbox-proximity')
}

// ─── Dialog (JS 다이얼로그) ──────────────────────────────
export type DialogAction = 'accept' | 'dismiss';

export interface DialogConfig {
  dialogType: 'alert' | 'confirm' | 'prompt' | 'beforeunload';
  message: string;                   // dialog.message()
  defaultValue?: string;             // prompt 기본값
  action: DialogAction;              // accept 또는 dismiss
  promptText?: string;               // prompt accept 시 입력값 (재생용)
}

// ─── Within Scope (행 스코프 로케이터) ──────────────────
export interface WithinScope {
  selector: string;                            // 스코프 컨테이너 CSS 셀렉터 (예: "table tbody tr", "div.card")
  hasText?: string;                            // 스코프 요소 특정 텍스트 ({{변수}} 지원)
}

// ─── Recording Event ──────────────────────────────────────
export interface RecordingEvent {
  type: RecordingEventType;
  timestamp: number;

  // 기존 필드 (웹/모바일 공통)
  selector?: string;
  value?: string;
  url?: string;
  coordinates?: { x: number; y: number };
  from?: { x: number; y: number };
  to?: { x: number; y: number };
  duration?: number;
  text?: string;
  meta?: {
    element?: {
      type?: string;
      label?: string;
      name?: string;
      accessibilityId?: string;
      xpath?: string;
      cssSelector?: string;
      testId?: string;
      textContent?: string;        // 텍스트 내용 (최대 200자)
      innerText?: string;          // 보이는 텍스트만 (getByText용)
      role?: string;               // ARIA role (명시적 또는 암시적)
      placeholder?: string;        // placeholder 속성
      title?: string;              // title 속성
      boundingBox?: {              // 요소 위치 (getBoundingClientRect)
        x: number;
        y: number;
        width: number;
        height: number;
      };
      isVisible?: boolean;         // 렌더링 시점 가시성 (display/visibility/opacity)
      isEnabled?: boolean;         // disabled 속성 여부
      // 정규화된 텍스트 (self-heal 유사도 비교용)
      textNormalized?: string;     // textContent 정규화 (공백/개행 압축, trim)
      accessibleNameNormalized?: string;  // label/aria-label 정규화
      // Android 전용 (UIAutomator dump에서 추출)
      resourceId?: string;         // resource-id (e.g. "com.app:id/btn_login")
      contentDesc?: string;        // content-desc (접근성 설명)
      text?: string;               // Android UI 텍스트
    };
    selectors?: string[];
    preferredLocators?: PreferredLocator[];   // 권장 로케이터 후보 (기록 시 생성)
    healedLocators?: HealedLocator[];         // self-heal로 복구된 로케이터 이력
    source?: string;
    screenshot?: string;
    pageContext?: {                 // 이벤트 시점 페이지 상태
      scrollX: number;
      scrollY: number;
      viewportWidth: number;
      viewportHeight: number;
      readyState: string;
      title: string;
    };
    [key: string]: any;
  };

  // 편집/고급 필드
  stepNo?: number;                     // 스텝 번호 (편집 후 재정렬)
  description?: string;                // 사람이 읽을 수 있는 설명
  assertion?: Assertion;               // 단일 어설션 (간편용)
  assertions?: Assertion[];            // 복수 어설션
  apiRequest?: ApiRequestConfig;       // type='api_request' 일 때
  waitForUser?: WaitForUserConfig;     // type='wait_for_user' 일 때
  checkEmail?: CheckEmailConfig;     // type='check_email' 일 때
  script?: ScriptConfig;              // type='run_script' 일 때
  variableName?: string;              // type='set_variable' 일 때
  variableValue?: string;             // 직접 값 ({{변수}} 지원)
  variableExpression?: string;        // JS expression으로 계산
  extractData?: ExtractDataConfig;     // type='extract_data' 일 때
  keyboard?: KeyboardConfig;           // type='keyboard' 일 때
  waitForConfig?: WaitForConfig;       // type='wait_for' 일 때
  forEachConfig?: ForEachConfig;       // type='for_each_start' 일 때
  ifCondition?: IfConditionConfig;     // type='if_start' 일 때
  blockConfig?: BlockConfig;           // type='block_start' 일 때
  imageMatchConfig?: ImageMatchConfig;   // type='image_match' 일 때
  ocrConfig?: OcrExtractConfig;          // type='ocr_extract' 일 때
  dialogConfig?: DialogConfig;           // type='dialog' 일 때
  clearAppBundleId?: string;           // type='clear_app'일 때: 초기화할 앱 bundleId (비우면 시나리오 기본값)
  iosSelector?: {                      // iOS 시맨틱 탭: 좌표 대신 셀렉터 기반 요소 탐색
    strategy: 'accessibility_id' | 'name' | 'label' | 'xpath';
    value: string;
  };
  androidSelector?: {                  // Android 시맨틱 탭: 좌표 대신 셀렉터 기반 요소 탐색
    strategy: 'resource_id' | 'content_desc' | 'text' | 'xpath';
    value: string;
  };
  captureResolvedAs?: string;        // fill: resolve된 최종값 저장 / click·hover: 요소 textContent 저장 (동적 값 추적)
  matchText?: string;                // click/hover 시 selector + 텍스트 조건으로 요소 매칭 ({{변수}} 지원)
  within?: WithinScope;              // 부모 컨테이너(행/카드) 안에서만 요소 탐색 (row-scoped locator)
  takeScreenshot?: boolean;           // step별 스크린샷 Y/N
  notes?: string;                     // 메모
  tags?: string[];                    // 태그
  disabled?: boolean;                 // true면 재생 시 건너뜀
  onFail?: OnFailPolicy;               // 실패 시 정책 (시나리오 시각화에서 설정)
}

// ─── Test Data ────────────────────────────────────────────
export interface TestDataSet {
  name: string;                                // e.g. "NAVER-A14"
  variables: Record<string, string>;           // e.g. { userName: "강종원" }
}

export interface TestDataProfile {
  id: string;
  name: string;
  description?: string;
  dataSets: TestDataSet[];
}

// ─── Scenario Reference (includes) ───────────────────────
export interface ScenarioRef {
  scenarioId: string;                          // 참조할 시나리오 ID
  aliasId?: string;                            // e.g. "COMMON-SIGNUP-WEB-ENTRY"
}

// ─── Recording Scenario ───────────────────────────────────
export interface RecordingScenario {
  id: string;
  name: string;
  platform: Platform;

  // 브라우저/디바이스 메타
  metadata?: {
    browser?: string;
    viewport?: { width: number; height: number };
    baseURL?: string;
    userAgent?: string;
    deviceType?: WebDeviceType;
  };
  deviceType?: 'ios' | 'android';
  udid?: string;
  deviceId?: string;
  bundleId?: string;
  package?: string;
  appiumServerUrl?: string;
  /** Reuse an existing Appium session (standby WDA) instead of creating a new one */
  existingAppiumSessionId?: string;

  // 녹화 시간
  startedAt: number;
  stoppedAt?: number;

  // 이벤트 목록
  events: RecordingEvent[];

  // 고급 필드
  tcId?: string;                               // TC_ID (e.g. "WEB-SIGNUP-NAVER-A14")
  version?: number;                            // 편집 버전 추적
  includes?: ScenarioRef[];                    // 공유 시나리오 참조
  testData?: TestDataProfile;                  // 내장 테스트 데이터
  testDataProfileId?: string;                  // 외부 테스트 데이터 참조
  variables?: Record<string, string>;          // 기본 변수값
  chainExports?: string[];                     // 체인으로 내보낼 변수 이름 (완료 후 chainVars에 병합)
  chainRequires?: string[];                    // 체인에서 필요한 변수 이름 (시작 전 검증)
  tags?: string[];                             // 분류 태그

  // Flow 시각화 레이아웃 저장 (사용자가 배치한 노드 위치 등)
  flowLayout?: FlowLayout;
}

/** Flow 시각화 레이아웃 — 노드 위치/방향/뷰포트를 시나리오에 저장 */
export interface FlowLayout {
  layoutVersion: number;                       // 레이아웃 스키마 버전
  direction: 'UD' | 'LR';                     // 그래프 방향
  nodes: Record<string, { x: number; y: number; fixed?: boolean }>; // nodeId → 위치
  viewport?: { scale: number; x: number; y: number }; // 저장된 뷰포트
  collapsedBlocks?: string[];                  // 접혀 있던 blockId 목록 (레이아웃 저장 시)
}

// ─── Recording Config ─────────────────────────────────────
export interface RecordingConfig {
  outputDir?: string;
  sessionName?: string;
  url?: string;
  browser?: 'chromium' | 'firefox' | 'webkit';
  viewport?: { width: number; height: number };
  deviceType?: WebDeviceType;
  authProfileId?: string;                  // 인증 프로필 ID (녹화 시 쿠키/스토리지 주입)
  baseURL?: string;
  udid?: string;
  deviceId?: string;
  bundleId?: string;
  package?: string;
  appiumServerUrl?: string;
  mirror?: boolean;                   // iOS 미러링 서버 활성화
  mirrorPort?: number;                // 미러링 서버 포트 (기본: 8787)
  controlOptions?: {
    tapPauseDuration?: number;
    tapReleaseDelay?: number;
    tapPostDelay?: number;
    swipePauseDuration?: number;
    swipeMinDuration?: number;
    swipeReleaseDelay?: number;
    swipePostDelay?: number;
    coordinateOrigin?: 'viewport' | 'pointer';
    coordinateOffset?: { x: number; y: number };
  };
}

// ─── Replay Options ───────────────────────────────────────
export interface ReplayOptions {
  speed?: number;
  delayBetweenEvents?: number;
  takeScreenshots?: boolean;
  reportDir?: string;

  // 고급 옵션
  variables?: Record<string, string>;          // CLI --var 오버라이드
  chainVariables?: Record<string, string>;     // 체인 실행 시 이전 시나리오에서 전달된 변수
  testDataSetName?: string;                    // 사용할 데이터셋 이름
  testDataProfilePath?: string;                // 외부 테스트 데이터 파일
  stopOnFailure?: boolean;                     // 실패 시 중단 (default true)
  headless?: boolean;                          // 헤드리스 모드
  timeout?: number;                            // step별 글로벌 타임아웃 ms

  // 체인 실행 지원 (ChainRunner 내부 사용)
  existingPage?: any;                          // 기존 Playwright Page
  existingContext?: any;                       // 기존 BrowserContext
  existingBrowser?: any;                       // 기존 Browser
  skipBrowserClose?: boolean;                  // true면 replay 후 브라우저 닫지 않음

  // 인증 주입
  authProfileId?: string;                      // 인증 프로필 ID

  // 디바이스 에뮬레이션
  deviceType?: WebDeviceType;                  // 리플레이 시 디바이스 에뮬레이션 오버라이드

  // 스텝 범위 실행 (특정 구간만 실행)
  fromStep?: number;                           // 시작 스텝 인덱스 (0-based, 포함)
  toStep?: number;                             // 종료 스텝 인덱스 (0-based, 포함)

  // wait_for_user 콜백 (CLI spinner 제어용)
  onWaitForUserStart?: () => void;             // wait_for_user 시작 시 호출
  onWaitForUserEnd?: () => void;               // wait_for_user 종료 시 호출

  // 네트워크 로그 수집
  networkLogFile?: string;                     // mitmproxy JSONL 로그 파일 경로
  networkHarFile?: string;                     // HAR 파일 경로 (Charles/Proxyman)
}

// ─── Test Result ──────────────────────────────────────────
export interface TestResult {
  scenarioId: string;
  scenarioName: string;
  platform: Platform;
  status: 'passed' | 'failed' | 'skipped';
  duration: number;
  startedAt: number;
  completedAt: number;
  events: EventResult[];
  error?: string;
  stackTrace?: string;

  // 고급 결과
  tcId?: string;
  testDataSetName?: string;
  variables?: Record<string, string>;          // 최종 변수 상태
  chainExportedVariables?: Record<string, string>;  // 체인 내보내기된 변수 (진단용)
  assertionsSummary?: {
    total: number;
    passed: number;
    failed: number;
  };

  // 신호/재시도 (Orchestrator 통합)
  signals?: {
    fallbackCount: number;
    coordinateFallbackCount: number;
    forceClickCount: number;
    fallbacksByType: Record<string, number>;
    infraFailures: string[];
  };
  outcomeClass?: 'PASS' | 'FLAKY_PASS' | 'RETRYABLE_FAIL' | 'FAIL' | 'INFRA_FAIL';
}

// ─── Auth Profile ─────────────────────────────────────────
export interface AuthCookie {
  name: string;
  value: string;
  domain: string;
  path: string;
  expires?: number;
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: 'Strict' | 'Lax' | 'None';
}

export interface AuthProfile {
  id: string;
  name: string;
  domain: string;                              // e.g. "nid.naver.com"
  domainPatterns?: string[];                   // 추가 도메인 패턴
  cookies?: AuthCookie[];
  localStorage?: Record<string, string>;
  sessionStorage?: Record<string, string>;
  headers?: Record<string, string>;            // e.g. Authorization bearer token
  createdAt: number;
  updatedAt: number;
  notes?: string;
}

// ─── Scenario Group (Batch/Chain 프리셋) ─────────────────
export interface ScenarioGroup {
  id: string;
  name: string;
  mode: 'batch' | 'chain';
  scenarioIds: string[];           // 실행 순서 유지
  authProfileId?: string;
  options: {
    speed?: number;
    takeScreenshots?: boolean;
    headless?: boolean;
    stopOnFailure?: boolean;
    deviceType?: WebDeviceType;
  };
  createdAt: number;
  updatedAt: number;
}

// ─── Scenario Folder (폴더 계층 정리) ────────────────────
export interface ScenarioFolder {
  id: string;
  name: string;
  parentId: string | null;       // null = root
  scenarioIds: string[];         // 정렬된 시나리오 ID 목록
  childFolderIds: string[];      // 정렬된 하위 폴더 ID 목록
  createdAt: number;
  updatedAt: number;
}

// ─── Run Management ───────────────────────────────────────
export interface RunConfig {
  scenarioIds: string[];
  mode: 'batch' | 'chain';
  authProfileId?: string;
  options: ReplayOptions;
}

export interface RunStatus {
  runId: string;
  mode: 'batch' | 'chain';
  status: 'running' | 'completed' | 'failed';
  scenarioIds: string[];
  currentIndex: number;
  results: TestResult[];
  startedAt: number;
  completedAt?: number;
  error?: string;
}

export interface BatchResult {
  runId: string;
  mode: 'batch' | 'chain';
  results: TestResult[];
  summary: {
    total: number;
    passed: number;
    failed: number;
    skipped: number;
    totalDuration: number;
  };
}

// ─── Exploration Graph ────────────────────────────────────
export interface PageNode {
  id: string;
  url: string;
  title: string;
  domain: string;
  screenshot?: string;
  /** DFS 탐색용 상태 키 (URL + DOM fingerprint 기반) */
  stateKey?: string;
  metadata?: {
    visitedAt: number;
    visitCount: number;
    hasAuth?: boolean;
    popupCount?: number;
    isPopup?: boolean;
    statusCode?: number;
    outLinks?: number;
    urlPattern?: string;
    urlVariations?: string[];
    variationTitles?: Record<string, string>;
    /** DOM fingerprint 해시 (DFS 탐색에서 상태 구분용) */
    fingerprint?: string;
    /** DFS 탐색 깊이 */
    depth?: number;
  };
}

export interface PageEdge {
  id: string;
  source: string;
  target: string;
  linkText?: string;
  linkSelector?: string;
  linkUrl: string;
  metadata?: {
    discoveredAt: number;
    discoveredBy: 'manual' | 'crawl' | 'dfs';
    /** DFS 탐색에서 사용된 액션 정보 */
    action?: {
      type: string;
      selector: string;
      text?: string;
      role?: string;
    };
  };
}

export type ExplorationStatus = 'idle' | 'exploring' | 'crawling' | 'dfs_crawling' | 'paused' | 'completed' | 'stopped';

export interface GraphRoot {
  id: string;
  url: string;
  label: string;
  authProfileId?: string;
  addedAt: number;
}

export interface ExplorationGraph {
  id: string;
  name: string;
  rootUrl: string;
  rootUrls?: GraphRoot[];
  allowedDomains: string[];
  createdAt: number;
  updatedAt: number;
  nodes: PageNode[];
  edges: PageEdge[];
  config: {
    authProfileId?: string;
    maxDepth?: number;
    maxNodes?: number;
    crawlDelay?: number;
    ignoreFragments?: boolean;
    ignoreQueryParams?: string[];
    enablePatternGrouping?: boolean;
    deviceType?: WebDeviceType;
    /** DFS 탐색 설정 */
    dfs?: {
      maxDepth?: number;
      maxStates?: number;
      maxActionsPerState?: number;
      maxSameUrlStates?: number;
      timeBudgetMs?: number;
      actionDelayMs?: number;
      executeUnknownRisk?: boolean;
    };
  };
  status: ExplorationStatus;
}

export interface ExplorationSession {
  graphId: string;
  status: ExplorationStatus;
  currentUrl?: string;
  currentNodeId?: string;
  visitedUrls: string[];
  queuedUrls: string[];
  stats: {
    nodesDiscovered: number;
    edgesDiscovered: number;
    pagesVisited: number;
    startedAt: number;
    lastActivityAt: number;
  };
}

// ─── Process (탐색 그래프의 부분 집합) ────────────────────

export interface ProcessEdge {
  id: string;
  source: string;                                // PageNode.id
  target: string;                                // PageNode.id
  condition: string;                             // 자유 텍스트 전환 조건
  type?: 'success' | 'failure';                  // 성공/실패 분기 (기본 success)
  originalEdgeId?: string;                       // 원본 PageEdge.id 참조
}

export interface ProcessTestMeta {
  tcId?: string;                       // TC_ID (예: "WEB-LOGIN-001")
  module?: string;                     // 모듈 (예: "Auth")
  feature?: string;                    // 기능 (예: "Login")
  requirementId?: string;              // 요구사항 ID (예: "REQ-LOGIN-NAVER")
  type?: 'Smoke' | 'Regression' | 'Functional' | 'UAT' | 'Exploratory' | 'NonFunctional';
  priority?: 'P0' | 'P1' | 'P2' | 'P3';
  severity?: 'S0(Blocking)' | 'S1(Critical)' | 'S2(Major)' | 'S3(Minor)' | 'S4(Trivial)';
  risk?: 'High' | 'Medium' | 'Low';
  platform?: 'Web' | 'Mobile Web' | 'WebView(App)' | 'API';
  environment?: 'Local' | 'Dev' | 'QA' | 'Stage' | 'Prod-like';
  browserDevice?: string;              // 예: "Chromium"
  automation?: 'Manual' | 'Auto' | 'Candidate';
  automationId?: string;
  preconditions?: string;
  expectedResultSummary?: string;
  postconditions?: string;
  owner?: string;
  reviewer?: string;
  status?: 'Draft' | 'Ready' | 'Deprecated';
  defectId?: string;
  notes?: string;
  version?: string;
  executionStatus?: 'Not Run' | 'Pass' | 'Fail' | 'Blocked' | 'Skipped';
  evidenceLink?: string;
}

export interface Process {
  id: string;
  name: string;
  description?: string;
  graphId: string;                               // 부모 ExplorationGraph.id
  nodeIds: string[];                             // 순서대로 참조할 PageNode.id
  edges: ProcessEdge[];
  createdAt: number;
  updatedAt: number;
  tags?: string[];
  nodePositions?: Record<string, { x: number; y: number }>;  // 서브그래프 노드 위치 저장
  testMeta?: ProcessTestMeta;                    // 테스트 관리 메타데이터
  linkedScenarios?: LinkedScenarioRef[];          // 연결된 시나리오/그룹 목록 (순서 보존)
}

// ─── Linked Scenario Reference ────────────────────────────
export interface LinkedScenarioRef {
  id: string;                                      // 링크 엔트리 고유 ID
  type: 'scenario' | 'group';                     // 시나리오 vs 그룹 구분
  refId: string;                                   // RecordingScenario.id 또는 ScenarioGroup.id
  addedAt: number;                                 // 연결 시점
}

// ─── Event Result ─────────────────────────────────────────
export interface EventResult {
  eventIndex: number;
  eventType: RecordingEventType;
  status: 'passed' | 'failed' | 'skipped';
  duration: number;
  error?: string;
  screenshot?: string;

  // 고급 결과
  stepNo?: number;
  description?: string;
  resolvedBy?: string;             // 어떤 전략으로 요소를 찾았는지 (진단용)
  assertionResults?: AssertionResult[];
  apiResponse?: {
    status: number;
    headers: Record<string, string>;
    body: any;
    duration: number;
  };
  capturedVariables?: Record<string, string>;

  // ocr_extract 결과 데이터 (report용)
  ocrResult?: OcrResult;

  // image_match 비교 결과 데이터 (report용)
  imageMatchData?: {
    templateBase64: string;       // 기준 이미지
    screenshotBase64: string;     // 실제 캡처한 스크린샷
    diffBase64?: string;          // diff 이미지 (pixelmatch 결과)
    diffPercent: number;          // 차이 비율 (%)
    matched: boolean;             // 매칭 성공 여부
    clip?: { x: number; y: number; width: number; height: number };
  };

  // 스텝별 증거 아티팩트 (iOS/Android E2E 디버깅용)
  artifacts?: StepArtifacts;
}

// ─── Step Artifacts (스텝별 증거 수집) ──────────────────
export interface StepArtifacts {
  screenshotBase64?: string;       // 스텝 실행 후 스크린샷 (base64 PNG)
  pageSourceXml?: string;          // 스텝 실행 후 UI 트리 XML
  pageSourceSummary?: string;      // UI 트리 요약 (요소 수, 주요 텍스트 등)
  timestamp: number;               // 아티팩트 수집 시점
}

// ─── Flow Graph (시나리오 시각화 CFG) ─────────────────────

export type FlowNodeType =
  | 'start'
  | 'end'
  | 'action'           // click, fill, select, navigate, wait 등 일반 액션
  | 'condition'        // if_start
  | 'loop_start'       // for_each_start
  | 'loop_end'         // for_each_end
  | 'wait'             // wait_for, wait_for_user
  | 'api'              // api_request
  | 'script'           // run_script
  | 'extract'          // extract_data, ocr_extract
  | 'assert'           // assert
  | 'dialog'           // dialog
  | 'popup'            // popup_opened, popup_closed
  | 'block'            // block_start (컨테이너 시작)
  | 'block_end';       // block_end (컨테이너 종료)

export type FlowEdgeType =
  | 'next'             // 순차 실행
  | 'if_true'          // 조건 참
  | 'if_false'         // 조건 거짓 (if_end로 스킵)
  | 'loop_back'        // for_each 루프백
  | 'on_fail'          // 실패 시 점프
  | 'on_fail_retry';   // 실패 시 재시도

export interface OnFailPolicy {
  action: 'stop' | 'jump' | 'retry' | 'skip' | 'fallback_route';
  jumpToStep?: number;           // action='jump' 일 때 점프 대상 step index (0-based)
  maxRetry?: number;             // action='retry' 일 때 최대 재시도 횟수
  retryDelayMs?: number;         // 재시도 간 대기 ms
  fallbackSteps?: number[];      // action='fallback_route' 일 때 대체 루트 step indices
}

export interface FlowNode {
  id: string;
  stepIndex: number;             // events[] 기준 인덱스 (-1 for virtual start/end)
  type: FlowNodeType;
  label: string;                 // 사람이 읽을 수 있는 요약
  eventType?: RecordingEventType;
  metadata?: {
    selector?: string;
    value?: string;
    url?: string;
    condition?: string;          // if 조건 텍스트
    loopSelector?: string;       // for_each 셀렉터
    onFail?: OnFailPolicy;       // 실패 정책
    description?: string;
    disabled?: boolean;
    blockName?: string;          // block_start 블록명
    blockId?: string;            // block 매칭용 ID
    blockColor?: string;         // block UI 색상
    isCollapsed?: boolean;       // block 접힘 상태
    childStepCount?: number;     // block 내부 스텝 수
  };
}

export interface FlowEdge {
  id: string;
  source: string;                // FlowNode.id
  target: string;                // FlowNode.id
  type: FlowEdgeType;
  label?: string;                // edge에 표시할 텍스트 (e.g. "true", "fail→재시도")
  metadata?: {
    jumpFromStep?: number;
    jumpToStep?: number;
  };
}

export interface FlowGraph {
  scenarioId: string;
  scenarioName: string;
  nodes: FlowNode[];
  edges: FlowEdge[];
  metadata?: {
    totalSteps: number;
    hasConditions: boolean;
    hasLoops: boolean;
    hasOnFailPolicies: boolean;
    hasBlocks?: boolean;
  };
}

// ─── Validation (Scenario Validator) ─────────────────────
export interface ValidationIssue {
  level: 'error' | 'warning' | 'info';
  stepIndex?: number;
  field?: string;
  message: string;
  code: string;
}

export interface ScenarioValidationResult {
  issues: ValidationIssue[];
  summary: { errors: number; warnings: number; info: number };
}

export interface SelectorHealthResult {
  score: number;
  level: 'excellent' | 'good' | 'fair' | 'fragile' | 'none';
  color: string;
}
