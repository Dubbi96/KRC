// @ts-nocheck
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

import { FileStorage } from '../storage/file-storage';
import { ScenarioComposer } from './composer';
import { WebReplayer } from '../web/replayer';
import { IOSReplayer } from '../ios/replayer';
import { AndroidReplayer } from '../android/replayer';
import { ChainRunner } from '../dashboard/chain-runner';
import type { RecordingScenario, ReplayOptions, TestResult } from '../types';

/** 플랫폼에 맞는 리플레이어로 시나리오를 실행 */
async function replayByPlatform(scenario: RecordingScenario, options: ReplayOptions): Promise<TestResult> {
  switch (scenario.platform) {
    case 'ios':
      return new IOSReplayer().replay(scenario, options);
    case 'android':
      return new AndroidReplayer().replay(scenario, options);
    case 'web':
    default:
      return new WebReplayer().replay(scenario, options);
  }
}

// ─── IPC 프로토콜 ──────────────────────────────────────

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

// ─── 워커 실행 (child_process 모드) ────────────────────

function sendMessage(msg: WorkerResponse): void {
  if (process.send) {
    process.send(msg);
  }
}

async function handleMessage(msg: WorkerMessage): Promise<void> {
  const storage = new FileStorage(msg.scenarioDir);
  const composer = new ScenarioComposer(storage);

  try {
    switch (msg.type) {
      case 'run-single': {
        const scenarioId = msg.scenarioIds[0];
        sendMessage({ type: 'progress', runId: msg.runId, event: 'scenario:started', data: { scenarioId, index: 0 } });

        const scenario = await storage.loadScenario(scenarioId);
        if (!scenario) throw new Error(`Scenario not found: ${scenarioId}`);

        const composedEvents = await composer.compose(scenario);
        const composed: RecordingScenario = { ...scenario, events: composedEvents };
        const result = await replayByPlatform(composed, msg.options);

        sendMessage({ type: 'progress', runId: msg.runId, event: 'scenario:completed', data: { scenarioId, index: 0, result } });
        sendMessage({ type: 'result', runId: msg.runId, data: { results: [result] } });
        break;
      }

      case 'run-batch': {
        const results: TestResult[] = [];
        for (let i = 0; i < msg.scenarioIds.length; i++) {
          const id = msg.scenarioIds[i];
          sendMessage({ type: 'progress', runId: msg.runId, event: 'scenario:started', data: { scenarioId: id, index: i } });

          let loadedPlatform: string = 'web';
          try {
            const scenario = await storage.loadScenario(id);
            if (!scenario) throw new Error(`Scenario not found: ${id}`);
            loadedPlatform = scenario.platform || 'web';

            const composedEvents = await composer.compose(scenario);
            const composed: RecordingScenario = { ...scenario, events: composedEvents };
            const result = await replayByPlatform(composed, msg.options);
            results.push(result);

            sendMessage({ type: 'progress', runId: msg.runId, event: 'scenario:completed', data: { scenarioId: id, index: i, result } });
          } catch (err: any) {
            const errorResult: TestResult = {
              scenarioId: id,
              scenarioName: `Error: ${id}`,
              platform: loadedPlatform as any,
              status: 'failed',
              duration: 0,
              startedAt: Date.now(),
              completedAt: Date.now(),
              events: [],
              error: err.message,
            };
            results.push(errorResult);
            sendMessage({ type: 'progress', runId: msg.runId, event: 'scenario:completed', data: { scenarioId: id, index: i, result: errorResult } });
          }
        }
        sendMessage({ type: 'result', runId: msg.runId, data: { results } });
        break;
      }

      case 'run-chain': {
        const chainRunner = new ChainRunner(storage);
        const results = await chainRunner.runChain(msg.scenarioIds, msg.options, {
          onScenarioStart: (id, index, scenario) => {
            sendMessage({ type: 'progress', runId: msg.runId, event: 'scenario:started', data: { scenarioId: id, index } });
          },
          onScenarioComplete: (id, index, result) => {
            sendMessage({ type: 'progress', runId: msg.runId, event: 'scenario:completed', data: { scenarioId: id, index, result } });
          },
        });
        sendMessage({ type: 'result', runId: msg.runId, data: { results } });
        break;
      }
    }
  } catch (err: any) {
    sendMessage({ type: 'error', runId: msg.runId, data: { error: err.message, stack: err.stack } });
  }

  // 작업 완료 후 프로세스 종료
  process.exit(0);
}

// ─── IPC 리스너 등록 ──────────────────────────────────

process.on('message', (msg: WorkerMessage) => {
  handleMessage(msg).catch(err => {
    sendMessage({ type: 'error', runId: msg?.runId || 'unknown', data: { error: err.message } });
    process.exit(1);
  });
});

// 부모 프로세스 연결이 끊기면 종료
process.on('disconnect', () => {
  process.exit(0);
});
