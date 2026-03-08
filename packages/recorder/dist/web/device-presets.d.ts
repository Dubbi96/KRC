/**
 * 디바이스 프리셋 레지스트리
 *
 * WebDeviceType 키를 Playwright BrowserContext 옵션으로 변환한다.
 * 모바일 타입은 Playwright의 내장 디바이스 디스크립터를 사용하고,
 * desktop은 기존 하드코딩 값(1280×800)을 유지한다.
 */
import type { WebDeviceType, DeviceEmulationConfig } from '../types';
/**
 * WebDeviceType을 DeviceEmulationConfig로 변환한다.
 * desktop이거나 undefined이면 기본 데스크톱 설정을 반환한다.
 */
export declare function resolveDeviceConfig(deviceType: WebDeviceType | undefined): Promise<DeviceEmulationConfig>;
/**
 * DeviceEmulationConfig를 Playwright BrowserContext 옵션 객체로 변환한다.
 */
export declare function toContextOptions(config: DeviceEmulationConfig): Record<string, any>;
/** UI 드롭다운용 디바이스 목록 */
export declare const AVAILABLE_DEVICES: Array<{
    value: WebDeviceType;
    label: string;
    category: 'desktop' | 'ios' | 'android';
}>;
