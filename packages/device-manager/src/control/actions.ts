import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

/** XML 속성값의 문자 엔티티를 디코딩 (&#10; → \n, &amp; → & 등) */
function decodeXmlAttr(s: string): string {
  return s
    .replace(/&#(\d+);/g, (_m, code) => String.fromCharCode(parseInt(code, 10)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_m, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

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
  duration?: number; // milliseconds
}

/**
 * Android 디바이스 제어
 */
export class AndroidController {
  constructor(private deviceId: string) {}

  /**
   * 화면 탭 (클릭)
   */
  async tap(x: number, y: number): Promise<void> {
    await execAsync(`adb -s ${this.deviceId} shell input tap ${x} ${y}`);
  }

  /**
   * 스와이프
   */
  async swipe(options: SwipeOptions): Promise<void> {
    const { from, to, duration = 300 } = options;
    await execAsync(
      `adb -s ${this.deviceId} shell input swipe ${from.x} ${from.y} ${to.x} ${to.y} ${duration}`
    );
  }

  /**
   * 텍스트 입력
   */
  async type(text: string): Promise<void> {
    // 특수문자 이스케이프
    const escaped = text.replace(/ /g, '%s').replace(/&/g, '\\&');
    await execAsync(`adb -s ${this.deviceId} shell input text "${escaped}"`);
  }

  /**
   * 키 입력 (백, 홈, 메뉴 등)
   */
  async key(keyCode: number): Promise<void> {
    await execAsync(`adb -s ${this.deviceId} shell input keyevent ${keyCode}`);
  }

  /**
   * 뒤로 가기
   */
  async back(): Promise<void> {
    await this.key(4); // KEYCODE_BACK
  }

  /**
   * 홈
   */
  async home(): Promise<void> {
    await this.key(3); // KEYCODE_HOME
  }

  /**
   * 메뉴
   */
  async menu(): Promise<void> {
    await this.key(82); // KEYCODE_MENU
  }

  /**
   * 롱 프레스
   */
  async longPress(x: number, y: number, duration: number = 1000): Promise<void> {
    await execAsync(
      `adb -s ${this.deviceId} shell input swipe ${x} ${y} ${x} ${y} ${duration}`
    );
  }

  /**
   * 화면 회전
   */
  async rotate(orientation: 0 | 1 | 2 | 3): Promise<void> {
    // 0: 세로, 1: 가로, 2: 역세로, 3: 역가로
    await execAsync(`adb -s ${this.deviceId} shell settings put system user_rotation ${orientation}`);
  }

  /**
   * 앱 실행
   */
  async launchApp(packageName: string, activityName?: string): Promise<void> {
    if (activityName) {
      await execAsync(
        `adb -s ${this.deviceId} shell am start -n ${packageName}/${activityName}`
      );
    } else {
      await execAsync(`adb -s ${this.deviceId} shell monkey -p ${packageName} -c android.intent.category.LAUNCHER 1`);
    }
  }

  /**
   * 앱 종료
   */
  async stopApp(packageName: string): Promise<void> {
    await execAsync(`adb -s ${this.deviceId} shell am force-stop ${packageName}`);
  }

  /**
   * UIAutomator dump로 Page Source(XML) 가져오기
   * UI 트리 스냅샷 캡처 및 요소 정보 추출에 사용
   */
  async getPageSource(): Promise<string | null> {
    try {
      const { stdout } = await execAsync(
        `adb -s ${this.deviceId} shell "uiautomator dump /sdcard/ui_dump.xml && cat /sdcard/ui_dump.xml"`,
        { timeout: 10000, maxBuffer: 5 * 1024 * 1024 }
      );
      // "UI hierchary dumped to: ..." 접두사 제거하고 XML만 추출
      const xmlStart = stdout.indexOf('<?xml');
      if (xmlStart >= 0) return stdout.substring(xmlStart);
      return null;
    } catch {
      return null;
    }
  }

  /**
   * 좌표로 요소 찾기 (UIAutomator XML 기반)
   * UIAutomator dump를 파싱하여 좌표에 해당하는 가장 적합한 요소를 반환
   */
  async findElementAtCoordinates(x: number, y: number): Promise<{
    type: string;
    shortType: string;
    resourceId?: string;
    contentDesc?: string;
    text?: string;
    bounds: { x: number; y: number; width: number; height: number };
    enabled: boolean;
    clickable: boolean;
  } | null> {
    const xml = await this.getPageSource();
    if (!xml) return null;

    // UIAutomator XML 파싱하여 좌표에 해당하는 요소 찾기
    const nodePattern = /<node\s([^>]+)\/?>/g;
    const boundsPattern = /bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/;

    const elements: Array<{
      type: string;
      shortType: string;
      resourceId?: string;
      contentDesc?: string;
      text?: string;
      bounds: { x: number; y: number; width: number; height: number };
      enabled: boolean;
      clickable: boolean;
    }> = [];

    let match;
    while ((match = nodePattern.exec(xml)) !== null) {
      const attrs = match[1];
      const boundsMatch = attrs.match(boundsPattern);
      if (!boundsMatch) continue;

      const x1 = parseInt(boundsMatch[1], 10);
      const y1 = parseInt(boundsMatch[2], 10);
      const x2 = parseInt(boundsMatch[3], 10);
      const y2 = parseInt(boundsMatch[4], 10);
      const width = x2 - x1;
      const height = y2 - y1;

      if (width === 0 && height === 0) continue;

      // 좌표가 요소의 bounds 안에 있는지 확인
      if (x >= x1 && x <= x2 && y >= y1 && y <= y2) {
        const classMatch = attrs.match(/class="([^"]*)"/);
        const resourceIdMatch = attrs.match(/resource-id="([^"]*)"/);
        const contentDescMatch = attrs.match(/content-desc="([^"]*)"/);
        const textMatch = attrs.match(/text="([^"]*)"/);
        const enabledMatch = attrs.match(/enabled="([^"]*)"/);
        const clickableMatch = attrs.match(/clickable="([^"]*)"/);

        const fullType = classMatch?.[1] || '';
        const shortType = fullType.split('.').pop() || fullType;

        elements.push({
          type: fullType,
          shortType,
          resourceId: resourceIdMatch?.[1] || undefined,
          contentDesc: contentDescMatch?.[1] || undefined,
          text: textMatch?.[1] || undefined,
          bounds: { x: x1, y: y1, width, height },
          enabled: enabledMatch?.[1] !== 'false',
          clickable: clickableMatch?.[1] === 'true',
        });
      }
    }

    if (elements.length === 0) return null;

    // 클릭 가능한 요소 우선
    const clickable = elements.filter(e => e.clickable);
    const candidates = clickable.length > 0 ? clickable : elements;

    // 식별자가 있는 요소 우선
    const withId = candidates.filter(e => e.resourceId || e.contentDesc || e.text);
    const finalCandidates = withId.length > 0 ? withId : candidates;

    // 가장 작은 영역의 요소 선택
    return finalCandidates.reduce((smallest, current) => {
      const smallestArea = smallest.bounds.width * smallest.bounds.height;
      const currentArea = current.bounds.width * current.bounds.height;
      return currentArea < smallestArea ? current : smallest;
    });
  }

  /**
   * 현재 포그라운드 앱의 Activity 정보 가져오기
   */
  async getCurrentActivity(): Promise<{ package: string; activity: string } | null> {
    try {
      const { stdout } = await execAsync(
        `adb -s ${this.deviceId} shell dumpsys activity activities | grep mResumedActivity`,
        { timeout: 3000 }
      );
      // 형식: mResumedActivity: ActivityRecord{... com.example/.MainActivity ...}
      const match = stdout.match(/([a-zA-Z0-9_.]+)\/([a-zA-Z0-9_.]+)/);
      if (match) {
        return { package: match[1], activity: match[2] };
      }
    } catch { /* ignore */ }
    return null;
  }

  /**
   * 스크린샷 캡처 (base64 PNG)
   */
  async screenshot(): Promise<string> {
    const { stdout } = await execAsync(
      `adb -s ${this.deviceId} exec-out screencap -p | base64`,
      { maxBuffer: 10 * 1024 * 1024, timeout: 10000 }
    );
    return stdout.trim();
  }

  /**
   * 디바이스 화면 해상도 가져오기
   */
  async getScreenSize(): Promise<{ width: number; height: number }> {
    try {
      const { stdout } = await execAsync(
        `adb -s ${this.deviceId} shell wm size`,
        { timeout: 3000 }
      );
      // 형식: Physical size: 1440x2960
      const match = stdout.match(/(\d+)x(\d+)/);
      if (match) {
        return { width: parseInt(match[1], 10), height: parseInt(match[2], 10) };
      }
    } catch { /* ignore */ }
    return { width: 1080, height: 1920 }; // 기본값
  }
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
  coordinateOffset?: { x: number; y: number };
}

