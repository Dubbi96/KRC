/**
 * iOS 의미 기반 시나리오 빌더
 *
 * 좌표 매크로 대신 셀렉터(accessibilityId/name/label) + assertion을 사용하여
 * 유지보수 가능한 E2E 시나리오를 생성한다.
 *
 * 사용 예:
 * ```ts
 * const scenario = iosScenario('로그인 테스트', {
 *   udid: 'device-uuid',
 *   bundleId: 'com.app.bundle',
 * })
 *   .tap({ accessibilityId: 'loginButton' }, '로그인 버튼 클릭')
 *   .assertVisible({ name: 'welcomeHeader' }, '환영 화면 표시 확인')
 *   .assertTextPresent('로그인 성공')
 *   .assertNoErrorText()
 *   .build();
 * ```
 */

import { randomUUID } from 'crypto';
import type {
  RecordingScenario, RecordingEvent, Assertion, AssertionType,
} from '../types';

// ─── Types ──────────────────────────────────────────────

interface IOSSelectorDef {
  accessibilityId?: string;
  name?: string;
  label?: string;
  xpath?: string;
}

interface ScenarioConfig {
  udid: string;
  bundleId?: string;
  appiumServerUrl?: string;
  tcId?: string;
  variables?: Record<string, string>;
  networkLogFile?: string;              // mitmproxy JSONL 로그 파일 경로
  networkHarFile?: string;              // HAR 파일 경로 (Charles/Proxyman)
}

// ─── Selector → iosSelector 변환 ─────────────────────────

function toIOSSelector(def: IOSSelectorDef): { strategy: 'accessibility_id' | 'name' | 'label' | 'xpath'; value: string } {
  if (def.accessibilityId) return { strategy: 'accessibility_id', value: def.accessibilityId };
  if (def.name) return { strategy: 'name', value: def.name };
  if (def.label) return { strategy: 'label', value: def.label };
  if (def.xpath) return { strategy: 'xpath', value: def.xpath };
  throw new Error('IOSSelectorDef에 accessibilityId, name, label, xpath 중 하나를 지정해야 합니다.');
}

// ─── Builder ────────────────────────────────────────────

export class IOSScenarioBuilder {
  private events: RecordingEvent[] = [];
  private config: ScenarioConfig;
  private name: string;
  private stepCounter = 0;

  constructor(name: string, config: ScenarioConfig) {
    this.name = name;
    this.config = config;
  }

  // ─── Actions ────────────────────────────────────────────

  /**
   * 시맨틱 탭: 셀렉터 기반 요소 클릭 (좌표 fallback 옵션)
   */
  tap(selector: IOSSelectorDef, description?: string, fallbackCoordinates?: { x: number; y: number }): this {
    this.events.push({
      type: 'tap',
      timestamp: Date.now(),
      stepNo: ++this.stepCounter,
      description: description || `Tap ${Object.values(selector).find(Boolean)}`,
      iosSelector: toIOSSelector(selector),
      coordinates: fallbackCoordinates,
      meta: {
        element: {
          accessibilityId: selector.accessibilityId,
          name: selector.name,
          label: selector.label,
        },
      },
    });
    return this;
  }

  /**
   * 좌표 기반 탭 (레거시 호환)
   */
  tapAt(x: number, y: number, description?: string): this {
    this.events.push({
      type: 'tap',
      timestamp: Date.now(),
      stepNo: ++this.stepCounter,
      description: description || `Tap at (${x}, ${y})`,
      coordinates: { x, y },
    });
    return this;
  }

  /**
   * 텍스트 입력
   */
  type(text: string, description?: string): this {
    this.events.push({
      type: 'type',
      timestamp: Date.now(),
      stepNo: ++this.stepCounter,
      description: description || `Type "${text.substring(0, 20)}${text.length > 20 ? '...' : ''}"`,
      text,
    });
    return this;
  }

