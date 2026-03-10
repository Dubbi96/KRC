/**
 * Device Capability Probe
 *
 * Given a detected device, runs platform-specific capability checks
 * and returns a structured result for heartbeat payloads.
 */

import { DetectedDevice } from '../provider/provider.interface';
import { ProviderRegistry } from '../provider/provider-registry';
import {
  DeviceHealthSnapshot,
  HealthStatus,
  ProviderType,
} from '../common/health-model';

export class DeviceCapabilityProbe {
  constructor(private registry: ProviderRegistry) {}

  /**
   * Probe a single device and return its health snapshot.
   */
  async probeDevice(device: DetectedDevice): Promise<DeviceHealthSnapshot> {
    const providerType = this.resolveProviderType(device);
    const provider = this.registry.get(providerType);

    if (!provider) {
      return {
        deviceId: device.id,
        healthStatus: HealthStatus.UNKNOWN,
        capabilities: { isReachable: false, isAutomatable: false, canCapture: false, canTouch: false },
        lastFailureCode: null,
        failureCount: 0,
        consecutiveFailures: 0,
        providerType,
      };
    }

    try {
      const [healthResult, capabilities] = await Promise.all([
        provider.healthCheck(device),
        provider.probeCapabilities(device),
      ]);

      return {
        deviceId: device.id,
        healthStatus: healthResult.status,
        capabilities,
        lastFailureCode: healthResult.failureCode ?? null,
        failureCount: 0,              // tracked cumulatively by caller
        consecutiveFailures: 0,        // tracked cumulatively by caller
        providerType,
      };
    } catch (err: any) {
      return {
        deviceId: device.id,
        healthStatus: HealthStatus.UNHEALTHY,
        capabilities: { isReachable: false, isAutomatable: false, canCapture: false, canTouch: false },
        lastFailureCode: null,
        failureCount: 0,
        consecutiveFailures: 0,
        providerType,
      };
    }
  }

  /**
   * Probe all devices and return a map of health snapshots.
   */
  async probeAll(devices: DetectedDevice[]): Promise<Record<string, DeviceHealthSnapshot>> {
    const results: Record<string, DeviceHealthSnapshot> = {};

    // Run probes in parallel (with concurrency limit of 5)
    const chunks: DetectedDevice[][] = [];
    for (let i = 0; i < devices.length; i += 5) {
      chunks.push(devices.slice(i, i + 5));
    }

    for (const chunk of chunks) {
      const snapshots = await Promise.all(chunk.map(d => this.probeDevice(d)));
      for (const snap of snapshots) {
        results[snap.deviceId] = snap;
      }
    }

    return results;
  }

  private resolveProviderType(device: DetectedDevice): ProviderType {
    switch (device.platform) {
      case 'web':
        return ProviderType.WEB_BROWSER;
      case 'ios':
        return device.isSimulator ? ProviderType.IOS_SIMULATOR : ProviderType.IOS_REAL;
      case 'android':
        return device.isEmulator ? ProviderType.ANDROID_EMULATOR : ProviderType.ANDROID_REAL;
      default:
        return ProviderType.WEB_BROWSER;
    }
  }
}
