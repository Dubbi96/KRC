import os from 'os';
import fs from 'fs';
import { config } from '../config';

/**
 * HTTP client for communicating with KCP (Katab Control Plane).
 * Handles node registration, heartbeat with system resources, and job claim.
 */
export class ControlPlaneClient {
  private baseUrl: string;
  private nodeToken: string;
  private _draining = false;

  constructor(baseUrl: string, nodeToken: string) {
    this.baseUrl = baseUrl;
    this.nodeToken = nodeToken;
  }

  get isDraining() { return this._draining; }

  setToken(token: string) {
    this.nodeToken = token;
  }

  private async request(method: string, path: string, body?: any) {
    const url = `${this.baseUrl}${path}`;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (this.nodeToken) {
      headers['X-Node-Token'] = this.nodeToken;
    }

    const res = await fetch(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`KCP API error ${res.status}: ${text}`);
    }
    return res.json() as Promise<any>;
  }

  // === Node Registration ===

  async register(params: {
    name: string;
    host: string;
    port: number;
    platforms: string[];
    labels?: string[];
    version?: string;
  }): Promise<{ id: string; apiToken: string }> {
    return this.request('POST', '/nodes/register', params);
  }

  // === Heartbeat with full system telemetry ===

  async sendHeartbeat(extra: {
    devices?: any[];
    activeSessions?: number;
    slots?: Record<string, any>;
    localApiPort?: number;
    localApiHost?: string;
    appiumHealth?: Record<string, boolean>;
    playwrightHealth?: boolean;
  }) {
    const cpus = os.cpus();
    const totalMem = Math.round(os.totalmem() / (1024 * 1024));
    const freeMem = Math.round(os.freemem() / (1024 * 1024));
    const load = os.loadavg();

    // Disk usage (best effort)
    let diskUsagePercent = 0;
    try {
      const stats = fs.statfsSync('/');
      const totalBlocks = stats.blocks;
      const freeBlocks = stats.bfree;
      diskUsagePercent = Math.round((1 - freeBlocks / totalBlocks) * 1000) / 10;
    } catch {}

    const result = await this.request('POST', '/nodes/heartbeat', {
      status: 'online',
      cpuCores: cpus.length,
      memoryMb: totalMem,
      diskGb: Math.round(os.totalmem() / (1024 * 1024 * 1024)), // approximate
      cpuUsagePercent: Math.round(load[0] / cpus.length * 100 * 10) / 10,
      memoryUsagePercent: Math.round((1 - freeMem / totalMem) * 100 * 10) / 10,
      diskUsagePercent,
      loadAverage: load.map((l) => Math.round(l * 100) / 100),
      agentVersion: '1.0.0',
      ...extra,
    });

    // Process directives from KCP
    if (result.directives?.drain && !this._draining) {
      console.log('[KRC] Received drain directive from KCP — stopping new job acceptance');
      this._draining = true;
    }

    return result;
  }

  // === Job claim (pull pattern) ===

  async claimJob(platforms: string[]): Promise<any | null> {
    const result = await this.request('POST', '/jobs/claim', { platforms });
    return result.noJob ? null : result;
  }

  async reportJobStarted(jobId: string) {
    return this.request('POST', `/jobs/${jobId}/started`);
  }

  async reportJobCompleted(jobId: string, result: Record<string, any>) {
    return this.request('POST', `/jobs/${jobId}/completed`, result);
  }

  // === Scenario-run callbacks (for KCP orchestration) ===

  async reportScenarioRunStarted(srId: string) {
    return this.request('POST', `/runs/scenario-runs/${srId}/started`);
  }

  async reportScenarioRunCompleted(srId: string, result: Record<string, any>) {
    return this.request('POST', `/runs/scenario-runs/${srId}/completed`, result);
  }
}
