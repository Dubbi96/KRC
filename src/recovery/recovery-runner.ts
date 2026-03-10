/**
 * Recovery Runner
 *
 * Executes recovery strategies step by step for a given failure.
 * Each step is attempted; if it succeeds, recovery stops.
 * If all steps fail, optionally requests quarantine from KCP.
 */

import { FailureCode, classifyFailure, RecoveryRecord, RecoveryAction } from 'katab-shared';
import { Provider, DetectedDevice } from '../provider/provider.interface';
import { ProviderRegistry } from '../provider/provider-registry';
import { RecoveryStrategyEngine } from './recovery-strategy';
import { RecoveryBudget } from './recovery-budget';

export interface RecoveryResult {
  recovered: boolean;
  records: RecoveryRecord[];
  shouldQuarantine: boolean;
  quarantineDurationMinutes: number;
  finalFailureCode: FailureCode;
}

export class RecoveryRunner {
  private strategyEngine = new RecoveryStrategyEngine();
  private recentRecords: RecoveryRecord[] = [];
  private budget = new RecoveryBudget();

  constructor(private registry: ProviderRegistry) {}

  /**
   * Attempt recovery for a failure.
   * Returns whether recovery was successful and the actions tried.
   */
  async attempt(
    failureCode: FailureCode,
    platform: string,
    device?: DetectedDevice,
  ): Promise<RecoveryResult> {
    const strategy = this.strategyEngine.getStrategy(failureCode)
      || this.strategyEngine.getDefaultStrategy(failureCode);

    const provider = this.registry.resolve(platform, {
      isSimulator: device?.isSimulator,
      isEmulator: device?.isEmulator,
    });

    if (!provider) {
      return {
        recovered: false,
        records: [],
        shouldQuarantine: false,
        quarantineDurationMinutes: 0,
        finalFailureCode: failureCode,
      };
    }

    // Check recovery budget before attempting
    const deviceId = device?.id || platform;
    const budgetCheck = this.budget.check(deviceId, failureCode);
    if (!budgetCheck.allowed) {
      console.warn(`[Recovery] Budget exceeded for ${deviceId}: ${budgetCheck.reason}`);
      return {
        recovered: false,
        records: [],
        shouldQuarantine: true,
        quarantineDurationMinutes: strategy.quarantineDurationMinutes || 30,
        finalFailureCode: failureCode,
      };
    }

    const records: RecoveryRecord[] = [];

    // Try each action in order
    for (const action of strategy.actions) {
      if (action === RecoveryAction.QUARANTINE) {
        // Quarantine is the last resort — don't execute it as a recovery action
        break;
      }

      try {
        console.log(`[Recovery] Trying ${action} for ${failureCode} on ${device?.id || platform}`);
        const record = await provider.recover(failureCode, device);
        record.action = action; // ensure the record reflects the intended action
        records.push(record);
        this.recentRecords.push(record);

        if (record.success) {
          console.log(`[Recovery] ${action} succeeded for ${failureCode}`);
          this.budget.record(deviceId, failureCode, action, true);
          return {
            recovered: true,
            records,
            shouldQuarantine: false,
            quarantineDurationMinutes: 0,
            finalFailureCode: failureCode,
          };
        }

        console.log(`[Recovery] ${action} failed: ${record.errorMessage || 'unknown reason'}`);
        this.budget.record(deviceId, failureCode, action, false);
      } catch (e: any) {
        console.error(`[Recovery] ${action} threw error: ${e.message}`);
        records.push({
          id: `err-${Date.now()}`,
          resourceId: device?.id || platform,
          resourceType: device ? 'device' : 'slot',
          failureCode,
          action,
          success: false,
          timestamp: new Date().toISOString(),
          durationMs: 0,
          errorMessage: e.message,
        });
      }
    }

    // All actions exhausted
    return {
      recovered: false,
      records,
      shouldQuarantine: strategy.quarantineAfterExhaustion,
      quarantineDurationMinutes: strategy.quarantineDurationMinutes,
      finalFailureCode: failureCode,
    };
  }

  /**
   * Attempt recovery from an error message (auto-classifies the failure).
   */
  async attemptFromError(
    errorMessage: string,
    platform: string,
    device?: DetectedDevice,
  ): Promise<RecoveryResult> {
    const classified = classifyFailure(errorMessage);
    return this.attempt(classified.code, platform, device);
  }

  /**
   * Get recent recovery records (for heartbeat reporting).
   */
  getRecentRecords(limit = 10): RecoveryRecord[] {
    return this.recentRecords.slice(-limit);
  }

  /**
   * Clear recent records.
   */
  clearRecords(): void {
    this.recentRecords = [];
  }
}
