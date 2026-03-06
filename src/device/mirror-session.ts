/**
 * Mirror Session
 *
 * Provides real-time screen streaming + remote control for a single device.
 * Reuses the mirror-server pattern from Katab_Stack but operates as a
 * WebSocket session instead of a standalone HTTP server.
 *
 * Flow:
 *   1. Start Appium session (mobile) or Playwright context (web)
 *   2. Poll screenshots at configurable FPS
 *   3. Push frames to connected WebSocket clients
 *   4. Receive user actions (tap/swipe/type) and inject into device
 *   5. Optionally record events as Katab scenario steps
 */

import { EventEmitter } from 'events';
import { execSync } from 'child_process';
import { rmSync, existsSync } from 'fs';
import { enrichFromPageSource, type ElementMeta } from './page-source-utils';

export type SessionPlatform = 'ios' | 'android' | 'web';
export type SessionStatus = 'creating' | 'active' | 'recording' | 'closing' | 'closed' | 'error';

export interface MirrorSessionOptions {
  platform: SessionPlatform;
  deviceId: string;             // UDID or ADB serial (ignored for web)
  appiumUrl?: string;           // default http://localhost:4723
  bundleId?: string;            // iOS
  appPackage?: string;          // Android
  appActivity?: string;         // Android
  url?: string;                 // Web URL
  fps?: number;                 // screenshot polling FPS (default 2)
  maxWidth?: number;            // downscale for bandwidth (default 720)
}

export interface UserAction {
  type: 'tap' | 'swipe' | 'type' | 'key' | 'back' | 'home' | 'scroll' | 'longPress' | 'click' | 'keyboard';
  x?: number;
  y?: number;
  endX?: number;
  endY?: number;
  text?: string;
  key?: string;
  duration?: number;
  deltaX?: number;
  deltaY?: number;
  direction?: string;
}

export interface RecordedEvent {
  type: string;
  timestamp: number;
  x?: number;
  y?: number;
  endX?: number;
  endY?: number;
  text?: string;
  elementMeta?: ElementMeta;
}

export class MirrorSession extends EventEmitter {
  readonly id: string;
  status: SessionStatus = 'creating';
  platform: SessionPlatform;
  deviceId: string;
  createdAt: string;

  private appiumSessionId: string | null = null;
  private appiumUrl: string;
  private screenshotTimer: NodeJS.Timeout | null = null;
  private fps: number;
  private maxWidth: number;
  private recording = false;
  private recordedEvents: RecordedEvent[] = [];
  private options: MirrorSessionOptions;
  private screenSize = { width: 0, height: 0 };
  /** Scale factor: screenshot pixels → device logical coordinates */
  private coordScale = 1;
  private screenshotDetected = false;
  private pendingEnrich: Promise<void> | null = null;
  private lastPageSourceSnapshot: string | null = null;
  private snapshotBeforeTap: string | null = null;

  constructor(id: string, options: MirrorSessionOptions) {
    super();
    this.id = id;
    this.platform = options.platform;
    this.deviceId = options.deviceId;
    this.appiumUrl = options.appiumUrl || 'http://localhost:4723';
    this.fps = options.fps || 2;
    this.maxWidth = options.maxWidth || 720;
    this.createdAt = new Date().toISOString();
    this.options = options;
  }

  /**
   * Initialize the session: create Appium session or Playwright context.
   */
  async start(): Promise<void> {
    this.status = 'creating';
    this.emit('status', this.status);

    try {
      if (this.platform === 'ios') {
        await this.startIOSSession();
      } else if (this.platform === 'android') {
        await this.startAndroidSession();
      } else {
        // Web: no Appium needed, handled differently
        this.status = 'active';
        this.emit('status', this.status);
        return;
      }

      this.status = 'active';
      this.emit('status', this.status);

      // Start screenshot polling
      this.startScreenshotPolling();
    } catch (err: any) {
      this.status = 'error';
      this.emit('status', this.status);
      this.emit('error', err.message);
      throw err;
    }
  }

