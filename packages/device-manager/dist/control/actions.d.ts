/**
 * 디바이스 제어 액션
 * 클릭, 스와이프, 타이핑 등
 */
export interface Point {
    x: number;
    y: number;
}
export interface SwipeOptions {
    from: Point;
    to: Point;
    duration?: number;
}
/**
 * Android 디바이스 제어
 */
export declare class AndroidController {
    private deviceId;
    constructor(deviceId: string);
    /**
     * 화면 탭 (클릭)
     */
    tap(x: number, y: number): Promise<void>;
    /**
     * 스와이프
     */
    swipe(options: SwipeOptions): Promise<void>;
    /**
     * 텍스트 입력
     */
    type(text: string): Promise<void>;
    /**
     * 키 입력 (백, 홈, 메뉴 등)
     */
    key(keyCode: number): Promise<void>;
    /**
     * 뒤로 가기
     */
    back(): Promise<void>;
    /**
     * 홈
     */
    home(): Promise<void>;
    /**
     * 메뉴
     */
    menu(): Promise<void>;
    /**
     * 롱 프레스
     */
    longPress(x: number, y: number, duration?: number): Promise<void>;
    /**
     * 화면 회전
     */
    rotate(orientation: 0 | 1 | 2 | 3): Promise<void>;
    /**
     * 앱 실행
     */
    launchApp(packageName: string, activityName?: string): Promise<void>;
    /**
     * 앱 종료
     */
    stopApp(packageName: string): Promise<void>;
    /**
     * UIAutomator dump로 Page Source(XML) 가져오기
     * UI 트리 스냅샷 캡처 및 요소 정보 추출에 사용
     */
    getPageSource(): Promise<string | null>;
    /**
     * 좌표로 요소 찾기 (UIAutomator XML 기반)
     * UIAutomator dump를 파싱하여 좌표에 해당하는 가장 적합한 요소를 반환
     */
    findElementAtCoordinates(x: number, y: number): Promise<{
        type: string;
        shortType: string;
        resourceId?: string;
        contentDesc?: string;
        text?: string;
        bounds: {
            x: number;
            y: number;
            width: number;
            height: number;
        };
        enabled: boolean;
        clickable: boolean;
    } | null>;
    /**
     * 현재 포그라운드 앱의 Activity 정보 가져오기
     */
    getCurrentActivity(): Promise<{
        package: string;
        activity: string;
    } | null>;
    /**
     * 스크린샷 캡처 (base64 PNG)
     */
    screenshot(): Promise<string>;
    /**
     * 디바이스 화면 해상도 가져오기
     */
    getScreenSize(): Promise<{
        width: number;
        height: number;
    }>;
}
/**
 * iOS 제어 설정 옵션
 * IOS_CONTROL_SETTINGS.md의 "정확도가 중요한 경우" 권장값이 기본값으로 적용됨
 */
export interface IOSControlOptions {
    /** 탭 액션의 pause duration (ms) - 기본값: 400 (정확도 향상) */
    tapPauseDuration?: number;
    /** 탭 액션 후 release 대기 시간 (ms) - 기본값: 400 (정확도 향상) */
    tapReleaseDelay?: number;
    /** 탭 액션 후 추가 대기 시간 (ms) - 기본값: 300 (정확도 향상) */
    tapPostDelay?: number;
    /** 스와이프 액션의 pause duration (ms) - 기본값: 150 (부드러운 동작) */
    swipePauseDuration?: number;
    /** 스와이프 최소 duration (ms) - 기본값: 400 (부드러운 동작) */
    swipeMinDuration?: number;
    /** 스와이프 후 release 대기 시간 (ms) - 기본값: 400 (정확도 향상) */
    swipeReleaseDelay?: number;
    /** 스와이프 후 추가 대기 시간 (ms) - 기본값: 300 (정확도 향상) */
    swipePostDelay?: number;
    /** 좌표 origin 타입: 'viewport' 또는 'pointer' - 기본값: 'viewport' */
    coordinateOrigin?: 'viewport' | 'pointer';
    /** 좌표 정확도 향상을 위한 오프셋 조정 (x, y) */
    coordinateOffset?: {
        x: number;
        y: number;
    };
}
/**
 * iOS 디바이스 제어
 * Appium + WebDriverAgent 사용
 */
