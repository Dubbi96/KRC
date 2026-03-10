/**
 * Katab Shared Failure Taxonomy
 * Identical across KRC, KCP, KCD for consistent failure classification.
 */

// ── Failure Codes ──────────────────────────────────────────────────────────

export enum FailureCode {
  // Device-level
  DEVICE_DISCONNECTED = 'DEVICE_DISCONNECTED',
  DEVICE_NOT_FOUND = 'DEVICE_NOT_FOUND',
  DEVICE_LOCKED = 'DEVICE_LOCKED',
  DEVICE_LOW_BATTERY = 'DEVICE_LOW_BATTERY',

  // iOS-specific
  WDA_NOT_REACHABLE = 'WDA_NOT_REACHABLE',
  WDA_BUILD_FAILED = 'WDA_BUILD_FAILED',
  TUNNEL_CREATION_FAILED = 'TUNNEL_CREATION_FAILED',
  XCODE_NOT_AVAILABLE = 'XCODE_NOT_AVAILABLE',

  // Android-specific
  ADB_OFFLINE = 'ADB_OFFLINE',
  ADB_UNAUTHORIZED = 'ADB_UNAUTHORIZED',
  UIAUTOMATOR_CRASH = 'UIAUTOMATOR_CRASH',

  // Session-level
  SESSION_STALE = 'SESSION_STALE',
  SESSION_CREATE_FAILED = 'SESSION_CREATE_FAILED',
  SESSION_TIMEOUT = 'SESSION_TIMEOUT',

  // App-level
  APP_CRASH_ON_LAUNCH = 'APP_CRASH_ON_LAUNCH',
  APP_NOT_INSTALLED = 'APP_NOT_INSTALLED',
  APP_INSTALL_FAILED = 'APP_INSTALL_FAILED',

  // Capture-level
  SCREENSHOT_FAILED = 'SCREENSHOT_FAILED',
  RECORDING_FAILED = 'RECORDING_FAILED',

  // Infra-level
  APPIUM_TIMEOUT = 'APPIUM_TIMEOUT',
  APPIUM_NOT_RUNNING = 'APPIUM_NOT_RUNNING',
  BROWSER_CRASH = 'BROWSER_CRASH',
  BROWSER_NOT_AVAILABLE = 'BROWSER_NOT_AVAILABLE',
  PORT_CONFLICT = 'PORT_CONFLICT',

  // Network-level
  NETWORK_UNREACHABLE = 'NETWORK_UNREACHABLE',
  TUNNEL_FAILURE = 'TUNNEL_FAILURE',
  CONNECTION_REFUSED = 'CONNECTION_REFUSED',
  CONNECTION_TIMEOUT = 'CONNECTION_TIMEOUT',

  // Generic
  UNKNOWN = 'UNKNOWN',
}

// ── Failure Categories ─────────────────────────────────────────────────────

export enum FailureCategory {
  DEVICE = 'DEVICE',
  SESSION = 'SESSION',
  APP = 'APP',
  CAPTURE = 'CAPTURE',
  INFRA = 'INFRA',
  NETWORK = 'NETWORK',
  UNKNOWN = 'UNKNOWN',
}

// ── Category Mapping ───────────────────────────────────────────────────────

const CODE_TO_CATEGORY: Record<FailureCode, FailureCategory> = {
  [FailureCode.DEVICE_DISCONNECTED]: FailureCategory.DEVICE,
  [FailureCode.DEVICE_NOT_FOUND]: FailureCategory.DEVICE,
  [FailureCode.DEVICE_LOCKED]: FailureCategory.DEVICE,
  [FailureCode.DEVICE_LOW_BATTERY]: FailureCategory.DEVICE,

  [FailureCode.WDA_NOT_REACHABLE]: FailureCategory.DEVICE,
  [FailureCode.WDA_BUILD_FAILED]: FailureCategory.DEVICE,
  [FailureCode.TUNNEL_CREATION_FAILED]: FailureCategory.DEVICE,
  [FailureCode.XCODE_NOT_AVAILABLE]: FailureCategory.INFRA,

  [FailureCode.ADB_OFFLINE]: FailureCategory.DEVICE,
  [FailureCode.ADB_UNAUTHORIZED]: FailureCategory.DEVICE,
  [FailureCode.UIAUTOMATOR_CRASH]: FailureCategory.DEVICE,

  [FailureCode.SESSION_STALE]: FailureCategory.SESSION,
  [FailureCode.SESSION_CREATE_FAILED]: FailureCategory.SESSION,
  [FailureCode.SESSION_TIMEOUT]: FailureCategory.SESSION,

  [FailureCode.APP_CRASH_ON_LAUNCH]: FailureCategory.APP,
  [FailureCode.APP_NOT_INSTALLED]: FailureCategory.APP,
  [FailureCode.APP_INSTALL_FAILED]: FailureCategory.APP,

  [FailureCode.SCREENSHOT_FAILED]: FailureCategory.CAPTURE,
  [FailureCode.RECORDING_FAILED]: FailureCategory.CAPTURE,

  [FailureCode.APPIUM_TIMEOUT]: FailureCategory.INFRA,
  [FailureCode.APPIUM_NOT_RUNNING]: FailureCategory.INFRA,
  [FailureCode.BROWSER_CRASH]: FailureCategory.INFRA,
  [FailureCode.BROWSER_NOT_AVAILABLE]: FailureCategory.INFRA,
  [FailureCode.PORT_CONFLICT]: FailureCategory.INFRA,

  [FailureCode.NETWORK_UNREACHABLE]: FailureCategory.NETWORK,
  [FailureCode.TUNNEL_FAILURE]: FailureCategory.NETWORK,
  [FailureCode.CONNECTION_REFUSED]: FailureCategory.NETWORK,
  [FailureCode.CONNECTION_TIMEOUT]: FailureCategory.NETWORK,

  [FailureCode.UNKNOWN]: FailureCategory.UNKNOWN,
};