  private async startIOSSession(): Promise<void> {
    console.log(`[iOS] Creating Appium session for device ${this.deviceId}...`);
    console.log(`[iOS] Appium URL: ${this.appiumUrl}`);

    // Auto-detect Xcode Team ID from keychain (same as Katab_Stack)
    const teamId = process.env.XCODE_ORG_ID || this.detectTeamId();
    if (teamId) {
      console.log(`[iOS] Team ID: ${teamId}`);
    } else {
      console.warn(`[iOS] No Team ID found. Set XCODE_ORG_ID env var or install a signing identity.`);
    }

    const derivedDataPath = process.env.DERIVED_DATA_PATH || '/tmp/katab-wda-direct';

    const baseCaps: Record<string, any> = {
      platformName: 'iOS',
      'appium:deviceName': 'iPhone',
      'appium:automationName': 'XCUITest',
      'appium:udid': this.deviceId,
      'appium:noReset': true,
      'appium:newCommandTimeout': 600,
      'appium:useNewWDA': false,
      'appium:useSimpleBuildTest': true,
      // WDA startup timeouts (real devices need more time)
      'appium:wdaLaunchTimeout': 120000,
      'appium:wdaConnectionTimeout': 120000,
      'appium:wdaStartupRetries': 4,
      'appium:wdaStartupRetryInterval': 15000,
      // WDA local port — use fixed 8100 to avoid port conflicts
      'appium:wdaLocalPort': 8100,
      // Performance & stability
      'appium:waitForQuiescence': false,
      'appium:skipLogCapture': true,
      'appium:shouldUseSingletonTestManager': false,
      // Derived data path for WDA builds
      'appium:derivedDataPath': derivedDataPath,
      // Allow Xcode to auto-generate provisioning profiles
      'appium:allowProvisioningUpdates': true,
    };

    // Code signing — required for real devices
    if (teamId) {
      baseCaps['appium:xcodeOrgId'] = teamId;
    }
    baseCaps['appium:xcodeSigningId'] = process.env.XCODE_SIGNING_ID || 'Apple Development';

    // Custom WDA bundle ID — required to avoid com.facebook.* reservation conflict
    const wdaBundleId = process.env.IOS_WDA_BUNDLE_ID || process.env.WDA_BUNDLE_ID || 'com.katab.WebDriverAgentRunner';
    baseCaps['appium:updatedWDABundleId'] = wdaBundleId;
    baseCaps['appium:updatedWDABundleIdSuffix'] = '';

    // Pre-installed WDA URL
    if (process.env.IOS_WDA_URL) {
      baseCaps['appium:webDriverAgentUrl'] = process.env.IOS_WDA_URL;
    }

    if (this.options.bundleId) {
      baseCaps['appium:bundleId'] = this.options.bundleId;
    }

    // ── Attempt 1: Pre-built WDA (fast path) ──
    try {
      console.log(`[iOS] Attempt 1/3: using pre-built WDA...`);
      const caps1 = { ...baseCaps, 'appium:usePrebuiltWDA': true };
      this.appiumSessionId = await this.createAppiumSession(caps1, 300_000);
      console.log(`[iOS] Session created: ${this.appiumSessionId}`);
      await this.fetchScreenSize();
      return;
    } catch (err: any) {
      console.warn(`[iOS] Attempt 1 failed: ${err.message?.slice(0, 200)}`);
    }

    // ── Attempt 2: Clean WDA cache + rebuild from source ──
    try {
      console.log(`[iOS] Attempt 2/3: cleaning WDA cache and rebuilding...`);
      this.cleanWDADerivedData(derivedDataPath, false);
      const caps2 = {
        ...baseCaps,
        'appium:usePrebuiltWDA': false,
        'appium:useSimpleBuildTest': false,
        'appium:showXcodeLog': true,
      };
      this.appiumSessionId = await this.createAppiumSession(caps2, 300_000);
      console.log(`[iOS] Session created: ${this.appiumSessionId}`);
      await this.fetchScreenSize();
      return;
    } catch (err: any) {
      console.warn(`[iOS] Attempt 2 failed: ${err.message?.slice(0, 200)}`);
    }

    // ── Attempt 3: Full clean + fresh build ──
    console.log(`[iOS] Attempt 3/3: full clean derived data and fresh build...`);
    this.cleanWDADerivedData(derivedDataPath, true);
    const caps3 = {
      ...baseCaps,
      'appium:usePrebuiltWDA': false,
      'appium:useSimpleBuildTest': false,
      'appium:showXcodeLog': true,
    };
    this.appiumSessionId = await this.createAppiumSession(caps3, 300_000);
    console.log(`[iOS] Session created: ${this.appiumSessionId}`);
    await this.fetchScreenSize();
  }

