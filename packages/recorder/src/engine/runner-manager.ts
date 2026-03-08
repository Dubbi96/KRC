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

import { fork, type ChildProcess } from 'child_process';
import { join } from 'path';
import type { ReplayOptions, TestResult } from '../types';
import type { WorkerMessage, WorkerResponse } from './runner-worker';

export interface RunProgress {
  event: string;
  data: any;
}

export class RunnerManager {
  private activeWorkers: Map<string, ChildProcess> = new Map();
  private workerScriptPath: string;

  constructor(private scenarioDir: string) {
    // runner-worker.ts의 컴파일된 위치를 기준으로 경로 설정
    this.workerScriptPath = join(__dirname, 'runner-worker.js');
  }

  /**
   * 단일 시나리오를 별도 프로세스에서 실행한다.
   */
  async runSingle(
    runId: string,
    scenarioId: string,
    options: ReplayOptions,
    onProgress?: (progress: RunProgress) => void,
  ): Promise<TestResult[]> {
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
  async runBatch(
    runId: string,
    scenarioIds: string[],
    options: ReplayOptions,
    onProgress?: (progress: RunProgress) => void,
  ): Promise<TestResult[]> {
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
  async runChain(
    runId: string,
    scenarioIds: string[],
    options: ReplayOptions,
    onProgress?: (progress: RunProgress) => void,
  ): Promise<TestResult[]> {
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
  cancel(runId: string): boolean {
    const worker = this.activeWorkers.get(runId);
    if (!worker) return false;

    worker.kill('SIGTERM');
    this.activeWorkers.delete(runId);
    return true;
  }

  /**
   * 모든 활성 워커를 종료한다.
   */
  cancelAll(): void {
    for (const [runId, worker] of this.activeWorkers) {
      worker.kill('SIGTERM');
    }
    this.activeWorkers.clear();
  }

  /** 현재 활성 워커 수 */
  get activeCount(): number {
    return this.activeWorkers.size;
  }

  /**
   * 워커를 fork하고 IPC 통신으로 실행 결과를 수집한다.
   */
  private dispatch(
    runId: string,
    message: WorkerMessage,
    onProgress?: (progress: RunProgress) => void,
  ): Promise<TestResult[]> {
    return new Promise<TestResult[]>((resolve, reject) => {
      const worker = fork(this.workerScriptPath, [], {
        // TypeScript를 직접 실행할 수 있도록 tsx 사용 (개발 환경)
        // 빌드 환경에서는 .js 파일을 직접 fork
        execArgv: this.workerScriptPath.endsWith('.ts')
          ? ['--import', 'tsx']
          : [],
        stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
      });

      this.activeWorkers.set(runId, worker);

      // 워커 stdout/stderr 로그
      worker.stdout?.on('data', (data: Buffer) => {
        const lines = data.toString().trim();
        if (lines) console.log(`[Worker:${runId.slice(0, 8)}] ${lines}`);
      });
      worker.stderr?.on('data', (data: Buffer) => {
        const lines = data.toString().trim();
        if (lines) console.error(`[Worker:${runId.slice(0, 8)}] ${lines}`);
      });

      worker.on('message', (msg: WorkerResponse) => {
        if (msg.runId !== runId) return;

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

      worker.on('error', (err: Error) => {
        this.activeWorkers.delete(runId);
        reject(err);
      });

      worker.on('exit', (code: number | null) => {
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
