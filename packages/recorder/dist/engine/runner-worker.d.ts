/**
 * Runner Worker
 *
 * child_process로 실행되는 워커 스크립트.
 * 부모 프로세스로부터 IPC 메시지를 받아 시나리오를 실행하고,
 * 진행 상황과 결과를 IPC로 반환한다.
 *
 * 이 분리를 통해:
 * - 대시보드 HTTP 서버가 Playwright 실행에 블로킹되지 않음
 * - Playwright crash가 대시보드를 죽이지 않음
 * - 향후 병렬/큐잉 확장 가능
 */
import type { ReplayOptions } from '../types';
export interface WorkerMessage {
    type: 'run-single' | 'run-batch' | 'run-chain';
    runId: string;
    scenarioIds: string[];
    options: ReplayOptions;
    scenarioDir: string;
}
export interface WorkerResponse {
    type: 'progress' | 'result' | 'error';
    runId: string;
    event?: string;
    data?: any;
}
