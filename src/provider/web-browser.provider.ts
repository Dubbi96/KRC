/**
 * Web Browser Provider
 *
 * Manages Playwright-based browser sessions.
 * Health checks verify browser binary availability.
 */

import { Provider, DetectedDevice, CreateSessionOptions } from './provider.interface';
import {
  FailureCode, classifyFailure,
  HealthCheckResult, HealthCheckMode, HealthStatus, DeviceCapability, ProviderType,
  RecoveryRecord, RecoveryAction,
} from 'katab-shared';
import { v4 as uuid } from 'uuid';
import { execSync } from 'child_process';

export class WebBrowserProvider implements Provider {
  readonly type = ProviderType.WEB_BROWSER;
  readonly platform = 'web' as const;

  async healthCheck(_device?: DetectedDevice, mode: HealthCheckMode = HealthCheckMode.MEDIUM): Promise<HealthCheckResult> {
    const details: Record<string, boolean> = {};

    if (mode === HealthCheckMode.LIGHTWEIGHT) {
      // Lightweight: just check process exists
      details.playwrightAvailable = true; // assume available for web
      return { status: HealthStatus.HEALTHY, details };
    }

    // Medium+: Check if npx playwright is available
    try {
      execSync('npx playwright --version', { timeout: 10000, stdio: 'pipe' });
      details.playwrightAvailable = true;
    } catch {
      details.playwrightAvailable = false;
    }

    if (mode === HealthCheckMode.HEAVY) {
      // Heavy: also check for stale browser processes
      try {
        const result = execSync("pgrep -f 'chromium|chrome|firefox|webkit' 2>/dev/null | wc -l", {
          timeout: 5000, stdio: 'pipe',
        }).toString().trim();
        details.staleBrowserProcesses = parseInt(result, 10) > 20;
      } catch {
        details.staleBrowserProcesses = false;
      }
    }

    const allGood = details.playwrightAvailable && !(details.staleBrowserProcesses);
    return {
      status: allGood ? HealthStatus.HEALTHY : details.playwrightAvailable ? HealthStatus.DEGRADED : HealthStatus.UNHEALTHY,
      details,
      failureCode: allGood ? undefined : FailureCode.BROWSER_NOT_AVAILABLE,
    };
  }

  async probeCapabilities(_device: DetectedDevice): Promise<DeviceCapability> {
    const health = await this.healthCheck();
    return {
      isReachable: true, // web is always "reachable"
      isAutomatable: health.details.playwrightAvailable ?? false,
      canCapture: health.details.playwrightAvailable ?? false,
      canTouch: false, // web doesn't have touch in the mobile sense
    };
  }

  async prepare(_device: DetectedDevice): Promise<void> {
    // No preparation needed for web browser
  }

  async recover(failureCode: FailureCode): Promise<RecoveryRecord> {
    const start = Date.now();
    let success = false;
    let errorMessage: string | undefined;

    try {
      if (failureCode === FailureCode.BROWSER_CRASH || failureCode === FailureCode.BROWSER_NOT_AVAILABLE) {
        // Kill stale browser processes
        try {
          execSync("pkill -f 'chromium.*--headless' 2>/dev/null || true", { timeout: 5000, stdio: 'pipe' });
          success = true;
        } catch (e: any) {
          errorMessage = e.message;
        }
      }
    } catch (e: any) {
      errorMessage = e.message;
    }

    return {
      id: uuid(),
      resourceId: 'web-browser',
      resourceType: 'slot',
      failureCode,
      action: RecoveryAction.BROWSER_RESTART,
      success,
      timestamp: new Date().toISOString(),
      durationMs: Date.now() - start,
      errorMessage,
    };
  }

  async release(_deviceId: string): Promise<void> {
    // Session cleanup handled by session-manager
  }

  supports(capability: 'recording' | 'execution' | 'mirror'): boolean {
    return capability === 'recording' || capability === 'execution';
  }

  getSupportedRecoveryActions(): RecoveryAction[] {
    return [RecoveryAction.BROWSER_RESTART, RecoveryAction.SESSION_RECREATE];
  }
}
