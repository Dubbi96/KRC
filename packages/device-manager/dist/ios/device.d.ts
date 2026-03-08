/**
 * iOS 디바이스 연결 및 제어
 * libimobiledevice 사용
 */
export interface IOSDevice {
    udid: string;
    name: string;
    version: string;
    model: string;
    status: 'connected' | 'disconnected';
}
/**
 * 연결된 iOS 디바이스 목록 조회
 * 여러 방법을 순차적으로 시도하여 가장 정확한 결과 반환
 */
export declare function listIOSDevices(): Promise<IOSDevice[]>;
/**
 * 연결된 iOS 디바이스의 설치된 앱 Bundle ID 목록 조회 (사용자 앱만)
 * ideviceinstaller 사용 (libimobiledevice 필요)
 * 여러 CLI 형식을 순차 시도하여 호환성 확보
 */
export declare function listIOSBundleIds(udid: string): Promise<string[]>;
/**
 * 현재 포그라운드 앱의 Bundle ID 조회 (Appium 세션 필요 없이)
 * idevice 도구 기반
 */
export declare function getCurrentIOSBundleId(udid: string): Promise<string | null>;
/**
 * iOS 디바이스 연결 확인
 */
export declare function isIOSDeviceConnected(udid: string): Promise<boolean>;
/**
 * iOS 디바이스가 USB 연결될 때까지 대기 (폴링)
 * 새 디바이스를 연결했을 때 인식까지 대기하는 용도
 * @returns 연결 성공 여부
 */
export declare function waitForIOSDevice(udid: string, timeoutMs?: number, pollIntervalMs?: number): Promise<boolean>;
/**
 * iOS 디바이스의 lockdown 서비스가 응답하는지 확인
 * 디바이스를 처음 연결하거나 "이 컴퓨터를 신뢰하시겠습니까?" 팝업을 수락해야 할 때
 * lockdown이 응답하지 않으면 Appium 세션 생성이 불가능
 */
export declare function isDeviceLockdownReady(udid: string): Promise<boolean>;
/**
 * 디바이스 lockdown 서비스가 준비될 때까지 대기
 * "이 컴퓨터를 신뢰하시겠습니까?" 팝업 수락 대기용
 */
export declare function waitForDeviceTrust(udid: string, timeoutMs?: number, pollIntervalMs?: number): Promise<boolean>;
/**
 * iOS 디바이스 화면 캡처
 */
export declare function captureIOSScreen(udid: string, outputPath: string): Promise<void>;
/**
 * iOS 디바이스 로그 수집
 */
export declare function getIOSLogs(udid: string, outputPath: string): Promise<void>;
