/**
 * Xcode 경로 및 버전 정보
 */
export interface XcodeInfo {
    path: string;
    version: string;
    buildVersion: string;
    isValid: boolean;
}
/**
 * Xcode 경로 찾기
 */
export declare function findXcodePath(): Promise<string | null>;
/**
 * Xcode 정보 가져오기
 */
export declare function getXcodeInfo(): Promise<XcodeInfo | null>;
/**
 * Xcode 경로 설정
 */
export declare function setXcodePath(path: string): Promise<boolean>;
/**
 * Xcode가 설치되어 있는지 확인
 */
export declare function isXcodeInstalled(): Promise<boolean>;
/**
 * DEVELOPER_DIR 환경 변수 설정
 */
export declare function setDeveloperDirEnv(xcodePath: string): void;
/**
 * Xcode 경로 자동 설정 시도
 */
export declare function autoConfigureXcode(): Promise<XcodeInfo | null>;