  /**
   * 스와이프
   */
  swipe(from: { x: number; y: number }, to: { x: number; y: number }, description?: string, duration?: number): this {
    this.events.push({
      type: 'swipe',
      timestamp: Date.now(),
      stepNo: ++this.stepCounter,
      description: description || 'Swipe',
      from,
      to,
      duration,
    });
    return this;
  }

  /**
   * 대기
   */
  wait(ms: number, description?: string): this {
    this.events.push({
      type: 'wait',
      timestamp: Date.now(),
      stepNo: ++this.stepCounter,
      description: description || `Wait ${ms}ms`,
      duration: ms,
    });
    return this;
  }

  /**
   * 홈 버튼
   */
  home(description?: string): this {
    this.events.push({
      type: 'home',
      timestamp: Date.now(),
      stepNo: ++this.stepCounter,
      description: description || 'Home button',
    });
    return this;
  }

  /**
   * 뒤로가기
   */
  back(description?: string): this {
    this.events.push({
      type: 'back',
      timestamp: Date.now(),
      stepNo: ++this.stepCounter,
      description: description || 'Back',
    });
    return this;
  }

  // ─── Assertions (이전 스텝에 부착) ─────────────────────

  /**
   * 요소 가시성 확인
   */
  assertVisible(selector: IOSSelectorDef, message?: string): this {
    this.addAssertionStep({
      type: 'ios_element_visible',
      target: '',
      expected: '',
      iosSelector: toIOSSelector(selector),
      message: message || `요소 표시 확인: ${Object.values(selector).find(Boolean)}`,
    });
    return this;
  }

  /**
   * 요소 부재 확인
   */
  assertNotExists(selector: IOSSelectorDef, message?: string): this {
    this.addAssertionStep({
      type: 'ios_element_not_exists',
      target: '',
      expected: '',
      iosSelector: toIOSSelector(selector),
      message: message || `요소 부재 확인: ${Object.values(selector).find(Boolean)}`,
    });
    return this;
  }

  /**
   * 텍스트 존재 확인
   */
  assertTextPresent(text: string, message?: string): this {
    this.addAssertionStep({
      type: 'ios_text_contains',
      target: '',
      expected: text,
      message: message || `텍스트 포함 확인: "${text}"`,
    });
    return this;
  }

  /**
   * 텍스트 부재 확인 (단일)
   */
  assertTextAbsent(text: string, message?: string): this {
    this.addAssertionStep({
      type: 'ios_text_absent',
      target: '',
      expected: text,
      message: message || `텍스트 부재 확인: "${text}"`,
    });
    return this;
  }

  /**
   * 에러/실패 텍스트 부재 확인 (공통 패턴)
   * ["오류", "실패", "네트워크", "권한", "다시 시도"] 등
   */
  assertNoErrorText(additionalTexts?: string[], message?: string): this {
    const defaultErrorTexts = ['오류', '실패', '네트워크 오류', '권한', '다시 시도', 'Error', 'Failed'];
    const allTexts = [...defaultErrorTexts, ...(additionalTexts || [])];
    this.addAssertionStep({
      type: 'ios_text_absent',
      target: '',
      expected: allTexts[0],
      iosAbsentTexts: allTexts,
      message: message || '에러/실패 텍스트 부재 확인',
    });
    return this;
  }

  /**
   * 리스트 아이템 존재 확인 (최소 N개)
   */
  assertListCount(minCount: number = 1, elementType: string = 'Cell', message?: string): this {
    this.addAssertionStep({
      type: 'ios_list_count',
      target: '',
      expected: String(minCount),
      iosListConfig: { elementType, minCount },
      message: message || `리스트 아이템 ${minCount}개 이상 확인`,
    });
    return this;
  }

  /**
   * 시스템 알럿 부재 확인
   */
  assertNoAlert(message?: string): this {
    this.addAssertionStep({
      type: 'ios_no_alert',
      target: '',
      expected: '',
      message: message || '시스템 알럿/팝업 부재 확인',
    });
    return this;
  }

