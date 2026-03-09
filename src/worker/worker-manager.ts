import * as fs from 'fs';
import * as path from 'path';
import { config } from '../config';
import { ScenarioExecutor } from '../executor/scenario-executor';
import { CloudClient } from './cloud-client';
import { ProcessManager } from './process-manager';
import type { SessionManager } from '../device/session-manager';

export interface ScenarioJobPayload {
  tenantId: string;
  scenarioRunId: string;
  runId: string;
  scenarioId: string;
  sequenceNo: number;
  platform: 'web' | 'ios' | 'android';
  options: Record<string, any>;
  attempt: number;
}

interface WorkerStats {
  platform: string;
  activeJobs: number;
  completedJobs: number;
  failedJobs: number;
}

/**
 * WorkerManager — manages scenario execution infrastructure.
 *
 * Jobs are claimed from KCP via HTTP polling (pull pattern).
 * BullMQ/Redis has been removed — KCP uses PostgreSQL
 * SELECT FOR UPDATE SKIP LOCKED for atomic job assignment.
 */
export class WorkerManager {
  private executor: ScenarioExecutor;
  private stats: Map<string, WorkerStats> = new Map();
  private jobLogs: Array<{ time: string; platform: string; jobId: string; event: string; detail?: string }> = [];
  readonly processManager: ProcessManager;
  private sessionManager: SessionManager | null = null;

  constructor(private cloudClient: CloudClient) {
    this.executor = new ScenarioExecutor();
    this.processManager = new ProcessManager();
  }

  /** Inject SessionManager so we can close mirror sessions before test execution */
  setSessionManager(sm: SessionManager) {
    this.sessionManager = sm;
  }

  private addLog(platform: string, jobId: string, event: string, detail?: string) {
    this.jobLogs.unshift({ time: new Date().toISOString(), platform, jobId, event, detail });
    if (this.jobLogs.length > 100) this.jobLogs.pop();
  }

  async start() {
    for (const platform of config.runner.platforms) {
      // Start Appium and platform prerequisites
      await this.processManager.startPlatform(platform);
      this.processManager.setWorkerStatus(platform, 'running');

      this.stats.set(platform, {
        platform,
        activeJobs: 0,
        completedJobs: 0,
        failedJobs: 0,
      });

      this.addLog(platform, '', 'worker_ready', 'Platform initialized (KCP pull mode)');
    }
  }

