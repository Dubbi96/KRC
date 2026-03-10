/**
 * Recovery Budget
 *
 * Prevents recovery storms by tracking per-device recovery attempts
 * within a sliding time window. If budget is exceeded, the device
 * should be immediately quarantined instead of retried.
 */

import { FailureCode } from 'katab-shared';

interface BudgetEntry {
  failureCode: FailureCode;
  action: string;
  timestamp: number;
  success: boolean;
}

const DEFAULT_WINDOW_MS = 10 * 60_000;       // 10 minutes
const DEFAULT_MAX_ATTEMPTS = 5;              // max recoveries per device per window
const DEFAULT_SAME_CODE_MAX = 3;             // max retries for same failure code

export class RecoveryBudget {
  private entries = new Map<string, BudgetEntry[]>(); // deviceId → entries

  constructor(
    private windowMs = DEFAULT_WINDOW_MS,
    private maxAttempts = DEFAULT_MAX_ATTEMPTS,
    private sameCodeMax = DEFAULT_SAME_CODE_MAX,
  ) {}

  /**
   * Check if a device has remaining recovery budget.
   * Returns { allowed, reason } — if not allowed, should quarantine immediately.
   */
  check(deviceId: string, failureCode: FailureCode): { allowed: boolean; reason?: string } {
    const now = Date.now();
    const entries = this.getRecentEntries(deviceId, now);

    // Total attempts in window
    if (entries.length >= this.maxAttempts) {
      return {
        allowed: false,
        reason: `Recovery budget exceeded: ${entries.length}/${this.maxAttempts} attempts in ${this.windowMs / 60000}m`,
      };
    }

    // Same failure code repeated
    const sameCodeCount = entries.filter(e => e.failureCode === failureCode).length;
    if (sameCodeCount >= this.sameCodeMax) {
      return {
        allowed: false,
        reason: `Same failure ${failureCode} repeated ${sameCodeCount}/${this.sameCodeMax} times`,
      };
    }

    // Consecutive failures (no success in between)
    const recentFailed = [];
    for (let i = entries.length - 1; i >= 0; i--) {
      if (entries[i].success) break;
      recentFailed.push(entries[i]);
    }
    if (recentFailed.length >= this.sameCodeMax) {
      return {
        allowed: false,
        reason: `${recentFailed.length} consecutive failed recoveries`,
      };
    }

    return { allowed: true };
  }

  /**
   * Record a recovery attempt.
   */
  record(deviceId: string, failureCode: FailureCode, action: string, success: boolean): void {
    if (!this.entries.has(deviceId)) {
      this.entries.set(deviceId, []);
    }
    this.entries.get(deviceId)!.push({
      failureCode, action, success, timestamp: Date.now(),
    });
  }

  /**
   * Reset budget for a device (e.g., after successful job or manual release).
   */
  reset(deviceId: string): void {
    this.entries.delete(deviceId);
  }

  private getRecentEntries(deviceId: string, now: number): BudgetEntry[] {
    const all = this.entries.get(deviceId) || [];
    const cutoff = now - this.windowMs;

    // Prune old entries
    const recent = all.filter(e => e.timestamp >= cutoff);
    this.entries.set(deviceId, recent);
    return recent;
  }
}
