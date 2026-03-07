import { config } from './config';
import { WorkerManager } from './worker/worker-manager';
import { createLocalApi } from './api/local-api';
import { CloudClient } from './worker/cloud-client';
import { ControlPlaneClient } from './worker/control-plane-client';
import { SessionManager } from './device/session-manager';
import { createDeviceRouter, attachWebSocketStreaming } from './api/device-api';
import http from 'http';
import os from 'os';
import fs from 'fs';
import path from 'path';

function getLocalIp(): string {
  const envHost = process.env.RUNNER_ADVERTISE_HOST;
  if (envHost) return envHost;

  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name] || []) {
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address;
      }
    }
  }
  return 'localhost';
}

async function main() {
  console.log('=== Katab Node Agent (KRC) ===');
  console.log(`Node Name: ${config.controlPlane.nodeName}`);
  console.log(`Platforms: ${config.runner.platforms.join(', ')}`);
  console.log(`Control Plane: ${config.controlPlane.apiUrl}`);
  console.log(`Cloud API: ${config.cloud.apiUrl}`);

  // --- Control Plane Client (KCP) ---
  const cpClient = new ControlPlaneClient(
    config.controlPlane.apiUrl,
    config.controlPlane.nodeToken,
  );

  // Register with KCP if no token yet
  if (!config.controlPlane.nodeToken) {
    console.log('No NODE_API_TOKEN found. Registering with Control Plane...');
    try {
      const result = await cpClient.register({
        name: config.controlPlane.nodeName,
        host: getLocalIp(),
        port: config.localApi.port,
        platforms: config.runner.platforms,
        labels: (process.env.NODE_LABELS || '').split(',').filter(Boolean),
        version: '1.0.0',
      });
      cpClient.setToken(result.apiToken);
      console.log(`Registered as node ${result.id}`);
      console.log(`Node token: ${result.apiToken}`);
      console.log('Save this token as NODE_API_TOKEN in .env for future starts.');
    } catch (e: any) {
      console.warn(`KCP registration failed: ${e.message}`);
      console.warn('Continuing in standalone mode (Cloud-only).');
    }
  }

  // --- Cloud Client (KCD) - backward compatible ---
  const cloudClient = new CloudClient(config.cloud.apiUrl, config.cloud.runnerToken);

  // Initialize device session manager
  const sessionManager = new SessionManager();
  console.log(`Detected devices: ${sessionManager.getDetectedDevices().length}`);

  // Initialize BullMQ workers + ProcessManager
  const workerManager = new WorkerManager(cloudClient);

  // 1) Start Appium servers immediately (always on for mobile platforms)
  await workerManager.processManager.startAppiumServers();

  // 2) Inject ProcessManager into SessionManager for tunnel access
  sessionManager.setProcessManager(workerManager.processManager);

  // 3) Auto-connect all detected physical devices (so Cloud sees them immediately)
  await sessionManager.autoConnectDetectedDevices();

  // 4) Start BullMQ workers
  await workerManager.start();

  // 5) Build Express app
  const app = createLocalApi(workerManager, cloudClient);

  // Mount device routes
  app.use(createDeviceRouter(sessionManager));

  // Create HTTP server (needed for WebSocket upgrade)
  const server = http.createServer(app);

  // Attach WebSocket streaming for device mirror sessions
  attachWebSocketStreaming(server, sessionManager);

  const bindAddr = config.localApi.bind;
  server.listen(config.localApi.port, bindAddr, () => {
    console.log(`Local API running on ${bindAddr}:${config.localApi.port}`);
    console.log(`Dashboard: http://localhost:${config.localApi.port}`);
  });

  // --- Heartbeat builder (reports system resources + devices + slots + health) ---
  const buildHeartbeat = () => {
    const connectedDevices = sessionManager.getConnectedDevices();
    const sessions = sessionManager.listSessions();
    const stats = workerManager.getStats();

    // Calculate slot usage from worker stats
    const slotUsage: Record<string, { busy: number }> = {};
    for (const [platform, info] of Object.entries(stats)) {
      slotUsage[platform] = { busy: (info as any).activeJobs || 0 };
    }

    // Platform health status
    const appiumHealth: Record<string, boolean> = {};
    for (const p of ['ios', 'android']) {
      const ps = workerManager.processManager.getPlatformStatus(p);
      if (ps) appiumHealth[p] = ps.ready;
    }

    return {
      devices: connectedDevices.map((d) => ({
        id: d.id,
        platform: d.platform,
        name: d.name,
        model: d.model,
        version: (d as any).version,
      })),
      activeSessions: sessions.length,
      slots: slotUsage,
      localApiPort: config.localApi.port,
      localApiHost: getLocalIp(),
      appiumHealth,
      playwrightHealth: true, // Playwright is always ready (no server process)
    };
  };

  // --- Send heartbeats to both KCP and KCD ---
  const sendHeartbeats = async () => {
    const payload = buildHeartbeat();

    // KCP heartbeat (enhanced with system resources, receives directives)
    try {
      await cpClient.sendHeartbeat(payload);
    } catch (e: any) {
      // KCP may not be running yet, that's ok
    }

    // KCD heartbeat (backward compatible)
    try {
      await cloudClient.sendHeartbeat('online', payload);
    } catch (e: any) {
      console.error('Cloud heartbeat failed:', e.message);
    }
  };

  await sendHeartbeats();
  console.log('Initial heartbeat sent.');

  const heartbeatInterval = setInterval(sendHeartbeats, 30_000);

  // --- Job claim polling (pull pattern from KCP) ---
  let jobClaimActive = true;
  const pollJobs = async () => {
    while (jobClaimActive) {
      // Don't claim new jobs if draining
      if (cpClient.isDraining) {
        const stats = workerManager.getStats();
        const totalActive = Object.values(stats).reduce((sum, s) => sum + ((s as any).activeJobs || 0), 0);
        if (totalActive === 0) {
          console.log('[KRC] Drain complete — no active jobs remaining');
          // Send final offline heartbeat (not via sendHeartbeat which sets 'online')
          try {
            await cloudClient.sendHeartbeat('offline');
          } catch {}
          // Keep running for dashboard access but stop polling
          break;
        }
        // Still have active jobs — wait and check again
        await new Promise((r) => setTimeout(r, 5_000));
        continue;
      }

      try {
        const job = await cpClient.claimJob(config.runner.platforms);
        if (job) {
          console.log(`[KCP] Claimed job ${job.id} (${job.platform})`);
          // Report started
          await cpClient.reportJobStarted(job.id);
          // Report scenario-run started if available
          if (job.payload?.scenarioRunId) {
            await cpClient.reportScenarioRunStarted(job.payload.scenarioRunId).catch(() => {});
          }
          // Execute via existing worker infrastructure
          try {
            const result = await workerManager.executeJob(job);
            const passed = result.status === 'passed';
            await cpClient.reportJobCompleted(job.id, {
              passed,
              status: result.status,
              durationMs: result.durationMs,
              error: result.error,
            });
            // Report scenario-run completion to KCP orchestrator
            if (job.payload?.scenarioRunId) {
              await cpClient.reportScenarioRunCompleted(job.payload.scenarioRunId, {
                status: result.status,
                durationMs: result.durationMs,
                error: result.error,
              }).catch(() => {});
            }
          } catch (err: any) {
            await cpClient.reportJobCompleted(job.id, {
              passed: false,
              infraFailure: true,
              error: err.message,
            });
            if (job.payload?.scenarioRunId) {
              await cpClient.reportScenarioRunCompleted(job.payload.scenarioRunId, {
                status: 'infra_failed',
                error: err.message,
              }).catch(() => {});
            }
          }
        } else {
          // No jobs available, wait before polling again
          await new Promise((r) => setTimeout(r, 5_000));
        }
      } catch {
        // KCP may not be available
        await new Promise((r) => setTimeout(r, 10_000));
      }
    }
  };

  // Start job polling in background (non-blocking)
  pollJobs();

  // --- Cleanup Watchdog (runs every 60s) ---
  const cleanupWatchdog = async () => {
    try {
      // 1) Clean old temp files (reports older than 24h)
      const reportDir = config.paths.reportDir;
      if (fs.existsSync(reportDir)) {
        const cutoff = Date.now() - 24 * 60 * 60 * 1000;
        const entries = fs.readdirSync(reportDir);
        for (const entry of entries) {
          const fullPath = path.join(reportDir, entry);
          try {
            const stat = fs.statSync(fullPath);
            if (stat.mtimeMs < cutoff) {
              fs.rmSync(fullPath, { recursive: true, force: true });
            }
          } catch {}
        }
      }

      // 2) Check for sessions that have been stuck in 'creating' for > 5 minutes
      const sessions = sessionManager.listSessions();
      for (const session of sessions) {
        if (session.status === 'creating') {
          const age = Date.now() - new Date(session.createdAt).getTime();
          if (age > 5 * 60 * 1000) {
            console.warn(`[Cleanup] Session ${session.id} stuck in 'creating' for ${Math.round(age / 1000)}s — closing`);
            await sessionManager.closeSession(session.id).catch(() => {});
          }
        }
      }
    } catch (e: any) {
      console.error('[Cleanup] Watchdog error:', e.message);
    }
  };

  const cleanupInterval = setInterval(cleanupWatchdog, 60_000);

  // Graceful shutdown
  const shutdown = async () => {
    console.log('\nShutting down node agent...');
    jobClaimActive = false;
    clearInterval(heartbeatInterval);
    clearInterval(cleanupInterval);
    await sessionManager.shutdown();
    await workerManager.stop();
    try { await cpClient.sendHeartbeat({ devices: [], activeSessions: 0 }); } catch {}
    try { await cloudClient.sendHeartbeat('offline'); } catch {}
    server.close();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((e) => {
  console.error('Fatal error:', e);
  process.exit(1);
});
