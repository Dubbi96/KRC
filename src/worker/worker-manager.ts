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
      id: scenario.id,
      name: scenario.name,
      platform: scenario.platform,
      ...scenario.scenarioData,
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
    let releasedDeviceUdid: string | null = null;
    try {
      // Report started to KCD as well if scenarioRunId exists
      if (scenarioRunId) {
        await this.cloudClient.reportStarted(scenarioRunId).catch(() => {});
      }

      // Download and execute scenario
      if (scenarioId) {
        await this.syncScenario(scenarioId);
      }

      // Close active mirror sessions AND release standby Appium session
      // before iOS/Android test to prevent WDA/port conflicts
      if ((platform === 'ios' || platform === 'android') && this.sessionManager && scenarioId) {
        try {
          const scenarioPath = path.join(config.paths.scenarioDir, `${scenarioId}.json`);
          const scenarioData = JSON.parse(fs.readFileSync(scenarioPath, 'utf-8'));
          const deviceUdid = scenarioData.deviceId || scenarioData.udid;
          if (deviceUdid) {
            // Close active mirror session
            const existingSession = this.sessionManager.getSessionByDeviceId(deviceUdid, platform);
            if (existingSession) {
              console.log(`[WorkerManager] Closing active mirror session ${existingSession.id} on device ${deviceUdid} before test execution`);
              await this.sessionManager.closeSession(existingSession.id);
            }
            // Release standby Appium session (frees WDA + ports for recorder CLI)
            const released = await this.sessionManager.releaseStandbySession(deviceUdid);
            if (released) {
              releasedDeviceUdid = deviceUdid;
            }
          }
        } catch (e: any) {
          console.warn(`[WorkerManager] Failed to release sessions: ${e.message}`);
        }
      }

      const result = await this.executor.execute({
        scenarioId: scenarioId || job.id,
        platform,
        options: job.payload.options || {},
        scenarioDir: config.paths.scenarioDir,
        reportDir: config.paths.reportDir,
      });

      // Restore standby session after test execution
      if (releasedDeviceUdid && this.sessionManager) {
        this.sessionManager.restoreStandbySession(releasedDeviceUdid).catch((e: any) => {
          console.warn(`[WorkerManager] Failed to restore standby session: ${e.message}`);
        });
      }

      const durationMs = Date.now() - startTime;

      // Report to KCD as well
      if (scenarioRunId) {
        await this.cloudClient.reportCompleted(scenarioRunId, {
          status: result.passed ? 'passed' : 'failed',
          durationMs,
          error: result.error,
          resultJson: result.details,
        }).catch(() => {});
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
        }).catch(() => {});
      }

      if (stat) {
        stat.activeJobs = Math.max(0, stat.activeJobs - 1);
        stat.failedJobs++;
      }
      this.addLog(platform, job.id, 'kcp_job_failed', error.message);

      // Restore standby session on error path too
      if (releasedDeviceUdid && this.sessionManager) {
        this.sessionManager.restoreStandbySession(releasedDeviceUdid).catch(() => {});
      }

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
}
