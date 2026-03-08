"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.RunnerManager = void 0;
const child_process_1 = require("child_process");
const path_1 = require("path");
class RunnerManager {
    scenarioDir;
    activeWorkers = new Map();
    workerScriptPath;
    constructor(scenarioDir) {
        this.scenarioDir = scenarioDir;
        // runner-worker.ts의 컴파일된 위치를 기준으로 경로 설정
        this.workerScriptPath = (0, path_1.join)(__dirname, 'runner-worker.js');
    }
    /**
     * 단일 시나리오를 별도 프로세스에서 실행한다.
     */
    async runSingle(runId, scenarioId, options, onProgress) {
        return this.dispatch(runId, {
            type: 'run-single',
            runId,
            scenarioIds: [scenarioId],
            options,
            scenarioDir: this.scenarioDir,
        }, onProgress);
    }
    /**
     * 여러 시나리오를 독립 브라우저로 순차 실행한다.
     */
    async runBatch(runId, scenarioIds, options, onProgress) {
        return this.dispatch(runId, {
            type: 'run-batch',
            runId,
            scenarioIds,
            options,
            scenarioDir: this.scenarioDir,
        }, onProgress);
    }
    /**
     * 여러 시나리오를 공유 브라우저에서 체인 실행한다.
     */
    async runChain(runId, scenarioIds, options, onProgress) {
        return this.dispatch(runId, {
            type: 'run-chain',
            runId,
            scenarioIds,
            options,
            scenarioDir: this.scenarioDir,
        }, onProgress);
    }
    /**
     * 실행 중인 워커를 강제 종료한다.
     */
    cancel(runId) {
        const worker = this.activeWorkers.get(runId);
        if (!worker)
            return false;
        worker.kill('SIGTERM');
        this.activeWorkers.delete(runId);
        return true;
    }
    /**
     * 모든 활성 워커를 종료한다.
     */
    cancelAll() {
        for (const [runId, worker] of this.activeWorkers) {
            worker.kill('SIGTERM');
        }
        this.activeWorkers.clear();
    }
    /** 현재 활성 워커 수 */
    get activeCount() {
        return this.activeWorkers.size;
    }
    /**
     * 워커를 fork하고 IPC 통신으로 실행 결과를 수집한다.
     */
    dispatch(runId, message, onProgress) {
        return new Promise((resolve, reject) => {
            const worker = (0, child_process_1.fork)(this.workerScriptPath, [], {
                // TypeScript를 직접 실행할 수 있도록 tsx 사용 (개발 환경)
                // 빌드 환경에서는 .js 파일을 직접 fork
                execArgv: this.workerScriptPath.endsWith('.ts')
                    ? ['--import', 'tsx']
                    : [],
                stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
            });
            this.activeWorkers.set(runId, worker);
            // 워커 stdout/stderr 로그
            worker.stdout?.on('data', (data) => {
                const lines = data.toString().trim();
                if (lines)
                    console.log(`[Worker:${runId.slice(0, 8)}] ${lines}`);
            });
            worker.stderr?.on('data', (data) => {
                const lines = data.toString().trim();
                if (lines)
                    console.error(`[Worker:${runId.slice(0, 8)}] ${lines}`);
            });
            worker.on('message', (msg) => {
                if (msg.runId !== runId)
                    return;
                switch (msg.type) {
                    case 'progress':
                        onProgress?.({ event: msg.event || '', data: msg.data });
                        break;
                    case 'result':
                        this.activeWorkers.delete(runId);
                        resolve(msg.data?.results || []);
                        break;
                    case 'error':
                        this.activeWorkers.delete(runId);
                        reject(new Error(msg.data?.error || 'Worker error'));
                        break;
                }
            });
            worker.on('error', (err) => {
                this.activeWorkers.delete(runId);
                reject(err);
            });
            worker.on('exit', (code) => {
                this.activeWorkers.delete(runId);
                if (code !== 0 && code !== null) {
                    reject(new Error(`Worker exited with code ${code}`));
                }
            });
            // 워커에 실행 메시지 전송
            worker.send(message);
        });
    }
}
exports.RunnerManager = RunnerManager;
//# sourceMappingURL=runner-manager.js.map