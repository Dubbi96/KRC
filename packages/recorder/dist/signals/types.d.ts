/**
 * Signal Types
 *
 * Fallback 신호, 테스트 실행 신호, Outcome 분류 타입 정의
 */
/** 개별 스텝의 fallback 기록 */
export interface FallbackRecord {
    stepIndex: number;
    eventType: string;
    resolvedBy: string;
    usedCoordinateFallback: boolean;
    usedForceClick: boolean;
    platform: 'web' | 'ios' | 'android';
}
/** 테스트 실행 전체의 신호 요약 */
export interface TestRunSignals {
    fallbackCount: number;
    coordinateFallbackCount: number;
    forceClickCount: number;
    fallbacksByType: Record<string, number>;
    infraFailures: string[];
    fallbackRecords: FallbackRecord[];
    optionalAssertTotal: number;
    optionalAssertPassed: number;
}
/** 테스트 결과 분류 */
export type OutcomeClass = 'PASS' | 'FLAKY_PASS' | 'RETRYABLE_FAIL' | 'FAIL' | 'INFRA_FAIL';
/** 재시도 룰 정의 */
export interface RetryRule {
    name: string;
    when: RetryCondition;
    maxAttempts: number;
    backoffSeconds: number[];
}
/** 재시도 조건 */
export interface RetryCondition {
    outcomeClasses?: OutcomeClass[];
    minFallbackCount?: number;
    hasCoordinateFallback?: boolean;
    platformIn?: ('web' | 'ios' | 'android')[];
}
/** 재시도 판단 결과 */
export interface RetryDecision {
    shouldRetry: boolean;
    delaySeconds: number;
    ruleName?: string;
    reason?: string;
}
