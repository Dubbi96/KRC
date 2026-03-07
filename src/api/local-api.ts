import express, { Request, Response, NextFunction } from 'express';
import os from 'os';
import { WorkerManager } from '../worker/worker-manager';
import { CloudClient } from '../worker/cloud-client';
import { config } from '../config';
import { DASHBOARD_HTML } from './dashboard.html';

/**
 * Auth middleware: validates Bearer token against RUNNER_API_TOKEN.
 * Allows unauthenticated access to /health for load balancer checks.
 */
function authMiddleware(req: Request, res: Response, next: NextFunction) {
  // Public paths (no auth required)
  if (req.path === '/' || req.path === '/health') return next();

  const expectedToken = config.cloud.runnerToken;
  if (!expectedToken) {
    // No token configured — allow all (dev mode)
    return next();
  }

  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing Authorization header' });
  }

  const token = authHeader.slice(7);
  if (token !== expectedToken) {
    return res.status(403).json({ error: 'Invalid token' });
  }

  next();
}

export function createLocalApi(workerManager: WorkerManager, cloudClient: CloudClient) {
  const app = express();
  app.use(express.json());
  app.use(authMiddleware);

  // Dashboard UI (token injected so browser JS can call authenticated APIs)
  app.get('/', (_req, res) => {
    const html = DASHBOARD_HTML.replace('__RUNNER_TOKEN__', config.cloud.runnerToken || '');
    res.type('html').send(html);
  });

  // Runner status
  app.get('/status', (_req, res) => {
    res.json({
      runner: {
        id: config.runner.runnerId,
        tenantId: config.runner.tenantId,
        platforms: config.runner.platforms,
        cloudApiUrl: config.cloud.apiUrl,
      },
      workers: workerManager.getStats(),
      uptime: process.uptime(),
    });
  });

  // System resources
  app.get('/resources', (_req, res) => {
    const cpus = os.cpus();
    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    const usedMem = totalMem - freeMem;

    // CPU usage approximation from cpus idle vs total
    let totalIdle = 0, totalTick = 0;
    for (const cpu of cpus) {
      for (const type of Object.keys(cpu.times) as Array<keyof typeof cpu.times>) {
        totalTick += cpu.times[type];
      }
      totalIdle += cpu.times.idle;
    }
    const cpuUsage = 1 - totalIdle / totalTick;

    res.json({
      cpuUsage,
      memTotal: totalMem,
      memUsed: usedMem,
      memFree: freeMem,
      nodeVersion: process.version,
      osPlatform: os.platform(),
      osArch: os.arch(),
      osRelease: os.release(),
      hostname: os.hostname(),
      cpuCount: cpus.length,
      loadAvg: os.loadavg(),
    });
  });

  // Platform processes (per-platform sub-process status)
  app.get('/platforms', (_req, res) => {
    res.json(workerManager.processManager.getStatus());
  });

  app.get('/platforms/:platform', (req, res) => {
    const status = workerManager.processManager.getPlatformStatus(req.params.platform);
    if (!status) return res.status(404).json({ error: 'Platform not found' });
    res.json(status);
  });

  // === Cloud proxy routes ===

  app.get('/cloud/info', async (_req, res) => {
    try {
      const info = await cloudClient.getRunnerInfo();
      res.json(info);
    } catch (e: any) {
      res.status(502).json({ error: e.message });
    }
  });

  app.get('/cloud/runners', async (_req, res) => {
    try {
      const runners = await cloudClient.listRunners();
      res.json(runners);
    } catch (e: any) {
      res.status(502).json({ error: e.message });
    }
  });

  app.get('/cloud/runs', async (req, res) => {
    try {
      const limit = parseInt(req.query.limit as string) || 20;
      const offset = parseInt(req.query.offset as string) || 0;
      const runs = await cloudClient.listRuns(limit, offset);
      res.json(runs);
    } catch (e: any) {
      res.status(502).json({ error: e.message });
    }
  });

  // === Queue management ===

  app.get('/queue/:platform/stats', async (req, res) => {
    try {
      const detailed = await workerManager.getDetailedStats();
      res.json(detailed[req.params.platform] || {});
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get('/queue/:platform/jobs', async (req, res) => {
    try {
      const status = (req.query.status as string) || 'waiting';
      const start = parseInt(req.query.start as string) || 0;
      const end = parseInt(req.query.end as string) || 19;
      const jobs = await workerManager.getJobs(req.params.platform, status as any, start, end);
      res.json(jobs);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post('/queue/:platform/jobs/:jobId/retry', async (req, res) => {
    try {
      const result = await workerManager.retryJob(req.params.platform, req.params.jobId);
      res.json(result || { error: 'Job not found' });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.delete('/queue/:platform/jobs/:jobId', async (req, res) => {
    try {
      const result = await workerManager.removeJob(req.params.platform, req.params.jobId);
      res.json(result || { error: 'Job not found' });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // Activity logs
  app.get('/logs', (_req, res) => {
    res.json(workerManager.getLogs());
  });

  // Health check
  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  return app;
}
