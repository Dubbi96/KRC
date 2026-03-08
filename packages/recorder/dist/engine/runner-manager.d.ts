/**
 * Runner Manager
 *
 * child_process를 통해 시나리오 실행을 별도 프로세스에서 관리한다.
 * DashboardServer에서 직접 TestRunner/ChainRunner를 호출하는 대신
 * RunnerManager를 통해 워커를 생성하고 IPC로 통신한다.
 *
 * 이점:
 * - 대시보드 HTTP 서버의 이벤트 루프 블로킹 방지
 * - Playwright crash 격리 (워커만 죽고 대시보드는 생존)
 * - 동시 실행 수 제한 및 큐잉 기반 확보
 * - 실행 취소 (kill) 지원
 */
import type { ReplayOptions, TestResult } from '../types';
export interface RunProgress {
    event: string;
    data: any;
}
export declare class RunnerManager {
    private scenarioDir;
    private activeWorkers;
    private workerScriptPath;
    constructor(scenarioDir: string);
    /**
     * 단일 시나리오를 별도 프로세스에서 실행한다.
     */
    runSingle(runId: string, scenarioId: string, options: ReplayOptions, onProgress?: (progress: RunProgress) => void): Promise<TestResult[]>;
    /**
     * 여러 시나리오를 독립 브라우저로 순차 실행한다.
     */
    runBatch(runId: string, scenarioIds: string[], options: ReplayOptions, onProgress?: (progress: RunProgress) => void): Promise<TestResult[]>;
    /**
     * 여러 시나리오를 공유 브라우저에서 체인 실행한다.
     */
    runChain(runId: string, scenarioIds: string[], options: ReplayOptions, onProgress?: (progress: RunProgress) => void): Promise<TestResult[]>;
    /**
     * 실행 중인 워커를 강제 종료한다.
     */
    cancel(runId: string): boolean;
    /**
     * 모든 활성 워커를 종료한다.
     */
    cancelAll(): void;
    /** 현재 활성 워커 수 */
    get activeCount(): number;
    /**
     * 워커를 fork하고 IPC 통신으로 실행 결과를 수집한다.
     */
    private dispatch;
}
