import { config } from './config';
import { WorkerManager } from './worker/worker-manager';
import { createLocalApi } from './api/local-api';
import { CloudClient } from './worker/cloud-client';
import { ControlPlaneClient } from './worker/control-plane-client';
import { SessionManager } from './device/session-manager';
import { createDeviceRouter, attachWebSocketStreaming } from './api/device-api';
import http from 'http';
import os from 'os';

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

  // --- Heartbeat builder (reports system resources + devices + slots) ---
  const buildHeartbeat = () => {
    const connectedDevices = sessionManager.getConnectedDevices();
    const sessions = sessionManager.listSessions();
    const stats = workerManager.getStats();

    // Calculate slot usage from worker stats
    const slotUsage: Record<string, { busy: number }> = {};
    for (const [platform, info] of Object.entries(stats)) {
      slotUsage[platform] = { busy: (info as any).activeJobs || 0 };
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
    };
  };

  // --- Send heartbeats to both KCP and KCD ---
  const sendHeartbeats = async () => {
    const payload = buildHeartbeat();

    // KCP heartbeat (enhanced with system resources)
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
      try {
        const job = await cpClient.claimJob(config.runner.platforms);
        if (job) {
          console.log(`[KCP] Claimed job ${job.id} (${job.platform})`);
          // Report started
          await cpClient.reportJobStarted(job.id);
          // Execute via existing worker infrastructure
          // The job payload contains scenarioId and options
          try {
            const result = await workerManager.executeJob(job);
            await cpClient.reportJobCompleted(job.id, {
              passed: result.status === 'passed',
              ...result,
            });
          } catch (err: any) {
            await cpClient.reportJobCompleted(job.id, {
              passed: false,
              infraFailure: true,
              error: err.message,
            });
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

  // Graceful shutdown
  const shutdown = async () => {
    console.log('\nShutting down node agent...');
    jobClaimActive = false;
    clearInterval(heartbeatInterval);
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