/**
 * iOS 디바이스 제어
 * Appium + WebDriverAgent 사용
 */
export class IOSController {
  private appiumServerUrl: string;
  private sessionId: string | null = null;
  private options: IOSControlOptions;

  /**
   * WDA Warm-Up: 디바이스를 Automation Running 상태로 만든다.
   * Worker 시작 시 호출하여 WDA 설치+신뢰+세션 생성을 미리 수행.
   * 성공하면 세션을 종료하고 결과를 반환한다.
   */
  static async warmUp(appiumServerUrl: string = 'http://localhost:4723'): Promise<{
    success: boolean;
    udid?: string;
    error?: string;
  }> {
    // 1. Appium 서버 실행 확인
    const { isAppiumServerRunning } = await import('../appium/server');
    const running = await isAppiumServerRunning(appiumServerUrl);
    if (!running) {
      return { success: false, error: 'Appium 서버가 실행되지 않았습니다' };
    }

    // 2. 연결된 iOS 디바이스 탐지
    const { listIOSDevices } = await import('../ios/device');
    const devices = await listIOSDevices();
    if (devices.length === 0) {
      return { success: false, error: '연결된 iOS 디바이스가 없습니다' };
    }

    const device = devices[0];
    console.log(`[iOS WarmUp] 디바이스 발견: ${device.name} (${device.udid})`);

    // 3. IOSController로 세션 생성 (WDA 빌드+설치+신뢰 포함)
    const controller = new IOSController(device.udid, appiumServerUrl);
    try {
      await controller.createSession(); // bundleId 없이 — SpringBoard에서 시작

      // 4. 세션 동작 확인 (window size 체크)
      const size = await controller.getWindowSize();
      console.log(`[iOS WarmUp] 세션 생성 성공 (화면: ${size.width}x${size.height})`);

      // 5. warm-up 세션 종료 (리소스 반납)
      await controller.closeSession();

      return { success: true, udid: device.udid };
    } catch (error: any) {
      // 실패해도 worker 시작은 막지 않음
      try { await controller.closeSession(); } catch { /* ignore */ }
      return { success: false, udid: device.udid, error: error.message };
    }
  }

  constructor(
    private udid: string,
    appiumServerUrl: string = 'http://localhost:4723',
    options: IOSControlOptions = {}
  ) {
    this.appiumServerUrl = appiumServerUrl;
    // 환경 변수에서 설정 읽기 (IOS_CONTROL_SETTINGS.md의 "정확도가 중요한 경우" 권장값을 기본값으로 사용)
    this.options = {
      // 탭 액션: 정확도 향상을 위해 더 긴 딜레이 사용
      tapPauseDuration: options.tapPauseDuration ?? parseInt(process.env.IOS_TAP_PAUSE_DURATION || '400', 10),
      tapReleaseDelay: options.tapReleaseDelay ?? parseInt(process.env.IOS_TAP_RELEASE_DELAY || '400', 10),
      tapPostDelay: options.tapPostDelay ?? parseInt(process.env.IOS_TAP_POST_DELAY || '300', 10),
      // 스와이프/스크롤 액션: 부드러운 동작을 위해 최적화된 값
      swipePauseDuration: options.swipePauseDuration ?? parseInt(process.env.IOS_SWIPE_PAUSE_DURATION || '150', 10),
      swipeMinDuration: options.swipeMinDuration ?? parseInt(process.env.IOS_SWIPE_MIN_DURATION || '400', 10),
      swipeReleaseDelay: options.swipeReleaseDelay ?? parseInt(process.env.IOS_SWIPE_RELEASE_DELAY || '400', 10),
      swipePostDelay: options.swipePostDelay ?? parseInt(process.env.IOS_SWIPE_POST_DELAY || '300', 10),
      // 좌표 설정
      coordinateOrigin: options.coordinateOrigin ?? (process.env.IOS_COORDINATE_ORIGIN as 'viewport' | 'pointer' | undefined) ?? 'viewport',
      coordinateOffset: options.coordinateOffset ?? {
        x: parseInt(process.env.IOS_COORDINATE_OFFSET_X || '0', 10),
        y: parseInt(process.env.IOS_COORDINATE_OFFSET_Y || '0', 10),
      },
    };
  }

  /**
   * Appium 서버 URL 접근
   */
  get serverUrl(): string {
    return this.appiumServerUrl;
  }

  /**
   * 현재 세션 ID 접근
   */
  get currentSessionId(): string | null {
    return this.sessionId;
  }

  /**
   * Attach to an existing Appium session (e.g. standby WDA session).
   * Skips session creation — the caller is responsible for keeping the session alive.
   */
  attachSession(sessionId: string): void {
    this.sessionId = sessionId;
  }

