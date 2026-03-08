"use strict";
/**
 * 테스트 러너
 *
 * 단일/파라미터화/스위트 실행을 지원한다.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.TestRunner = void 0;
const composer_1 = require("./composer");
const replayer_1 = require("../web/replayer");
const replayer_2 = require("../ios/replayer");
const replayer_3 = require("../android/replayer");
class TestRunner {
    storage;
    composer;
    constructor(storage) {
        this.storage = storage;
        this.composer = new composer_1.ScenarioComposer(storage);
    }
    /** 단일 시나리오 실행 (includes 해석 포함) */
    async runSingle(scenarioId, options = {}) {
        const scenario = await this.storage.loadScenario(scenarioId);
        if (!scenario)
            throw new Error(`Scenario not found: ${scenarioId}`);
        // includes 해석 → 이벤트 합성
        const composedEvents = await this.composer.compose(scenario);
        const composedScenario = { ...scenario, events: composedEvents };
        return this.replayScenario(composedScenario, options);
    }
    /** 파라미터화 실행: 시나리오 내 모든 데이터셋으로 반복 */
    async runParameterized(scenarioId, options = {}) {
        const scenario = await this.storage.loadScenario(scenarioId);
        if (!scenario)
            throw new Error(`Scenario not found: ${scenarioId}`);
        const composedEvents = await this.composer.compose(scenario);
        const composedScenario = { ...scenario, events: composedEvents };
        const dataSets = composedScenario.testData?.dataSets || [];
        if (dataSets.length === 0) {
            // 데이터셋 없으면 단순 실행
            return [await this.replayScenario(composedScenario, options)];
        }
        const results = [];
        for (const ds of dataSets) {
            const runOptions = { ...options, testDataSetName: ds.name };
            const result = await this.replayScenario(composedScenario, runOptions);
            results.push(result);
        }
        return results;
    }
    /** 스위트 실행: 여러 시나리오를 순차적으로 */
    async runSuite(scenarioIds, options = {}) {
        const results = [];
        for (const id of scenarioIds) {
            try {
                const result = await this.runSingle(id, options);
                results.push(result);
            }
            catch (err) {
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
    async replayScenario(scenario, options) {
        // Inject standby Appium session from env vars (set by KRC WorkerManager)
        if (process.env.EXISTING_APPIUM_SESSION_ID && (scenario.platform === 'ios' || scenario.platform === 'android')) {
            scenario.existingAppiumSessionId = process.env.EXISTING_APPIUM_SESSION_ID;
            if (process.env.EXISTING_APPIUM_URL) {
                scenario.appiumServerUrl = process.env.EXISTING_APPIUM_URL;
            }
        }
        switch (scenario.platform) {
            case 'web':
                return new replayer_1.WebReplayer().replay(scenario, options);
            case 'ios':
                return new replayer_2.IOSReplayer().replay(scenario, options);
            case 'android':
                return new replayer_3.AndroidReplayer().replay(scenario, options);
            default:
                throw new Error(`Unsupported platform: ${scenario.platform}`);
        }
    }
}
exports.TestRunner = TestRunner;
//# sourceMappingURL=runner.js.map