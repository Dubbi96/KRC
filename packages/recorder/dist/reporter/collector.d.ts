import type { TestResult, EventResult, Platform } from '../types';
export declare class ResultCollector {
    private results;
    private startTime;
    private scenarioId;
    private scenarioName;
    private platform;
    start(scenarioId: string, scenarioName: string, platform: Platform): void;
    addEventResult(result: EventResult): void;
    finish(error?: string, stackTrace?: string): TestResult;
}
