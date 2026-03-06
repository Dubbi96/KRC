import { Worker, Job, Queue, ConnectionOptions } from 'bullmq';
import * as fs from 'fs';
import * as path from 'path';
import { config } from '../config';
import { ScenarioExecutor } from '../executor/scenario-executor';
import { CloudClient } from './cloud-client';
import { ProcessManager } from './process-manager';

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

export class WorkerManager {
  private workers: Worker[] = [];
  private queues: Map<string, Queue> = new Map();
  private connectionOpts: ConnectionOptions;
  private executor: ScenarioExecutor;
  private stats: Map<string, WorkerStats> = new Map();
  private jobLogs: Array<{ time: string; platform: string; jobId: string; event: string; detail?: string }> = [];
  readonly processManager: ProcessManager;

  constructor(private cloudClient: CloudClient) {
    this.connectionOpts = {
      host: config.redis.host,
      port: config.redis.port,
      password: config.redis.password,
      maxRetriesPerRequest: null,
      enableReadyCheck: false,
    };
    this.executor = new ScenarioExecutor();
    this.processManager = new ProcessManager();
  }

  private addLog(platform: string, jobId: string, event: string, detail?: string) {
    this.jobLogs.unshift({ time: new Date().toISOString(), platform, jobId, event, detail });
    if (this.jobLogs.length > 100) this.jobLogs.pop();
  }

  async start() {
    for (const platform of config.runner.platforms) {
      // Appium already started at boot time (main.ts → startAppiumServers).
      // Tunnel is started on-demand when a device is "connected".
      // Just verify Appium is still healthy, then start the BullMQ worker.
      await this.processManager.startPlatform(platform);
      await this.startWorker(platform);
    }
  }

  private async startWorker(platform: 'web' | 'ios' | 'android') {
    const queueName = `${config.queuePrefix}-${config.runner.tenantId}-${platform}`;
    console.log(`Starting worker for queue: ${queueName}`);

    this.processManager.setWorkerStatus(platform, 'starting');

    this.stats.set(platform, {
      platform,
      activeJobs: 0,
      completedJobs: 0,
      failedJobs: 0,
    });

    // Create a Queue instance for inspection
    const queue = new Queue(queueName, { connection: this.connectionOpts });
    this.queues.set(platform, queue);

    try {
      const worker = new Worker<ScenarioJobPayload>(
        queueName,
        async (job: Job<ScenarioJobPayload>) => {
          return this.processJob(job);
        },
        {
          connection: this.connectionOpts,
          concurrency: 1,
          lockDuration: 300_000, // 5 minutes
        },
      );

      worker.on('completed', (job) => {
        const stat = this.stats.get(platform)!;
        stat.activeJobs = Math.max(0, stat.activeJobs - 1);
        stat.completedJobs++;
        this.addLog(platform, job.id || '', 'completed');
        console.log(`Job ${job.id} completed (${platform})`);
      });

      worker.on('failed', (job, err) => {
        const stat = this.stats.get(platform)!;
        stat.activeJobs = Math.max(0, stat.activeJobs - 1);
        stat.failedJobs++;
        this.addLog(platform, job?.id || '', 'failed', err.message);
        console.error(`Job ${job?.id} failed (${platform}):`, err.message);
      });

      worker.on('error', (err) => {
        console.error(`Worker error (${platform}):`, err.message);
        this.processManager.setWorkerStatus(platform, 'error', err.message);
      });

      worker.on('ready', () => {
        this.processManager.setWorkerStatus(platform, 'running');
        this.addLog(platform, '', 'worker_ready', `Worker connected to Redis`);
      });

      this.workers.push(worker);
      // If 'ready' event doesn't fire (older bullmq), mark running after creation
      this.processManager.setWorkerStatus(platform, 'running');
    } catch (err: any) {
      this.processManager.setWorkerStatus(platform, 'error', err.message);
      this.addLog(platform, '', 'worker_error', err.message);
      console.error(`Failed to start worker for ${platform}:`, err.message);
    }
  }

