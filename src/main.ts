import { config } from './config';
import { WorkerManager } from './worker/worker-manager';
import { createLocalApi } from './api/local-api';
import { CloudClient } from './worker/cloud-client';
import { ControlPlaneClient } from './worker/control-plane-client';
import { SessionManager } from './device/session-manager';
import { createDeviceRouter, attachWebSocketStreaming } from './api/device-api';
import { CloudTunnel } from './tunnel/cloud-tunnel';
import { ProviderRegistry } from './provider/provider-registry';
import { DeviceCapabilityProbe } from './device/device-capability-probe';
import { DeviceHealthSnapshot } from './common/health-model';
import http from 'http';
import os from 'os';
import fs from 'fs';
import path from 'path';

// Heartbeat file logger — keeps heartbeat noise out of main console
const heartbeatLogPath = path.join(process.cwd(), 'logs', 'heartbeat.log');
let heartbeatLogStream: fs.WriteStream | null = null;
function heartbeatLog(msg: string) {
  if (!heartbeatLogStream) {
    fs.mkdirSync(path.dirname(heartbeatLogPath), { recursive: true });
    heartbeatLogStream = fs.createWriteStream(heartbeatLogPath, { flags: 'a' });
  }
  heartbeatLogStream.write(`[${new Date().toISOString()}] ${msg}\n`);
}

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

  // Register or re-register with KCP
  const registerWithKcp = async () => {
    console.log('Registering with Control Plane...');
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

    // Auto-persist NODE_API_TOKEN to .env for future starts
    try {
      const envPath = require('path').resolve(__dirname, '../.env');
      const fs = require('fs');
      if (fs.existsSync(envPath)) {
        let envContent = fs.readFileSync(envPath, 'utf-8');
        if (envContent.includes('NODE_API_TOKEN=')) {
          envContent = envContent.replace(/NODE_API_TOKEN=.*/, `NODE_API_TOKEN=${result.apiToken}`);
        } else {
          envContent += `\nNODE_API_TOKEN=${result.apiToken}\n`;
        }
        fs.writeFileSync(envPath, envContent, 'utf-8');
        console.log('NODE_API_TOKEN saved to .env');
      }
    } catch (e: any) {
      console.warn(`Could not save NODE_API_TOKEN to .env: ${e.message}`);
    }
  };

  if (!config.controlPlane.nodeToken) {
    console.log('No NODE_API_TOKEN found.');
    try {
      await registerWithKcp();
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

  // Initialize provider registry and capability probe
  const providerRegistry = new ProviderRegistry({
    iosAppiumPort: 4723,
    androidAppiumPort: 4724,
  });
  const capabilityProbe = new DeviceCapabilityProbe(providerRegistry);
  console.log(`Provider registry initialized: ${providerRegistry.all().map(p => p.type).join(', ')}`);

  // Initialize WorkerManager (KCP pull mode — no BullMQ/Redis)
  const workerManager = new WorkerManager(cloudClient);

  // 1) Start Appium servers immediately (always on for mobile platforms)
  await workerManager.processManager.startAppiumServers();

  // 2) Inject ProcessManager into SessionManager for tunnel/port access
  sessionManager.setProcessManager(workerManager.processManager);

  // 3) Inject SessionManager into WorkerManager (close mirror sessions before iOS/Android tests)
  workerManager.setSessionManager(sessionManager);

  // 3) Devices are shown in KRC Dashboard — operator manually clicks "Connect"
  //    to register them. Only connected devices are reported to Cloud via heartbeat.
  console.log(`  → ${sessionManager.getDetectedDevices().length} device(s) available for connection in Dashboard.`);

  // 4) Initialize platform workers (no BullMQ — jobs pulled from KCP)
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
  await new Promise<void>((resolve, reject) => {
    server.once('error', (err: any) => {
      console.error(`FATAL: Cannot bind to ${bindAddr}:${config.localApi.port} — ${err.message}`);
      console.error('Another KRC instance may already be running. Exiting.');
      process.exit(1);
    });
    server.listen(config.localApi.port, bindAddr, () => {
      console.log(`Local API running on ${bindAddr}:${config.localApi.port}`);
      console.log(`Dashboard: http://localhost:${config.localApi.port}`);
      resolve();
    });
  });

  // --- Cloud Tunnel (reverse WebSocket for KCD → KRC commands) ---
  let cloudTunnel: CloudTunnel | null = null;
  if (config.cloud.apiUrl && config.cloud.runnerToken) {
    // Derive tunnel URL from CLOUD_API_URL: http://host/api/v1 → ws://host/ws/runner-tunnel
    const tunnelUrl = config.cloud.apiUrl
      .replace(/\/api\/v1\/?$/, '')
      .replace(/^http/, 'ws') + '/ws/runner-tunnel';
    cloudTunnel = new CloudTunnel(tunnelUrl, config.cloud.runnerToken, sessionManager);
    cloudTunnel.connect();
    console.log(`Cloud tunnel connecting to: ${tunnelUrl}`);
  }

  // --- Job concurrency state (declared early so heartbeat can reference it) ---
  let jobClaimActive = true;
  const activeJobs = new Map<string, Promise<void>>();
  const maxConcurrentJobs = Math.max(config.runner.platforms.length, 2);

  // --- Device health cache (updated periodically) ---
  let cachedDeviceHealth: Record<string, DeviceHealthSnapshot> = {};
  const updateDeviceHealth = async () => {
    try {
      const connectedDevices = sessionManager.getConnectedDevices();
      if (connectedDevices.length > 0) {
        cachedDeviceHealth = await capabilityProbe.probeAll(
          connectedDevices.map(d => ({
            id: d.id,
            platform: d.platform as 'ios' | 'android' | 'web',
            name: d.name,
            model: d.model,
            udid: (d as any).udid || d.id,
            isSimulator: (d as any).isSimulator,
            isEmulator: (d as any).isEmulator,
          })),
        );
      }
    } catch (e: any) {
      console.warn(`[HealthProbe] Failed: ${e.message}`);
    }
  };

  // Run initial health probe, then every 60 seconds
  updateDeviceHealth();
  setInterval(updateDeviceHealth, 60_000);

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
      supportedPlatforms: config.runner.platforms,
      maxConcurrentJobs: maxConcurrentJobs,
      activeJobCount: activeJobs.size,
      deviceHealth: cachedDeviceHealth,
    };
  };

  // --- Send heartbeats to both KCP and KCD ---
  let kcpAuthRetried = false;
  const sendHeartbeats = async () => {
    const payload = buildHeartbeat();

    // KCP heartbeat (enhanced with system resources, receives directives)
    try {
      await cpClient.sendHeartbeat(payload);
      heartbeatLog('KCP heartbeat OK');
      kcpAuthRetried = false; // Reset on success
    } catch (e: any) {
      heartbeatLog(`KCP heartbeat failed: ${e.message}`);
      // Auto-re-register if token is invalid (e.g., KCP DB was reset)
      if (!kcpAuthRetried && (e.message?.includes('401') || e.message?.includes('Unauthorized'))) {
        kcpAuthRetried = true;
        console.warn('[KRC] KCP auth failed — attempting re-registration...');
        try {
          await registerWithKcp();
          // Retry heartbeat with new token
          await cpClient.sendHeartbeat(payload);
          heartbeatLog('KCP heartbeat OK (after re-registration)');
          console.log('[KRC] Re-registration successful, heartbeat restored.');
        } catch (regErr: any) {
          console.warn(`[KRC] Re-registration failed: ${regErr.message}`);
        }
      }
    }

    // KCD heartbeat (backward compatible)
    try {
      await cloudClient.sendHeartbeat('online', payload);
      heartbeatLog('KCD heartbeat OK');
    } catch (e: any) {
      heartbeatLog(`KCD heartbeat failed: ${e.message}`);
    }
  };

  await sendHeartbeats();
  console.log('Initial heartbeat sent.');

  const heartbeatInterval = setInterval(sendHeartbeats, 30_000);

  // --- Job claim polling (concurrent pull pattern from KCP) ---

  const executeJobAsync = async (job: any) => {
    const scenarioRunId = job.scenarioRunId || job.payload?.scenarioRunId;
    try {
      await cpClient.reportJobStarted(job.id);
      if (scenarioRunId) {
        await cpClient.reportScenarioRunStarted(scenarioRunId).catch(() => {});
      }

      const result = await workerManager.executeJob(job);
      const passed = result.status === 'passed';
      await cpClient.reportJobCompleted(job.id, {
        passed,
        status: result.status,
        durationMs: result.durationMs,
        error: result.error,
      });
      if (scenarioRunId) {
        await cpClient.reportScenarioRunCompleted(scenarioRunId, {
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
      if (scenarioRunId) {
        await cpClient.reportScenarioRunCompleted(scenarioRunId, {
          status: 'infra_failed',
          error: err.message,
        }).catch(() => {});
      }
    } finally {
      activeJobs.delete(job.id);
      console.log(`[KCP] Job ${job.id} done (active: ${activeJobs.size}/${maxConcurrentJobs})`);
    }
  };

  const pollJobs = async () => {
    console.log(`[KRC] Job polling started (max concurrent: ${maxConcurrentJobs})`);

    while (jobClaimActive) {
      // Don't claim new jobs if draining
      if (cpClient.isDraining) {
        if (activeJobs.size === 0) {
          console.log('[KRC] Drain complete — no active jobs remaining');
          try { await cloudClient.sendHeartbeat('offline'); } catch {}
          break;
        }
        await new Promise((r) => setTimeout(r, 5_000));
        continue;
      }

      // Wait for capacity before claiming more jobs
      if (activeJobs.size >= maxConcurrentJobs) {
        await Promise.race([...activeJobs.values()]).catch(() => {});
        continue;
      }

      try {
        const job = await cpClient.claimJob(config.runner.platforms);
        if (job) {
          console.log(`[KCP] Claimed job ${job.id} (${job.platform}) — active: ${activeJobs.size + 1}/${maxConcurrentJobs}`);
          // Fire execution without blocking the poll loop
          const p = executeJobAsync(job);
          activeJobs.set(job.id, p);
          // Immediately try to claim the next job
          continue;
        } else {
          await new Promise((r) => setTimeout(r, 5_000));
        }
      } catch {
        await new Promise((r) => setTimeout(r, 10_000));
      }
    }

    // Wait for all in-flight jobs to finish
    if (activeJobs.size > 0) {
      console.log(`[KRC] Waiting for ${activeJobs.size} active job(s) to complete...`);
      await Promise.allSettled([...activeJobs.values()]);
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
    if (cloudTunnel) cloudTunnel.close();
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
