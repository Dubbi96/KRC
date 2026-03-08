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
import type { RecordingScenario, Assertion } from '../types';
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
    networkLogFile?: string;
    networkHarFile?: string;
}
export declare class IOSScenarioBuilder {
    private events;
    private config;
    private name;
    private stepCounter;
    constructor(name: string, config: ScenarioConfig);
    /**
     * 시맨틱 탭: 셀렉터 기반 요소 클릭 (좌표 fallback 옵션)
     */
    tap(selector: IOSSelectorDef, description?: string, fallbackCoordinates?: {
        x: number;
        y: number;
    }): this;
    /**
     * 좌표 기반 탭 (레거시 호환)
     */
    tapAt(x: number, y: number, description?: string): this;
    /**
     * 텍스트 입력
     */
    type(text: string, description?: string): this;
    /**
     * 스와이프
     */
    swipe(from: {
        x: number;
        y: number;
    }, to: {
        x: number;
        y: number;
    }, description?: string, duration?: number): this;
    /**
     * 대기
     */
    wait(ms: number, description?: string): this;
    /**
     * 홈 버튼
     */
    home(description?: string): this;
    /**
     * 뒤로가기
     */
    back(description?: string): this;
    /**
     * 요소 가시성 확인
     */
    assertVisible(selector: IOSSelectorDef, message?: string): this;
    /**
     * 요소 부재 확인
     */
    assertNotExists(selector: IOSSelectorDef, message?: string): this;
    /**
     * 텍스트 존재 확인
     */
    assertTextPresent(text: string, message?: string): this;
    /**
     * 텍스트 부재 확인 (단일)
     */
    assertTextAbsent(text: string, message?: string): this;
    /**
     * 에러/실패 텍스트 부재 확인 (공통 패턴)
     * ["오류", "실패", "네트워크", "권한", "다시 시도"] 등
     */
    assertNoErrorText(additionalTexts?: string[], message?: string): this;
    /**
     * 리스트 아이템 존재 확인 (최소 N개)
     */
    assertListCount(minCount?: number, elementType?: string, message?: string): this;
    /**
     * 시스템 알럿 부재 확인
     */
    assertNoAlert(message?: string): this;
    /**
     * 요소 대기 (wait_for)
     */
    waitForVisible(selector: IOSSelectorDef, timeout?: number, description?: string): this;
    /**
     * 텍스트 대기 (wait_for)
     */
    waitForText(text: string, timeout?: number, description?: string): this;
    /**
     * 요소 사라짐 대기 (로딩 스피너 등)
     */
    waitForGone(selector: IOSSelectorDef, timeout?: number, description?: string): this;
    /**
     * API 요청이 발생했는지 확인
     * @param urlPattern - URL 패턴 (부분 문자열 또는 정규식)
     * @param options - 필터 옵션
     */
    assertRequestSent(urlPattern: string, options?: {
        method?: string;
        isRegex?: boolean;
        windowMs?: number;
    }, message?: string): this;
    /**
     * API 응답 상태 코드 확인
     */
    assertResponseStatus(urlPattern: string, expectedStatus: number, options?: {
        method?: string;
        isRegex?: boolean;
        windowMs?: number;
    }, message?: string): this;
    /**
     * API 응답 JSON 값 검증 (JSONPath 기반)
     * @example
     * .assertJsonPath('/api/search', '$.results.length', '>', 0)
     */
    assertJsonPath(urlPattern: string, jsonPath: string, op: '>' | '>=' | '<' | '<=' | '==' | '!=' | 'exists' | 'not_empty', value?: string | number, options?: {
        method?: string;
        isRegex?: boolean;
        windowMs?: number;
    }, message?: string): this;
    /**
     * 이미지 URL 로드 확인 (API 응답에서 이미지 URL을 추출하여 200 확인)
     * @param apiUrlPattern - 이미지 URL이 포함된 API 응답의 URL 패턴
     * @param imageUrlJsonPath - 이미지 URL을 추출할 JSONPath (e.g. '$.results[*].imageUrl')
     * @param sampleCount - 확인할 이미지 수 (default: 3)
     */
    assertImageLoads(apiUrlPattern: string, imageUrlJsonPath: string, sampleCount?: number, message?: string): this;
    /**
     * 네트워크 에러(4xx/5xx/timeout) 부재 확인
     */
    assertNoNetworkErrors(urlPattern?: string, options?: {
        windowMs?: number;
        allowedErrorStatus?: number[];
    }, message?: string): this;
    /**
     * assertion을 독립 assert 스텝으로 추가
     */
    private addAssertionStep;
    /**
     * 마지막 이벤트에 assertion을 inline으로 부착 (이전 액션에 연결)
     */
    attachToLast(assertion: Assertion): this;
    /**
     * 시나리오 객체를 생성한다.
     */
    build(): RecordingScenario;
}
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
export declare function iosScenario(name: string, config: ScenarioConfig): IOSScenarioBuilder;
/**
 * 화면 전환 후 기본 검증 세트를 생성한다.
 * 매 화면 전환 후 붙이면 "어디에서 막혔는지"가 자동으로 남는다.
 *
 * @param screenTitle - 화면 제목/헤더 텍스트
 * @param errorTexts - 추가 금지 텍스트
 */
export declare function navigationAssertionSet(screenTitle: string, errorTexts?: string[]): Assertion[];
/**
 * 네트워크 API 검증 세트
 * 특정 API 호출의 성공 여부, JSON 응답 형식, 에러 부재를 한번에 검증한다.
 *
 * @param apiUrlPattern - 검증할 API URL 패턴
 * @param expectedStatus - 기대 상태 코드 (default: 200)
 * @param jsonChecks - JSON 검증 목록 (optional)
 */
export declare function networkAssertionSet(apiUrlPattern: string, expectedStatus?: number, jsonChecks?: Array<{
    jsonPath: string;
    op: '>' | '>=' | '<' | '<=' | '==' | '!=' | 'exists' | 'not_empty';
    value?: string | number;
}>): Assertion[];
/**
 * 리스트/검색 결과 검증 세트
 */
export declare function listResultAssertionSet(minCount?: number, emptyStateText?: string): Assertion[];
export {};
