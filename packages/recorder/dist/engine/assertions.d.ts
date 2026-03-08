/**
 * 어설션 엔진
 *
 * URL, 요소, 텍스트, HTTP 상태, 변수 등을 검증한다.
 * Playwright Page 또는 모바일 컨텍스트에서 동작.
 */
import type { Page } from 'playwright';
import type { Assertion, AssertionResult, NetworkLogEntry } from '../types';
import type { VariableContext } from './variables';
export interface AssertionContext {
    page?: Page;
    iosController?: any;
    variables: VariableContext;
    lastApiResponse?: {
        status: number;
        headers: Record<string, string>;
        body: any;
    };
    networkLogs?: NetworkLogEntry[];
}
export declare class AssertionEngine {
    /** evaluateAll 호출 중 동일 selector에 대한 visual check 결과 캐시 */
    private _visualCheckCache;
    /** 단일 어설션 평가 */
    evaluate(assertion: Assertion, ctx: AssertionContext): Promise<AssertionResult>;
    /** 복수 어설션 평가 */
    evaluateAll(assertions: Assertion[], ctx: AssertionContext): Promise<AssertionResult[]>;
    private checkUrl;
    private checkElement;
    private checkElementVisible;
    private checkPageText;
    private checkElementText;
    private checkElementAttribute;
    private checkHttpStatus;
    private checkResponseBody;
    private checkVariable;
    private checkCustom;
    /**
     * <video> 요소를 찾는 공통 JS 스크립트.
     * 대부분의 커스텀 플레이어에서 <video>와 overlay는 형제 관계이므로
     * 자식 → 부모 컨테이너 → 조상 → 페이지 전역 순으로 탐색한다.
     */
    private static readonly FIND_VIDEO_JS;
    /**
     * video_playing: <video> 요소가 실제로 재생 중인지 검증
     *
     * 검증 로직:
     * 1. selector로 video 요소 탐색 (컨테이너면 내부 video 탐색)
     * 2. t0 = currentTime, paused, ended, videoWidth/Height 확인
     * 3. observeMs(기본 2초) 대기
     * 4. t1 = currentTime
     * 5. t1 - t0 >= minTimeAdvance(기본 0.5초) && paused=false && ended=false && (선택) w/h > 0
     */
    private checkVideoPlaying;
    /**
     * video_no_error: <video> 요소에 에러가 없는지 검증
     *
     * video.error === null 이면 통과
     */
    private checkVideoNoError;
    /**
     * video_auto: HTML5 video_playing을 먼저 시도하고,
     * video 요소가 없는 경우에만 stream_segments_loaded로 폴백한다.
     *
     * 폴백 조건: video 요소를 찾을 수 없을 때만.
     * paused=true 또는 ended=true는 폴백하지 않고 그대로 실패 반환.
     */
    private checkVideoAuto;
    /**
     * Playwright의 page.frames() API로 모든 iframe (cross-origin 포함) 내에서
     * <video> 요소 상태를 조회한다.
     * page.evaluate의 contentDocument와 달리 cross-origin iframe에도 접근 가능.
     */
    private findVideoStateInFrames;
    /**
     * Playwright frames() API로 모든 iframe 내에서 <video> 에러 상태를 조회.
     */
    private findVideoErrorStateInFrames;
    /**
     * video_visual: 지정 영역의 스크린샷 2장을 비교하여 픽셀 변화로
     * 영상 재생 여부를 감지한다.
     *
     * <video> 요소 없이도 동작하며, canvas 렌더러/iframe/WebRTC 등
     * 모든 비디오 기술에 적용 가능하다.
     *
     * 검증 로직:
     * 1. selector 영역 또는 clip 영역의 스크린샷 캡처 (t0)
     * 2. observeMs 대기
     * 3. 동일 영역 스크린샷 캡처 (t1)
     * 4. 바이트 레벨 차이 비율 계산
     * 5. changeThreshold 이상이면 통과
     */
    private checkVideoVisual;
    /**
     * stream_segments_loaded: 네트워크 로그에서 HLS/DASH 매니페스트와
     * 세그먼트 응답을 분석하여 스트리밍이 정상 로드되는지 검증한다.
     *
     * 검증 로직:
     * 1. windowMs(기본 5초) 이내의 네트워크 로그 필터링
     * 2. manifestPattern으로 매니페스트 응답 카운트
     * 3. segmentPattern으로 세그먼트 응답 카운트
     * 4. allowedStatus, requireSegmentBytes 조건 확인
     * 5. minManifestResponses, minSegmentResponses 이상이면 통과
     */
    private checkStreamSegmentsLoaded;
    /** iOS pageSource 캐시 (동일 평가 사이클 내 1회만 호출) */
    private iosPageSourceCache;
    private static readonly IOS_CACHE_TTL;
    private getIOSPageSource;
    /**
     * ios_element_visible: iosSelector로 지정된 요소가 화면에 visible인지 검증
     */
    private checkIOSElementVisible;
    /**
     * ios_element_not_exists: iosSelector로 지정된 요소가 존재하지 않는지 검증
     */
    private checkIOSElementNotExists;
    /**
     * ios_text_contains: pageSource XML에 특정 텍스트가 포함되어 있는지 검증
     */
    private checkIOSTextContains;
    /**
     * ios_element_value_equals: iosSelector로 지정된 요소의 value 속성이 expected와 같은지 검증
     */
    private checkIOSElementValueEquals;
    /**
     * ios_text_absent: pageSource에 특정 텍스트(들)이 없어야 함
     * 오류/실패/네트워크 에러 등의 UI 텍스트를 탐지하는 데 사용
     *
     * iosAbsentTexts 배열이 있으면 모든 텍스트를 검사하고,
     * 없으면 expected 하나만 검사한다.
     */
    private checkIOSTextAbsent;
    /**
     * ios_list_count: 특정 타입의 visible 요소 수가 최소 N개인지 검증
     * 검색 결과/리스트가 존재하는지 확인하는 데 사용
     */
    private checkIOSListCount;
    /**
     * ios_no_alert: 시스템 알럿/권한 팝업이 없는지 검증
     * pageSource에서 Alert/Sheet 타입 요소를 탐지
     */
    private checkIOSNoAlert;
    /**
     * ios_screen_changed: 이전 pageSource와 현재가 달라야 함
     * 화면 전환이 정상적으로 발생했는지 확인
     *
     * 시맨틱 비교: parsePageSource + diffUITrees를 사용하여
     * 타임스탬프 등 무의미한 XML 변경을 무시하고 실제 UI 변화만 감지
     */
    private checkIOSScreenChanged;
    /** 네트워크 로그에서 URL 패턴으로 로그 필터링 */
    private filterNetworkLogs;
    /**
     * network_request_sent: 특정 URL 패턴의 요청이 발생했는지 검증
     * "요청이 안 나감" vs "나가는데 빈 값" 분류에 핵심
     */
    private checkNetworkRequestSent;
    /**
     * network_response_status: 특정 URL 패턴 요청의 응답 상태 코드 검증
     */
    private checkNetworkResponseStatus;
    /**
     * network_response_json: 응답 JSON body에서 JSONPath 조건 검증
     * 이미지 검색 결과 items.length > 0 같은 도메인 로직 검증에 핵심
     */
    private checkNetworkResponseJson;
    /**
     * network_image_loads: 이미지 URL들이 정상 로드(200)되는지 샘플링 검증
     * 이미지 검색 결과의 썸네일이 실제로 보이는지 확인
     */
    private checkNetworkImageLoads;
    /**
     * network_no_errors: 네트워크 에러(4xx/5xx/timeout)가 없는지 검증
     */
    private checkNetworkNoErrors;
    /** 간단한 JSON path 해석 (네트워크 assertion용) */
    private resolveJsonPathForNetwork;
    /**
     * JSONPath에서 이미지 URL 배열 추출
     * "$.items[*].thumbnailUrl" 같은 와일드카드 지원
     */
    private extractImageUrls;
}
