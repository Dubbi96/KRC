/**
 * Session Manager
 *
 * Manages device connections and mirror/recording sessions.
 *
 * Device lifecycle:
 *   1. Scanner detects physical devices (auto, every 10s)
 *   2. Operator "connects" a device → tunnel started (iOS) → device available
 *   3. Cloud user "borrows" device → Appium session → mirroring
 *   4. User "returns" device → session closed → device still connected
 *   5. Operator "disconnects" device → device removed from pool
 */

import { v4 as uuid } from 'uuid';
import { EventEmitter } from 'events';
import { scanDevices, DetectedDevice } from './device-scanner';
import { MirrorSession, MirrorSessionOptions, UserAction, SessionStatus, RecordedEvent } from './mirror-session';
import { WebRecordingSession, WebRecordingOptions, WebRecordedEvent, WebSessionStatus } from './web-recording-session';
import { ProcessManager } from '../worker/process-manager';
import { portPool, SessionPorts } from '../worker/port-pool';

/**
 * Common interface that both MirrorSession and WebRecordingSession satisfy.
 */
export interface AnySession extends EventEmitter {
  readonly id: string;
  status: string;
  start(): Promise<void>;
  handleAction(action: any): Promise<void>;
  startRecording(): void;
  stopRecording(): any[];
  close(): Promise<void>;
  getInfo(): SessionInfo;
}

export interface SessionInfo {
  id: string;
  platform: string;
  deviceId: string;
  status: string;
  recording: boolean;
  createdAt: string;
  fps: number;
  eventCount: number;
  url?: string;
  screenSize?: { width: number; height: number };
}

export interface CreateSessionOptions {
  platform: 'ios' | 'android' | 'web';
  deviceId?: string;
  bundleId?: string;
  appPackage?: string;
  appActivity?: string;
  url?: string;
  fps?: number;
}

export interface ConnectedDevice extends DetectedDevice {
  /** When this device was connected/registered */
  connectedAt: string;
  /** Whether tunnel is established (iOS only) */
  tunnelActive?: boolean;
  /** Pre-started Appium session ID (WDA already running) */
  appiumSessionId?: string;
  /** Appium server URL for this device's platform */
  appiumUrl?: string;
}

export class SessionManager {
  private sessions: Map<string, AnySession> = new Map();
  private deviceCache: DetectedDevice[] = [];
  private scanTimer: NodeJS.Timeout | null = null;
  /** Explicitly connected devices — only these are reported to cloud */
  private connectedDeviceIds: Set<string> = new Set();
  private connectedDeviceMeta: Map<string, ConnectedDevice> = new Map();
  private processManager: ProcessManager | null = null;

  constructor() {
    this.refreshDevices();
    this.scanTimer = setInterval(() => this.refreshDevices(), 10_000);
  }

  /**
   * Inject ProcessManager for tunnel management.
   * Called after WorkerManager creates the ProcessManager.
   */
  setProcessManager(pm: ProcessManager): void {
    this.processManager = pm;
  }


  private refreshDevices() {
    try {
      this.deviceCache = scanDevices();

      // Update connected device info from latest scan
      for (const [id, meta] of this.connectedDeviceMeta) {
        const scanned = this.deviceCache.find((d) => d.id === id);
        if (scanned) {
          // Update fields from scan (name, model, version might change)
          meta.name = scanned.name;
          meta.model = scanned.model;
          meta.version = scanned.version;
          meta.status = scanned.status;
        } else {
          // Device physically disconnected
          meta.status = 'offline';
        }
      }

      // Clean up connected devices that are no longer physically present
      for (const id of [...this.connectedDeviceIds]) {
        const meta = this.connectedDeviceMeta.get(id);
        if (!meta) continue;
        const cached = this.deviceCache.find((d) => d.id === id);
        if (!cached) {
          // Device physically disconnected — only remove if no active session
          const hasSession = this.getSessionByDeviceId(id);
          if (!hasSession) {
            this.connectedDeviceIds.delete(id);
            this.connectedDeviceMeta.delete(id);
            console.log(`[device] Physically disconnected, unregistered: ${id}`);
          } else {
            meta.status = 'offline';
          }
        }
      }
    } catch {
      // Scan failures are non-fatal
    }
  }

