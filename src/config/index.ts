import * as dotenv from 'dotenv';
import * as path from 'path';
import * as fs from 'fs';

// dotenv does NOT override existing env vars — process.env from parent takes priority
dotenv.config();

function resolveKatabCli(): string {
  if (process.env.KATAB_CLI_PATH) return process.env.KATAB_CLI_PATH;
  // 1) npm package (production)
  const npmPath = path.resolve(__dirname, '../../node_modules/@katab/recorder/dist/cli.js');
  if (fs.existsSync(npmPath)) return npmPath;
  // 2) Local Katab_Stack monorepo (development)
  const localPath = path.resolve(__dirname, '../../../../Katab_Stack/packages/recorder/dist/cli.js');
  if (fs.existsSync(localPath)) return localPath;
  // 3) Return npm path as default (will show clear error at execution time)
  return npmPath;
}

export const config = {
  cloud: {
    apiUrl: process.env.CLOUD_API_URL || 'http://localhost:4000/api/v1',
    runnerToken: process.env.RUNNER_API_TOKEN || '',
  },
  redis: {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379'),
    password: process.env.REDIS_PASSWORD || undefined,
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
    bind: process.env.LOCAL_API_BIND || '127.0.0.1',
  },
  queuePrefix: process.env.QUEUE_PREFIX || 'katab',
};
