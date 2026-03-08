/**
 * Retry Policy Engine
 *
 * JSON 기반 룰 엔진으로 재시도 여부와 딜레이를 결정한다.
 */
import type { OutcomeClass, TestRunSignals, RetryRule, RetryDecision } from './types';
/** 기본 재시도 정책 */
export declare const DEFAULT_RETRY_RULES: RetryRule[];
export declare class RetryPolicyEngine {
    private rules;
    constructor(rules?: RetryRule[]);
    /**
     * 재시도 여부를 판단한다.
     *
     * @param outcomeClass 테스트 결과 분류
     * @param signals 테스트 실행 신호
     * @param platform 실행 플랫폼
     * @param currentAttempt 현재 시도 횟수 (1-based)
     * @returns 재시도 판단 결과
     */
    shouldRetry(outcomeClass: OutcomeClass, signals: TestRunSignals, platform: 'web' | 'ios' | 'android', currentAttempt: number): RetryDecision;
    private matchesCondition;
    /**
     * 현재 적용된 룰 목록을 반환한다 (진단/설정 확인용).
     */
    getRules(): RetryRule[];
}
