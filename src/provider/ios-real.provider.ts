/**
 * iOS Real Device Provider
 *
 * Manages real iOS device sessions via Appium XCUITest.
 * Health checks verify Appium server, device connectivity, and WDA status.
 */

import { Provider, DetectedDevice } from './provider.interface';
import {
  FailureCode,
  HealthCheckResult, HealthCheckMode, HealthStatus, DeviceCapability, ProviderType,
  RecoveryRecord, RecoveryAction,
} from 'katab-shared';
import { v4 as uuid } from 'uuid';
import { execSync } from 'child_process';

export class IOSRealProvider implements Provider {
  readonly type = ProviderType.IOS_REAL;
  readonly platform = 'ios' as const;

  private appiumPort: number;

  constructor(appiumPort = 4723) {
    this.appiumPort = appiumPort;
  }

  async healthCheck(device?: DetectedDevice, mode: HealthCheckMode = HealthCheckMode.MEDIUM): Promise<HealthCheckResult> {
    const details: Record<string, boolean> = {};

    if (mode === HealthCheckMode.LIGHTWEIGHT) {
      // Lightweight: quick Appium /status only (no xcrun, no device probe)
      try {
        const resp = await fetch(`http://127.0.0.1:${this.appiumPort}/status`, { signal: AbortSignal.timeout(3000) });
        details.appiumReachable = resp.ok;
      } catch {
        details.appiumReachable = false;
      }
      return {
        status: details.appiumReachable ? HealthStatus.HEALTHY : HealthStatus.UNHEALTHY,
        details,
        failureCode: details.appiumReachable ? undefined : FailureCode.APPIUM_NOT_RUNNING,
      };
    }

    // Medium+: Check Appium server
    try {
      const resp = await fetch(`http://127.0.0.1:${this.appiumPort}/status`, { signal: AbortSignal.timeout(5000) });
      details.appiumReachable = resp.ok;
    } catch {
      details.appiumReachable = false;
    }

    // Medium+: Check xcrun devicectl
    try {
      execSync('xcrun devicectl list devices 2>/dev/null', { timeout: 10000, stdio: 'pipe' });
      details.xcrunAvailable = true;
    } catch {
      details.xcrunAvailable = false;
    }

    // Medium+: Check specific device if provided
    if (device?.udid) {
      try {
        const output = execSync(`xcrun devicectl list devices 2>/dev/null`, { timeout: 10000, stdio: 'pipe' }).toString();
        details.deviceVisible = output.includes(device.udid);
      } catch {
        details.deviceVisible = false;
      }
    }

    if (mode === HealthCheckMode.HEAVY) {
      // Heavy: also verify WDA port responsiveness for the device
      if (device?.udid) {
        try {
          const resp = await fetch('http://127.0.0.1:8100/status', { signal: AbortSignal.timeout(3000) });
          details.wdaReachable = resp.ok;
        } catch {
          details.wdaReachable = false;
        }
      }
    }

    const hasAppium = details.appiumReachable;
    const hasDevice = device ? details.deviceVisible : true;

    let status: HealthStatus;
    let failureCode: FailureCode | undefined;

    if (hasAppium && hasDevice) {
      status = HealthStatus.HEALTHY;
    } else if (!hasAppium) {
      status = HealthStatus.UNHEALTHY;
      failureCode = FailureCode.APPIUM_NOT_RUNNING;
    } else {
      status = HealthStatus.DEGRADED;
      failureCode = FailureCode.DEVICE_DISCONNECTED;
    }

    return { status, details, failureCode };
  }

  async probeCapabilities(device: DetectedDevice): Promise<DeviceCapability> {
    const details: Record<string, boolean> = {};

    // Check device reachability
    try {
      if (device.udid) {
        const output = execSync('xcrun devicectl list devices --json-output /dev/stdout 2>/dev/null', {
          timeout: 10000, stdio: 'pipe',
        }).toString();
        details.isReachable = output.includes(device.udid);
      } else {
        details.isReachable = false;
      }
    } catch {
      details.isReachable = false;
    }

    // Check Appium for automation capability
    try {
      const resp = await fetch(`http://127.0.0.1:${this.appiumPort}/status`, { signal: AbortSignal.timeout(3000) });
      details.isAutomatable = resp.ok;
    } catch {
      details.isAutomatable = false;
    }

    return {
      isReachable: details.isReachable ?? false,
      isAutomatable: (details.isReachable && details.isAutomatable) ?? false,
      canCapture: (details.isReachable && details.isAutomatable) ?? false,
      canTouch: details.isReachable ?? false,
    };
  }

  async prepare(device: DetectedDevice): Promise<void> {
    // Ensure tunnel is running for the device (best-effort)
    if (device.udid) {
      try {
        execSync(`xcrun devicectl device info --device ${device.udid} 2>/dev/null`, {
          timeout: 10000, stdio: 'pipe',
        });
      } catch {
        // Non-fatal: Appium handles internal tunnel for USB devices
      }
    }
  }

  async recover(failureCode: FailureCode, device?: DetectedDevice): Promise<RecoveryRecord> {
    const start = Date.now();
    let success = false;
    let errorMessage: string | undefined;
    let action = RecoveryAction.SESSION_RECREATE;

    try {
      switch (failureCode) {
        case FailureCode.WDA_NOT_REACHABLE:
        case FailureCode.WDA_BUILD_FAILED:
          action = RecoveryAction.WDA_REBUILD;
          // WDA rebuild is handled at the session level via Appium
          // Here we just verify Appium is still responding
          try {
            const resp = await fetch(`http://127.0.0.1:${this.appiumPort}/status`, { signal: AbortSignal.timeout(5000) });
            success = resp.ok;
          } catch {
            success = false;
            errorMessage = 'Appium server not responding';
          }
          break;

        case FailureCode.SESSION_STALE:
        case FailureCode.SESSION_CREATE_FAILED:
          action = RecoveryAction.SESSION_RECREATE;
          success = true; // Session recreate is handled by the caller
          break;

        case FailureCode.DEVICE_DISCONNECTED:
          action = RecoveryAction.TUNNEL_RECONNECT;
          if (device?.udid) {
            try {
              execSync(`xcrun devicectl device info --device ${device.udid} 2>/dev/null`, {
                timeout: 10000, stdio: 'pipe',
              });
              success = true;
            } catch {
              success = false;
              errorMessage = 'Device not reachable after reconnect attempt';
            }
          }
          break;

        default:
          action = RecoveryAction.SESSION_RECREATE;
          success = false;
          errorMessage = `No recovery strategy for ${failureCode}`;
      }
    } catch (e: any) {
      errorMessage = e.message;
    }

    return {
      id: uuid(),
      resourceId: device?.udid || 'ios-unknown',
      resourceType: 'device',
      failureCode,
      action,
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
    return true; // iOS supports all capabilities
  }

  getSupportedRecoveryActions(): RecoveryAction[] {
    return [
      RecoveryAction.SESSION_RECREATE,
      RecoveryAction.WDA_REBUILD,
      RecoveryAction.WDA_RESTART,
      RecoveryAction.TUNNEL_RECONNECT,
      RecoveryAction.APP_FORCE_STOP,
    ];
  }
}
