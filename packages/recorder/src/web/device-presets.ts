/**
 * 디바이스 프리셋 레지스트리
 *
 * WebDeviceType 키를 Playwright BrowserContext 옵션으로 변환한다.
 * 모바일 타입은 Playwright의 내장 디바이스 디스크립터를 사용하고,
 * desktop은 기존 하드코딩 값(1280×800)을 유지한다.
 */

import type { WebDeviceType, DeviceEmulationConfig } from '../types';

// ─── 내부 매핑 ────────────────────────────────────────────

/** WebDeviceType → Playwright devices 딕셔너리 키 */
const DEVICE_MAP: Record<string, string> = {
  'iphone-14': 'iPhone 14',
  'iphone-14-pro-max': 'iPhone 14 Pro Max',
  'iphone-15-pro': 'iPhone 15 Pro',
  'pixel-7': 'Pixel 7',
  'galaxy-s24': 'Galaxy S24',
};

const DESKTOP_CONFIG: DeviceEmulationConfig = {
  deviceType: 'desktop',
  viewport: { width: 1280, height: 800 },
  isMobile: false,
  hasTouch: false,
};

// ─── 공개 API ─────────────────────────────────────────────

/**
 * WebDeviceType을 DeviceEmulationConfig로 변환한다.
 * desktop이거나 undefined이면 기본 데스크톱 설정을 반환한다.
 */
export async function resolveDeviceConfig(
  deviceType: WebDeviceType | undefined,
): Promise<DeviceEmulationConfig> {
  if (!deviceType || deviceType === 'desktop') {
    return DESKTOP_CONFIG;
  }

  const playwrightName = DEVICE_MAP[deviceType];
  if (!playwrightName) {
    console.warn(`[device-presets] 알 수 없는 디바이스: ${deviceType}, desktop으로 폴백`);
    return DESKTOP_CONFIG;
  }

  const { devices } = await import('playwright');

  if (!devices[playwrightName]) {
    console.warn(`[device-presets] Playwright에 '${playwrightName}' 디바이스가 없습니다, desktop으로 폴백`);
    return DESKTOP_CONFIG;
  }

  const descriptor = devices[playwrightName];
  return {
    deviceType,
    viewport: descriptor.viewport,
    userAgent: descriptor.userAgent,
    deviceScaleFactor: descriptor.deviceScaleFactor,
    isMobile: descriptor.isMobile,
    hasTouch: descriptor.hasTouch,
  };
}

/**
 * DeviceEmulationConfig를 Playwright BrowserContext 옵션 객체로 변환한다.
 */
export function toContextOptions(config: DeviceEmulationConfig): Record<string, any> {
  const opts: Record<string, any> = {
    viewport: config.viewport,
  };
  if (config.userAgent) opts.userAgent = config.userAgent;
  if (config.deviceScaleFactor !== undefined) opts.deviceScaleFactor = config.deviceScaleFactor;
  if (config.isMobile !== undefined) opts.isMobile = config.isMobile;
  if (config.hasTouch !== undefined) opts.hasTouch = config.hasTouch;
  return opts;
}

/** UI 드롭다운용 디바이스 목록 */
export const AVAILABLE_DEVICES: Array<{
  value: WebDeviceType;
  label: string;
  category: 'desktop' | 'ios' | 'android';
}> = [
  { value: 'desktop', label: 'Desktop (1280×800)', category: 'desktop' },
  { value: 'iphone-14', label: 'iPhone 14 (390×664)', category: 'ios' },
  { value: 'iphone-14-pro-max', label: 'iPhone 14 Pro Max (430×740)', category: 'ios' },
  { value: 'iphone-15-pro', label: 'iPhone 15 Pro (393×659)', category: 'ios' },
  { value: 'pixel-7', label: 'Pixel 7 (412×839)', category: 'android' },
  { value: 'galaxy-s24', label: 'Galaxy S24 (360×780)', category: 'android' },
];