  /**
   * Appium 세션 생성
   * Pre-flight: USB 연결 확인 → 디바이스 신뢰 확인 → WDA 캐시 정리 → 세션 생성
   */
  async createSession(bundleId?: string): Promise<void> {
    const { createAppiumSession } = await import('../appium/server');
    const { autoConfigureXcode, isXcodeInstalled } = await import('../ios/xcode-utils');

    const isRealDevice = !this.udid.includes('Simulator');

    // ── Pre-flight: 디바이스 준비 상태 확인 ──
    if (isRealDevice && this.udid) {
      await this.prepareDevice();
    }

    // Xcode 자동 설정 시도
    const xcodeInfo = await autoConfigureXcode();
    const hasXcode = await isXcodeInstalled();

    // Xcode가 없어도 일단 시도 (usePrebuiltWDA 옵션 사용)
    if (!hasXcode && isRealDevice) {
      console.warn('[WARN]  Xcode가 설치되어 있지 않습니다. usePrebuiltWDA 옵션으로 시도합니다.');
      console.warn('   실제 디바이스 제어를 위해서는 Xcode가 필요할 수 있습니다.');
    }

    // Team ID 자동 탐지 (XCODE_ORG_ID가 없는 경우)
    let teamId = process.env.XCODE_ORG_ID || '';
    if (!teamId && isRealDevice && hasXcode) {
      teamId = await this.detectTeamId();
    }

    // WDA 번들 ID (환경변수 또는 기본값)
    const wdaBundleId = process.env.WDA_BUNDLE_ID || '';

    const capabilities: any = {
      platformName: 'iOS',
      'appium:deviceName': 'iPhone',
      'appium:udid': this.udid,
      'appium:automationName': 'XCUITest',
      'appium:noReset': true,
      // 미리 빌드된 WDA 우선 사용 (빌드 실패 방지)
      'appium:usePrebuiltWDA': true,
      'appium:useSimpleBuildTest': true,
    };

    // WDA 커스텀 번들 ID 설정 (Appium 서버 default-capabilities와 충돌 방지)
    if (wdaBundleId) {
      capabilities['appium:updatedWDABundleId'] = wdaBundleId;
    }

    // Xcode 정보가 있으면 사용
    if (xcodeInfo && xcodeInfo.isValid) {
      process.env.DEVELOPER_DIR = xcodeInfo.path;
    } else if (!process.env.DEVELOPER_DIR) {
      // /Applications/Xcode.app 기본 경로 시도
      const defaultPath = '/Applications/Xcode.app/Contents/Developer';
      try {
        const { existsSync } = await import('fs');
        if (existsSync(defaultPath)) {
          process.env.DEVELOPER_DIR = defaultPath;
        }
      } catch { /* ignore */ }
    }

    // 실제 디바이스인 경우 서명 정보 추가
    if (isRealDevice) {
      if (teamId) {
        capabilities['appium:xcodeOrgId'] = teamId;
      }
      capabilities['appium:xcodeSigningId'] = process.env.XCODE_SIGNING_ID || 'Apple Development';

      // 실제 디바이스용 추가 설정
      capabilities['appium:useNewWDA'] = false;
      capabilities['appium:wdaLaunchTimeout'] = 240000;
      capabilities['appium:wdaConnectionTimeout'] = 240000;
      capabilities['appium:wdaStartupRetries'] = 4;
      capabilities['appium:wdaStartupRetryInterval'] = 15000;
      // WDA 포트 포워딩 — 고정 포트로 충돌 방지
      capabilities['appium:wdaLocalPort'] = 8100 + Math.floor(Math.random() * 100);
      // 기존 WDA를 최대한 재사용 (빌드 회피)
      capabilities['appium:shouldUseSingletonTestManager'] = false;
      // 실제 디바이스 연결 안정화
      capabilities['appium:waitForQuiescence'] = false;
      capabilities['appium:skipLogCapture'] = true;
    }

    // Derived Data 경로 설정 (선택사항)
    if (process.env.DERIVED_DATA_PATH) {
      capabilities['appium:derivedDataPath'] = process.env.DERIVED_DATA_PATH;
    }

    if (bundleId) {
      capabilities['appium:bundleId'] = bundleId;
    }

    // 세션 생성 타임아웃 (WDA 시작 대기 시간 고려)
    const sessionTimeout = 300000; // 5분

    // WDA 에러 판별 함수
    const isWDAError = (msg: string) =>
      msg.includes('xcodebuild failed') ||
      msg.includes('WebDriverAgent') ||
      msg.includes('socket hang up') ||
      msg.includes('Could not proxy') ||
      msg.includes('invalid code signature') ||
      msg.includes('not been explicitly trusted');

    // WDA 신뢰 에러 판별 (사용자가 디바이스에서 WDA 앱 신뢰 필요)
    const isTrustError = (msg: string) =>
      msg.includes('invalid code signature') ||
      msg.includes('not been explicitly trusted') ||
      msg.includes('untrusted developer');

    // ── 1차 시도: usePrebuiltWDA ──
    try {
      this.sessionId = await createAppiumSession(this.appiumServerUrl, capabilities, sessionTimeout);
      return;
    } catch (error: any) {
      const errorMsg = error.message || '';
      if (!isWDAError(errorMsg)) throw error;

      console.warn('[WARN]  미리 빌드된 WDA 사용 실패. 원인 분석 후 재시도합니다...');
      console.warn(`   (원인: ${errorMsg.substring(0, 200)})`);

      // ── Trust 에러: 사용자가 디바이스에서 WDA 신뢰할 때까지 대기 ──
      if (isTrustError(errorMsg) && isRealDevice) {
        console.log('[iOS] WDA 앱이 디바이스에서 신뢰되지 않았습니다.');
        console.log('[iOS] 디바이스에서: 설정 → 일반 → VPN 및 디바이스 관리 → 개발자 앱 신뢰');
        console.log('[iOS] 신뢰 완료 후 자동 재시도합니다 (최대 60초 대기)...');

        // 60초 동안 5초 간격으로 재시도
        const trustWaitStart = Date.now();
        const trustTimeout = 60000;
        while (Date.now() - trustWaitStart < trustTimeout) {
          await new Promise(r => setTimeout(r, 5000));
          try {
            this.sessionId = await createAppiumSession(this.appiumServerUrl, capabilities, sessionTimeout);
            console.log('[iOS] WDA 신뢰 확인 — 세션 생성 성공');
            return;
          } catch (retryErr: any) {
            if (isTrustError(retryErr.message || '')) {
              const elapsed = Math.round((Date.now() - trustWaitStart) / 1000);
              console.log(`[iOS] 아직 신뢰되지 않음 (${elapsed}초 경과)... 계속 대기 중`);
              continue;
            }
            // Trust 이외의 에러면 break하고 다음 단계로
            break;
          }
        }
      }
    }

    // ── 2차 시도 전: WDA 모듈 캐시 정리 ──
    await this.cleanWDADerivedData();

    if (!teamId && isRealDevice) {
      throw new Error(
        'WebDriverAgent 세션 생성에 실패했습니다.\n' +
        '실제 iOS 디바이스를 사용하려면 다음 설정이 필요합니다:\n\n' +
        '  1. Xcode에서 Apple 계정 로그인\n' +
        '  2. 환경 변수 설정:\n' +
        '     export XCODE_ORG_ID="YOUR_TEAM_ID"\n' +
        '     (Team ID는 Xcode > Settings > Accounts에서 확인)\n\n' +
        '  3. WebDriverAgent 수동 빌드:\n' +
        '     cd ~/.appium/node_modules/appium-xcuitest-driver/node_modules/appium-webdriveragent\n' +
        '     xcodebuild build-for-testing -project WebDriverAgent.xcodeproj \\\n' +
        '       -scheme WebDriverAgentRunner -destination "id=<UDID>" \\\n' +
        '       -allowProvisioningUpdates\n\n' +
        '  4. iOS 디바이스에서 WDA 앱 신뢰:\n' +
        '     설정 → 일반 → VPN 및 디바이스 관리 → 개발자 앱 신뢰\n\n' +
        '  참고: https://appium.github.io/appium-xcuitest-driver/latest/preparation/real-device-config/\n\n' +
        `원본 에러: WDA session creation failed`
      );
    }

    // ── 2차 시도: xcodebuild (클린 빌드) ──
    console.log('[iOS] WDA 캐시 정리 완료. xcodebuild로 클린 빌드 시도...');
    capabilities['appium:usePrebuiltWDA'] = false;
    capabilities['appium:useSimpleBuildTest'] = false;
    capabilities['appium:showXcodeLog'] = true;

    try {
      this.sessionId = await createAppiumSession(this.appiumServerUrl, capabilities, sessionTimeout);
    } catch (error: any) {
      const errorMsg = error.message || '';

      // xcodebuild도 실패하면 모듈 캐시 완전 삭제 후 마지막 시도
      if (errorMsg.includes('module file') && errorMsg.includes('not found') ||
          errorMsg.includes('pcm') || errorMsg.includes('xcodebuild failed')) {
        console.warn('[iOS] xcodebuild 실패. 전체 derived data 삭제 후 최종 시도...');
        await this.cleanWDADerivedData(true); // 전체 삭제
        this.sessionId = await createAppiumSession(this.appiumServerUrl, capabilities, sessionTimeout);
      } else {
        throw error;
      }
    }
  }

  /**
   * macOS 키체인/프로비저닝 프로파일에서 Team ID를 자동 탐지한다.
   */
  private async detectTeamId(): Promise<string> {
    try {
      const { execSync } = await import('child_process');
      // security 명령으로 코드 서명 인증서에서 Team ID 추출
      const output = execSync(
        'security find-identity -v -p codesigning 2>/dev/null | head -5',
        { encoding: 'utf-8', timeout: 5000 }
      );
      // "Apple Development: name@email.com (TEAM_ID)" 패턴에서 Team ID 추출
      const match = output.match(/\(([A-Z0-9]{10})\)/);
      if (match) {
        console.log(`[OK] Team ID 자동 감지: ${match[1]}`);
        return match[1];
      }
    } catch { /* ignore */ }
    return '';
  }

  /**
   * 디바이스 사전 준비: USB 연결 확인 → lockdown 신뢰 확인
   * 새 디바이스를 연결했을 때 "이 컴퓨터를 신뢰하시겠습니까?" 수락까지 대기
   */
  private async prepareDevice(): Promise<void> {
    const { waitForIOSDevice, isDeviceLockdownReady, waitForDeviceTrust } = await import('../ios/device');

    // Step 1: USB 물리 연결 확인 (최대 15초 대기)
    console.log(`[iOS] 디바이스 연결 확인 중: ${this.udid}`);
    const usbConnected = await waitForIOSDevice(this.udid, 15000, 2000);
    if (!usbConnected) {
      throw new Error(
        `iOS 디바이스를 찾을 수 없습니다: ${this.udid}\n` +
        '1. USB 케이블이 올바르게 연결되어 있는지 확인\n' +
        '2. 디바이스가 잠금 해제되어 있는지 확인\n' +
        '3. 다른 USB 포트에 연결 시도\n' +
        '4. idevice_id -l 명령어로 디바이스 목록 확인'
      );
    }

    // Step 2: lockdown 서비스 확인 (디바이스 신뢰 상태)
    const lockdownReady = await isDeviceLockdownReady(this.udid);
    if (!lockdownReady) {
      console.log('[iOS] 디바이스 lockdown 서비스 미응답 — 신뢰 대기 중...');
      const trusted = await waitForDeviceTrust(this.udid, 60000, 3000);
      if (!trusted) {
        throw new Error(
          `iOS 디바이스 신뢰가 필요합니다: ${this.udid}\n` +
          '디바이스 화면에서 "이 컴퓨터를 신뢰하시겠습니까?" 팝업을 수락해주세요.\n' +
          '팝업이 나타나지 않으면:\n' +
          '  1. USB 케이블을 뽑았다가 다시 연결\n' +
          '  2. 디바이스를 잠금 해제한 상태에서 연결\n' +
          '  3. 설정 → 일반 → 전송 또는 iPhone 재설정 → 위치 및 개인 정보 보호 재설정'
        );
      }
    }

    console.log(`[iOS] 디바이스 준비 완료: ${this.udid}`);
  }