// ── Error Message Pattern Matching ─────────────────────────────────────────

const ERROR_PATTERNS: Array<{ pattern: RegExp; code: FailureCode }> = [
  // Device
  { pattern: /device.*(not found|disappeared|removed)/i, code: FailureCode.DEVICE_NOT_FOUND },
  { pattern: /device.*(disconnect|detach|unplug)/i, code: FailureCode.DEVICE_DISCONNECTED },
  { pattern: /device.*locked/i, code: FailureCode.DEVICE_LOCKED },

  // iOS
  { pattern: /wda.*(not reachable|unreachable|connection refused|failed to start)/i, code: FailureCode.WDA_NOT_REACHABLE },
  { pattern: /wda.*build.*fail/i, code: FailureCode.WDA_BUILD_FAILED },
  { pattern: /xcodebuild.*fail/i, code: FailureCode.WDA_BUILD_FAILED },
  { pattern: /tunnel.*(creation|start).*fail/i, code: FailureCode.TUNNEL_CREATION_FAILED },
  { pattern: /xcode.*(not found|not available|not installed)/i, code: FailureCode.XCODE_NOT_AVAILABLE },

  // Android
  { pattern: /adb.*(offline|not found|error)/i, code: FailureCode.ADB_OFFLINE },
  { pattern: /adb.*unauthorized/i, code: FailureCode.ADB_UNAUTHORIZED },
  { pattern: /uiautomator.*(crash|stop|died)/i, code: FailureCode.UIAUTOMATOR_CRASH },

  // Session
  { pattern: /session.*(stale|expired|invalid)/i, code: FailureCode.SESSION_STALE },
  { pattern: /session.*(create|creation).*fail/i, code: FailureCode.SESSION_CREATE_FAILED },
  { pattern: /session.*timeout/i, code: FailureCode.SESSION_TIMEOUT },

  // App
  { pattern: /app.*(crash|died).*(launch|start)/i, code: FailureCode.APP_CRASH_ON_LAUNCH },
  { pattern: /app.*(not installed|not found)/i, code: FailureCode.APP_NOT_INSTALLED },
  { pattern: /app.*install.*fail/i, code: FailureCode.APP_INSTALL_FAILED },

  // Capture
  { pattern: /screenshot.*fail/i, code: FailureCode.SCREENSHOT_FAILED },
  { pattern: /recording.*fail/i, code: FailureCode.RECORDING_FAILED },

  // Infra
  { pattern: /appium.*(timeout|timed out)/i, code: FailureCode.APPIUM_TIMEOUT },
  { pattern: /appium.*(not running|not started|down)/i, code: FailureCode.APPIUM_NOT_RUNNING },
  { pattern: /browser.*(crash|died|terminated)/i, code: FailureCode.BROWSER_CRASH },
  { pattern: /browser.*(not found|not available|not installed)/i, code: FailureCode.BROWSER_NOT_AVAILABLE },
  { pattern: /port.*(conflict|in use|already bound|EADDRINUSE)/i, code: FailureCode.PORT_CONFLICT },

  // Network
  { pattern: /ECONNREFUSED/i, code: FailureCode.CONNECTION_REFUSED },
  { pattern: /ECONNRESET|EPIPE/i, code: FailureCode.NETWORK_UNREACHABLE },
  { pattern: /ETIMEDOUT|ESOCKETTIMEDOUT/i, code: FailureCode.CONNECTION_TIMEOUT },
  { pattern: /tunnel.*(fail|error|disconnect)/i, code: FailureCode.TUNNEL_FAILURE },
  { pattern: /network.*(unreachable|unavailable)/i, code: FailureCode.NETWORK_UNREACHABLE },
];

