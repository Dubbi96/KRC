/**
 * 테스트 러너
 *
 * 단일/파라미터화/스위트 실행을 지원한다.
 */

import type { RecordingScenario, ReplayOptions, TestResult } from '../types';
import { FileStorage } from '../storage/file-storage';
import { ScenarioComposer } from './composer';
import { WebReplayer } from '../web/replayer';
import { IOSReplayer } from '../ios/replayer';
import { AndroidReplayer } from '../android/replayer';

export class TestRunner {
  private composer: ScenarioComposer;

  constructor(private storage: FileStorage) {
    this.composer = new ScenarioComposer(storage);
  }

  /** 단일 시나리오 실행 (includes 해석 포함) */
  async runSingle(scenarioId: string, options: ReplayOptions = {}): Promise<TestResult> {
    const scenario = await this.storage.loadScenario(scenarioId);
    if (!scenario) throw new Error(`Scenario not found: ${scenarioId}`);

    // includes 해석 → 이벤트 합성
    const composedEvents = await this.composer.compose(scenario);
    const composedScenario: RecordingScenario = { ...scenario, events: composedEvents };

    return this.replayScenario(composedScenario, options);
  }

  /** 파라미터화 실행: 시나리오 내 모든 데이터셋으로 반복 */
  async runParameterized(scenarioId: string, options: ReplayOptions = {}): Promise<TestResult[]> {
    const scenario = await this.storage.loadScenario(scenarioId);
    if (!scenario) throw new Error(`Scenario not found: ${scenarioId}`);

    const composedEvents = await this.composer.compose(scenario);
    const composedScenario: RecordingScenario = { ...scenario, events: composedEvents };

    const dataSets = composedScenario.testData?.dataSets || [];
    if (dataSets.length === 0) {
      // 데이터셋 없으면 단순 실행
      return [await this.replayScenario(composedScenario, options)];
    }

    const results: TestResult[] = [];
    for (const ds of dataSets) {
      const runOptions: ReplayOptions = { ...options, testDataSetName: ds.name };
      const result = await this.replayScenario(composedScenario, runOptions);
      results.push(result);
    }
    return results;
  }

  /** 스위트 실행: 여러 시나리오를 순차적으로 */
  async runSuite(scenarioIds: string[], options: ReplayOptions = {}): Promise<TestResult[]> {
    const results: TestResult[] = [];
    for (const id of scenarioIds) {
      try {
        const result = await this.runSingle(id, options);
        results.push(result);
      } catch (err: any) {
        results.push({
          scenarioId: id,
          scenarioName: `Error: ${id}`,
          platform: 'web',
          status: 'failed',
          duration: 0,
          startedAt: Date.now(),
          completedAt: Date.now(),
          events: [],
          error: err.message,
        });
      }
    }
    return results;
  }

  /** 플랫폼에 맞는 리플레이어로 실행 */
  private async replayScenario(scenario: RecordingScenario, options: ReplayOptions): Promise<TestResult> {
    // Inject standby Appium session from env vars (set by KRC WorkerManager)
    if (process.env.EXISTING_APPIUM_SESSION_ID && (scenario.platform === 'ios' || scenario.platform === 'android')) {
      scenario.existingAppiumSessionId = process.env.EXISTING_APPIUM_SESSION_ID;
      if (process.env.EXISTING_APPIUM_URL) {
        scenario.appiumServerUrl = process.env.EXISTING_APPIUM_URL;
      }
    }

    switch (scenario.platform) {
      case 'web':
        return new WebReplayer().replay(scenario, options);
      case 'ios':
        return new IOSReplayer().replay(scenario, options);
      case 'android':
        return new AndroidReplayer().replay(scenario, options);
      default:
        throw new Error(`Unsupported platform: ${scenario.platform}`);
    }
  }
}
