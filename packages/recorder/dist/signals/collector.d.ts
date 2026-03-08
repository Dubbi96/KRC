/**
 * Signal Collector
 *
 * TestResult의 EventResult.resolvedBy 문자열을 파싱하여
 * 표준화된 Fallback 신호(TestRunSignals)를 수집한다.
 *
 * 기존 replayer 코드를 수정하지 않고, 결과에서 역으로 파싱.
 */
import type { TestResult } from '../types';
import type { TestRunSignals } from './types';
/**
 * TestResult에서 fallback 신호를 수집한다.
 */
export declare function collectSignals(testResult: TestResult, platform?: 'web' | 'ios' | 'android'): TestRunSignals;
