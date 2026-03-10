/**
 * Katab Shared Resource Health Model
 * Identical across KRC, KCP, KCD for consistent health tracking.
 */

import { FailureCode } from './failure-taxonomy';

// ── Health Status ──────────────────────────────────────────────────────────

export enum HealthStatus {
  HEALTHY = 'healthy',
  DEGRADED = 'degraded',
  UNHEALTHY = 'unhealthy',
  QUARANTINED = 'quarantined',
  UNKNOWN = 'unknown',
}

// ── Provider Type ──────────────────────────────────────────────────────────

export enum ProviderType {
  WEB_BROWSER = 'web-browser',
  IOS_REAL = 'ios-real',
  IOS_SIMULATOR = 'ios-simulator',
  ANDROID_REAL = 'android-real',
  ANDROID_EMULATOR = 'android-emulator',
}

// ── Resource Health ────────────────────────────────────────────────────────

export interface ResourceHealth {
  healthStatus: HealthStatus;
  lastHealthCheckAt: string | null;      // ISO date
  lastFailureCode: FailureCode | null;
  failureCount: number;
  consecutiveFailures: number;
  quarantineUntil: string | null;        // ISO date
  lastRecoveryAction: string | null;
  lastRecoveryAt: string | null;         // ISO date
}

// ── Health Check Result ────────────────────────────────────────────────────

export interface HealthCheckResult {
  status: HealthStatus;
  details: Record<string, boolean>;      // e.g. { appiumReachable: true, deviceVisible: true }
  failureCode?: FailureCode;
  message?: string;
}

// ── Device Capability ──────────────────────────────────────────────────────

export interface DeviceCapability {
  isReachable: boolean;
  isAutomatable: boolean;
  canCapture: boolean;
  canTouch: boolean;
}

// ── Device Health Snapshot (sent in heartbeat) ─────────────────────────────

export interface DeviceHealthSnapshot {
  deviceId: string;
  healthStatus: HealthStatus;
  capabilities: DeviceCapability;
  lastFailureCode: FailureCode | null;
  failureCount: number;
  consecutiveFailures: number;
  providerType: ProviderType;
}

// ── Korean Labels ──────────────────────────────────────────────────────────

export const HEALTH_STATUS_LABELS_KO: Record<HealthStatus, string> = {
  [HealthStatus.HEALTHY]: '정상',
  [HealthStatus.DEGRADED]: '저하',
  [HealthStatus.UNHEALTHY]: '비정상',
  [HealthStatus.QUARANTINED]: '격리됨',
  [HealthStatus.UNKNOWN]: '알 수 없음',
};

export const PROVIDER_TYPE_LABELS_KO: Record<ProviderType, string> = {
  [ProviderType.WEB_BROWSER]: '웹 브라우저',
  [ProviderType.IOS_REAL]: 'iOS 실기기',
  [ProviderType.IOS_SIMULATOR]: 'iOS 시뮬레이터',
  [ProviderType.ANDROID_REAL]: 'Android 실기기',
  [ProviderType.ANDROID_EMULATOR]: 'Android 에뮬레이터',
};
