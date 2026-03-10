/**
 * Katab Shared Recovery Action Types
 * Identical across KRC, KCP, KCD for consistent recovery tracking.
 */

import { FailureCode } from './failure-taxonomy';

// ── Recovery Actions ───────────────────────────────────────────────────────

export enum RecoveryAction {
  SESSION_RECREATE = 'session_recreate',
  WDA_REBUILD = 'wda_rebuild',
  WDA_RESTART = 'wda_restart',
  ADB_RECONNECT = 'adb_reconnect',
  APP_FORCE_STOP = 'app_force_stop',
  APP_REINSTALL = 'app_reinstall',
  DEVICE_REBOOT = 'device_reboot',
  BROWSER_RESTART = 'browser_restart',
  APPIUM_RESTART = 'appium_restart',
  TUNNEL_RECONNECT = 'tunnel_reconnect',
  QUARANTINE = 'quarantine',
}

// ── Recovery Record ────────────────────────────────────────────────────────

export interface RecoveryRecord {
  id: string;
  resourceId: string;
  resourceType: 'device' | 'slot' | 'node';
  failureCode: FailureCode;
  action: RecoveryAction;
  success: boolean;
  timestamp: string;           // ISO date
  durationMs: number;
  errorMessage?: string;
  nodeId?: string;
}

// ── Recovery Strategy ──────────────────────────────────────────────────────

export interface RecoveryStrategy {
  failureCode: FailureCode;
  actions: RecoveryAction[];   // Ordered: try first, then second, etc.
  maxAttempts: number;
  quarantineAfterExhaustion: boolean;
  quarantineDurationMinutes: number;
}

// ── Korean Labels ──────────────────────────────────────────────────────────

export const RECOVERY_ACTION_LABELS_KO: Record<RecoveryAction, string> = {
  [RecoveryAction.SESSION_RECREATE]: '세션 재생성',
  [RecoveryAction.WDA_REBUILD]: 'WDA 재빌드',
  [RecoveryAction.WDA_RESTART]: 'WDA 재시작',
  [RecoveryAction.ADB_RECONNECT]: 'ADB 재연결',
  [RecoveryAction.APP_FORCE_STOP]: '앱 강제 종료',
  [RecoveryAction.APP_REINSTALL]: '앱 재설치',
  [RecoveryAction.DEVICE_REBOOT]: '장비 재부팅',
  [RecoveryAction.BROWSER_RESTART]: '브라우저 재시작',
  [RecoveryAction.APPIUM_RESTART]: 'Appium 재시작',
  [RecoveryAction.TUNNEL_RECONNECT]: '터널 재연결',
  [RecoveryAction.QUARANTINE]: '장비 격리',
};
