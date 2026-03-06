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

  /**
   * Auto-connect all physically detected devices on startup.
   * This ensures devices are immediately available in the Cloud device pool
   * without requiring manual "Connect" clicks on the Runner dashboard.
   */
  async autoConnectDetectedDevices(): Promise<void> {
    const detected = this.deviceCache.filter((d) => d.status === 'connected');
    if (detected.length === 0) {
      console.log('[auto-connect] No physical devices detected.');
      return;
    }
    console.log(`[auto-connect] Found ${detected.length} device(s). Registering...`);
    for (const device of detected) {
      if (this.connectedDeviceIds.has(device.id)) continue;
      try {
        await this.connectDevice(device.id);
      } catch (err: any) {
        console.warn(`[auto-connect] Failed to connect ${device.name}: ${err.message}`);
      }
    }
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

    console.log(`[connect] Device ${device.name} (${deviceId}) connected and available.`);
    return connectedDevice;
  }

  /**
   * Disconnect a device — removes it from the available pool.
   * Active sessions on this device are NOT closed (user must return first).
   */
  disconnectDevice(deviceId: string): void {
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

    // For iOS, try to ensure tunnel is active (best-effort).
    // Appium XCUITest driver can manage its own tunnel for USB devices.
    if (options.platform === 'ios' && this.processManager && !this.processManager.isTunnelRunning()) {
      console.warn(`[session] iOS external tunnel not running — Appium will handle internally.`);
    }

    const session = new MirrorSession(sessionId, {
      platform: options.platform as 'ios' | 'android',
      deviceId,
      bundleId: options.bundleId,
      appPackage: options.appPackage,
      appActivity: options.appActivity,
      fps: options.fps || 2,
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
  }
}
