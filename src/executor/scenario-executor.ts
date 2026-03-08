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
  /** Existing Appium session ID to reuse (standby WDA) */
  existingAppiumSessionId?: string;
  /** Appium server URL for the existing session */
  existingAppiumUrl?: string;
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
  /**
   * Check if a scenario can run headless by inspecting its events.
   * If any event is wait_for_user with resumeOn='keypress' (or default),
   * the scenario requires headed mode (user interaction).
   */
  private canRunHeadless(scenarioPath: string): boolean {
    try {
      const data = JSON.parse(fs.readFileSync(scenarioPath, 'utf-8'));
      const events: any[] = data.events || data.scenarioData?.events || [];
      for (const event of events) {
        if (event.type === 'wait_for_user') {
          // Default resumeOn is 'keypress' — requires headed mode
          const resumeOn = event.resumeOn || event.data?.resumeOn || 'keypress';
          if (resumeOn === 'keypress') {
            return false; // Cannot run headless — needs user interaction
          }
        }
      }
      return true; // No keypress waits — headless is fine
    } catch {
      return true; // If we can't read the file, default to headless
    }
  }

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
        error: `Katab CLI not found at: ${cliPath}. Run 'cd packages/recorder && npm run build' first.`,
      };
    }

    // Auto-detect headed/headless (matches Katab_Stack logic):
    // - headless explicitly set → respect it, but override if scenario can't run headless
    // - headless not specified (undefined) → auto-detect from scenario events
    const canBeHeadless = this.canRunHeadless(scenarioPath);
    let useHeadless: boolean;

    if (opts.options.headless !== undefined) {
      // Explicit: use requested value, but force headed if scenario requires it
      useHeadless = opts.options.headless && canBeHeadless;
      if (opts.options.headless && !canBeHeadless) {
        console.log(`Scenario ${opts.scenarioId} has wait_for_user keypress events — forcing headed mode`);
      }
    } else {
      // Auto-detect: headless if scenario allows it
      useHeadless = canBeHeadless;
      if (useHeadless) {
        console.log(`Auto-headless: scenario ${opts.scenarioId} (no keypress wait_for_user)`);
      }
    }

    return new Promise<ExecuteResult>((resolve) => {
      const args = [
        cliPath,
        'run',
        opts.scenarioId,
        '-o', opts.scenarioDir,
        '-r', opts.reportDir,
      ];

      if (useHeadless) args.push('--headless');
      if (opts.options.speed) args.push('--speed', String(opts.options.speed));
      if (opts.options.takeScreenshots) args.push('--screenshots');
      if (opts.options.authProfileId) args.push('--auth', opts.options.authProfileId);
      if (opts.options.stopOnFailure !== false) args.push('--stop-on-failure');

      // Chain Variables: pass accumulated variables from previous scenarios
      if (opts.options.chainVariables && typeof opts.options.chainVariables === 'object') {
        for (const [key, value] of Object.entries(opts.options.chainVariables)) {
          if (value != null) {
            args.push('--var', `${key}=${value}`);
          }
        }
      }

      // Pass standby Appium session info via env vars for iOS/Android session reuse
      const childEnv: Record<string, string> = { ...process.env as any, FORCE_COLOR: '0' };
      if (opts.existingAppiumSessionId) {
        childEnv.EXISTING_APPIUM_SESSION_ID = opts.existingAppiumSessionId;
      }
      if (opts.existingAppiumUrl) {
        childEnv.EXISTING_APPIUM_URL = opts.existingAppiumUrl;
      }

      const child = spawn('node', args, {
        cwd: path.dirname(cliPath),
        env: childEnv,
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
