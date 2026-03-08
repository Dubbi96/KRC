/**
 * Retry Policy Engine
 *
 * JSON 기반 룰 엔진으로 재시도 여부와 딜레이를 결정한다.
 */

import type { OutcomeClass, TestRunSignals, RetryRule, RetryCondition, RetryDecision } from './types';

/** 기본 재시도 정책 */
export const DEFAULT_RETRY_RULES: RetryRule[] = [
  {
    name: 'infra-retry',
    when: {
      outcomeClasses: ['INFRA_FAIL'],
    },
    maxAttempts: 3,
    backoffSeconds: [0, 30, 120],
  },
  {
    name: 'retryable-fail',
    when: {
      outcomeClasses: ['RETRYABLE_FAIL'],
    },
    maxAttempts: 2,
    backoffSeconds: [0, 30],
  },
  {
    name: 'mobile-infra',
    when: {
      outcomeClasses: ['INFRA_FAIL'],
      platformIn: ['ios', 'android'],
    },
    maxAttempts: 3,
    backoffSeconds: [0, 60, 180],
  },
];

export class RetryPolicyEngine {
  private rules: RetryRule[];

  constructor(rules?: RetryRule[]) {
    this.rules = rules || DEFAULT_RETRY_RULES;
  }

  /**
   * 재시도 여부를 판단한다.
   *
   * @param outcomeClass 테스트 결과 분류
   * @param signals 테스트 실행 신호
   * @param platform 실행 플랫폼
   * @param currentAttempt 현재 시도 횟수 (1-based)
   * @returns 재시도 판단 결과
   */
  shouldRetry(
    outcomeClass: OutcomeClass,
    signals: TestRunSignals,
    platform: 'web' | 'ios' | 'android',
    currentAttempt: number,
  ): RetryDecision {
    // PASS나 FLAKY_PASS는 재시도하지 않음
    if (outcomeClass === 'PASS' || outcomeClass === 'FLAKY_PASS') {
      return { shouldRetry: false, delaySeconds: 0 };
    }

    // FAIL (assertion 실패)은 재시도하지 않음
    if (outcomeClass === 'FAIL') {
      return { shouldRetry: false, delaySeconds: 0, reason: 'Assertion failure - not retryable' };
    }

    // 매칭되는 룰 찾기 (플랫폼 특화 룰이 우선)
    const matchingRules = this.rules.filter(rule =>
      this.matchesCondition(rule.when, outcomeClass, signals, platform),
    );

    // 플랫폼 특화 룰 우선
    const platformRule = matchingRules.find(r => r.when.platformIn?.includes(platform));
    const rule = platformRule || matchingRules[0];

    if (!rule) {
      return { shouldRetry: false, delaySeconds: 0, reason: 'No matching retry rule' };
    }

    if (currentAttempt >= rule.maxAttempts) {
      return {
        shouldRetry: false,
        delaySeconds: 0,
        ruleName: rule.name,
        reason: `Max attempts (${rule.maxAttempts}) reached`,
      };
    }

    const delayIndex = Math.min(currentAttempt - 1, rule.backoffSeconds.length - 1);
    const delaySeconds = rule.backoffSeconds[delayIndex];

    return {
      shouldRetry: true,
      delaySeconds,
      ruleName: rule.name,
      reason: `Rule "${rule.name}" matched, attempt ${currentAttempt}/${rule.maxAttempts}`,
    };
  }

  private matchesCondition(
    condition: RetryCondition,
    outcomeClass: OutcomeClass,
    signals: TestRunSignals,
    platform: 'web' | 'ios' | 'android',
  ): boolean {
    if (condition.outcomeClasses && !condition.outcomeClasses.includes(outcomeClass)) {
      return false;
    }
    if (condition.minFallbackCount !== undefined && signals.fallbackCount < condition.minFallbackCount) {
      return false;
    }
    if (condition.hasCoordinateFallback !== undefined) {
      const hasIt = signals.coordinateFallbackCount > 0;
      if (hasIt !== condition.hasCoordinateFallback) return false;
    }
    if (condition.platformIn && !condition.platformIn.includes(platform)) {
      return false;
    }
    return true;
  }

  /**
   * 현재 적용된 룰 목록을 반환한다 (진단/설정 확인용).
   */
  getRules(): RetryRule[] {
    return [...this.rules];
  }
}
