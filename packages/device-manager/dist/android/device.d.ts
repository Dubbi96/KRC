/**
 * Android 디바이스 연결 및 제어
 * ADB 사용
 */
export interface AndroidDevice {
    id: string;
    model: string;
    version: string;
    sdk: string;
    status: 'device' | 'offline' | 'unauthorized';
}
/**
 * 연결된 Android 디바이스 목록 조회
 */
export declare function listAndroidDevices(): Promise<AndroidDevice[]>;
/**
 * 연결된 Android 디바이스의 설치된 패키지 목록 조회 (3rd-party 앱만)
 */
export declare function listAndroidPackages(deviceId: string): Promise<string[]>;
/**
 * 현재 포그라운드 앱의 패키지 이름 조회
 */
export declare function getCurrentAndroidPackage(deviceId: string): Promise<string | null>;
/**
 * Android 디바이스 연결 확인
 */
export declare function isAndroidDeviceConnected(deviceId: string): Promise<boolean>;
/**
 * Android 디바이스 화면 캡처
 */
export declare function captureAndroidScreen(deviceId: string, outputPath: string): Promise<void>;
/**
 * Android 디바이스 로그 수집
 */
export declare function getAndroidLogs(deviceId: string, outputPath: string): Promise<void>;