  // ─── Device Detection ────────────────────────────────

  /** All physically detected devices (connected + unregistered) */
  getDetectedDevices(): DetectedDevice[] {
    return this.deviceCache;
  }

  /** Legacy alias */
  getDevices(): DetectedDevice[] {
    return this.deviceCache;
  }

  rescanDevices(): DetectedDevice[] {
    this.refreshDevices();
    return this.deviceCache;
  }

  // ─── Device Connection (Registration) ────────────────

  /**
   * Connect/register a device — makes it available for borrowing.
   * For iOS: starts CoreDevice tunnel if not running.
   */
  async connectDevice(deviceId: string): Promise<ConnectedDevice> {
    // Find device in scan cache
    const device = this.deviceCache.find((d) => d.id === deviceId);
    if (!device) {
      throw new Error(`Device ${deviceId} not found. Run rescan first.`);
    }

    if (device.status !== 'connected') {
      throw new Error(`Device ${deviceId} is ${device.status}, cannot connect.`);
    }

    // For iOS, try to start CoreDevice tunnel (best-effort).
    // Appium XCUITest driver handles tunnel internally for USB-connected devices,
    // so an external tunnel failure is non-fatal.
    if (device.platform === 'ios' && this.processManager) {
      console.log(`[connect] iOS device ${deviceId} — attempting tunnel (best-effort)...`);
      const result = await this.processManager.ensureTunnelRunning();
      if (!result.ok) {
        console.warn(`[connect] External tunnel not started: ${result.error}. Appium will handle tunnel internally.`);
      }
    }

    // Mark as connected
    this.connectedDeviceIds.add(deviceId);
    const connectedDevice: ConnectedDevice = {
      ...device,
      connectedAt: new Date().toISOString(),
      tunnelActive: device.platform === 'ios' ? this.processManager?.isTunnelRunning() : undefined,
    };
    this.connectedDeviceMeta.set(deviceId, connectedDevice);

    // Pre-start Appium session (WDA) for mobile devices at connect time.
    // This ensures the password/trust prompt happens once at connect,
    // not every time a user borrows the device.
    // Allocate unique ports from port pool to support parallel sessions.
    if (device.platform === 'ios' || device.platform === 'android') {
      const ports = portPool.allocate(deviceId);
      const appiumPort = this.processManager?.getAppiumPort(device.platform) || (device.platform === 'ios' ? 4723 : 4724);
      const appiumUrl = `http://localhost:${appiumPort}`;
      console.log(`[connect] Pre-starting Appium session (WDA) for ${device.name}...`);
      try {
        const appiumSessionId = await this.createStandbyAppiumSession(device, appiumUrl);
        if (appiumSessionId) {
          connectedDevice.appiumSessionId = appiumSessionId;
          connectedDevice.appiumUrl = appiumUrl;
          console.log(`[connect] WDA ready for ${device.name} (session: ${appiumSessionId})`);
        }
      } catch (err: any) {
        console.warn(`[connect] Pre-start WDA failed: ${err.message}. Will create on borrow.`);
      }
    }

    console.log(`[connect] Device ${device.name} (${deviceId}) connected and available.`);
    return connectedDevice;
  }

