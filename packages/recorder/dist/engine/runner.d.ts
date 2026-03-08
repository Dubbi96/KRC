/**
 * 테스트 러너
 *
 * 단일/파라미터화/스위트 실행을 지원한다.
 */
import type { ReplayOptions, TestResult } from '../types';
import { FileStorage } from '../storage/file-storage';
export declare class TestRunner {
    private storage;
    private composer;
    constructor(storage: FileStorage);
    /** 단일 시나리오 실행 (includes 해석 포함) */
    runSingle(scenarioId: string, options?: ReplayOptions): Promise<TestResult>;
    /** 파라미터화 실행: 시나리오 내 모든 데이터셋으로 반복 */
    runParameterized(scenarioId: string, options?: ReplayOptions): Promise<TestResult[]>;
    /** 스위트 실행: 여러 시나리오를 순차적으로 */
    runSuite(scenarioIds: string[], options?: ReplayOptions): Promise<TestResult[]>;
    /** 플랫폼에 맞는 리플레이어로 실행 */
    private replayScenario;
}