  /**
   * 요소 대기 (wait_for)
   */
  waitForVisible(selector: IOSSelectorDef, timeout: number = 30000, description?: string): this {
    this.events.push({
      type: 'wait_for',
      timestamp: Date.now(),
      stepNo: ++this.stepCounter,
      description: description || `Wait for ${Object.values(selector).find(Boolean)}`,
      waitForConfig: {
        waitType: 'ios_element_visible',
        iosSelector: toIOSSelector(selector),
        timeout,
      },
    });
    return this;
  }

  /**
   * 텍스트 대기 (wait_for)
   */
  waitForText(text: string, timeout: number = 30000, description?: string): this {
    this.events.push({
      type: 'wait_for',
      timestamp: Date.now(),
      stepNo: ++this.stepCounter,
      description: description || `Wait for text "${text}"`,
      waitForConfig: {
        waitType: 'ios_text_contains',
        iosExpectedText: text,
        timeout,
      },
    });
    return this;
  }

  /**
   * 요소 사라짐 대기 (로딩 스피너 등)
   */
  waitForGone(selector: IOSSelectorDef, timeout: number = 30000, description?: string): this {
    this.events.push({
      type: 'wait_for',
      timestamp: Date.now(),
      stepNo: ++this.stepCounter,
      description: description || `Wait for gone ${Object.values(selector).find(Boolean)}`,
      waitForConfig: {
        waitType: 'ios_element_not_exists',
        iosSelector: toIOSSelector(selector),
        timeout,
      },
    });
    return this;
  }

  // ─── Network Assertions ────────────────────────────────

  /**
   * API 요청이 발생했는지 확인
   * @param urlPattern - URL 패턴 (부분 문자열 또는 정규식)
   * @param options - 필터 옵션
   */
  assertRequestSent(
    urlPattern: string,
    options?: { method?: string; isRegex?: boolean; windowMs?: number },
    message?: string,
  ): this {
    this.addAssertionStep({
      type: 'network_request_sent',
      target: '',
      expected: '',
      networkConfig: {
        urlPattern,
        urlIsRegex: options?.isRegex,
        method: options?.method,
        windowMs: options?.windowMs,
      },
      message: message || `네트워크 요청 확인: ${urlPattern}`,
    });
    return this;
  }

  /**
   * API 응답 상태 코드 확인
   */
  assertResponseStatus(
    urlPattern: string,
    expectedStatus: number,
    options?: { method?: string; isRegex?: boolean; windowMs?: number },
    message?: string,
  ): this {
    this.addAssertionStep({
      type: 'network_response_status',
      target: '',
      expected: String(expectedStatus),
      networkConfig: {
        urlPattern,
        urlIsRegex: options?.isRegex,
        method: options?.method,
        expectedStatus,
        windowMs: options?.windowMs,
      },
      message: message || `응답 상태 확인: ${urlPattern} → ${expectedStatus}`,
    });
    return this;
  }

  /**
   * API 응답 JSON 값 검증 (JSONPath 기반)
   * @example
   * .assertJsonPath('/api/search', '$.results.length', '>', 0)
   */
  assertJsonPath(
    urlPattern: string,
    jsonPath: string,
    op: '>' | '>=' | '<' | '<=' | '==' | '!=' | 'exists' | 'not_empty',
    value?: string | number,
    options?: { method?: string; isRegex?: boolean; windowMs?: number },
    message?: string,
  ): this {
    this.addAssertionStep({
      type: 'network_response_json',
      target: '',
      expected: '',
      networkConfig: {
        urlPattern,
        urlIsRegex: options?.isRegex,
        method: options?.method,
        jsonPath,
        jsonOp: op,
        jsonValue: value,
        windowMs: options?.windowMs,
      },
      message: message || `JSON 검증: ${urlPattern} ${jsonPath} ${op} ${value ?? ''}`,
    });
    return this;
  }

