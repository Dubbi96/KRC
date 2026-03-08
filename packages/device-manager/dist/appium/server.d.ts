/**
 * Appium 서버 관리
 */
export interface AppiumServerConfig {
    port?: number;
    host?: string;
    logLevel?: string;
}
export interface AppiumCapabilities {
    platformName: 'iOS' | 'Android';
    platformVersion?: string;
    deviceName?: string;
    udid?: string;
    app?: string;
    bundleId?: string;
    package?: string;
    activity?: string;
    automationName?: 'UiAutomator2' | 'XCUITest';
    [key: string]: any;
}
/**
 * Appium 서버가 실행 중인지 확인
 */
export declare function isAppiumServerRunning(serverUrl?: string): Promise<boolean>;
/**
 * Appium 서버 시작 (appium 또는 npx appium 사용)
 */
export declare function startAppiumServer(config?: AppiumServerConfig): Promise<{
    process: any;
    port: number;
}>;
/**
 * Appium 서버 중지
 */
export declare function stopAppiumServer(process: any): void;
/**
 * Appium 세션 생성
 */
export declare function createAppiumSession(serverUrl: string, capabilities: AppiumCapabilities, timeoutMs?: number): Promise<string>;
/**
 * Appium 세션 종료
 */
export declare function deleteAppiumSession(serverUrl: string, sessionId: string): Promise<void>;
/**
 * Appium 액션 실행 (최적화된 버전)
 */
export declare function executeAppiumAction(serverUrl: string, sessionId: string, action: string, params?: any): Promise<any>;
