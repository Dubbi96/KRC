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
  // optional assertion 통계
  optionalAssertTotal: number;   // optional assertion 총 개수
  optionalAssertPassed: number;  // optional assertion 중 성공 개수
}

/** 테스트 결과 분류 */
export type OutcomeClass =
  | 'PASS'             // 모든 스텝 통과, fallback 없음
  | 'FLAKY_PASS'       // 통과했지만 fallback 사용
  | 'RETRYABLE_FAIL'   // 실패했지만 재시도 가능 (셀렉터/타이밍 이슈)
  | 'FAIL'             // 확정 실패 (assertion 실패)
  | 'INFRA_FAIL';      // 인프라 문제 (crash, timeout, 장치 오류)

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