// ── Classifier Function ────────────────────────────────────────────────────

export interface ClassifiedFailure {
  code: FailureCode;
  category: FailureCategory;
}

export function classifyFailure(errorMessage: string): ClassifiedFailure {
  if (!errorMessage) {
    return { code: FailureCode.UNKNOWN, category: FailureCategory.UNKNOWN };
  }

  for (const { pattern, code } of ERROR_PATTERNS) {
    if (pattern.test(errorMessage)) {
      return { code, category: CODE_TO_CATEGORY[code] };
    }
  }

  return { code: FailureCode.UNKNOWN, category: FailureCategory.UNKNOWN };
}

export function getCategory(code: FailureCode): FailureCategory {
  return CODE_TO_CATEGORY[code] ?? FailureCategory.UNKNOWN;
}

export function isInfraFailure(code: FailureCode): boolean {
  const cat = getCategory(code);
  return cat === FailureCategory.INFRA || cat === FailureCategory.NETWORK || cat === FailureCategory.DEVICE;
}

// ── Korean Labels (for KCD Dashboard / Webhooks) ───────────────────────────

export const FAILURE_CODE_LABELS_KO: Record<FailureCode, string> = {
  [FailureCode.DEVICE_DISCONNECTED]: '장비 연결 끊김',
  [FailureCode.DEVICE_NOT_FOUND]: '장비를 찾을 수 없음',
  [FailureCode.DEVICE_LOCKED]: '장비 잠금 상태',
  [FailureCode.DEVICE_LOW_BATTERY]: '장비 배터리 부족',

  [FailureCode.WDA_NOT_REACHABLE]: 'WDA 연결 불가',
  [FailureCode.WDA_BUILD_FAILED]: 'WDA 빌드 실패',
  [FailureCode.TUNNEL_CREATION_FAILED]: '터널 생성 실패',
  [FailureCode.XCODE_NOT_AVAILABLE]: 'Xcode 사용 불가',

  [FailureCode.ADB_OFFLINE]: 'ADB 오프라인',
  [FailureCode.ADB_UNAUTHORIZED]: 'ADB 인증 필요',
  [FailureCode.UIAUTOMATOR_CRASH]: 'UiAutomator 크래시',

  [FailureCode.SESSION_STALE]: '세션 만료',
  [FailureCode.SESSION_CREATE_FAILED]: '세션 생성 실패',
  [FailureCode.SESSION_TIMEOUT]: '세션 타임아웃',

  [FailureCode.APP_CRASH_ON_LAUNCH]: '앱 실행 중 크래시',
  [FailureCode.APP_NOT_INSTALLED]: '앱 미설치',
  [FailureCode.APP_INSTALL_FAILED]: '앱 설치 실패',

  [FailureCode.SCREENSHOT_FAILED]: '스크린샷 실패',
  [FailureCode.RECORDING_FAILED]: '녹화 실패',

  [FailureCode.APPIUM_TIMEOUT]: 'Appium 타임아웃',
  [FailureCode.APPIUM_NOT_RUNNING]: 'Appium 미실행',
  [FailureCode.BROWSER_CRASH]: '브라우저 크래시',
  [FailureCode.BROWSER_NOT_AVAILABLE]: '브라우저 사용 불가',
  [FailureCode.PORT_CONFLICT]: '포트 충돌',

  [FailureCode.NETWORK_UNREACHABLE]: '네트워크 연결 불가',
  [FailureCode.TUNNEL_FAILURE]: '터널 연결 실패',
  [FailureCode.CONNECTION_REFUSED]: '연결 거부됨',
  [FailureCode.CONNECTION_TIMEOUT]: '연결 시간 초과',

  [FailureCode.UNKNOWN]: '알 수 없는 오류',
};

export const FAILURE_CATEGORY_LABELS_KO: Record<FailureCategory, string> = {
  [FailureCategory.DEVICE]: '장비',
  [FailureCategory.SESSION]: '세션',
  [FailureCategory.APP]: '앱',
  [FailureCategory.CAPTURE]: '캡처',
  [FailureCategory.INFRA]: '인프라',
  [FailureCategory.NETWORK]: '네트워크',
  [FailureCategory.UNKNOWN]: '기타',
};