  /**
   * Auto-detect Xcode Team ID from keychain (mirrors Katab_Stack).
   */
  private detectTeamId(): string {
    try {
      const output = execSync('security find-identity -v -p codesigning 2>/dev/null | head -5', {
        encoding: 'utf-8',
        timeout: 5000,
      });
      // Match exactly 10-char alphanumeric Team ID in parentheses
      const match = output.match(/\(([A-Z0-9]{10})\)/);
      return match?.[1] || '';
    } catch {
      return '';
    }
  }

  /**
   * Clean WDA derived data between retry attempts (mirrors Katab_Stack).
   */
  private cleanWDADerivedData(derivedDataPath: string, fullClean: boolean): void {
    try {
      if (fullClean) {
        if (existsSync(derivedDataPath)) {
          rmSync(derivedDataPath, { recursive: true, force: true });
          console.log(`[iOS] Fully removed ${derivedDataPath}`);
        }
      } else {
        // Selective: remove precompiled modules + module cache
        const pcmPath = `${derivedDataPath}/Build/Intermediates.noindex/ExplicitPrecompiledModules`;
        const cachePath = `${derivedDataPath}/ModuleCache.noindex`;
        if (existsSync(pcmPath)) rmSync(pcmPath, { recursive: true, force: true });
        if (existsSync(cachePath)) rmSync(cachePath, { recursive: true, force: true });
        console.log(`[iOS] Cleaned WDA cache in ${derivedDataPath}`);
      }
    } catch (err: any) {
      console.warn(`[iOS] Failed to clean derived data: ${err.message}`);
    }
  }

  private async startAndroidSession(): Promise<void> {
    const capabilities: Record<string, any> = {
      platformName: 'Android',
      'appium:automationName': 'UiAutomator2',
      'appium:deviceName': this.deviceId,
      'appium:noReset': true,
      'appium:newCommandTimeout': 600,
    };
    if (this.options.appPackage) {
      capabilities['appium:appPackage'] = this.options.appPackage;
      capabilities['appium:appActivity'] = this.options.appActivity || '';
    }

    this.appiumSessionId = await this.createAppiumSession(capabilities);
    await this.fetchScreenSize();
  }

  private async createAppiumSession(capabilities: Record<string, any>, timeoutMs = 300_000): Promise<string> {
    const res = await fetch(`${this.appiumUrl}/session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ capabilities: { alwaysMatch: capabilities } }),
      signal: AbortSignal.timeout(timeoutMs),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Appium session creation failed: ${res.status} ${text.slice(0, 300)}`);
    }