  /**
   * WDA Derived Data 캐시 정리
   * 오래된 .pcm (precompiled module) 파일이 빌드 실패를 유발하는 것을 방지
   * @param fullClean true이면 전체 derived data 삭제, false이면 ExplicitPrecompiledModules만
   */
  private async cleanWDADerivedData(fullClean: boolean = false): Promise<void> {
    const { rm } = await import('fs/promises');

    // DERIVED_DATA_PATH가 설정된 경우 해당 경로, 아니면 기본 /tmp/katab-wda 사용
    const derivedDataPath = process.env.DERIVED_DATA_PATH || '/tmp/katab-wda';

    try {
      const { existsSync } = await import('fs');
      if (!existsSync(derivedDataPath)) {
        return; // 경로가 없으면 정리할 것도 없음
      }

      if (fullClean) {
        // 전체 Derived Data 삭제 (완전 클린 빌드)
        console.log(`[iOS] WDA Derived Data 전체 삭제: ${derivedDataPath}`);
        await rm(derivedDataPath, { recursive: true, force: true });
      } else {
        // ExplicitPrecompiledModules만 삭제 (stale .pcm 파일 제거)
        const pcmDir = `${derivedDataPath}/Build/Intermediates.noindex/ExplicitPrecompiledModules`;
        if (existsSync(pcmDir)) {
          console.log(`[iOS] WDA 모듈 캐시 삭제: ${pcmDir}`);
          await rm(pcmDir, { recursive: true, force: true });
        }

        // ModuleCache도 삭제 (오래된 모듈 정의 캐시)
        const moduleCache = `${derivedDataPath}/ModuleCache.noindex`;
        if (existsSync(moduleCache)) {
          console.log(`[iOS] WDA ModuleCache 삭제: ${moduleCache}`);
          await rm(moduleCache, { recursive: true, force: true });
        }
      }
    } catch (err: any) {
      // 정리 실패는 치명적이지 않으므로 경고만
      console.warn(`[iOS] WDA 캐시 정리 실패 (비치명적): ${err.message}`);
    }
  }

  /**
   * Appium 세션 종료
   */
  async closeSession(): Promise<void> {
    if (this.sessionId) {
      const { deleteAppiumSession } = await import('../appium/server');
      await deleteAppiumSession(this.appiumServerUrl, this.sessionId);
      this.sessionId = null;
    }
  }

  /**
   * 세션이 없으면 생성
   */
  private async ensureSession(): Promise<void> {
    if (!this.sessionId) {
      await this.createSession();
    }
  }

  /**
   * WDA(WebDriverAgent)가 응답하는지 확인
   */
  private async isWDAAlive(): Promise<boolean> {
    if (!this.sessionId) return false;
    try {
      const { executeAppiumAction } = await import('../appium/server');
      await executeAppiumAction(this.appiumServerUrl, this.sessionId, 'window/size', {});
      return true;
    } catch {
      return false;
    }
  }

  /**
   * WDA 연결 끊김 등 네트워크 에러인지 판별
   */
  private isWDADisconnectError(msg: string): boolean {
    return msg.includes('ECONNREFUSED') ||
      msg.includes('Could not proxy') ||
      msg.includes('socket hang up') ||
      msg.includes('ECONNRESET') ||
      msg.includes('fetch failed');
  }

  /**
   * WDA 연결 끊김 시 세션 복구 시도
   * 주의: 앱 상태가 유지되지 않을 수 있음
   */
  private async recoverSession(): Promise<boolean> {
    console.log('[IOSController] WDA 세션 복구 시도...');
    const oldSession = this.sessionId;
    this.sessionId = null;

    // 기존 세션 정리
    if (oldSession) {
      try {
        const { deleteAppiumSession } = await import('../appium/server');
        await deleteAppiumSession(this.appiumServerUrl, oldSession);
      } catch { /* ignore */ }
    }

    // WDA 모듈 캐시 정리 (stale 캐시로 인한 복구 실패 방지)
    await this.cleanWDADerivedData();

    try {
      await this.createSession();
      console.log('[IOSController] [OK] WDA 세션 복구 성공');
      return true;
    } catch (err: any) {
      console.error('[IOSController] WDA 세션 복구 실패:', err.message?.substring(0, 200));
      return false;
    }
  }

  /**
   * Page Source(XML) 가져오기
   * UI 트리 스냅샷 캡처 및 assertion 평가에 사용
   */
  async getPageSource(): Promise<string | null> {
    await this.ensureSession();
    if (!this.sessionId) return null;

    const { executeAppiumAction } = await import('../appium/server');
    try {
      const result = await executeAppiumAction(
        this.appiumServerUrl,
        this.sessionId,
        'source',
        {}
      );
      const sourceStr = typeof result === 'string'
        ? result
        : (result?.value || '');
      return typeof sourceStr === 'string' ? sourceStr : null;
    } catch {
      return null;
    }
  }