  /** Validate scenarioId to prevent path traversal */
  private validateScenarioId(scenarioId: string): void {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(scenarioId)) {
      throw new Error(`Invalid scenario ID format: ${scenarioId}`);
    }
  }

  private async syncScenario(scenarioId: string) {
    this.validateScenarioId(scenarioId);

    const scenarioDir = config.paths.scenarioDir;
    if (!fs.existsSync(scenarioDir)) {
      fs.mkdirSync(scenarioDir, { recursive: true });
    }

    console.log(`Downloading scenario ${scenarioId} from Cloud...`);
    const scenario = await this.cloudClient.downloadScenario(scenarioId) as {
      id: string; name: string; platform: string; scenarioData: any;
    };

    const scenarioFile = {
      ...scenario.scenarioData,
      id: scenario.id,         // KCD entity ID must override scenarioData.id (recording-time ID)
      name: scenario.name,
      platform: scenario.platform,
    };

    const filePath = path.join(scenarioDir, `${scenarioId}.json`);

    const resolvedPath = path.resolve(filePath);
    const resolvedDir = path.resolve(scenarioDir);
    if (!resolvedPath.startsWith(resolvedDir + path.sep)) {
      throw new Error(`Path traversal detected: ${scenarioId}`);
    }

    fs.writeFileSync(filePath, JSON.stringify(scenarioFile, null, 2), 'utf-8');
    console.log(`Scenario synced to ${filePath}`);
  }

  /**
   * Execute a job claimed from KCP (Control Plane).
   */
  async executeJob(job: {
    id: string;
    scenarioId?: string;
    platform: string;
    payload: Record<string, any>;
    scenarioRunId?: string;
    runId?: string;
  }): Promise<{ status: string; durationMs?: number; error?: string }> {
    const platform = job.platform as 'web' | 'ios' | 'android';
    const scenarioId = job.scenarioId || job.payload.scenarioId;
    const scenarioRunId = job.scenarioRunId || job.payload.scenarioRunId;

    const stat = this.stats.get(platform);
    if (stat) stat.activeJobs++;
    this.addLog(platform, job.id, 'kcp_job_started');

    const startTime = Date.now();
    try {
      // Report started to KCD as well if scenarioRunId exists
      if (scenarioRunId) {
        await this.cloudClient.reportStarted(scenarioRunId).catch(() => {});
      }

      // Download and execute scenario
      if (scenarioId) {
        await this.syncScenario(scenarioId);
      }

      // For iOS/Android: get standby session info to pass to recorder CLI for reuse.
      // Also close any active mirror sessions to avoid device conflicts.
      let existingAppiumSessionId: string | undefined;
      let existingAppiumUrl: string | undefined;
      if ((platform === 'ios' || platform === 'android') && this.sessionManager && scenarioId) {
        try {
          const scenarioPath = path.join(config.paths.scenarioDir, `${scenarioId}.json`);
          const scenarioData = JSON.parse(fs.readFileSync(scenarioPath, 'utf-8'));
          const deviceUdid = scenarioData.deviceId || scenarioData.udid;
          if (deviceUdid) {
            // Close active mirror session (if any cloud user is borrowing the device)
            const existingSession = this.sessionManager.getSessionByDeviceId(deviceUdid, platform);
            if (existingSession) {
              console.log(`[WorkerManager] Closing active mirror session ${existingSession.id} on device ${deviceUdid} before test execution`);
              await this.sessionManager.closeSession(existingSession.id);
            }
            // Get standby Appium session info for recorder to reuse (WDA stays running)
            const standbyInfo = this.sessionManager.getStandbySessionInfo(deviceUdid);
            if (standbyInfo) {
              existingAppiumSessionId = standbyInfo.sessionId;
              existingAppiumUrl = standbyInfo.appiumUrl;
              console.log(`[WorkerManager] Passing standby session ${existingAppiumSessionId} to recorder CLI`);
            }
          }
        } catch (e: any) {
          console.warn(`[WorkerManager] Failed to prepare session: ${e.message}`);
        }
      }

      const result = await this.executor.execute({
        scenarioId: scenarioId || job.id,
        platform,
        options: job.payload.options || {},
        scenarioDir: config.paths.scenarioDir,
        reportDir: config.paths.reportDir,
        existingAppiumSessionId,
        existingAppiumUrl,
        // Default: return to home after mobile scenario. KCD can set returnToHome=false for chain continuation.
        returnToHome: job.payload.options?.returnToHome !== false,
      });

      const durationMs = Date.now() - startTime;

      // Report to KCD with full step details (strip base64 blobs for payload size)
      if (scenarioRunId) {
        const resultJson = result.details ? this.stripBase64(result.details) : undefined;
        await this.cloudClient.reportCompleted(scenarioRunId, {
          status: result.passed ? 'passed' : 'failed',
          durationMs,
          error: result.error,
          resultJson,
        }).catch((e) => console.error(`[WorkerManager] reportCompleted failed: ${e.message}`));
      }

      if (stat) {
        stat.activeJobs = Math.max(0, stat.activeJobs - 1);
        stat.completedJobs++;
      }
      this.addLog(platform, job.id, 'kcp_job_completed');

      return { status: result.passed ? 'passed' : 'failed', durationMs };
    } catch (error: any) {
      const durationMs = Date.now() - startTime;

      if (scenarioRunId) {
        await this.cloudClient.reportCompleted(scenarioRunId, {
          status: 'infra_failed',
          durationMs,
          error: error.message,
        }).catch((e) => console.error(`[WorkerManager] reportCompleted (infra_failed) failed: ${e.message}`));
      }

      if (stat) {
        stat.activeJobs = Math.max(0, stat.activeJobs - 1);
        stat.failedJobs++;
      }
      this.addLog(platform, job.id, 'kcp_job_failed', error.message);

      return { status: 'infra_failed', durationMs, error: error.message };
    }
  }

  async stop() {
    await this.processManager.stopAll();
    console.log('All workers stopped');
  }

  getStats(): Record<string, any> {
    const result: Record<string, any> = {};
    for (const stat of this.stats.values()) {
      result[stat.platform] = {
        active: stat.activeJobs,
        completed: stat.completedJobs,
        failed: stat.failedJobs,
      };
    }
    return result;
  }

  getLogs() {
    return this.jobLogs;
  }

  /** Strip large blobs from TestResult to reduce payload size for KCD.
   *  Keeps screenshotBase64 so KCD can generate reports with step screenshots.
   *  Strips pageSourceXml (debug-only, very large) and imageMatch blobs. */
  private stripBase64(details: any): any {
    if (!details || typeof details !== 'object') return details;
    const clone = JSON.parse(JSON.stringify(details));
    if (Array.isArray(clone.events)) {
      for (const ev of clone.events) {
        // Keep screenshotBase64 — KCD needs it for report generation
        // Strip pageSourceXml (debug-only, very large XML)
        if (ev.artifacts?.pageSourceXml) {
          ev.artifacts.pageSourceXml = '[stripped]';
        }
        // Strip image match base64
        if (ev.imageMatchData?.templateBase64) ev.imageMatchData.templateBase64 = '[stripped]';
        if (ev.imageMatchData?.screenshotBase64) ev.imageMatchData.screenshotBase64 = '[stripped]';
        if (ev.imageMatchData?.diffBase64) ev.imageMatchData.diffBase64 = '[stripped]';
      }
    }
    return clone;
  }
}