  /**
   * 이미지 URL 로드 확인 (API 응답에서 이미지 URL을 추출하여 200 확인)
   * @param apiUrlPattern - 이미지 URL이 포함된 API 응답의 URL 패턴
   * @param imageUrlJsonPath - 이미지 URL을 추출할 JSONPath (e.g. '$.results[*].imageUrl')
   * @param sampleCount - 확인할 이미지 수 (default: 3)
   */
  assertImageLoads(
    apiUrlPattern: string,
    imageUrlJsonPath: string,
    sampleCount: number = 3,
    message?: string,
  ): this {
    this.addAssertionStep({
      type: 'network_image_loads',
      target: '',
      expected: '',
      networkConfig: {
        urlPattern: apiUrlPattern,
        imageUrlJsonPath,
        sampleCount,
      },
      message: message || `이미지 로드 확인: ${imageUrlJsonPath} (${sampleCount}개 샘플)`,
    });
    return this;
  }

  /**
   * 네트워크 에러(4xx/5xx/timeout) 부재 확인
   */
  assertNoNetworkErrors(
    urlPattern?: string,
    options?: { windowMs?: number; allowedErrorStatus?: number[] },
    message?: string,
  ): this {
    this.addAssertionStep({
      type: 'network_no_errors',
      target: '',
      expected: '',
      networkConfig: {
        urlPattern: urlPattern || '.',
        urlIsRegex: !urlPattern ? true : undefined,
        windowMs: options?.windowMs,
        allowedErrorStatus: options?.allowedErrorStatus,
      },
      message: message || '네트워크 에러 부재 확인',
    });
    return this;
  }

  // ─── Assertion 부착 유틸 ─────────────────────────────────

  /**
   * assertion을 독립 assert 스텝으로 추가
   */
  private addAssertionStep(assertion: Assertion): void {
    this.events.push({
      type: 'assert',
      timestamp: Date.now(),
      stepNo: ++this.stepCounter,
      description: assertion.message || 'Assertion',
      assertions: [assertion],
      takeScreenshot: true,  // assertion 실패 시 증거 수집
    });
  }

  /**
   * 마지막 이벤트에 assertion을 inline으로 부착 (이전 액션에 연결)
   */
  attachToLast(assertion: Assertion): this {
    if (this.events.length === 0) {
      this.addAssertionStep(assertion);
      return this;
    }
    const last = this.events[this.events.length - 1];
    if (!last.assertions) last.assertions = [];
    last.assertions.push(assertion);
    return this;
  }

  // ─── Build ────────────────────────────────────────────

  /**
   * 시나리오 객체를 생성한다.
   */
  build(): RecordingScenario {
    return {
      id: randomUUID(),
      name: this.name,
      platform: 'ios',
      deviceType: 'ios',
      udid: this.config.udid,
      bundleId: this.config.bundleId,
      appiumServerUrl: this.config.appiumServerUrl || 'http://localhost:4723',
      startedAt: Date.now(),
      events: this.events,
      tcId: this.config.tcId,
      variables: this.config.variables,
    };
  }
}

// ─── Factory ────────────────────────────────────────────

/**
 * iOS 의미 기반 시나리오를 생성하는 팩토리 함수
 *
 * @example
 * ```ts
 * const scenario = iosScenario('촬영예약 검색 테스트', {
 *   udid: 'DEVICE-UUID',
 *   bundleId: 'com.example.app',
 * })
 *   .tap({ accessibilityId: 'searchButton' }, '검색 버튼 클릭')
 *   .waitForVisible({ name: 'searchInput' })
 *   .type('테스트 검색어')
 *   .tap({ accessibilityId: 'submitSearch' }, '검색 실행')
 *   .waitForGone({ name: 'loadingSpinner' }, 10000, '로딩 대기')
 *   .assertListCount(1, 'Cell', '검색 결과 1개 이상')
 *   .assertNoErrorText()
 *   .assertNoAlert()
 *   .build();
 * ```
 */
