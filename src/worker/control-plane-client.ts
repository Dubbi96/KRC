import os from 'os';
import fs from 'fs';
import https from 'https';
import http from 'http';
import { config } from '../config';

/**
 * HTTP client for communicating with KCP (Katab Control Plane).
 * Handles node registration, heartbeat with system resources, and job claim.
 *
 * Supports optional mTLS: when MTLS_CA_CERT + MTLS_CLIENT_CERT + MTLS_CLIENT_KEY
 * are set, all requests use mutual TLS for strong node authentication.
 */
export class ControlPlaneClient {
  private baseUrl: string;
  private nodeToken: string;
  private _draining = false;
  private httpsAgent: https.Agent | null = null;

  constructor(baseUrl: string, nodeToken: string) {
    this.baseUrl = baseUrl;
    this.nodeToken = nodeToken;

    // Initialize mTLS agent if certificates are configured
    const { caCert, clientCert, clientKey } = config.mtls;
    if (caCert && clientCert && clientKey) {
      try {
        this.httpsAgent = new https.Agent({
          ca: fs.readFileSync(caCert),
          cert: fs.readFileSync(clientCert),
          key: fs.readFileSync(clientKey),
          rejectUnauthorized: true,
        });
        console.log('[KRC] mTLS enabled for KCP communication');
      } catch (err: any) {
        console.warn(`[KRC] mTLS certificate loading failed: ${err.message}`);
        console.warn('[KRC] Falling back to token-based auth');
      }
    }
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

    // Use mTLS-capable request when agent is configured and URL is HTTPS
    if (this.httpsAgent && url.startsWith('https://')) {
      return this.requestWithAgent(method, url, headers, body);
    }

    // Standard fetch (token-based auth)
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

  /**
   * HTTPS request with mTLS client certificate.
   * Uses Node.js https module since built-in fetch doesn't support custom agents.
   */
  private requestWithAgent(method: string, url: string, headers: Record<string, string>, body?: any): Promise<any> {
    return new Promise((resolve, reject) => {
      const parsedUrl = new URL(url);
      const payload = body ? JSON.stringify(body) : undefined;

      if (payload) {
        headers['Content-Length'] = Buffer.byteLength(payload).toString();
      }

      const transport = parsedUrl.protocol === 'https:' ? https : http;
      const req = transport.request({
        hostname: parsedUrl.hostname,
        port: parsedUrl.port,
        path: parsedUrl.pathname + parsedUrl.search,
        method,
        headers,
        agent: this.httpsAgent || undefined,
      }, (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          if (res.statusCode && res.statusCode >= 400) {
            reject(new Error(`KCP API error ${res.statusCode}: ${data}`));
            return;
          }
          try {
            resolve(JSON.parse(data));
          } catch {
            resolve(data);
          }
        });
      });

      req.on('error', reject);
      req.setTimeout(30000, () => {
        req.destroy(new Error('Request timeout'));
      });

      if (payload) req.write(payload);
      req.end();
    });
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
