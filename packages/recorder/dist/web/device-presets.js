"use strict";
/**
 * 디바이스 프리셋 레지스트리
 *
 * WebDeviceType 키를 Playwright BrowserContext 옵션으로 변환한다.
 * 모바일 타입은 Playwright의 내장 디바이스 디스크립터를 사용하고,
 * desktop은 기존 하드코딩 값(1280×800)을 유지한다.
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.AVAILABLE_DEVICES = void 0;
exports.resolveDeviceConfig = resolveDeviceConfig;
exports.toContextOptions = toContextOptions;
// ─── 내부 매핑 ────────────────────────────────────────────
/** WebDeviceType → Playwright devices 딕셔너리 키 */
const DEVICE_MAP = {
    'iphone-14': 'iPhone 14',
    'iphone-14-pro-max': 'iPhone 14 Pro Max',
    'iphone-15-pro': 'iPhone 15 Pro',
    'pixel-7': 'Pixel 7',
    'galaxy-s24': 'Galaxy S24',
};
const DESKTOP_CONFIG = {
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
async function resolveDeviceConfig(deviceType) {
    if (!deviceType || deviceType === 'desktop') {
        return DESKTOP_CONFIG;
    }
    const playwrightName = DEVICE_MAP[deviceType];
    if (!playwrightName) {
        console.warn(`[device-presets] 알 수 없는 디바이스: ${deviceType}, desktop으로 폴백`);
        return DESKTOP_CONFIG;
    }
    const { devices } = await Promise.resolve().then(() => __importStar(require('playwright')));
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
function toContextOptions(config) {
    const opts = {
        viewport: config.viewport,
    };
    if (config.userAgent)
        opts.userAgent = config.userAgent;
    if (config.deviceScaleFactor !== undefined)
        opts.deviceScaleFactor = config.deviceScaleFactor;
    if (config.isMobile !== undefined)
        opts.isMobile = config.isMobile;
    if (config.hasTouch !== undefined)
        opts.hasTouch = config.hasTouch;
    return opts;
}
/** UI 드롭다운용 디바이스 목록 */
exports.AVAILABLE_DEVICES = [
    { value: 'desktop', label: 'Desktop (1280×800)', category: 'desktop' },
    { value: 'iphone-14', label: 'iPhone 14 (390×664)', category: 'ios' },
    { value: 'iphone-14-pro-max', label: 'iPhone 14 Pro Max (430×740)', category: 'ios' },
    { value: 'iphone-15-pro', label: 'iPhone 15 Pro (393×659)', category: 'ios' },
    { value: 'pixel-7', label: 'Pixel 7 (412×839)', category: 'android' },
    { value: 'galaxy-s24', label: 'Galaxy S24 (360×780)', category: 'android' },
];
//# sourceMappingURL=device-presets.js.map