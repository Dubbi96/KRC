"use strict";
/**
 * Outcome Classifier
 *
 * TestResult와 TestRunSignals를 기반으로 OutcomeClass를 판정한다.
 *
 * 분류 로직:
 *   PASS         → 통과, 신뢰도 높은 셀렉터로 해결 (preferred, semantic:role 등 포함)
 *   FLAKY_PASS   → 통과했지만 좌표 fallback/강제 클릭 사용, 소프트 fallback 다수, 또는 optional assertion 성공률 ≤ 20%
 *   RETRYABLE_FAIL → 실패, 셀렉터/타이밍 문제로 재시도 가능
 *   FAIL         → 확정 실패 (assertion 실패)
 *   INFRA_FAIL   → 인프라 문제
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.classifyOutcome = classifyOutcome;
function classifyOutcome(testResult, signals) {
    // 1) 인프라 실패 우선 검사
    if (signals.infraFailures.length > 0) {
        return 'INFRA_FAIL';
    }
    // 2) 통과한 경우
    if (testResult.status === 'passed') {
        // 좌표 기반 fallback이나 강제 클릭은 즉시 FLAKY_PASS (재현성 낮음)
        if (signals.coordinateFallbackCount > 0 || signals.forceClickCount > 0) {
            return 'FLAKY_PASS';
        }
        // 소프트 fallback (text 기반 등)은 3건 초과 시에만 FLAKY_PASS
        const softFallbackCount = signals.fallbackCount
            - signals.coordinateFallbackCount
            - signals.forceClickCount;
        if (softFallbackCount > 3) {
            return 'FLAKY_PASS';
        }
        // optional assertion 성공률 ≤ 20% → FLAKY_PASS
        if (signals.optionalAssertTotal > 0) {
            const passRate = signals.optionalAssertPassed / signals.optionalAssertTotal;
            if (passRate <= 0.2) {
                return 'FLAKY_PASS';
            }
        }
        return 'PASS';
    }
    // 3) 스킵된 경우
    if (testResult.status === 'skipped') {
        return 'FAIL'; // skip은 재시도 대상 아님
    }
    // 4) 실패한 경우 — 실패 원인 분석
    const failedEvents = testResult.events.filter(e => e.status === 'failed');
    // assertion 실패가 있으면 확정 실패
    const hasAssertionFailure = failedEvents.some(e => e.assertionResults?.some(ar => !ar.passed));
    if (hasAssertionFailure) {
        return 'FAIL';
    }
    // 셀렉터/타이밍 관련 에러 패턴
    const retryablePatterns = [
        '요소를 찾을 수 없습니다',
        'locator.click',
        'locator.fill',
        'locator.waitFor',
        'timeout',
        'Timeout',
        '스텝 타임아웃',
        'waiting for',
        'selector',
        'element not found',
        'Cannot find',
        'not visible',
        'intercepted',
    ];
    const selectorFailures = failedEvents.filter(e => e.error && retryablePatterns.some(p => e.error.includes(p)));
    // 대부분이 셀렉터/타이밍 문제면 재시도 가능
    if (selectorFailures.length > 0 && selectorFailures.length === failedEvents.length) {
        return 'RETRYABLE_FAIL';
    }
    // 전체 에러 메시지에서도 인프라/타이밍 패턴 검사
    if (testResult.error) {
        const isRetryable = retryablePatterns.some(p => testResult.error.includes(p));
        if (isRetryable)
            return 'RETRYABLE_FAIL';
    }
    // 기본: 재시도 가능으로 분류 (보수적)
    if (failedEvents.length > 0 && !hasAssertionFailure) {
        return 'RETRYABLE_FAIL';
    }
    return 'FAIL';
}
//# sourceMappingURL=outcome-classifier.js.map