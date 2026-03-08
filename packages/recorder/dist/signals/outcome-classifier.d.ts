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
import type { TestResult } from '../types';
import type { OutcomeClass, TestRunSignals } from './types';
export declare function classifyOutcome(testResult: TestResult, signals: TestRunSignals): OutcomeClass;
