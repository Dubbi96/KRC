/**
 * Android Real Device Provider
 *
 * Manages real Android device sessions via Appium UiAutomator2.
 * Health checks verify Appium server and adb connectivity.
 */

import { Provider, DetectedDevice } from './provider.interface';
import {
  FailureCode,
  HealthCheckResult, HealthCheckMode, HealthStatus, DeviceCapability, ProviderType,
  RecoveryRecord, RecoveryAction,
} from 'katab-shared';
import { v4 as uuid } from 'uuid';
import { execSync } from 'child_process';

export class AndroidRealProvider implements Provider {
  readonly type = ProviderType.ANDROID_REAL;
  readonly platform = 'android' as const;

  private appiumPort: number;

  constructor(appiumPort = 4724) {
    this.appiumPort = appiumPort;
  }

  async healthCheck(device?: DetectedDevice, mode: HealthCheckMode = HealthCheckMode.MEDIUM): Promise<HealthCheckResult> {
    const details: Record<string, boolean> = {};

    if (mode === HealthCheckMode.LIGHTWEIGHT) {
      // Lightweight: quick Appium /status only (no adb, no device probe)
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

    // Medium+: Check adb
    try {
      execSync('adb devices -l 2>/dev/null', { timeout: 5000, stdio: 'pipe' });
      details.adbAvailable = true;
    } catch {
      details.adbAvailable = false;
    }

    // Medium+: Check specific device
    if (device?.udid) {
      try {
        const output = execSync('adb devices -l 2>/dev/null', { timeout: 5000, stdio: 'pipe' }).toString();
        const lines = output.split('\n').filter(l => l.includes('device') && !l.startsWith('List'));
        details.deviceOnline = lines.some(l => l.startsWith(device.udid!));
      } catch {
        details.deviceOnline = false;
      }
    }

    if (mode === HealthCheckMode.HEAVY) {
      // Heavy: also verify adb shell responsiveness
      if (device?.udid) {
        try {
          execSync(`adb -s ${device.udid} shell getprop ro.build.version.sdk 2>/dev/null`, {
            timeout: 5000, stdio: 'pipe',
          });
          details.adbShellResponsive = true;
        } catch {
          details.adbShellResponsive = false;
        }
      }
    }

    const hasAppium = details.appiumReachable;
    const hasDevice = device ? details.deviceOnline : true;

    let status: HealthStatus;
    let failureCode: FailureCode | undefined;

    if (hasAppium && hasDevice) {
      status = HealthStatus.HEALTHY;
    } else if (!hasAppium) {
      status = HealthStatus.UNHEALTHY;
      failureCode = FailureCode.APPIUM_NOT_RUNNING;
    } else {
      status = HealthStatus.DEGRADED;
      failureCode = FailureCode.ADB_OFFLINE;
    }

    return { status, details, failureCode };
  }

  async probeCapabilities(device: DetectedDevice): Promise<DeviceCapability> {
    let isReachable = false;
    let adbResponsive = false;

    if (device.udid) {
      try {
        const output = execSync('adb devices -l 2>/dev/null', { timeout: 5000, stdio: 'pipe' }).toString();
        isReachable = output.includes(device.udid) && output.includes('device');
      } catch {
        isReachable = false;
      }

      if (isReachable) {
        try {
          execSync(`adb -s ${device.udid} shell echo ok 2>/dev/null`, { timeout: 5000, stdio: 'pipe' });
          adbResponsive = true;
        } catch {
          adbResponsive = false;
        }
      }
    }

    return {
      isReachable,
      isAutomatable: adbResponsive,
      canCapture: adbResponsive,
      canTouch: adbResponsive,
    };
  }

  async prepare(device: DetectedDevice): Promise<void> {
    if (device.udid) {
      // Ensure adb connection is fresh
      try {
        execSync(`adb -s ${device.udid} shell echo ready 2>/dev/null`, { timeout: 5000, stdio: 'pipe' });
      } catch {
        // Try adb reconnect
        try {
          execSync(`adb reconnect ${device.udid} 2>/dev/null`, { timeout: 10000, stdio: 'pipe' });
        } catch { /* best-effort */ }
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
        case FailureCode.ADB_OFFLINE:
          action = RecoveryAction.ADB_RECONNECT;
          if (device?.udid) {
            try {
              execSync(`adb reconnect ${device.udid} 2>/dev/null`, { timeout: 10000, stdio: 'pipe' });
              // Verify reconnection
              await new Promise(r => setTimeout(r, 2000));
              const output = execSync('adb devices 2>/dev/null', { timeout: 5000, stdio: 'pipe' }).toString();
              success = output.includes(device.udid) && output.includes('device');
            } catch (e: any) {
              errorMessage = e.message;
            }
          }
          break;

        case FailureCode.ADB_UNAUTHORIZED:
          action = RecoveryAction.ADB_RECONNECT;
          errorMessage = 'Device requires USB debugging authorization. Check device screen.';
          break;

        case FailureCode.UIAUTOMATOR_CRASH:
          action = RecoveryAction.SESSION_RECREATE;
          success = true; // Session recreate handled by caller
          break;

        case FailureCode.SESSION_STALE:
        case FailureCode.SESSION_CREATE_FAILED:
          action = RecoveryAction.SESSION_RECREATE;
          success = true;
          break;

        default:
          action = RecoveryAction.SESSION_RECREATE;
          errorMessage = `No recovery strategy for ${failureCode}`;
      }
    } catch (e: any) {
      errorMessage = e.message;
    }

    return {
      id: uuid(),
      resourceId: device?.udid || 'android-unknown',
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
    // Cleanup handled by session-manager
  }

  supports(capability: 'recording' | 'execution' | 'mirror'): boolean {
    return true;
  }

  getSupportedRecoveryActions(): RecoveryAction[] {
    return [
      RecoveryAction.SESSION_RECREATE,
      RecoveryAction.ADB_RECONNECT,
      RecoveryAction.APP_FORCE_STOP,
      RecoveryAction.DEVICE_REBOOT,
    ];
  }
}
