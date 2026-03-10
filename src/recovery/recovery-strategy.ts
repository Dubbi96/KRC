/**
 * Recovery Strategy Engine
 *
 * Maps FailureCode to an ordered list of RecoveryActions.
 * The RecoveryRunner tries each action in order until one succeeds.
 */

import { FailureCode } from '../common/failure-taxonomy';
import { RecoveryAction, RecoveryStrategy } from '../common/recovery-types';

const DEFAULT_STRATEGIES: RecoveryStrategy[] = [
  // iOS
  {
    failureCode: FailureCode.WDA_NOT_REACHABLE,
    actions: [RecoveryAction.SESSION_RECREATE, RecoveryAction.WDA_REBUILD, RecoveryAction.QUARANTINE],
    maxAttempts: 3,
    quarantineAfterExhaustion: true,
    quarantineDurationMinutes: 30,
  },
  {
    failureCode: FailureCode.WDA_BUILD_FAILED,
    actions: [RecoveryAction.WDA_REBUILD, RecoveryAction.QUARANTINE],
    maxAttempts: 2,
    quarantineAfterExhaustion: true,
    quarantineDurationMinutes: 60,
  },
  {
    failureCode: FailureCode.TUNNEL_CREATION_FAILED,
    actions: [RecoveryAction.TUNNEL_RECONNECT, RecoveryAction.SESSION_RECREATE, RecoveryAction.QUARANTINE],
    maxAttempts: 3,
    quarantineAfterExhaustion: true,
    quarantineDurationMinutes: 15,
  },

  // Android
  {
    failureCode: FailureCode.ADB_OFFLINE,
    actions: [RecoveryAction.ADB_RECONNECT, RecoveryAction.DEVICE_REBOOT, RecoveryAction.QUARANTINE],
    maxAttempts: 3,
    quarantineAfterExhaustion: true,
    quarantineDurationMinutes: 30,
  },
  {
    failureCode: FailureCode.ADB_UNAUTHORIZED,
    actions: [RecoveryAction.ADB_RECONNECT, RecoveryAction.QUARANTINE],
    maxAttempts: 1,
    quarantineAfterExhaustion: true,
    quarantineDurationMinutes: 60,
  },
  {
    failureCode: FailureCode.UIAUTOMATOR_CRASH,
    actions: [RecoveryAction.SESSION_RECREATE, RecoveryAction.APPIUM_RESTART, RecoveryAction.QUARANTINE],
    maxAttempts: 3,
    quarantineAfterExhaustion: true,
    quarantineDurationMinutes: 15,
  },

  // Session
  {
    failureCode: FailureCode.SESSION_STALE,
    actions: [RecoveryAction.SESSION_RECREATE],
    maxAttempts: 2,
    quarantineAfterExhaustion: false,
    quarantineDurationMinutes: 0,
  },
  {
    failureCode: FailureCode.SESSION_CREATE_FAILED,
    actions: [RecoveryAction.SESSION_RECREATE, RecoveryAction.APPIUM_RESTART, RecoveryAction.QUARANTINE],
    maxAttempts: 3,
    quarantineAfterExhaustion: true,
    quarantineDurationMinutes: 15,
  },
  {
    failureCode: FailureCode.SESSION_TIMEOUT,
    actions: [RecoveryAction.SESSION_RECREATE],
    maxAttempts: 2,
    quarantineAfterExhaustion: false,
    quarantineDurationMinutes: 0,
  },

  // App
  {
    failureCode: FailureCode.APP_CRASH_ON_LAUNCH,
    actions: [RecoveryAction.APP_FORCE_STOP, RecoveryAction.SESSION_RECREATE],
    maxAttempts: 2,
    quarantineAfterExhaustion: false,
    quarantineDurationMinutes: 0,
  },

  // Infra
  {
    failureCode: FailureCode.APPIUM_NOT_RUNNING,
    actions: [RecoveryAction.APPIUM_RESTART, RecoveryAction.QUARANTINE],
    maxAttempts: 2,
    quarantineAfterExhaustion: true,
    quarantineDurationMinutes: 30,
  },
  {
    failureCode: FailureCode.BROWSER_CRASH,
    actions: [RecoveryAction.BROWSER_RESTART, RecoveryAction.SESSION_RECREATE],
    maxAttempts: 3,
    quarantineAfterExhaustion: false,
    quarantineDurationMinutes: 0,
  },
  {
    failureCode: FailureCode.BROWSER_NOT_AVAILABLE,
    actions: [RecoveryAction.BROWSER_RESTART, RecoveryAction.QUARANTINE],
    maxAttempts: 2,
    quarantineAfterExhaustion: true,
    quarantineDurationMinutes: 30,
  },

  // Device
  {
    failureCode: FailureCode.DEVICE_DISCONNECTED,
    actions: [RecoveryAction.TUNNEL_RECONNECT, RecoveryAction.QUARANTINE],
    maxAttempts: 2,
    quarantineAfterExhaustion: true,
    quarantineDurationMinutes: 15,
  },
];

const strategyMap = new Map<FailureCode, RecoveryStrategy>();
for (const s of DEFAULT_STRATEGIES) {
  strategyMap.set(s.failureCode, s);
}

export class RecoveryStrategyEngine {
  /**
   * Get the recovery strategy for a failure code.
   */
  getStrategy(failureCode: FailureCode): RecoveryStrategy | undefined {
    return strategyMap.get(failureCode);
  }

  /**
   * Get the default fallback strategy (session recreate → quarantine).
   */
  getDefaultStrategy(failureCode: FailureCode): RecoveryStrategy {
    return {
      failureCode,
      actions: [RecoveryAction.SESSION_RECREATE, RecoveryAction.QUARANTINE],
      maxAttempts: 2,
      quarantineAfterExhaustion: true,
      quarantineDurationMinutes: 15,
    };
  }
}
