/**
 * Provider Interface
 *
 * Abstraction layer for different device/platform providers.
 * Each provider handles health checks, session creation, recovery, and release
 * for a specific platform type.
 */

import { FailureCode } from '../common/failure-taxonomy';
import { HealthCheckResult, DeviceCapability, ProviderType } from '../common/health-model';
import { RecoveryRecord, RecoveryAction } from '../common/recovery-types';

export interface DetectedDevice {
  id: string;
  platform: 'ios' | 'android' | 'web';
  name: string;
  model?: string;
  osVersion?: string;
  udid?: string;
  isSimulator?: boolean;
  isEmulator?: boolean;
  transport?: 'usb' | 'wifi' | 'tunnel';
}

export interface CreateSessionOptions {
  deviceId?: string;
  device?: DetectedDevice;
  url?: string;                      // web only
  capabilities?: Record<string, any>;
  reuseSessionId?: string;           // reuse standby WDA session
  reuseAppiumUrl?: string;
}

export interface Provider {
  readonly type: ProviderType;
  readonly platform: 'ios' | 'android' | 'web';

  /** Run a health check on the provider infrastructure */
  healthCheck(device?: DetectedDevice): Promise<HealthCheckResult>;

  /** Probe device capabilities */
  probeCapabilities(device: DetectedDevice): Promise<DeviceCapability>;

  /** Prepare a device for session (ensure prerequisites) */
  prepare(device: DetectedDevice): Promise<void>;

  /** Attempt recovery for a specific failure */
  recover(failureCode: FailureCode, device?: DetectedDevice): Promise<RecoveryRecord>;

  /** Release a device / clean up resources */
  release(deviceId: string): Promise<void>;

  /** Check if this provider supports a capability */
  supports(capability: 'recording' | 'execution' | 'mirror'): boolean;

  /** Get supported recovery actions for this provider */
  getSupportedRecoveryActions(): RecoveryAction[];
}
