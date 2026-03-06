import { config } from './config';
import { WorkerManager } from './worker/worker-manager';
import { createLocalApi } from './api/local-api';
import { CloudClient } from './worker/cloud-client';
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
  console.log('=== Katab Local Runner ===');
  console.log(`Tenant: ${config.runner.tenantId}`);
  console.log(`Runner: ${config.runner.runnerId}`);
  console.log(`Platforms: ${config.runner.platforms.join(', ')}`);
  console.log(`Cloud API: ${config.cloud.apiUrl}`);

  if (!config.runner.tenantId || !config.cloud.runnerToken) {
    console.error('ERROR: TENANT_ID and RUNNER_API_TOKEN are required.');
    console.error('Register a runner in the cloud dashboard first.');
    process.exit(1);
  }

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
    if (bindAddr === '127.0.0.1' || bindAddr === 'localhost') {
      console.log('NOTE: API bound to localhost only. Set LOCAL_API_BIND=0.0.0.0 to allow external access.');
    }
  });

  // Heartbeat payload builder — reports only CONNECTED (registered) devices
  const buildHeartbeat = () => {
    const connectedDevices = sessionManager.getConnectedDevices();
    return {
      devices: connectedDevices.map((d) => ({
        id: d.id, platform: d.platform, name: d.name, model: d.model,
      })),
      activeSessions: sessionManager.listSessions().length,
      localApiPort: config.localApi.port,
      localApiHost: getLocalIp(),
    };
  };

  // Send initial heartbeat immediately
  try {
    await cloudClient.sendHeartbeat('online', buildHeartbeat());
    console.log('Initial heartbeat sent.');
  } catch (e: any) {
    console.error('Initial heartbeat failed:', e.message);
  }

  // Then send periodically
  const heartbeatInterval = setInterval(async () => {
    try {
      await cloudClient.sendHeartbeat('online', buildHeartbeat());
    } catch (e: any) {
      console.error('Heartbeat failed:', e.message);
    }
  }, 30_000);

  // Graceful shutdown
  const shutdown = async () => {
    console.log('\nShutting down runner...');
    clearInterval(heartbeatInterval);
    await sessionManager.shutdown();
    await workerManager.stop();
    await cloudClient.sendHeartbeat('offline').catch(() => {});
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