export declare class IOSController {
    private udid;
    private appiumServerUrl;
    private sessionId;
    private options;
    /**
     * WDA Warm-Up: 디바이스를 Automation Running 상태로 만든다.
     * Worker 시작 시 호출하여 WDA 설치+신뢰+세션 생성을 미리 수행.
     * 성공하면 세션을 종료하고 결과를 반환한다.
     */
    static warmUp(appiumServerUrl?: string): Promise<{
        success: boolean;
        udid?: string;
        error?: string;
    }>;
    constructor(udid: string, appiumServerUrl?: string, options?: IOSControlOptions);
    /**
     * Appium 서버 URL 접근
     */
    get serverUrl(): string;
    /**
     * 현재 세션 ID 접근
     */
    get currentSessionId(): string | null;
    /**
     * Appium 세션 생성
     * Pre-flight: USB 연결 확인 → 디바이스 신뢰 확인 → WDA 캐시 정리 → 세션 생성
     */
    createSession(bundleId?: string): Promise<void>;
    /**
     * macOS 키체인/프로비저닝 프로파일에서 Team ID를 자동 탐지한다.
     */
    private detectTeamId;
    /**
     * 디바이스 사전 준비: USB 연결 확인 → lockdown 신뢰 확인
     * 새 디바이스를 연결했을 때 "이 컴퓨터를 신뢰하시겠습니까?" 수락까지 대기
     */
    private prepareDevice;
    /**
     * WDA Derived Data 캐시 정리
     * 오래된 .pcm (precompiled module) 파일이 빌드 실패를 유발하는 것을 방지
     * @param fullClean true이면 전체 derived data 삭제, false이면 ExplicitPrecompiledModules만
     */
    private cleanWDADerivedData;
    /**
     * Appium 세션 종료
     */
    closeSession(): Promise<void>;
    /**
     * 세션이 없으면 생성
     */
    private ensureSession;
    /**
     * WDA(WebDriverAgent)가 응답하는지 확인
     */
    private isWDAAlive;
    /**
     * WDA 연결 끊김 등 네트워크 에러인지 판별
     */
    private isWDADisconnectError;
    /**
     * WDA 연결 끊김 시 세션 복구 시도
     * 주의: 앱 상태가 유지되지 않을 수 있음
     */
    private recoverSession;
    /**
     * Page Source(XML) 가져오기
     * UI 트리 스냅샷 캡처 및 assertion 평가에 사용
     */
    getPageSource(): Promise<string | null>;
    /**
     * 좌표로 요소 찾기 (XCUIElement)
     */
    findElementAtCoordinates(x: number, y: number): Promise<any>;
    /**
     * 요소로 직접 클릭 (가장 정확함)
     */
    tapElement(element: any): Promise<void>;
    /**
     * 좌표로 탭 - W3C Actions로 직접 터치 이벤트 시뮬레이션 (손가락으로 화면 터치하는 것처럼)
     * WDA 연결 끊김 시 최대 2회 재시도 (3초, 6초 대기)
     */
    tapAtCoordinates(x: number, y: number): Promise<void>;
    /**
     * 화면 탭 (클릭) - 좌표 기반 직접 터치 (미러링 화면에 손가락 갖다 대는 것처럼)
     * 요소 찾기 없이 바로 좌표로 터치하여 빠르고 정확하게 동작
     */
    tap(x: number, y: number): Promise<{
        element?: any;
        coordinates: {
            x: number;
            y: number;
        };
    }>;
    /**
     * 스크롤 - W3C Actions로 직접 스와이프 (스크롤도 스와이프로 처리)
     */
    scroll(options: SwipeOptions): Promise<{
        fromElement?: any;
        toElement?: any;
        coordinates: {
            from: {
                x: number;
                y: number;
            };
            to: {
                x: number;
                y: number;
            };
        };
    }>;
    /**
     * 스와이프 - W3C Actions로 직접 터치 드래그 시뮬레이션 (손가락으로 화면을 드래그하는 것처럼)
     */
    swipe(options: SwipeOptions): Promise<{
        fromElement?: any;
        toElement?: any;
        coordinates: {
            from: {
                x: number;
                y: number;
            };
            to: {
                x: number;
                y: number;
            };
        };
    }>;
    /**
     * 텍스트 입력 - TextField를 찾아서 입력 (검증+재시도 포함)
     *
     * OTP/코드 입력 패턴(한 칸에 한 문자씩 개별 TextField)을 자동 감지하여
     * W3C 키보드 시뮬레이션으로 한 글자씩 입력한다.
     */
    type(text: string): Promise<void>;
    /**
     * 화면 캡처 - Appium 표준 screenshot API 사용
     */
    screenshot(): Promise<string>;
    /**
     * 뒤로 가기 - Appium 표준 back 명령 사용
     */
    back(): Promise<void>;
    /**
     * 홈 버튼 - Appium 표준 mobile: pressButton 사용
     */
    home(): Promise<void>;
    /**
     * 롱 프레스 - Appium 표준 mobile: touchAndHold 사용
     */
    longPress(x: number, y: number, duration?: number): Promise<void>;
    /**
     * 앱 실행
     */
    launchApp(bundleId: string): Promise<void>;
    /**
     * 앱 종료
     */
    stopApp(bundleId: string): Promise<void>;
    /**
     * 앱 캐시/데이터 초기화
     * mobile:clearApp으로 캐시 삭제, 실패 시 removeApp + relaunch fallback
     */
    clearApp(bundleId: string): Promise<void>;
    /**
     * 뷰포트 크기 조회 (미러링 좌표 변환용)
     */
    getWindowSize(): Promise<{
        width: number;
        height: number;
    }>;
    /**
     * 시스템 알럿이 현재 표시 중인지 확인
     */
    isAlertPresent(): Promise<boolean>;
    /**
     * 현재 표시 중인 알럿의 텍스트 반환
     */
    getAlertText(): Promise<string | null>;
    /**
     * 현재 알럿의 확인(Accept) 버튼 클릭
     */
    acceptAlert(): Promise<void>;
    /**
     * 현재 알럿의 취소(Dismiss) 버튼 클릭
     */
    dismissAlert(): Promise<void>;
}