export function iosScenario(name: string, config: ScenarioConfig): IOSScenarioBuilder {
  return new IOSScenarioBuilder(name, config);
}

// ─── 공통 Assertion Preset ────────────────────────────────

/**
 * 화면 전환 후 기본 검증 세트를 생성한다.
 * 매 화면 전환 후 붙이면 "어디에서 막혔는지"가 자동으로 남는다.
 *
 * @param screenTitle - 화면 제목/헤더 텍스트
 * @param errorTexts - 추가 금지 텍스트
 */
export function navigationAssertionSet(
  screenTitle: string,
  errorTexts?: string[]
): Assertion[] {
  return [
    {
      type: 'ios_text_contains' as AssertionType,
      target: '',
      expected: screenTitle,
      message: `화면 전환 확인: "${screenTitle}" 표시`,
    },
    {
      type: 'ios_text_absent' as AssertionType,
      target: '',
      expected: '오류',
      iosAbsentTexts: ['오류', '실패', '네트워크 오류', '권한', '다시 시도', ...(errorTexts || [])],
      message: '에러 텍스트 부재 확인',
    },
    {
      type: 'ios_no_alert' as AssertionType,
      target: '',
      expected: '',
      message: '시스템 알럿 부재 확인',
    },
  ];
}

/**
 * 네트워크 API 검증 세트
 * 특정 API 호출의 성공 여부, JSON 응답 형식, 에러 부재를 한번에 검증한다.
 *
 * @param apiUrlPattern - 검증할 API URL 패턴
 * @param expectedStatus - 기대 상태 코드 (default: 200)
 * @param jsonChecks - JSON 검증 목록 (optional)
 */
export function networkAssertionSet(
  apiUrlPattern: string,
  expectedStatus: number = 200,
  jsonChecks?: Array<{
    jsonPath: string;
    op: '>' | '>=' | '<' | '<=' | '==' | '!=' | 'exists' | 'not_empty';
    value?: string | number;
  }>,
): Assertion[] {
  const assertions: Assertion[] = [
    {
      type: 'network_request_sent' as AssertionType,
      target: '',
      expected: '',
      networkConfig: { urlPattern: apiUrlPattern },
      message: `API 요청 발생 확인: ${apiUrlPattern}`,
    },
    {
      type: 'network_response_status' as AssertionType,
      target: '',
      expected: String(expectedStatus),
      networkConfig: { urlPattern: apiUrlPattern, expectedStatus },
      message: `API 응답 상태 확인: ${expectedStatus}`,
    },
  ];
  if (jsonChecks) {
    for (const check of jsonChecks) {
      assertions.push({
        type: 'network_response_json' as AssertionType,
        target: '',
        expected: '',
        networkConfig: {
          urlPattern: apiUrlPattern,
          jsonPath: check.jsonPath,
          jsonOp: check.op,
          jsonValue: check.value,
        },
        message: `JSON 검증: ${check.jsonPath} ${check.op} ${check.value ?? ''}`,
      });
    }
  }
  return assertions;
}

/**
 * 리스트/검색 결과 검증 세트
 */
export function listResultAssertionSet(
  minCount: number = 1,
  emptyStateText?: string
): Assertion[] {
  const assertions: Assertion[] = [
    {
      type: 'ios_list_count' as AssertionType,
      target: '',
      expected: String(minCount),
      iosListConfig: { elementType: 'Cell', minCount },
      message: `리스트 아이템 ${minCount}개 이상 확인`,
    },
  ];
  if (emptyStateText) {
    assertions.push({
      type: 'ios_text_absent' as AssertionType,
      target: '',
      expected: emptyStateText,
      message: `빈 상태 텍스트 부재 확인: "${emptyStateText}"`,
    });
  }
  return assertions;
}
