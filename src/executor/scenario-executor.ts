import { spawn } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import { config } from '../config';

export interface ExecuteOptions {
  scenarioId: string;
  platform: 'web' | 'ios' | 'android';
  options: Record<string, any>;
  scenarioDir: string;
  reportDir: string;
}

export interface ExecuteResult {
  passed: boolean;
  error?: string;
  details?: Record<string, any>;
  reportPath?: string;
}

/**
 * Executes Katab scenarios by spawning the Katab CLI process.
 * This integrates with the existing `packages/recorder` replay functionality.
 */
export class ScenarioExecutor {
  async execute(opts: ExecuteOptions): Promise<ExecuteResult> {
    // Validate scenarioId format (UUID only) to prevent path traversal
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(opts.scenarioId)) {
      return {
        passed: false,
        error: `Invalid scenario ID format: ${opts.scenarioId}`,
      };
    }

    const scenarioPath = path.join(opts.scenarioDir, `${opts.scenarioId}.json`);

    // Verify resolved path is inside scenarioDir
    const resolvedPath = path.resolve(scenarioPath);
    const resolvedDir = path.resolve(opts.scenarioDir);
    if (!resolvedPath.startsWith(resolvedDir + path.sep)) {
      return {
        passed: false,
        error: `Path traversal detected: ${opts.scenarioId}`,
      };
    }

    if (!fs.existsSync(scenarioPath)) {
      return {
        passed: false,
        error: `Scenario file not found: ${scenarioPath}`,
      };
    }

    const cliPath = config.paths.katabCli;
    if (!fs.existsSync(cliPath)) {
      return {
        passed: false,
        error: `Katab CLI not found at: ${cliPath}. Run 'pnpm build' in Katab_Stack first.`,
      };
    }

    return new Promise<ExecuteResult>((resolve) => {
      const args = [
        cliPath,
        'run',
        opts.scenarioId,
        '-o', opts.scenarioDir,
        '-r', opts.reportDir,
      ];

      if (opts.options.headless) args.push('--headless');
      if (opts.options.speed) args.push('--speed', String(opts.options.speed));
      if (opts.options.takeScreenshots) args.push('--screenshots');
      if (opts.options.authProfileId) args.push('--auth', opts.options.authProfileId);
      if (opts.options.stopOnFailure !== false) args.push('--stop-on-failure');

      const child = spawn('node', args, {
        cwd: path.dirname(cliPath),
        env: { ...process.env, FORCE_COLOR: '0' },
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      let stdout = '';
      let stderr = '';

      child.stdout.on('data', (data) => {
        stdout += data.toString();
      });
      child.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      const timeout = setTimeout(() => {
        child.kill('SIGTERM');
        resolve({
          passed: false,
          error: 'Scenario execution timed out (10 minutes)',
        });
      }, 600_000);

      child.on('close', (code) => {
        clearTimeout(timeout);

        if (code === 0) {
          // Try to parse result from stdout
          let details: any;
          try {
            const jsonMatch = stdout.match(/\{[\s\S]*\}$/);
            if (jsonMatch) details = JSON.parse(jsonMatch[0]);
          } catch {}

          resolve({
            passed: true,
            details,
            reportPath: path.join(opts.reportDir, opts.scenarioId),
          });
        } else {
          resolve({
            passed: false,
            error: stderr || `Process exited with code ${code}`,
            details: { stdout: stdout.slice(-2000), stderr: stderr.slice(-2000) },
          });
        }
      });

      child.on('error', (err) => {
        clearTimeout(timeout);
        resolve({
          passed: false,
          error: `Failed to spawn process: ${err.message}`,
        });
      });
    });
  }
}