    const data: any = await res.json();
    return data.value?.sessionId || data.sessionId;
  }

  private async fetchScreenSize() {
    if (!this.appiumSessionId) return;
    try {
      const res = await fetch(`${this.appiumUrl}/session/${this.appiumSessionId}/window/rect`);
      const data: any = await res.json();
      this.screenSize = { width: data.value?.width || 375, height: data.value?.height || 812 };
    } catch {
      this.screenSize = { width: 375, height: 812 };
    }
  }

  /**
   * Detect screenshot dimensions from PNG header and compute coordinate scale.
   * PNG format: bytes 16-19 = width (BE uint32), bytes 20-23 = height (BE uint32).
   * For iOS Retina devices, screenshot is in physical pixels but Appium expects logical points.
   */
  private detectCoordScale(base64Png: string): void {
    if (this.screenshotDetected) return;
    this.screenshotDetected = true;
    try {
      const buf = Buffer.from(base64Png.substring(0, 48), 'base64');
      const ssWidth = buf.readUInt32BE(16);
      const ssHeight = buf.readUInt32BE(20);
      if (ssWidth > 0 && this.screenSize.width > 0) {
        this.coordScale = this.screenSize.width / ssWidth;
        console.log(`[${this.platform}] Screenshot: ${ssWidth}x${ssHeight}, Device: ${this.screenSize.width}x${this.screenSize.height}, Scale: ${this.coordScale.toFixed(3)}`);
      }
    } catch {
      console.warn(`[${this.platform}] Could not detect screenshot dimensions`);
    }
  }

  /** Convert coordinates from screenshot-pixel space to device logical space. */
  private scaleCoords(x: number, y: number): { x: number; y: number } {
    if (this.coordScale === 1 || this.coordScale === 0) return { x: Math.round(x), y: Math.round(y) };
    return { x: Math.round(x * this.coordScale), y: Math.round(y * this.coordScale) };
  }

  /**
   * Poll screenshots and emit them as 'frame' events.
   */
  private startScreenshotPolling() {
    const intervalMs = Math.max(200, Math.floor(1000 / this.fps));

    this.screenshotTimer = setInterval(async () => {
      if (this.status !== 'active' && this.status !== 'recording') return;
      try {
        const frame = await this.captureScreenshot();
        if (frame) {
          this.detectCoordScale(frame);
          this.emit('frame', frame);
        }
      } catch (err: any) {
        // Transient screenshot failures are common, don't crash
        this.emit('frame_error', err.message);
      }
    }, intervalMs);
  }

  private async captureScreenshot(): Promise<string | null> {
    if (!this.appiumSessionId) return null;

    const res = await fetch(
      `${this.appiumUrl}/session/${this.appiumSessionId}/screenshot`,
      { signal: AbortSignal.timeout(5000) },
    );
    if (!res.ok) return null;

    const data: any = await res.json();
    return data.value || null; // base64 PNG
  }

  /**
   * Handle a user action from the cloud dashboard.
   */
  async handleAction(action: UserAction): Promise<void> {
    if (!this.appiumSessionId) return;

    const sessionUrl = `${this.appiumUrl}/session/${this.appiumSessionId}`;
    console.log(`[${this.platform}:action] ${action.type}${action.x != null ? ` (${action.x},${action.y})` : ''}${action.text ? ` "${action.text}"` : ''}${action.key ? ` [${action.key}]` : ''}`);

    switch (action.type) {
      case 'tap': {
        const { x, y } = this.scaleCoords(action.x || 0, action.y || 0);
        console.log(`[${this.platform}:tap] scaled → (${x}, ${y})`);
        await this.appiumAction(sessionUrl, 'actions', {
          actions: [{
            type: 'pointer', id: 'finger1',
            parameters: { pointerType: 'touch' },
            actions: [
              { type: 'pointerMove', duration: 0, x, y },
              { type: 'pointerDown', button: 0 },
              { type: 'pause', duration: 50 },
              { type: 'pointerUp', button: 0 },
            ],
          }],
        });
        break;
      }

      case 'swipe': {
        const start = this.scaleCoords(action.x || 0, action.y || 0);
        const end = this.scaleCoords(action.endX || 0, action.endY || 0);
        await this.appiumAction(sessionUrl, 'actions', {
          actions: [{
            type: 'pointer', id: 'finger1',
            parameters: { pointerType: 'touch' },
            actions: [
              { type: 'pointerMove', duration: 0, x: start.x, y: start.y },
              { type: 'pointerDown', button: 0 },
              { type: 'pointerMove', duration: action.duration || 300, x: end.x, y: end.y },
              { type: 'pointerUp', button: 0 },
            ],
          }],
        });
        break;
      }

      case 'type':
        if (action.text) {
          // Find focused element and send keys
          const activeEl = await this.appiumAction(sessionUrl, 'element/active', {});
          const elId = activeEl?.value?.ELEMENT || activeEl?.value?.['element-6066-11e4-a52e-4f735466cecf'];
          if (elId) {
            await this.appiumAction(sessionUrl, `element/${elId}/value`, { text: action.text });
          } else {
            console.warn(`[${this.platform}:type] No active element found — typing via keyboard`);
            // Fallback: use mobile-specific keyboard input
            if (this.platform === 'ios') {
              await this.appiumAction(sessionUrl, 'execute/sync', {
                script: 'mobile: keys', args: [{ keys: action.text.split('') }],
              });
            }
          }
        }
        break;

      case 'key':
        // Handle special keys (backspace, enter, etc.)
        if (action.key) {
          const keyMap: Record<string, number> = {
            'backspace': 67, 'enter': 66, 'delete': 112,
            'tab': 61, 'escape': 111, 'space': 62,
          };
          if (this.platform === 'android') {
            const keycode = keyMap[action.key.toLowerCase()];
            if (keycode) {
              await this.appiumAction(sessionUrl, 'execute/sync', {
                script: 'mobile: pressKey', args: [{ keycode }],
              });
            }
          } else if (this.platform === 'ios') {
            // iOS: use mobile: keys for character-level input
            const iosKeyMap: Record<string, string> = {
              'backspace': '\b', 'enter': '\n', 'delete': '\u007F',
              'tab': '\t', 'space': ' ',
            };
            const mapped = iosKeyMap[action.key.toLowerCase()];
            if (mapped) {
              await this.appiumAction(sessionUrl, 'execute/sync', {
                script: 'mobile: keys', args: [{ keys: [mapped] }],
              });
            }
          }
        }
        break;

      case 'back':
        if (this.platform === 'android') {
          await this.appiumAction(sessionUrl, 'back', {});
        } else if (this.platform === 'ios') {
          // iOS: swipe from left edge to go back (system gesture)
          const h = this.screenSize.height || 812;
          await this.appiumAction(sessionUrl, 'actions', {
            actions: [{
              type: 'pointer', id: 'finger1',
              parameters: { pointerType: 'touch' },
              actions: [
                { type: 'pointerMove', duration: 0, x: 5, y: Math.round(h / 2) },
                { type: 'pointerDown', button: 0 },
                { type: 'pointerMove', duration: 300, x: Math.round((this.screenSize.width || 390) * 0.7), y: Math.round(h / 2) },
                { type: 'pointerUp', button: 0 },
              ],
            }],
          });
        }
        break;

      case 'home':
        if (this.platform === 'android') {
          await this.appiumAction(sessionUrl, 'execute/sync', {
            script: 'mobile: pressKey', args: [{ keycode: 3 }],
          });
        } else if (this.platform === 'ios') {
          // iOS: press Home button via mobile: pressButton
          await this.appiumAction(sessionUrl, 'execute/sync', {
            script: 'mobile: pressButton', args: [{ name: 'home' }],
          });
        }
        break;

      case 'scroll': {
        // Scroll as swipe gesture from center of screen (already in device coords)
        const centerX = Math.round(this.screenSize.width / 2);
        const centerY = Math.round(this.screenSize.height / 2);
        // Scale deltaY: if coords need scaling, delta should too
        const rawDy = action.deltaY || (action.direction === 'up' ? -300 : 300);
        const scaledDy = Math.round(rawDy * (this.coordScale !== 1 ? this.coordScale : 1));
        // Clamp scroll endpoints within screen bounds
        const scrollStartY = Math.min(Math.max(centerY, 50), this.screenSize.height - 50);
        const scrollEndY = Math.min(Math.max(scrollStartY - scaledDy, 50), this.screenSize.height - 50);

        await this.appiumAction(sessionUrl, 'actions', {
          actions: [{
            type: 'pointer', id: 'finger1',
            parameters: { pointerType: 'touch' },
            actions: [
              { type: 'pointerMove', duration: 0, x: centerX, y: scrollStartY },
              { type: 'pointerDown', button: 0 },
              { type: 'pointerMove', duration: 300, x: centerX, y: scrollEndY },
              { type: 'pointerUp', button: 0 },
            ],
          }],
        });
        break;
      }

      case 'longPress': {
        const lp = this.scaleCoords(action.x || 0, action.y || 0);
        await this.appiumAction(sessionUrl, 'actions', {
          actions: [{
            type: 'pointer', id: 'finger1',
            parameters: { pointerType: 'touch' },
            actions: [
              { type: 'pointerMove', duration: 0, x: lp.x, y: lp.y },
              { type: 'pointerDown', button: 0 },
              { type: 'pause', duration: action.duration || 1500 },
              { type: 'pointerUp', button: 0 },
            ],
          }],
        });
        break;
      }
    }

    // Record the action if recording (store device-logical coordinates)
    if (this.recording) {
      const recCoords = (action.x != null) ? this.scaleCoords(action.x, action.y || 0) : {};
      const recEndCoords = (action.endX != null) ? this.scaleCoords(action.endX, action.endY || 0) : {};
      this.recordedEvents.push({
        type: action.type,
        timestamp: Date.now(),
        ...(action.x != null ? { x: (recCoords as any).x, y: (recCoords as any).y } : {}),
        ...(action.endX != null ? { endX: (recEndCoords as any).x, endY: (recEndCoords as any).y } : {}),
        text: action.text || action.key,
      });

      // Enrich with element metadata after tap/swipe (async, non-blocking)
      if ((action.type === 'tap' || action.type === 'swipe') && action.x != null && action.y != null) {
        const scaled = this.scaleCoords(action.x, action.y);
        this.enrichLastEventWithElement(scaled.x, scaled.y);
      }
    }
  }

  /**
   * Enrich the last recorded event with element metadata from page source.
   * Fetches Appium pageSource XML, parses it, finds the element at coordinates,
   * and attaches accessibilityId/label/name (iOS) or resourceId/contentDesc/text (Android).
   */
  private async enrichLastEventWithElement(x: number, y: number): Promise<void> {
    if (!this.appiumSessionId || this.recordedEvents.length === 0) return;
    if (this.platform !== 'ios' && this.platform !== 'android') return;

    const platform = this.platform; // narrow type to 'ios' | 'android'

    // Wait for any previous enrich to finish first
    if (this.pendingEnrich) {
      await this.pendingEnrich.catch(() => {});
    }

    const enrichJob = (async () => {
      try {
        // Swap before/after snapshots: previous after becomes current before
        this.snapshotBeforeTap = this.lastPageSourceSnapshot;

        const pageSourceXml = await this.fetchPageSource();
        if (!pageSourceXml) return;

        // Cache for next action's before snapshot
        this.lastPageSourceSnapshot = pageSourceXml;

        const meta = enrichFromPageSource(platform, pageSourceXml, x, y);
        if (meta && this.recordedEvents.length > 0) {
          const lastEvent = this.recordedEvents[this.recordedEvents.length - 1];
          lastEvent.elementMeta = meta;
        }
      } catch {
        // Element enrichment is best-effort, never block recording
      } finally {
        this.pendingEnrich = null;
      }
    })();

    this.pendingEnrich = enrichJob;
  }

  /**
   * Fetch page source XML from Appium.
   */
  private async fetchPageSource(): Promise<string | null> {
    if (!this.appiumSessionId) return null;
    try {
      const res = await fetch(
        `${this.appiumUrl}/session/${this.appiumSessionId}/source`,
        { signal: AbortSignal.timeout(10_000) },
      );
      if (!res.ok) return null;
      const data: any = await res.json();
      return data.value || null;
    } catch {
      return null;
    }
  }

  private async appiumAction(sessionUrl: string, endpoint: string, body: any): Promise<any> {
    try {
      const res = await fetch(`${sessionUrl}/${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(15_000),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        console.warn(`[appium] ${endpoint} failed (${res.status}): ${text.slice(0, 200)}`);
        return null;
      }
      return res.json();
    } catch (err: any) {
      console.warn(`[appium] ${endpoint} error: ${err.message}`);
      return null;
    }
  }

  /**
   * Start recording user actions as a scenario.
   */
  startRecording() {
    this.recording = true;
    this.recordedEvents = [];
    if (this.status === 'active') {
      this.status = 'recording';
      this.emit('status', this.status);
    }
  }

  /**
   * Stop recording and return the captured events.
   */
  stopRecording(): RecordedEvent[] {
    this.recording = false;
    const events = [...this.recordedEvents];
    this.recordedEvents = [];
    if (this.status === 'recording') {
      this.status = 'active';
      this.emit('status', this.status);
    }
    return events;
  }

  /**
   * Close the session and clean up.
   */
  async close(): Promise<void> {
    this.status = 'closing';
    this.emit('status', this.status);

    // Wait for any pending enrichment (max 2s)
    if (this.pendingEnrich) {
      await Promise.race([this.pendingEnrich, new Promise(r => setTimeout(r, 2000))]).catch(() => {});
      this.pendingEnrich = null;
    }

    if (this.screenshotTimer) {
      clearInterval(this.screenshotTimer);
      this.screenshotTimer = null;
    }

    if (this.appiumSessionId) {
      try {
        await fetch(`${this.appiumUrl}/session/${this.appiumSessionId}`, {
          method: 'DELETE',
          signal: AbortSignal.timeout(5000),
        });
      } catch {}
      this.appiumSessionId = null;
    }

    this.lastPageSourceSnapshot = null;
    this.snapshotBeforeTap = null;
    this.status = 'closed';
    this.emit('status', this.status);
    this.removeAllListeners();
  }

  getInfo() {
    return {
      id: this.id,
      platform: this.platform,
      deviceId: this.deviceId,
      status: this.status,
      recording: this.recording,
      screenSize: this.screenSize,
      createdAt: this.createdAt,
      fps: this.fps,
      eventCount: this.recordedEvents.length,
    };
  }
}
