/**
 * Platform-specific Process Manager.
 *
 * Lifecycle:
 *   1. Runner boots → Appium server starts immediately (always on)
 *   2. Device "connect" → iOS tunnel started on-demand
 *   3. Job workers pull from KCP (no BullMQ/Redis)
 *
 * This manager handles lifecycle, health-checks, and status reporting
 * for all sub-processes so the dashboard can display them in real-time.
 */

import { spawn, ChildProcess, execFileSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { config } from '../config';

export type ProcessStatus = 'stopped' | 'starting' | 'running' | 'error' | 'not_required';

export interface SubProcess {
  name: string;
  status: ProcessStatus;
  pid?: number;
  startedAt?: string;
  error?: string;
  /** For health-check based processes like Appium */
  healthUrl?: string;
}

export interface PlatformProcesses {
  platform: 'web' | 'ios' | 'android';
  enabled: boolean;
  processes: SubProcess[];
  /** Overall platform readiness */
  ready: boolean;
}

export class ProcessManager {
  private platformStates: Map<string, PlatformProcesses> = new Map();
  private childProcesses: Map<string, ChildProcess> = new Map();
  private healthTimers: Map<string, NodeJS.Timeout> = new Map();

  constructor() {
    for (const platform of config.runner.platforms) {
      this.platformStates.set(platform, this.initPlatformState(platform));
    }
  }

  private initPlatformState(platform: 'web' | 'ios' | 'android'): PlatformProcesses {
    const processes: SubProcess[] = [];

    if (platform === 'ios') {
      processes.push(
        { name: 'Tunnel', status: 'not_required' },
        { name: 'Appium Server', status: 'stopped', healthUrl: `http://localhost:${this.getAppiumPort(platform)}` },
        { name: 'iOS Worker', status: 'stopped' },
      );
    } else if (platform === 'android') {
      processes.push(
        { name: 'Appium Server', status: 'stopped', healthUrl: `http://localhost:${this.getAppiumPort(platform)}` },
        { name: 'Android Worker', status: 'stopped' },
      );
    } else {
      processes.push(
        { name: 'Web Worker', status: 'stopped' },
      );
    }

    return { platform, enabled: true, processes, ready: false };
  }

  getAppiumPort(platform: string): number {
    return platform === 'ios' ? 4723 : 4724;
  }

  // ─── Boot-time: Start Appium servers ─────────────────────

  /**
   * Start Appium servers for all mobile platforms on runner boot.
   * Called once at startup — Appium stays running for the runner's lifetime.
   */
  async startAppiumServers(): Promise<void> {
    for (const platform of config.runner.platforms) {
      if (platform === 'ios' || platform === 'android') {
        console.log(`[${platform}] Starting Appium server on boot...`);
        await this.startAppium(platform);
      }
    }
  }

  /**
   * Start all required sub-processes for a platform (BullMQ worker startup).
   * Appium is already running from boot — only starts worker-specific prereqs.
   */
  async startPlatform(platform: 'web' | 'ios' | 'android'): Promise<void> {
    const state = this.platformStates.get(platform);
    if (!state) return;

    // Appium already started at boot time — just verify it's still running
    if (platform === 'ios' || platform === 'android') {
      const appiumProc = this.getSubProcess(platform, 'Appium Server');
      if (appiumProc && appiumProc.status !== 'running') {
        console.log(`[${platform}] Appium not running, starting...`);
        await this.startAppium(platform);
      }
    }
  }

  // ─── On-demand: Tunnel for device connection ─────────────

  /**
   * Ensure CoreDevice tunnel is running (iOS 17+).
   * Called when a device is "connected" via the Runner Console.
   * The tunnel is system-wide — covers all physically connected iOS devices.
   */
  async ensureTunnelRunning(): Promise<{ ok: boolean; error?: string }> {
    const platform = 'ios';
    let proc = this.getSubProcess(platform, 'Tunnel');
    if (!proc) {
      // Auto-register iOS platform on-demand when a physical device is detected
      console.log(`[ios] Platform not pre-configured — registering dynamically for device connect...`);
      this.platformStates.set(platform, this.initPlatformState(platform));
      proc = this.getSubProcess(platform, 'Tunnel');
      if (!proc) {
        return { ok: false, error: 'Failed to initialize iOS platform state' };
      }
    }

    // Already running
    if (proc.status === 'running') {
      const tunnelChild = this.childProcesses.get(`${platform}:tunnel`);
      if (tunnelChild && !tunnelChild.killed) {
        return { ok: true };
      }
      // Process died but status wasn't updated
      proc.status = 'stopped';
    }

    // Start tunnel (mutates proc.status)
    await this.startTunnel(platform);

    // Re-read status after startTunnel — cast to string to avoid TS narrowing issue
    if ((proc.status as string) === 'running') {
      this.updateReadiness(platform);
      return { ok: true };
    }
    // Tunnel failure is non-fatal — Appium XCUITest handles tunnels internally for USB.
    // Mark as not_required so it doesn't block platform readiness.
    proc.status = 'not_required';
    proc.error = proc.error || 'External tunnel not available — Appium will handle internally';
    this.updateReadiness(platform);
    return { ok: false, error: proc.error };
  }

  /**
   * Check if iOS CoreDevice tunnel is currently running.
   */
  isTunnelRunning(): boolean {
    const proc = this.getSubProcess('ios', 'Tunnel');
    if (!proc || proc.status !== 'running') return false;
    const child = this.childProcesses.get('ios:tunnel');
    return !!child && !child.killed;
  }

  /**
   * Check if Appium is running for a given platform.
   */
  async isAppiumReady(platform: string): Promise<boolean> {
    const port = this.getAppiumPort(platform);
    return this.isAppiumRunning(port);
  }

  // ─── Internal: Process lifecycle ─────────────────────────

  /**
   * Start iOS CoreDevice tunnel (iOS 17+).
   */
  private async startTunnel(platform: string): Promise<void> {
    const proc = this.getSubProcess(platform, 'Tunnel');
    if (!proc) return;

    proc.status = 'starting';
    this.emitUpdate();

    try {
      const tunnelScript = this.resolveTunnelScript();
      if (!tunnelScript) {
        proc.status = 'not_required';
        proc.error = 'Tunnel script not found — Appium will manage tunnel internally for USB devices.';
        this.updateReadiness(platform);
        this.emitUpdate();
        return;
      }

      console.log(`[${platform}] Starting CoreDevice tunnel: ${tunnelScript}`);

      // Use process.execPath to resolve the node binary (launchd may not have node in PATH)
      const nodeBin = process.execPath;
      const args = [tunnelScript];

      const child = spawn(nodeBin, args, {
        env: {
          ...process.env,
          NODE_PATH: process.env.NODE_PATH || path.join(os.homedir(), '.npm-global/lib/node_modules'),
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      this.childProcesses.set(`${platform}:tunnel`, child);
      proc.pid = child.pid;
      proc.startedAt = new Date().toISOString();

      // Tunnel outputs "Tunnel started" or similar when ready
      await new Promise<void>((resolve) => {
        let output = '';
        const timer = setTimeout(() => {
          // Tunnel might not print a clear "ready" message.
          // If it's still alive after 5s, assume it's working.
          if (!child.killed) {
            proc.status = 'running';
            this.emitUpdate();
          }
          resolve();
        }, 5000);

        child.stdout?.on('data', (data) => {
          const chunk = data.toString();
          console.log(`[${platform}:tunnel:stdout] ${chunk.trim()}`);
          output += chunk;
          if (output.includes('tunnel') || output.includes('started') || output.includes('ready')) {
            clearTimeout(timer);
            proc.status = 'running';
            this.emitUpdate();
            resolve();
          }
        });

        child.stderr?.on('data', (data) => {
          const chunk = data.toString().trim();
          if (chunk) console.error(`[${platform}:tunnel:stderr] ${chunk}`);
        });

        child.on('error', (err) => {
          clearTimeout(timer);
          proc.status = 'not_required';
          proc.error = `Tunnel process error: ${err.message} — Appium will handle internally`;
          this.updateReadiness(platform);
          this.emitUpdate();
          resolve();
        });

        child.on('exit', (code) => {
          if (proc.status !== 'running') {
            clearTimeout(timer);
            proc.status = 'not_required';
            proc.error = `Tunnel exited (code ${code}) — Appium will handle internally`;
            this.updateReadiness(platform);
            this.emitUpdate();
            resolve();
          } else {
            proc.status = 'not_required';
            this.updateReadiness(platform);
            this.emitUpdate();
          }
        });
      });
    } catch (err: any) {
      proc.status = 'not_required';
      proc.error = `Tunnel error: ${err.message} — Appium will handle internally`;
      this.updateReadiness(platform);
      this.emitUpdate();
    }
  }

  /**
   * Resolve environment variables needed for mobile platform processes.
   * Under launchd, JAVA_HOME/ANDROID_HOME may not be set.
   */
  private resolveMobileEnv(): Record<string, string> {
    const env: Record<string, string> = { ...process.env as any };

    // Resolve JAVA_HOME
    if (!env.JAVA_HOME) {
      const javaHomeCandidates = [
        '/usr/local/opt/openjdk@17',
        '/opt/homebrew/opt/openjdk@17',
        '/usr/local/opt/openjdk',
        '/opt/homebrew/opt/openjdk',
      ];
      for (const p of javaHomeCandidates) {
        if (fs.existsSync(p)) { env.JAVA_HOME = p; break; }
      }
      // macOS java_home fallback
      if (!env.JAVA_HOME) {
        try {
          env.JAVA_HOME = execFileSync('/usr/libexec/java_home', {
            encoding: 'utf-8', timeout: 3000, stdio: ['pipe', 'pipe', 'pipe'],
          }).trim();
        } catch {}
      }
    }

    // Resolve ANDROID_HOME
    if (!env.ANDROID_HOME) {
      const androidHomeCandidates = [
        path.join(os.homedir(), 'Library/Android/sdk'),
        '/usr/local/share/android-commandlinetools',
        '/opt/homebrew/share/android-commandlinetools',
      ];
      for (const p of androidHomeCandidates) {
        if (fs.existsSync(p)) { env.ANDROID_HOME = p; break; }
      }
    }
    // Also set ANDROID_SDK_ROOT (some tools use this)
    if (env.ANDROID_HOME && !env.ANDROID_SDK_ROOT) {
      env.ANDROID_SDK_ROOT = env.ANDROID_HOME;
    }

    // Ensure platform-tools is in PATH (for adb)
    if (env.ANDROID_HOME) {
      const ptPath = path.join(env.ANDROID_HOME, 'platform-tools');
      if (fs.existsSync(ptPath) && !env.PATH?.includes(ptPath)) {
        env.PATH = `${ptPath}:${env.PATH || ''}`;
      }
    }

    // Ensure JAVA_HOME/bin is in PATH
    if (env.JAVA_HOME) {
      const javaBin = path.join(env.JAVA_HOME, 'bin');
      if (fs.existsSync(javaBin) && !env.PATH?.includes(javaBin)) {
        env.PATH = `${javaBin}:${env.PATH || ''}`;
      }
    }

    env.DEVELOPER_DIR = env.DEVELOPER_DIR || '/Applications/Xcode.app/Contents/Developer';

    // Ensure global npm modules are resolvable by Appium drivers (~/.appium/node_modules/).
    // Drivers like uiautomator2 do require('appium/driver') which fails if the global
    // appium package isn't in the Node.js module search path.
    try {
      const npmGlobalRoot = execFileSync('npm', ['root', '-g'], {
        encoding: 'utf-8', timeout: 5000, stdio: ['pipe', 'pipe', 'pipe'],
      }).trim();
      if (npmGlobalRoot && fs.existsSync(npmGlobalRoot)) {
        env.NODE_PATH = `${npmGlobalRoot}:${env.NODE_PATH || ''}`;
      }
    } catch {}

    return env;
  }

  /**
   * Resolve the path to the appium binary.
   * Under launchd, npm global bin might not be in PATH.
   */
  private resolveAppiumBin(): string {
    // Check if appium is in PATH
    try {
      execFileSync('which', ['appium'], { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] });
      return 'appium';
    } catch {}

    // Common npm global bin locations
    const candidates = [
      '/usr/local/bin/appium',
      '/opt/homebrew/bin/appium',
      path.join(os.homedir(), '.npm-global/bin/appium'),
      path.join(os.homedir(), 'node_modules/.bin/appium'),
    ];
    for (const p of candidates) {
      if (fs.existsSync(p)) return p;
    }

    // Try npm root -g
    try {
      const npmRoot = execFileSync('npm', ['root', '-g'], {
        encoding: 'utf-8', timeout: 5000, stdio: ['pipe', 'pipe', 'pipe'],
      }).trim();
      const appiumBin = path.join(npmRoot, '.bin/appium');
      if (fs.existsSync(appiumBin)) return appiumBin;
      // Also check parent/bin
      const parentBin = path.join(path.dirname(npmRoot), 'bin/appium');
      if (fs.existsSync(parentBin)) return parentBin;
    } catch {}

    return 'appium'; // fallback — spawn will fail with descriptive error
  }

  /**
   * Start Appium server for iOS or Android.
   */
  private async startAppium(platform: string): Promise<void> {
    const proc = this.getSubProcess(platform, 'Appium Server');
    if (!proc) return;

    const port = this.getAppiumPort(platform);
    proc.healthUrl = `http://localhost:${port}`;

    // Check if already running
    if (await this.isAppiumRunning(port)) {
      proc.status = 'running';
      proc.startedAt = new Date().toISOString();
      this.startHealthCheck(platform, 'Appium Server', port);
      this.emitUpdate();
      return;
    }

    proc.status = 'starting';
    this.emitUpdate();

    const appiumBin = this.resolveAppiumBin();
    const mobileEnv = this.resolveMobileEnv();

    console.log(`[${platform}] Starting Appium: ${appiumBin} (JAVA_HOME=${mobileEnv.JAVA_HOME || 'unset'}, ANDROID_HOME=${mobileEnv.ANDROID_HOME || 'unset'})`);

    try {
      const args = ['--port', String(port), '--address', '0.0.0.0', '--log-level', 'info'];
      const child = spawn(appiumBin, args, {
        env: mobileEnv,
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      this.childProcesses.set(`${platform}:appium`, child);
      proc.pid = child.pid;
      proc.startedAt = new Date().toISOString();

      // Capture stderr for diagnostics
      let stderrBuf = '';
      child.stderr?.on('data', (data) => {
        stderrBuf += data.toString();
        if (stderrBuf.length > 2000) stderrBuf = stderrBuf.slice(-1000);
      });

      child.on('error', (err) => {
        proc.status = 'error';
        proc.error = `Failed to start Appium: ${err.message}. Install via: npm install -g appium`;
        console.error(`[${platform}] Appium spawn error: ${err.message}`);
        this.emitUpdate();
      });

      child.on('exit', (code) => {
        if (proc.status !== 'running') {
          proc.status = 'error';
          proc.error = `Appium exited (code ${code}): ${stderrBuf.slice(0, 200)}`;
          console.error(`[${platform}] Appium exited before ready (code ${code}): ${stderrBuf.slice(0, 300)}`);
        } else {
          proc.status = 'error';
          proc.error = `Appium exited unexpectedly (code ${code})`;
        }
        this.emitUpdate();
      });

      // Wait for Appium to be ready (poll /status)
      await new Promise<void>((resolve) => {
        let attempts = 0;
        const maxAttempts = 60; // 60s timeout (Appium can be slow on first boot)
        const interval = setInterval(async () => {
          attempts++;
          if (await this.isAppiumRunning(port)) {
            clearInterval(interval);
            proc.status = 'running';
            console.log(`[${platform}] Appium server ready on port ${port} (took ${attempts}s)`);
            this.startHealthCheck(platform, 'Appium Server', port);
            this.emitUpdate();
            resolve();
          } else if (attempts >= maxAttempts) {
            clearInterval(interval);
            proc.status = 'error';
            proc.error = `Appium failed to start within ${maxAttempts}s. stderr: ${stderrBuf.slice(0, 200)}`;
            console.error(`[${platform}] Appium timeout after ${maxAttempts}s. stderr: ${stderrBuf.slice(0, 500)}`);
            this.emitUpdate();
            resolve();
          }
        }, 1000);
      });
    } catch (err: any) {
      proc.status = 'error';
      proc.error = err.message;
      this.emitUpdate();
    }
  }

  /**
   * Resolve the tunnel-creation.mjs script path.
   * Priority: TUNNEL_SCRIPT_PATH env → ~/.appium installation → Katab_Stack local
   */
  private resolveTunnelScript(): string | null {
    if (config.paths.tunnelScript) {
      if (fs.existsSync(config.paths.tunnelScript)) return config.paths.tunnelScript;
    }

    const appiumHome = process.env.APPIUM_HOME || path.join(os.homedir(), '.appium');
    const appiumPath = path.join(appiumHome, 'node_modules/appium-xcuitest-driver/scripts/tunnel-creation.mjs');
    if (fs.existsSync(appiumPath)) return appiumPath;

    const localPath = path.resolve(__dirname, '../../../../Katab_Stack/node_modules/appium-xcuitest-driver/scripts/tunnel-creation.mjs');
    if (fs.existsSync(localPath)) return localPath;

    return null;
  }

  private async isAppiumRunning(port: number): Promise<boolean> {
    try {
      const res = await fetch(`http://localhost:${port}/status`, {
        signal: AbortSignal.timeout(2000),
      });
      const data: any = await res.json();
      return data?.value?.ready === true;
    } catch {
      return false;
    }
  }

  private startHealthCheck(platform: string, processName: string, port: number) {
    const key = `${platform}:${processName}`;
    const existing = this.healthTimers.get(key);
    if (existing) clearInterval(existing);

    const timer = setInterval(async () => {
      const proc = this.getSubProcess(platform, processName);
      if (!proc || proc.status === 'stopped') {
        clearInterval(timer);
        return;
      }
      const running = await this.isAppiumRunning(port);
      if (!running && proc.status === 'running') {
        proc.status = 'error';
        proc.error = 'Health check failed — process not responding';
        this.emitUpdate();
      } else if (running && proc.status === 'error') {
        proc.status = 'running';
        proc.error = undefined;
        this.emitUpdate();
      }
    }, 10_000);

    this.healthTimers.set(key, timer);
  }

  // ─── Worker status ──────────────────────────────────────

  /**
   * Mark a BullMQ worker as running for a given platform.
   * Called by WorkerManager after the BullMQ Worker is created.
   */
  setWorkerStatus(platform: string, status: ProcessStatus, error?: string) {
    const workerName = platform === 'ios' ? 'iOS Worker'
      : platform === 'android' ? 'Android Worker'
      : 'Web Worker';
    const proc = this.getSubProcess(platform, workerName);
    if (!proc) return;
    proc.status = status;
    proc.startedAt = status === 'running' ? new Date().toISOString() : proc.startedAt;
    if (error) proc.error = error;
    else if (status === 'running') proc.error = undefined;
    this.updateReadiness(platform);
    this.emitUpdate();
  }

  private updateReadiness(platform: string) {
    const state = this.platformStates.get(platform);
    if (!state) return;
    state.ready = state.processes.every(
      (p) => p.status === 'running' || p.status === 'not_required',
    );
  }

  private getSubProcess(platform: string, name: string): SubProcess | undefined {
    return this.platformStates.get(platform)?.processes.find((p) => p.name === name);
  }

  // ─── Shutdown ───────────────────────────────────────────

  async stopPlatform(platform: string) {
    console.log(`[${platform}] Stopping platform processes...`);

    for (const [key, child] of this.childProcesses) {
      if (key.startsWith(`${platform}:`)) {
        child.kill('SIGTERM');
        this.childProcesses.delete(key);
      }
    }

    for (const [key, timer] of this.healthTimers) {
      if (key.startsWith(`${platform}:`)) {
        clearInterval(timer);
        this.healthTimers.delete(key);
      }
    }

    const state = this.platformStates.get(platform);
    if (state) {
      state.processes.forEach((p) => {
        p.status = 'stopped';
        p.error = undefined;
      });
      state.ready = false;
    }
  }

  async stopAll() {
    for (const platform of this.platformStates.keys()) {
      await this.stopPlatform(platform);
    }
  }

  getStatus(): PlatformProcesses[] {
    return Array.from(this.platformStates.values());
  }

  getPlatformStatus(platform: string): PlatformProcesses | undefined {
    return this.platformStates.get(platform);
  }

  private emitUpdate() {
    // Future: push to dashboard via SSE
  }
}