  private async processJob(job: Job<ScenarioJobPayload>) {
    const { scenarioRunId, scenarioId, platform, options } = job.data;
    const stat = this.stats.get(platform)!;
    stat.activeJobs++;

    console.log(`Processing scenario ${scenarioId} (run: ${job.data.runId})`);

    // Report started to cloud
    await this.cloudClient.reportStarted(scenarioRunId);

    const startTime = Date.now();
    try {
      // Download scenario from Cloud before execution
      await this.syncScenario(scenarioId);

      // Execute the scenario using Katab CLI
      const result = await this.executor.execute({
        scenarioId,
        platform,
        options,
        scenarioDir: config.paths.scenarioDir,
        reportDir: config.paths.reportDir,
      });

      const durationMs = Date.now() - startTime;

      // Report completion to cloud
      await this.cloudClient.reportCompleted(scenarioRunId, {
        status: result.passed ? 'passed' : 'failed',
        durationMs,
        error: result.error,
        resultJson: result.details,
      });

      return { status: result.passed ? 'passed' : 'failed', durationMs };
    } catch (error: any) {
      const durationMs = Date.now() - startTime;

      await this.cloudClient.reportCompleted(scenarioRunId, {
        status: 'infra_failed',
        durationMs,
        error: error.message,
      });

      throw error;
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

    // Build full scenario file: merge scenarioData with top-level metadata
    // The Katab CLI expects { id, name, platform, events, variables, ... }
    const scenarioFile = {
      id: scenario.id,
      name: scenario.name,
      platform: scenario.platform,
      ...scenario.scenarioData,
    };

    const filePath = path.join(scenarioDir, `${scenarioId}.json`);

    // Extra safety: verify resolved path is inside scenarioDir
    const resolvedPath = path.resolve(filePath);
    const resolvedDir = path.resolve(scenarioDir);
    if (!resolvedPath.startsWith(resolvedDir + path.sep)) {
      throw new Error(`Path traversal detected: ${scenarioId}`);
    }

    fs.writeFileSync(filePath, JSON.stringify(scenarioFile, null, 2), 'utf-8');
    console.log(`Scenario synced to ${filePath}`);
  }

  async stop() {
    for (const worker of this.workers) {
      await worker.close();
    }
    for (const queue of this.queues.values()) {
      await queue.close();
    }
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

  async getDetailedStats(): Promise<Record<string, any>> {
    const result: Record<string, any> = {};
    for (const [platform, queue] of this.queues) {
      const localStat = this.stats.get(platform);
      const [waiting, active, completed, failed, delayed] = await Promise.all([
        queue.getWaitingCount(),
        queue.getActiveCount(),
        queue.getCompletedCount(),
        queue.getFailedCount(),
        queue.getDelayedCount(),
      ]);
      result[platform] = {
        waiting, active, completed, failed, delayed,
        localActive: localStat?.activeJobs || 0,
        localCompleted: localStat?.completedJobs || 0,
        localFailed: localStat?.failedJobs || 0,
      };
    }
    return result;
  }

  async getJobs(platform: string, status: 'waiting' | 'active' | 'completed' | 'failed' | 'delayed', start = 0, end = 19) {
    const queue = this.queues.get(platform);
    if (!queue) return [];
    const jobs = await queue.getJobs([status], start, end);
    return jobs.map((job) => ({
      id: job.id,
      name: job.name,
      data: job.data,
      attemptsMade: job.attemptsMade,
      timestamp: job.timestamp,
      processedOn: job.processedOn,
      finishedOn: job.finishedOn,
      failedReason: job.failedReason,
      returnvalue: job.returnvalue,
    }));
  }

  async retryJob(platform: string, jobId: string) {
    const queue = this.queues.get(platform);
    if (!queue) return null;
    const job = await queue.getJob(jobId);
    if (!job) return null;
    await job.retry();
    this.addLog(platform, jobId, 'retried');
    return { ok: true };
  }

  async removeJob(platform: string, jobId: string) {
    const queue = this.queues.get(platform);
    if (!queue) return null;
    const job = await queue.getJob(jobId);
    if (!job) return null;
    await job.remove();
    this.addLog(platform, jobId, 'removed');
    return { ok: true };
  }

  getLogs() {
    return this.jobLogs;
  }
}
