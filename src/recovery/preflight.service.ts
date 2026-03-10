/**
 * Preflight Service
 *
 * Runs checks before job execution to ensure the environment is ready.
 * If checks fail, attempts recovery before giving up.
 */

import { FailureCode, HealthCheckMode, HealthStatus } from 'katab-shared';
import { Provider, DetectedDevice } from '../provider/provider.interface';
import { ProviderRegistry } from '../provider/provider-registry';
import { RecoveryRunner, RecoveryResult } from './recovery-runner';

export interface PreflightResult {
  passed: boolean;
  failureCode?: FailureCode;
  message?: string;
  recoveryAttempted: boolean;
  recoveryResult?: RecoveryResult;
}

export class PreflightService {
  constructor(
    private registry: ProviderRegistry,
    private recoveryRunner: RecoveryRunner,
  ) {}

  /**
   * Run preflight checks for a job.
   * Returns pass/fail with details.
   */
  async check(
    platform: string,
    device?: DetectedDevice,
  ): Promise<PreflightResult> {
    const provider = this.registry.resolve(platform, {
      isSimulator: device?.isSimulator,
      isEmulator: device?.isEmulator,
    });

    if (!provider) {
      return {
        passed: false,
        failureCode: FailureCode.UNKNOWN,
        message: `No provider found for platform: ${platform}`,
        recoveryAttempted: false,
      };
    }

    // 1. Provider health check (MEDIUM mode for preflight)
    const healthResult = await provider.healthCheck(device, HealthCheckMode.MEDIUM);

    if (healthResult.status === HealthStatus.HEALTHY) {
      return { passed: true, recoveryAttempted: false };
    }

    // 2. If not healthy, determine the failure
    const failureCode = healthResult.failureCode || FailureCode.UNKNOWN;
    console.log(`[Preflight] Health check failed: ${healthResult.status} (${failureCode})`);

    // 3. Attempt recovery
    const recoveryResult = await this.recoveryRunner.attempt(
      failureCode,
      platform,
      device,
    );

    if (recoveryResult.recovered) {
      // Verify health after recovery (HEAVY mode for post-recovery verification)
      const recheck = await provider.healthCheck(device, HealthCheckMode.HEAVY);
      if (recheck.status === HealthStatus.HEALTHY || recheck.status === HealthStatus.DEGRADED) {
        console.log('[Preflight] Recovery successful — proceeding with job');
        return { passed: true, recoveryAttempted: true, recoveryResult };
      }
    }

    // 4. Recovery failed
    return {
      passed: false,
      failureCode,
      message: `Preflight failed: ${healthResult.status}. Recovery ${recoveryResult.recovered ? 'succeeded but recheck failed' : 'failed'}.`,
      recoveryAttempted: true,
      recoveryResult,
    };
  }
}
