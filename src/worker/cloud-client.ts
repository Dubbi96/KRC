/**
 * HTTP client for communicating with the Cloud Orchestrator.
 * Uses Runner API token for authentication.
 */
export class CloudClient {
  constructor(
    private baseUrl: string,
    private token: string,
  ) {}

  private async request(method: string, path: string, body?: any) {
    const url = `${this.baseUrl}${path}`;
    const res = await fetch(url, {
      method,
      headers: {
        'Content-Type': 'application/json',
        'X-Runner-Token': this.token,
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Cloud API error ${res.status}: ${text}`);
    }
    return res.json();
  }

  // === Callbacks ===

  async reportStarted(scenarioRunId: string) {
    return this.request('POST', `/runner/scenario-runs/${scenarioRunId}/started`);
  }

  async reportCompleted(
    scenarioRunId: string,
    result: {
      status: 'passed' | 'failed' | 'infra_failed';
      durationMs?: number;
      error?: string;
      resultJson?: any;
    },
  ) {
    return this.request('POST', `/runner/scenario-runs/${scenarioRunId}/completed`, result);
  }

  async sendHeartbeat(status: 'online' | 'offline' | 'busy', extra?: Record<string, any>) {
    return this.request('POST', '/runner/heartbeat', { status, ...extra });
  }

  async downloadScenario(scenarioId: string) {
    const url = `${this.baseUrl}/runner/scenarios/${scenarioId}`;
    const res = await fetch(url, {
      headers: { 'X-Runner-Token': this.token },
    });
    if (!res.ok) throw new Error(`Failed to download scenario ${scenarioId}`);
    return res.json();
  }

  // === Queries (for local management dashboard) ===

  async getRunnerInfo() {
    return this.request('GET', '/runner/me');
  }

  async listRunners() {
    return this.request('GET', '/runner/runners');
  }

  async listRuns(limit = 20, offset = 0) {
    return this.request('GET', `/runner/runs?limit=${limit}&offset=${offset}`);
  }

  async getQueueStats() {
    return this.request('GET', '/runner/queue-stats');
  }
}