  /**
   * 좌표로 요소 찾기 (XCUIElement)
   */
  async findElementAtCoordinates(x: number, y: number): Promise<any> {
    await this.ensureSession();
    if (!this.sessionId) throw new Error('Session not created');

    try {
      const sourceStr = await this.getPageSource();
      if (!sourceStr) {
        return null;
      }

      // XCUIElement XML 파싱하여 좌표에 해당하는 요소 찾기
      // 다양한 bounds 형식 지원: {{x, y}, {width, height}} 또는 {x, y, width, height}
      const boundsPatterns = [
        // 형식 1: bounds="{{100, 200}, {50, 30}}"
        /XCUIElementType(\w+)[^>]*bounds="\{?\{?([0-9.]+),\s*([0-9.]+)\}?,\s*\{?([0-9.]+),\s*([0-9.]+)\}?\}?"[^>]*>/g,
        // 형식 2: bounds="{100, 200, 50, 30}"
        /XCUIElementType(\w+)[^>]*bounds="\{([0-9.]+),\s*([0-9.]+),\s*([0-9.]+),\s*([0-9.]+)\}"[^>]*>/g,
      ];

      const elements: Array<{
        type: string;
        x: number;
        y: number;
        width: number;
        height: number;
        label?: string;
        value?: string;
        name?: string;
        accessibilityId?: string;
        enabled?: boolean;
        visible?: boolean;
        fullMatch: string;
        matchIndex: number;
      }> = [];

      // 각 패턴으로 요소 찾기
      for (let patternIndex = 0; patternIndex < boundsPatterns.length; patternIndex++) {
        const pattern = boundsPatterns[patternIndex];
        let match;

        while ((match = pattern.exec(sourceStr)) !== null) {
          const elementType = match[1];
          let elemX: number, elemY: number, elemWidth: number, elemHeight: number;

          if (patternIndex === 0) {
            // 형식 1: {{x, y}, {width, height}}
            elemX = parseFloat(match[2]);
            elemY = parseFloat(match[3]);
            elemWidth = parseFloat(match[4]);
            elemHeight = parseFloat(match[5]);
          } else {
            // 형식 2: {x, y, width, height}
            elemX = parseFloat(match[2]);
            elemY = parseFloat(match[3]);
            elemWidth = parseFloat(match[4]);
            elemHeight = parseFloat(match[5]);
          }

          // 좌표가 요소의 bounds 안에 있는지 확인
          if (x >= elemX && x <= elemX + elemWidth && y >= elemY && y <= elemY + elemHeight) {
            // 요소의 추가 정보 추출
            const fullMatch = match[0];
            const labelMatch = fullMatch.match(/label="([^"]*)"/);
            const valueMatch = fullMatch.match(/value="([^"]*)"/);
            const nameMatch = fullMatch.match(/name="([^"]*)"/);
            const accessibilityIdMatch = fullMatch.match(/accessibilityId="([^"]*)"/);
            const enabledMatch = fullMatch.match(/enabled="([^"]*)"/);
            const visibleMatch = fullMatch.match(/visible="([^"]*)"/);

            elements.push({
              type: elementType,
              x: elemX,
              y: elemY,
              width: elemWidth,
              height: elemHeight,
              label: labelMatch ? decodeXmlAttr(labelMatch[1]) : undefined,
              value: valueMatch ? decodeXmlAttr(valueMatch[1]) : undefined,
              name: nameMatch ? decodeXmlAttr(nameMatch[1]) : undefined,
              accessibilityId: accessibilityIdMatch ? decodeXmlAttr(accessibilityIdMatch[1]) : undefined,
              enabled: enabledMatch ? enabledMatch[1] === 'true' : undefined,
              visible: visibleMatch ? visibleMatch[1] === 'true' : undefined,
              fullMatch,
              matchIndex: match.index || 0,
            });
          }
        }
      }

      // 형식 3: 개별 속성 x="..." y="..." width="..." height="..." (일부 WDA 버전)
      // bounds 패턴에 매칭되지 않은 요소를 추가로 탐색
      if (elements.length === 0) {
        const elementPattern = /XCUIElementType(\w+)([^>]*)>/g;
        let elMatch;
        while ((elMatch = elementPattern.exec(sourceStr)) !== null) {
          const elementType = elMatch[1];
          const attrs = elMatch[2];
          // bounds 속성이 있으면 이미 처리됨 → 스킵
          if (/bounds="/.test(attrs)) continue;
          const xM = attrs.match(/\bx="([0-9.]+)"/);
          const yM = attrs.match(/\by="([0-9.]+)"/);
          const wM = attrs.match(/\bwidth="([0-9.]+)"/);
          const hM = attrs.match(/\bheight="([0-9.]+)"/);
          if (!xM || !yM || !wM || !hM) continue;

          const elemX = parseFloat(xM[1]);
          const elemY = parseFloat(yM[1]);
          const elemWidth = parseFloat(wM[1]);
          const elemHeight = parseFloat(hM[1]);
          if (elemWidth === 0 && elemHeight === 0) continue;

          if (x >= elemX && x <= elemX + elemWidth && y >= elemY && y <= elemY + elemHeight) {
            const fullMatch = elMatch[0];
            const labelMatch = fullMatch.match(/label="([^"]*)"/);
            const valueMatch = fullMatch.match(/value="([^"]*)"/);
            const nameMatch = fullMatch.match(/name="([^"]*)"/);
            const accessibilityIdMatch = fullMatch.match(/accessibilityId="([^"]*)"/);
            const enabledMatch = fullMatch.match(/enabled="([^"]*)"/);
            const visibleMatch = fullMatch.match(/visible="([^"]*)"/);

            elements.push({
              type: elementType,
              x: elemX,
              y: elemY,
              width: elemWidth,
              height: elemHeight,
              label: labelMatch ? decodeXmlAttr(labelMatch[1]) : undefined,
              value: valueMatch ? decodeXmlAttr(valueMatch[1]) : undefined,
              name: nameMatch ? decodeXmlAttr(nameMatch[1]) : undefined,
              accessibilityId: accessibilityIdMatch ? decodeXmlAttr(accessibilityIdMatch[1]) : undefined,
              enabled: enabledMatch ? enabledMatch[1] === 'true' : undefined,
              visible: visibleMatch ? visibleMatch[1] === 'true' : undefined,
              fullMatch,
              matchIndex: elMatch.index || 0,
            });
          }
        }
      }

      // 가장 적합한 요소 선택
      if (elements.length > 0) {
        // 1. 클릭 가능한 요소 타입 우선
        const clickableTypes = ['Button', 'Cell', 'StaticText', 'Image', 'TextField', 'SecureTextField', 'Other'];
        const clickableElements = elements.filter(e => clickableTypes.includes(e.type));
        
        if (clickableElements.length > 0) {
          // 2. enabled이고 visible인 요소 우선
          const enabledVisible = clickableElements.filter(e => e.enabled !== false && e.visible !== false);
          const candidates = enabledVisible.length > 0 ? enabledVisible : clickableElements;
          
          // 3. label이나 name이 있는 요소 우선 (더 정확한 선택자 생성 가능)
          const withIdentifier = candidates.filter(e => e.label || e.name || e.accessibilityId);
          const finalCandidates = withIdentifier.length > 0 ? withIdentifier : candidates;
          
          // 4. 가장 작은 영역을 가진 요소 선택 (더 정확함)
          return finalCandidates.reduce((smallest, current) => {
            const smallestArea = smallest.width * smallest.height;
            const currentArea = current.width * current.height;
            return currentArea < smallestArea ? current : smallest;
          });
        }

        // 클릭 가능한 요소가 없으면 가장 작은 요소 선택
        return elements.reduce((smallest, current) => {
          const smallestArea = smallest.width * smallest.height;
          const currentArea = current.width * current.height;
          return currentArea < smallestArea ? current : smallest;
        });
      }

      return null;
    } catch (error) {
      console.error('Failed to find element at coordinates:', error);
      return null;
    }
  }

  /**
   * 요소로 직접 클릭 (가장 정확함)
   */
  async tapElement(element: any): Promise<void> {
    await this.ensureSession();
    if (!this.sessionId) throw new Error('Session not created');

    const { executeAppiumAction } = await import('../appium/server');
    
    // 요소 선택자로 찾아서 클릭
    try {
      if (element.accessibilityId) {
        // accessibility id로 찾기
        const elementResponse = await executeAppiumAction(
          this.appiumServerUrl,
          this.sessionId,
          'element',
          { using: 'id', value: element.accessibilityId }
        );
        const elementId = elementResponse.value?.ELEMENT || elementResponse.value?.elementId;
        if (elementId) {
          await executeAppiumAction(
            this.appiumServerUrl,
            this.sessionId,
            `element/${elementId}/click`,
            {}
          );
          return;
        }
      }
      
      if (element.label) {
        // XPath로 label 찾기
        const xpath = `//XCUIElementType${element.type || '*'}[@label='${element.label.replace(/'/g, "\\'")}']`;
        const elementResponse = await executeAppiumAction(
          this.appiumServerUrl,
          this.sessionId,
          'element',
          { using: 'xpath', value: xpath }
        );
        const elementId = elementResponse.value?.ELEMENT || elementResponse.value?.elementId;
        if (elementId) {
          await executeAppiumAction(
            this.appiumServerUrl,
            this.sessionId,
            `element/${elementId}/click`,
            {}
          );
          return;
        }
      }
      
      if (element.name) {
        // XPath로 name 찾기
        const xpath = `//XCUIElementType${element.type || '*'}[@name='${element.name.replace(/'/g, "\\'")}']`;
        const elementResponse = await executeAppiumAction(
          this.appiumServerUrl,
          this.sessionId,
          'element',
          { using: 'xpath', value: xpath }
        );
        const elementId = elementResponse.value?.ELEMENT || elementResponse.value?.elementId;
        if (elementId) {
    await executeAppiumAction(
      this.appiumServerUrl,
      this.sessionId,
            `element/${elementId}/click`,
            {}
          );
          return;
        }
      }
    } catch (error) {
      // 요소 기반 클릭 실패 시 좌표로 fallback
      console.warn('Element-based click failed, falling back to coordinates:', error);
    }
    
    // Fallback: 좌표로 클릭
    const centerX = Math.round(element.bounds.x + element.bounds.width / 2);
    const centerY = Math.round(element.bounds.y + element.bounds.height / 2);
    await this.tapAtCoordinates(centerX, centerY);
  }

  /**
   * 좌표로 탭 - W3C Actions로 직접 터치 이벤트 시뮬레이션 (손가락으로 화면 터치하는 것처럼)
   * WDA 연결 끊김 시 최대 2회 재시도 (3초, 6초 대기)
   */
  async tapAtCoordinates(x: number, y: number): Promise<void> {
    await this.ensureSession();
    if (!this.sessionId) throw new Error('Session not created');

    // 좌표 오프셋 적용
    const offsetX = this.options.coordinateOffset?.x || 0;
    const offsetY = this.options.coordinateOffset?.y || 0;
    const roundedX = Math.round(x + offsetX);
    const roundedY = Math.round(y + offsetY);

    console.log(`[IOSController] Tapping at coordinates: (${roundedX}, ${roundedY}) [original: (${x}, ${y}), offset: (${offsetX}, ${offsetY})]`);

    const { executeAppiumAction } = await import('../appium/server');
    const maxRetries = 2;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        await executeAppiumAction(
          this.appiumServerUrl,
          this.sessionId!,
          'actions',
          {
            actions: [{
              type: 'pointer',
              id: 'finger1',
              parameters: { pointerType: 'touch' },
              actions: [
                {
                  type: 'pointerMove',
                  duration: 0,
                  origin: 'viewport',
                  x: roundedX,
                  y: roundedY
                },
                { type: 'pointerDown', button: 0 },
                { type: 'pause', duration: 50 },
                { type: 'pointerUp', button: 0 }
              ]
            }]
          }
        );
        console.log(`[IOSController] [OK] W3C Actions tap succeeded at (${roundedX}, ${roundedY})`);
        return;
      } catch (error: any) {
        const isDisconnect = this.isWDADisconnectError(error.message || '');

        if (isDisconnect && attempt < maxRetries) {
          const delay = (attempt + 1) * 3000;
          console.warn(`[IOSController] [WARN] WDA 연결 끊김, ${delay / 1000}초 후 재시도 (${attempt + 1}/${maxRetries})...`);
          await new Promise(r => setTimeout(r, delay));

          // WDA가 자체적으로 복구되었는지 확인
          const alive = await this.isWDAAlive();
          if (!alive) {
            console.warn('[IOSController] WDA 응답 없음, 세션 재생성 시도...');
            const recovered = await this.recoverSession();
            if (!recovered) {
              console.error('[IOSController] WDA 세션 복구 실패');
              throw new Error(`WDA disconnected and recovery failed: ${error.message}`);
            }
          }
          continue;
        }

        console.error(`[IOSController] W3C Actions tap failed:`, error);
        throw new Error(`Failed to tap: ${error.message}`);
      }
    }
  }

  /**
   * 화면 탭 (클릭) - 좌표 기반 직접 터치 (미러링 화면에 손가락 갖다 대는 것처럼)
   * 요소 찾기 없이 바로 좌표로 터치하여 빠르고 정확하게 동작
   */
  async tap(x: number, y: number): Promise<{ element?: any; coordinates: { x: number; y: number } }> {
    await this.ensureSession();
    if (!this.sessionId) throw new Error('Session not created');

    // 좌표 기반 직접 터치 (요소 찾기 생략하여 빠르게)
    await this.tapAtCoordinates(x, y);

    return {
      coordinates: { x, y },
    };
  }

  /**
   * 스크롤 - W3C Actions로 직접 스와이프 (스크롤도 스와이프로 처리)
   */
  async scroll(options: SwipeOptions): Promise<{ 
    fromElement?: any; 
    toElement?: any; 
    coordinates: { from: { x: number; y: number }; to: { x: number; y: number } } 
  }> {
    // 스크롤도 스와이프로 처리 (동일한 동작)
    return this.swipe(options);
  }

  /**
   * 스와이프 - W3C Actions로 직접 터치 드래그 시뮬레이션 (손가락으로 화면을 드래그하는 것처럼)
   */
  async swipe(options: SwipeOptions): Promise<{ 
    fromElement?: any; 
    toElement?: any; 
    coordinates: { from: { x: number; y: number }; to: { x: number; y: number } } 
  }> {
    await this.ensureSession();
    if (!this.sessionId) throw new Error('Session not created');

    const { from, to, duration = 300 } = options;

    // 좌표 오프셋 적용
    const offsetX = this.options.coordinateOffset?.x || 0;
    const offsetY = this.options.coordinateOffset?.y || 0;
    
    const fromX = Math.round(from.x + offsetX);
    const fromY = Math.round(from.y + offsetY);
    const toX = Math.round(to.x + offsetX);
    const toY = Math.round(to.y + offsetY);

    // W3C Actions로 직접 터치 드래그 시뮬레이션
    const { executeAppiumAction } = await import('../appium/server');
    const maxRetries = 2;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const moveDuration = Math.max(duration, 100);
        const steps = Math.max(Math.floor(moveDuration / 10), 5);
        const stepDuration = moveDuration / steps;

        await executeAppiumAction(
          this.appiumServerUrl,
          this.sessionId!,
          'actions',
          {
            actions: [{
              type: 'pointer',
              id: 'finger1',
              parameters: { pointerType: 'touch' },
              actions: [
                {
                  type: 'pointerMove',
                  duration: 0,
                  origin: 'viewport',
                  x: fromX,
                  y: fromY
                },
                { type: 'pointerDown', button: 0 },
                ...Array.from({ length: steps }, (_, i) => {
                  const progress = (i + 1) / steps;
                  const x = Math.round(fromX + (toX - fromX) * progress);
                  const y = Math.round(fromY + (toY - fromY) * progress);
                  return {
                    type: 'pointerMove',
                    duration: stepDuration,
                    origin: 'viewport',
                    x,
                    y
                  };
                }),
                { type: 'pointerUp', button: 0 }
              ]
            }]
          }
        );
        console.log(`[IOSController] [OK] W3C Actions swipe succeeded from (${fromX}, ${fromY}) to (${toX}, ${toY})`);
        break;
      } catch (error: any) {
        const isDisconnect = this.isWDADisconnectError(error.message || '');

        if (isDisconnect && attempt < maxRetries) {
          const delay = (attempt + 1) * 3000;
          console.warn(`[IOSController] [WARN] WDA 연결 끊김 (swipe), ${delay / 1000}초 후 재시도 (${attempt + 1}/${maxRetries})...`);
          await new Promise(r => setTimeout(r, delay));

          const alive = await this.isWDAAlive();
          if (!alive) {
            console.warn('[IOSController] WDA 응답 없음, 세션 재생성 시도...');
            const recovered = await this.recoverSession();
            if (!recovered) {
              throw new Error(`WDA disconnected and recovery failed: ${error.message}`);
            }
          }
          continue;
        }

        console.error(`[IOSController] W3C Actions swipe failed:`, error);
        throw new Error(`Failed to swipe: ${error.message}`);
      }
    }

    return {
      coordinates: { from: { x: fromX, y: fromY }, to: { x: toX, y: toY } },
    };
  }

  /**
   * 텍스트 입력 - TextField를 찾아서 입력 (검증+재시도 포함)
   *
   * OTP/코드 입력 패턴(한 칸에 한 문자씩 개별 TextField)을 자동 감지하여
   * W3C 키보드 시뮬레이션으로 한 글자씩 입력한다.
   */
  async type(text: string): Promise<void> {
    await this.ensureSession();
    if (!this.sessionId) throw new Error('Session not created');

    const { executeAppiumAction } = await import('../appium/server');

    const MAX_RETRIES = 3;
    const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

    // ── 헬퍼: Page Source에서 visible TextField 정보 분석 ──
    interface TextFieldInfo {
      xml: string;
      x: number; y: number; width: number; height: number;
      enabled: boolean; visible: boolean;
      label: string; name: string; accessibilityId: string;
    }

    const analyzeTextFields = async (): Promise<TextFieldInfo[]> => {
      try {
        const sourceStr = await this.getPageSource();
        if (!sourceStr) return [];

        const textFieldPattern = /XCUIElementType(?:TextField|SecureTextField)[^>]*>/g;
        const matches = Array.from(sourceStr.matchAll(textFieldPattern));

        return matches.map(m => {
          const s = m[0];
          const attr = (name: string) => {
            const match = s.match(new RegExp(name + '="([^"]*)"'));
            return match ? match[1] : '';
          };
          return {
            xml: s,
            x: parseInt(attr('x')) || 0,
            y: parseInt(attr('y')) || 0,
            width: parseInt(attr('width')) || 0,
            height: parseInt(attr('height')) || 0,
            enabled: attr('enabled') !== 'false',
            visible: attr('visible') !== 'false',
            label: attr('label'),
            name: attr('name'),
            accessibilityId: attr('accessibilityId'),
          };
        }).filter(f => f.enabled && f.visible);
      } catch {
        return [];
      }
    };

    // ── 헬퍼: OTP/코드 입력 패턴 감지 ──
    // 동일 y 좌표, 유사 크기의 TextField가 text.length 개 이상 → 개별 문자 입력 필드
    const isMultiFieldInput = (fields: TextFieldInfo[]): boolean => {
      if (fields.length < 2 || fields.length < text.length) return false;

      // 같은 y 좌표(±5px) 그룹 찾기
      const yGroups = new Map<number, TextFieldInfo[]>();
      for (const f of fields) {
        const yKey = Math.round(f.y / 5) * 5; // 5px 단위로 그룹화
        if (!yGroups.has(yKey)) yGroups.set(yKey, []);
        yGroups.get(yKey)!.push(f);
      }

      // text.length 이상인 그룹이 있으면 multi-field
      for (const group of yGroups.values()) {
        if (group.length >= text.length) {
          // 추가 검증: 크기가 유사하고(너비 차이 ≤10px), x 좌표로 정렬되어 있는지
          const widths = group.map(f => f.width);
          const minW = Math.min(...widths);
          const maxW = Math.max(...widths);
          if (maxW - minW <= 10) {
            console.log(`[IOSController] 🔢 Multi-field input detected: ${group.length} fields for ${text.length} chars`);
            return true;
          }
        }
      }
      return false;
    };

    // ── 헬퍼: elementId 찾기 (첫 번째 visible TextField) ──
    const findElementId = async (field: TextFieldInfo): Promise<string | null> => {
      if (field.accessibilityId) {
        try {
          const r = await executeAppiumAction(
            this.appiumServerUrl, this.sessionId!,
            'element', { using: 'id', value: field.accessibilityId }
          );
          const eid = r.value?.ELEMENT || r.value?.elementId || null;
          if (eid) return eid;
        } catch { /* next */ }
      }
      if (field.label) {
        try {
          const xpath = `//XCUIElementType*[@label='${field.label.replace(/'/g, "\\'")}']`;
          const r = await executeAppiumAction(
            this.appiumServerUrl, this.sessionId!,
            'element', { using: 'xpath', value: xpath }
          );
          const eid = r.value?.ELEMENT || r.value?.elementId || null;
          if (eid) return eid;
        } catch { /* next */ }
      }
      if (field.name) {
        try {
          const xpath = `//XCUIElementType*[@name='${field.name.replace(/'/g, "\\'")}']`;
          const r = await executeAppiumAction(
            this.appiumServerUrl, this.sessionId!,
            'element', { using: 'xpath', value: xpath }
          );
          const eid = r.value?.ELEMENT || r.value?.elementId || null;
          if (eid) return eid;
        } catch { /* next */ }
      }
      // 일반 XPath
      try {
        const xpath = '//XCUIElementTypeTextField | //XCUIElementTypeSecureTextField';
        const r = await executeAppiumAction(
          this.appiumServerUrl, this.sessionId!,
          'element', { using: 'xpath', value: xpath }
        );
        return r.value?.ELEMENT || r.value?.elementId || null;
      } catch { return null; }
    };

    // ── 헬퍼: W3C 키보드로 한 문자 입력 ──
    const typeOneChar = async (char: string): Promise<void> => {
      await executeAppiumAction(
        this.appiumServerUrl, this.sessionId!,
        'actions',
        {
          actions: [{
            type: 'key',
            id: 'keyboard',
            actions: [
              { type: 'keyDown', value: char },
              { type: 'keyUp', value: char },
            ],
          }]
        }
      );
    };

    // ── 헬퍼: 요소의 현재 값 읽기 ──
    const getElementValue = async (elementId: string): Promise<string | null> => {
      try {
        const resp = await executeAppiumAction(
          this.appiumServerUrl, this.sessionId!,
          `element/${elementId}/attribute/value`, {}
        );
        return resp.value ?? null;
      } catch { return null; }
    };

    // ── 헬퍼: 요소 클리어 ──
    const clearElement = async (elementId: string): Promise<void> => {
      try {
        await executeAppiumAction(
          this.appiumServerUrl, this.sessionId!,
          `element/${elementId}/clear`, {}
        );
      } catch { /* ignore */ }
    };

    // ═════════════════════════════════════════════════════
    // 메인 로직
    // ═════════════════════════════════════════════════════

    const fields = await analyzeTextFields();
    const multiField = isMultiFieldInput(fields);

    // ── 경로 A: Multi-field (OTP/코드 입력) ──
    // 한 칸에 한 문자, 앱이 자동으로 다음 필드로 포커스 이동
    // → 반드시 W3C 키보드 시뮬레이션으로 한 글자씩 입력해야 함
    if (multiField) {
      const MULTI_FIELD_CHAR_DELAY_MS = 150; // 자동 포커스 이동 대기

      for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        // 첫 번째 필드에 포커스 보장: 탭으로 클릭
        if (fields.length > 0) {
          const first = fields[0];
          const tapX = first.x + Math.round(first.width / 2);
          const tapY = first.y + Math.round(first.height / 2);
          try {
            await executeAppiumAction(
              this.appiumServerUrl, this.sessionId!,
              'actions',
              {
                actions: [{
                  type: 'pointer',
                  id: 'finger1',
                  parameters: { pointerType: 'touch' },
                  actions: [
                    { type: 'pointerMove', duration: 0, x: tapX, y: tapY },
                    { type: 'pointerDown', button: 0 },
                    { type: 'pause', duration: 100 },
                    { type: 'pointerUp', button: 0 },
                  ],
                }]
              }
            );
            await sleep(300); // 포커스 안정화 대기
          } catch (e) {
            console.debug('[IOSController] Tap on first field failed, continuing:', (e as Error).message?.substring(0, 80));
          }
        }

        // 한 글자씩 키보드로 입력
        let typedOk = true;
        for (let ci = 0; ci < text.length; ci++) {
          try {
            await typeOneChar(text[ci]);
            // 앱이 다음 필드로 자동 이동할 시간을 줌
            await sleep(MULTI_FIELD_CHAR_DELAY_MS);
          } catch (e) {
            console.warn(`[IOSController] [WARN] Multi-field char ${ci} ('${text[ci]}') failed:`, (e as Error).message?.substring(0, 80));
            typedOk = false;
            break;
          }
        }

        if (typedOk) {
          console.log(`[IOSController] [OK] Multi-field type completed (attempt ${attempt}): "${text}"`);
          return;
        }

        // 실패 시 재시도 전 대기
        if (attempt < MAX_RETRIES) {
          console.warn(`[IOSController] Multi-field attempt ${attempt} failed, retrying...`);
          await sleep(500);
        }
      }

      // 모든 시도 실패
      throw new Error(`Failed to type multi-field text "${text}" after ${MAX_RETRIES} attempts`);
    }

    // ── 경로 B: Single-field (일반 텍스트 입력) ──
    const SINGLE_FIELD_CHAR_DELAY_MS = 30;

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      const firstField = fields[0];
      const elementId = firstField ? await findElementId(firstField) : null;

      if (elementId) {
        if (attempt > 1) {
          await clearElement(elementId);
          await sleep(100);
        }

        // element/value API로 텍스트 전체 입력
        try {
          await executeAppiumAction(
            this.appiumServerUrl, this.sessionId!,
            `element/${elementId}/value`, { text }
          );
        } catch (e) {
          console.warn(`[IOSController] element/value failed:`, (e as Error).message?.substring(0, 80));
        }

        // 검증
        await sleep(100);
        const actualValue = await getElementValue(elementId);
        if (actualValue !== null) {
          if (actualValue === text) {
            console.log(`[IOSController] [OK] Single-field type verified (attempt ${attempt}): "${text}"`);
            return;
          }
          console.warn(`[IOSController] [WARN] Single-field mismatch (attempt ${attempt}): expected "${text}", got "${actualValue}"`);

          if (attempt < MAX_RETRIES) {
            await clearElement(elementId);
            await sleep(150);
            continue;
          }

          // 마지막 시도: clear 후 W3C char-by-char
          console.warn(`[IOSController] Last resort: W3C char-by-char for single-field`);
          await clearElement(elementId);
          await sleep(150);
          for (const char of text) {
            await typeOneChar(char);
            if (SINGLE_FIELD_CHAR_DELAY_MS > 0) await sleep(SINGLE_FIELD_CHAR_DELAY_MS);
          }
          return;
        }

        // 값을 읽을 수 없으면 (SecureTextField 등) 성공으로 간주
        console.log(`[IOSController] [OK] Single-field type completed (attempt ${attempt}, unverifiable): "${text}"`);
        return;
      }

      // elementId를 못 찾은 경우: W3C char-by-char
      console.debug(`[IOSController] No TextField found, using W3C char-by-char (attempt ${attempt})`);
      try {
        for (const char of text) {
          await typeOneChar(char);
          if (SINGLE_FIELD_CHAR_DELAY_MS > 0) await sleep(SINGLE_FIELD_CHAR_DELAY_MS);
        }
        console.log(`[IOSController] [OK] W3C char-by-char succeeded (attempt ${attempt})`);
        return;
      } catch (error: any) {
        if (attempt === MAX_RETRIES) {
          throw new Error(`Failed to type text after ${MAX_RETRIES} attempts: ${error.message}`);
        }
        console.warn(`[IOSController] W3C char-by-char failed (attempt ${attempt}):`, error.message?.substring(0, 100));
        await sleep(300);
      }
    }
  }

  /**
   * 화면 캡처 - Appium 표준 screenshot API 사용
   */
  async screenshot(): Promise<string> {
    await this.ensureSession();
    if (!this.sessionId) throw new Error('Session not created');

    const { executeAppiumAction } = await import('../appium/server');
    
    try {
      const result = await executeAppiumAction(
        this.appiumServerUrl,
        this.sessionId,
        'screenshot',
        {}
      );
    return result.value || '';
    } catch (error: any) {
      throw new Error(`Failed to capture screenshot: ${error.message}`);
    }
  }

  /**
   * 뒤로 가기 - Appium 표준 back 명령 사용
   */
  async back(): Promise<void> {
    await this.ensureSession();
    if (!this.sessionId) throw new Error('Session not created');

    const { executeAppiumAction } = await import('../appium/server');
    // Appium 표준 back 명령 사용
    await executeAppiumAction(
      this.appiumServerUrl,
      this.sessionId,
      'back',
      {}
    );
  }

  /**
   * 홈 버튼 - Appium 표준 mobile: pressButton 사용
   */
  async home(): Promise<void> {
    await this.ensureSession();
    if (!this.sessionId) throw new Error('Session not created');

    const { executeAppiumAction } = await import('../appium/server');
    
    // Appium 표준 mobile: pressButton 사용
    try {
      await executeAppiumAction(
        this.appiumServerUrl,
        this.sessionId,
        'execute_script',
        {
          script: 'mobile: pressButton',
          args: [{ name: 'home' }]
        }
      );
      console.log(`[IOSController] [OK] mobile: pressButton (home) succeeded`);
    } catch (error: any) {
      // mobile: pressButton 실패 시 mobile: deactivateApp로 fallback
      console.warn(`[IOSController] mobile: pressButton failed, trying deactivateApp:`, error.message);
      try {
        await executeAppiumAction(
          this.appiumServerUrl,
          this.sessionId,
          'execute_script',
          {
          script: 'mobile: deactivateApp',
            args: [{ seconds: 0.5 }]
          }
        );
        console.log(`[IOSController] [OK] mobile: deactivateApp succeeded`);
      } catch (deactivateError: any) {
        throw new Error(`Failed to press home button: ${deactivateError.message}`);
      }
    }
  }

  /**
   * 롱 프레스 - Appium 표준 mobile: touchAndHold 사용
   */
  async longPress(x: number, y: number, duration: number = 1000): Promise<void> {
    await this.ensureSession();
    if (!this.sessionId) throw new Error('Session not created');

    const offsetX = this.options.coordinateOffset?.x || 0;
    const offsetY = this.options.coordinateOffset?.y || 0;
    const roundedX = Math.round(x + offsetX);
    const roundedY = Math.round(y + offsetY);

    const { executeAppiumAction } = await import('../appium/server');
    
    // Appium 표준 mobile: touchAndHold 사용
    try {
    await executeAppiumAction(
      this.appiumServerUrl,
      this.sessionId,
        'execute_script',
        {
          script: 'mobile: touchAndHold',
          args: [{
            x: roundedX,
            y: roundedY,
            duration: duration / 1000 // 밀리초를 초로 변환
          }]
        }
      );
      console.log(`[IOSController] [OK] mobile: touchAndHold succeeded at (${roundedX}, ${roundedY})`);
    } catch (error: any) {
      console.error(`[IOSController] mobile: touchAndHold failed:`, error);
      throw new Error(`Failed to long press: ${error.message}`);
    }
  }

  /**
   * 앱 실행
   */
  async launchApp(bundleId: string): Promise<void> {
    await this.ensureSession();
    if (!this.sessionId) throw new Error('Session not created');

    const { executeAppiumAction } = await import('../appium/server');
    await executeAppiumAction(
      this.appiumServerUrl,
      this.sessionId,
      'appium/device/activate_app',
      { bundleId }
    );
  }

  /**
   * 앱 종료
   */
  async stopApp(bundleId: string): Promise<void> {
    await this.ensureSession();
    if (!this.sessionId) throw new Error('Session not created');

    const { executeAppiumAction } = await import('../appium/server');
    await executeAppiumAction(
      this.appiumServerUrl,
      this.sessionId,
      'appium/device/terminate_app',
      { bundleId }
    );
  }

  /**
   * 앱 캐시/데이터 초기화
   * mobile:clearApp으로 캐시 삭제, 실패 시 removeApp + relaunch fallback
   */
  async clearApp(bundleId: string): Promise<void> {
    await this.ensureSession();
    if (!this.sessionId) throw new Error('Session not created');

    const { executeAppiumAction } = await import('../appium/server');

    try { await this.stopApp(bundleId); } catch { /* 앱이 실행 중이 아닐 수 있음 */ }
    await new Promise(resolve => setTimeout(resolve, 1000));

    try {
      await executeAppiumAction(
        this.appiumServerUrl, this.sessionId,
        'execute_script',
        { script: 'mobile: clearApp', args: [{ bundleId }] }
      );
      console.log(`[IOSController] App cache cleared: ${bundleId}`);
    } catch (error: any) {
      console.warn(`[IOSController] mobile:clearApp failed: ${error.message}, trying removeApp fallback`);
      try {
        await executeAppiumAction(
          this.appiumServerUrl, this.sessionId,
          'execute_script',
          { script: 'mobile: removeApp', args: [{ bundleId }] }
        );
        await this.launchApp(bundleId);
      } catch (fallbackError: any) {
        throw new Error(`Failed to clear app: ${fallbackError.message}`);
      }
    }
  }

  /**
   * 뷰포트 크기 조회 (미러링 좌표 변환용)
   */
  async getWindowSize(): Promise<{ width: number; height: number }> {
    await this.ensureSession();
    if (!this.sessionId) throw new Error('Session not created');

    const { executeAppiumAction } = await import('../appium/server');

    // Appium 3.x: window/rect 사용 (window/size는 404)
    try {
      const result = await executeAppiumAction(
        this.appiumServerUrl, this.sessionId, 'window/rect', {}
      );
      const val = result.value || {};
      if (val.width && val.height) {
        return { width: val.width, height: val.height };
      }
    } catch {
      // window/rect 실패 시 window/size fallback (Appium 2.x)
      try {
        const result = await executeAppiumAction(
          this.appiumServerUrl, this.sessionId, 'window/size', {}
        );
        if (result.value) return result.value;
      } catch { /* both failed */ }
    }

    console.warn('[IOSController] getWindowSize: all methods failed, using default 390x844');
    return { width: 390, height: 844 };
  }

  /**
   * 시스템 알럿이 현재 표시 중인지 확인
   */
  async isAlertPresent(): Promise<boolean> {
    await this.ensureSession();
    if (!this.sessionId) return false;

    const { executeAppiumAction } = await import('../appium/server');
    try {
      await executeAppiumAction(this.appiumServerUrl, this.sessionId, 'alert/text', {});
      return true;
    } catch {
      return false;
    }
  }

  /**
   * 현재 표시 중인 알럿의 텍스트 반환
   */
  async getAlertText(): Promise<string | null> {
    await this.ensureSession();
    if (!this.sessionId) return null;

    const { executeAppiumAction } = await import('../appium/server');
    try {
      const result = await executeAppiumAction(this.appiumServerUrl, this.sessionId, 'alert/text', {});
      return result.value || null;
    } catch {
      return null;
    }
  }

  /**
   * 현재 알럿의 확인(Accept) 버튼 클릭
   */
  async acceptAlert(): Promise<void> {
    await this.ensureSession();
    if (!this.sessionId) throw new Error('Session not created');

    const { executeAppiumAction } = await import('../appium/server');
    await executeAppiumAction(this.appiumServerUrl, this.sessionId, 'alert/accept', {});
  }

  /**
   * 현재 알럿의 취소(Dismiss) 버튼 클릭
   */
  async dismissAlert(): Promise<void> {
    await this.ensureSession();
    if (!this.sessionId) throw new Error('Session not created');

    const { executeAppiumAction } = await import('../appium/server');
    await executeAppiumAction(this.appiumServerUrl, this.sessionId, 'alert/dismiss', {});
  }
}