  /**
   * Create a standby Appium session for a device (starts WDA).
   * Uses the same capabilities as MirrorSession but without a specific bundleId.
   */
  private async createStandbyAppiumSession(device: DetectedDevice, appiumUrl: string): Promise<string | null> {
    const { execSync } = require('child_process');

    // Get port pool allocation for this device
    const ports = portPool.get(device.id) || portPool.allocate(device.id);

    // Detect team ID for code signing
    let teamId = process.env.XCODE_ORG_ID || '';
    if (!teamId) {
      try {
        const output = execSync('security find-identity -v -p codesigning 2>/dev/null | head -5', {
          encoding: 'utf-8', timeout: 5000,
        });
        const match = output.match(/\(([A-Z0-9]{10})\)/);
        teamId = match?.[1] || '';
      } catch {}
    }

    const wdaBundleId = process.env.IOS_WDA_BUNDLE_ID || process.env.WDA_BUNDLE_ID || 'com.katab.WebDriverAgentRunner';

    const baseCaps: Record<string, any> = device.platform === 'ios' ? {
      platformName: 'iOS',
      'appium:deviceName': 'iPhone',
      'appium:automationName': 'XCUITest',
      'appium:udid': device.id,
      'appium:noReset': true,
      'appium:newCommandTimeout': 0, // Never timeout — standby session
      'appium:useNewWDA': false,
      'appium:useSimpleBuildTest': true,
      'appium:wdaLaunchTimeout': 120000,
      'appium:wdaConnectionTimeout': 120000,
      'appium:wdaStartupRetries': 4,
      'appium:wdaStartupRetryInterval': 15000,
      'appium:wdaLocalPort': ports.wdaLocalPort,
      'appium:waitForQuiescence': false,
      'appium:skipLogCapture': true,
      'appium:shouldUseSingletonTestManager': false,
      'appium:derivedDataPath': ports.derivedDataPath,
      'appium:allowProvisioningUpdates': true,
      'appium:xcodeSigningId': process.env.XCODE_SIGNING_ID || 'Apple Development',
      'appium:updatedWDABundleId': wdaBundleId,
      'appium:updatedWDABundleIdSuffix': '',
      ...(teamId ? { 'appium:xcodeOrgId': teamId } : {}),
      ...(process.env.IOS_WDA_URL ? { 'appium:webDriverAgentUrl': process.env.IOS_WDA_URL } : {}),
    } : {
      platformName: 'Android',
      'appium:automationName': 'UiAutomator2',
      'appium:deviceName': device.id,
      'appium:noReset': true,
      'appium:newCommandTimeout': 0,
      'appium:systemPort': ports.systemPort,
      'appium:mjpegServerPort': ports.mjpegServerPort,
      'appium:chromedriverPort': ports.chromedriverPort,
    };

    // Try with pre-built WDA first, then rebuild
    for (const attempt of [1, 2, 3]) {
      try {
        const caps = { ...baseCaps };
        if (device.platform === 'ios') {
          if (attempt === 1) {
            caps['appium:usePrebuiltWDA'] = true;
          } else {
            caps['appium:usePrebuiltWDA'] = false;
            caps['appium:useSimpleBuildTest'] = false;
            caps['appium:showXcodeLog'] = true;
          }
        }
        console.log(`[connect] WDA attempt ${attempt}/3...`);
        const res = await fetch(`${appiumUrl}/session`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ capabilities: { alwaysMatch: caps } }),
          signal: AbortSignal.timeout(300_000),
        });
        if (!res.ok) {
          const text = await res.text();
          throw new Error(`${res.status} ${text.slice(0, 200)}`);
        }
        const data: any = await res.json();
        return data.value?.sessionId || data.sessionId;
      } catch (err: any) {
        console.warn(`[connect] WDA attempt ${attempt} failed: ${err.message?.slice(0, 200)}`);
        if (attempt === 3) throw err;
      }
    }
    return null;
  }

  /**
   * Disconnect a device — removes it from the available pool.
   * Closes the standby Appium session (WDA stops).
   * Active sessions on this device are NOT closed (user must return first).
   */
  disconnectDevice(deviceId: string): void {
    const meta = this.connectedDeviceMeta.get(deviceId);

    // Close standby Appium session if one exists
    if (meta?.appiumSessionId && meta.appiumUrl) {
      console.log(`[disconnect] Closing standby Appium session ${meta.appiumSessionId}`);
      fetch(`${meta.appiumUrl}/session/${meta.appiumSessionId}`, {
        method: 'DELETE',
        signal: AbortSignal.timeout(5000),
      }).catch(() => {});
    }

    // Release port pool allocation
    portPool.release(deviceId);

    this.connectedDeviceIds.delete(deviceId);
    this.connectedDeviceMeta.delete(deviceId);
    console.log(`[disconnect] Device ${deviceId} disconnected from pool.`);
  }

  /** Get all explicitly connected devices (for heartbeat/cloud reporting) */
  getConnectedDevices(): ConnectedDevice[] {
    return Array.from(this.connectedDeviceMeta.values());
  }

  /** Check if a specific device is connected */
  isDeviceConnected(deviceId: string): boolean {
    return this.connectedDeviceIds.has(deviceId);
  }

  /**
   * Release the standby Appium session for a device (before test execution).
   * This frees the WDA/ports so the recorder CLI can create its own session.
   * Returns true if a standby session was released.
   */
  async releaseStandbySession(deviceId: string): Promise<boolean> {
    const meta = this.connectedDeviceMeta.get(deviceId);
    if (!meta?.appiumSessionId || !meta.appiumUrl) return false;

    console.log(`[session] Releasing standby Appium session ${meta.appiumSessionId} for device ${deviceId}`);
    try {
      await fetch(`${meta.appiumUrl}/session/${meta.appiumSessionId}`, {
        method: 'DELETE',
        signal: AbortSignal.timeout(10_000),
      });
    } catch (err: any) {
      console.warn(`[session] Failed to delete standby session: ${err.message}`);
    }

    // Release port pool so recorder can allocate fresh ports
    portPool.release(deviceId);

    // Clear standby session info (keep device connected)
    meta.appiumSessionId = undefined;
    meta.appiumUrl = undefined;
    console.log(`[session] Standby session released for ${deviceId}`);
    return true;
  }

  /**
   * Restore the standby Appium session after test execution completes.
   * Re-allocates ports and pre-starts WDA again.
   */
  async restoreStandbySession(deviceId: string): Promise<void> {
    const meta = this.connectedDeviceMeta.get(deviceId);
    if (!meta || meta.appiumSessionId) return; // already has a session or not connected

    const device = this.deviceCache.find(d => d.id === deviceId);
    if (!device || (device.platform !== 'ios' && device.platform !== 'android')) return;

    console.log(`[session] Restoring standby Appium session for ${device.name}...`);
    try {
      const ports = portPool.allocate(deviceId);
      const appiumPort = this.processManager?.getAppiumPort(device.platform) || (device.platform === 'ios' ? 4723 : 4724);
      const appiumUrl = `http://localhost:${appiumPort}`;
      const appiumSessionId = await this.createStandbyAppiumSession(device, appiumUrl);
      if (appiumSessionId) {
        meta.appiumSessionId = appiumSessionId;
        meta.appiumUrl = appiumUrl;
        console.log(`[session] Standby session restored for ${device.name} (session: ${appiumSessionId})`);
      }
    } catch (err: any) {
      console.warn(`[session] Failed to restore standby session: ${err.message}`);
    }
  }

  // ─── Sessions ────────────────────────────────────────

  /**
   * Create a new session — MirrorSession for mobile, WebRecordingSession for web.
   */
  async createSession(options: CreateSessionOptions): Promise<AnySession> {
    const sessionId = uuid();

    if (options.platform === 'web') {
      return this.createWebSession(sessionId, options);
    } else {
      return this.createMobileSession(sessionId, options);
    }
  }

  private async createMobileSession(sessionId: string, options: CreateSessionOptions): Promise<MirrorSession> {
    const deviceId = options.deviceId || 'default';

    // Auto-connect device if detected but not yet registered (mirrors Katab_Stack prepareDevice behaviour)
    if (!this.connectedDeviceIds.has(deviceId)) {
      const detected = this.deviceCache.find((d) => d.id === deviceId);
      if (!detected) {
        // Try a fresh scan before giving up
        this.refreshDevices();
        const retry = this.deviceCache.find((d) => d.id === deviceId);
        if (!retry) {
          throw new Error(
            `Device ${deviceId} not found. Make sure the device is physically connected and trusted.`
          );
        }
      }
      console.log(`[session] Device ${deviceId} not registered — auto-connecting...`);
      await this.connectDevice(deviceId);
    }

    // Check if device is already in use
    for (const session of this.sessions.values()) {
      const info = session.getInfo();
      if (info.deviceId === deviceId && info.platform === options.platform
          && session.status !== 'closed' && session.status !== 'error') {
        throw new Error(`Device ${deviceId} is already in use by session ${session.id}`);
      }
    }

    // Check if we have a pre-started Appium session from connect time
    const connectedMeta = this.connectedDeviceMeta.get(deviceId);
    const existingAppiumSessionId = connectedMeta?.appiumSessionId;
    const appiumUrl = connectedMeta?.appiumUrl;

    if (existingAppiumSessionId) {
      console.log(`[session] Reusing pre-started WDA session: ${existingAppiumSessionId}`);
    } else if (options.platform === 'ios' && this.processManager && !this.processManager.isTunnelRunning()) {
      console.warn(`[session] iOS external tunnel not running — Appium will handle internally.`);
    }

    const session = new MirrorSession(sessionId, {
      platform: options.platform as 'ios' | 'android',
      deviceId,
      bundleId: options.bundleId,
      appPackage: options.appPackage,
      appActivity: options.appActivity,
      fps: options.fps || 2,
      existingAppiumSessionId,
      ...(appiumUrl ? { appiumUrl } : {}),
    });

    this.sessions.set(sessionId, session as AnySession);
    this.attachAutoCleanup(sessionId, session);
    await session.start();
    return session;
  }

  private async createWebSession(sessionId: string, options: CreateSessionOptions): Promise<WebRecordingSession> {
    if (!options.url) {
      throw new Error('url is required for web sessions');
    }

    const session = new WebRecordingSession(sessionId, {
      url: options.url,
      headless: true,
      viewport: { width: 1280, height: 720 },
      fps: options.fps || 2,
    });

    this.sessions.set(sessionId, session as unknown as AnySession);
    this.attachAutoCleanup(sessionId, session);
    await session.start();
    return session;
  }

  private attachAutoCleanup(sessionId: string, session: EventEmitter) {
    session.on('status', (status: string) => {
      if (status === 'closed') {
        setTimeout(() => this.sessions.delete(sessionId), 60_000);
      }
    });
  }

  getSession(sessionId: string): AnySession | undefined {
    return this.sessions.get(sessionId);
  }

  /**
   * Find the active session occupying a specific device (if any).
   * Used by Runner monitoring to check if Cloud has borrowed a device.
   */
  getSessionByDeviceId(deviceId: string, platform?: string): AnySession | undefined {
    for (const session of this.sessions.values()) {
      const info = session.getInfo();
      if (info.deviceId === deviceId && session.status !== 'closed' && session.status !== 'error') {
        if (!platform || info.platform === platform) return session;
      }
    }
    return undefined;
  }

  async closeSession(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    await session.close();
  }

  async handleAction(sessionId: string, action: any): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error('Session not found');
    if (session.status !== 'active' && session.status !== 'recording') {
      throw new Error(`Session is ${session.status}, cannot handle actions`);
    }
    await session.handleAction(action);
  }

  startRecording(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error('Session not found');
    session.startRecording();
  }

  stopRecording(sessionId: string): any[] {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error('Session not found');
    return session.stopRecording();
  }

  listSessions(): SessionInfo[] {
    const result: SessionInfo[] = [];
    for (const session of this.sessions.values()) {
      result.push(session.getInfo());
    }
    return result;
  }

  async shutdown() {
    if (this.scanTimer) {
      clearInterval(this.scanTimer);
      this.scanTimer = null;
    }
    for (const session of this.sessions.values()) {
      await session.close().catch(() => {});
    }
    this.sessions.clear();

    // Close all standby Appium sessions
    for (const [id, meta] of this.connectedDeviceMeta) {
      if (meta.appiumSessionId && meta.appiumUrl) {
        await fetch(`${meta.appiumUrl}/session/${meta.appiumSessionId}`, {
          method: 'DELETE', signal: AbortSignal.timeout(5000),
        }).catch(() => {});
      }
    }
  }
}
