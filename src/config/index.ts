import * as dotenv from 'dotenv';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

// dotenv does NOT override existing env vars — process.env from parent takes priority
dotenv.config();

function resolveKatabCli(): string {
  if (process.env.KATAB_CLI_PATH) return process.env.KATAB_CLI_PATH;
  // 1) Local packages/recorder (bundled with KRC)
  const localPkg = path.resolve(__dirname, '../../packages/recorder/dist/cli.js');
  if (fs.existsSync(localPkg)) return localPkg;
  // 2) npm package (production)
  const npmPath = path.resolve(__dirname, '../../node_modules/@katab/recorder/dist/cli.js');
  if (fs.existsSync(npmPath)) return npmPath;
  // 3) Return local package path as default (will show clear error at execution time)
  return localPkg;
}

export const config = {
  cloud: {
    apiUrl: process.env.CLOUD_API_URL || 'http://localhost:4000/api/v1',
    runnerToken: process.env.RUNNER_API_TOKEN || '',
  },
  controlPlane: {
    apiUrl: process.env.CONTROL_PLANE_URL || 'http://localhost:4100/api',
    nodeToken: process.env.NODE_API_TOKEN || '',
    nodeName: process.env.NODE_NAME || os.hostname(),
  },
  runner: {
    tenantId: process.env.TENANT_ID || '',
    runnerId: process.env.RUNNER_ID || '',
    platforms: (process.env.RUNNER_PLATFORMS || 'web').split(',') as Array<'web' | 'ios' | 'android'>,
  },
  paths: {
    katabCli: resolveKatabCli(),
    scenarioDir: process.env.SCENARIO_DIR || path.resolve(__dirname, '../../scenarios'),
    reportDir: process.env.REPORT_DIR || path.resolve(__dirname, '../../reports'),
    tunnelScript: process.env.TUNNEL_SCRIPT_PATH || '',
  },
  localApi: {
    port: parseInt(process.env.LOCAL_API_PORT || '5001'),
    bind: process.env.LOCAL_API_BIND || '0.0.0.0',
  },
  mtls: {
    caCert: process.env.MTLS_CA_CERT || '',
    clientCert: process.env.MTLS_CLIENT_CERT || '',
    clientKey: process.env.MTLS_CLIENT_KEY || '',
  },
};
