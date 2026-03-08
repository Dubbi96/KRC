"use strict";
/**
 * 부분 다시 녹화 오케스트레이터
 *
 * 시나리오의 특정 구간(fromIndex ~ toIndex)만 다시 녹화한다.
 * 1. 이전 스텝(0 ~ fromIndex-1)을 WebReplayer로 재생하여 브라우저를 올바른 상태로 이동
 * 2. 브라우저를 닫지 않고 Recording 모드로 전환
 * 3. 사용자가 새 동작을 녹화
 * 4. 녹화 중지 → 합치기: [prefix events] + [new events] + [suffix events]
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.PartialReRecorder = void 0;
const playwright_1 = require("playwright");
const crypto_1 = require("crypto");
const replayer_1 = require("./replayer");
const recorder_1 = require("./recorder");
const device_presets_1 = require("./device-presets");
const auth_store_1 = require("../dashboard/auth-store");
const timestamp_utils_1 = require("../engine/timestamp-utils");
class PartialReRecorder {
    storage;
    browser = null;
    context = null;
    page = null;
    recorder = null;
    config = null;
    originalScenario = null;
    prefixEvents = [];
    suffixEvents = [];
    constructor(storage) {
        this.storage = storage;
    }
    async start(config) {
        this.config = config;
        const emit = config.onStatus || (() => { });
        try {
            // 1. 시나리오 로드
            emit({ phase: 'loading', message: '시나리오 로드 중...' });
            const scenario = await this.storage.loadScenario(config.scenarioId);
            if (!scenario)
                throw new Error(`Scenario not found: ${config.scenarioId}`);
            if (scenario.platform !== 'web')
                throw new Error('부분 다시 녹화는 web 시나리오만 지원합니다');
            this.originalScenario = scenario;
            const events = scenario.events;
            if (config.replaceFromIndex < 0 || config.replaceToIndex >= events.length) {
                throw new Error(`인덱스 범위 초과: 0~${events.length - 1}`);
            }
            if (config.replaceFromIndex > config.replaceToIndex) {
                throw new Error('fromIndex는 toIndex보다 작거나 같아야 합니다');
            }
            // 2. prefix / suffix 분리
            this.prefixEvents = events.slice(0, config.replaceFromIndex);
            this.suffixEvents = events.slice(config.replaceToIndex + 1);
            // 3. 브라우저 생성 (PartialReRecorder가 직접 관리)
            const browserType = scenario.metadata?.browser || 'chromium';
            const deviceType = scenario.metadata?.deviceType;
            const deviceConfig = await (0, device_presets_1.resolveDeviceConfig)(deviceType);
            const contextOptions = deviceType
                ? (0, device_presets_1.toContextOptions)(deviceConfig)
                : { viewport: scenario.metadata?.viewport || { width: 1280, height: 720 } };
            const launcher = browserType === 'firefox' ? playwright_1.firefox : browserType === 'webkit' ? playwright_1.webkit : playwright_1.chromium;
            this.browser = await launcher.launch({ headless: false });
            this.context = await this.browser.newContext(contextOptions);
            this.page = await this.context.newPage();
            // 인증 주입
            if (config.authProfileId) {
                try {
                    const authStore = new auth_store_1.AuthStore(config.scenarioDir);
                    await authStore.injectIntoContext(this.context, config.authProfileId);
                }
                catch (err) {
                    console.warn(`[PartialReRecorder] Auth injection failed: ${err.message}`);
                }
            }
            // 4. prefix 스텝 재생 (브라우저를 올바른 상태로 이동)
            if (this.prefixEvents.length > 0) {
                emit({ phase: 'replaying', replayProgress: { current: 0, total: this.prefixEvents.length } });
                // prefix 전용 임시 시나리오 생성
                const tempScenario = {
                    ...scenario,
                    id: (0, crypto_1.randomUUID)(),
                    events: [...this.prefixEvents],
                };
                const replayOptions = {
                    headless: false,
                    skipBrowserClose: true,
                    existingBrowser: this.browser,
                    existingContext: this.context,
                    existingPage: this.page,
                    reportDir: '/tmp/katab-partial-rerecord',
                    authProfileId: config.authProfileId,
                    stopOnFailure: false,
                };
                const replayer = new replayer_1.WebReplayer();
                const result = await replayer.replay(tempScenario, replayOptions);
                emit({
                    phase: 'replaying',
                    replayProgress: { current: this.prefixEvents.length, total: this.prefixEvents.length },
                    message: `리플레이 완료 (${result.status})`,
                });
                // 리플레이 후 페이지 참조 갱신 (context.pages()에서 활성 페이지 확보)
                const pages = this.context.pages();
                if (pages.length > 0) {
                    this.page = pages[pages.length - 1];
                }
            }
            else {
                // prefix가 없으면 초기 URL로 이동
                const baseURL = scenario.metadata?.baseURL;
                if (baseURL && baseURL !== 'about:blank') {
                    await this.page.goto(baseURL, { waitUntil: 'domcontentloaded' });
                }
            }
            // 인증 스토리지 주입 (페이지 로드 후)
            if (config.authProfileId) {
                try {
                    const authStore = new auth_store_1.AuthStore(config.scenarioDir);
                    const hasStorage = await authStore.injectStorageIntoPage(this.page, config.authProfileId);
                    if (hasStorage && this.prefixEvents.length === 0) {
                        await this.page.reload({ waitUntil: 'domcontentloaded' });
                    }
                }
                catch {
                    // non-critical
                }
            }
            // 5. Recording 모드로 전환
            const recordingScenario = {
                id: config.scenarioId,
                name: scenario.name,
                platform: 'web',
                metadata: scenario.metadata,
                startedAt: Date.now(),
                events: [],
            };
            this.recorder = new recorder_1.WebRecorder({
                outputDir: config.scenarioDir,
            }, this.storage);
            await this.recorder.attachToPage(this.page, this.context, this.browser, recordingScenario);
            emit({ phase: 'recording', message: '브라우저에서 동작을 수행하세요' });
        }
        catch (err) {
            emit({ phase: 'error', message: err.message });
            await this.cleanup();
            throw err;
        }
    }
    async stop() {
        if (!this.recorder || !this.config || !this.originalScenario) {
            throw new Error('부분 다시 녹화가 시작되지 않았습니다');
        }
        const emit = this.config.onStatus || (() => { });
        emit({ phase: 'stopping', message: '녹화 중지 중...' });
        try {
            // 1. recorder 중지 → 새 이벤트 획득
            const recordedScenario = await this.recorder.stop();
            const newEvents = recordedScenario.events;
            // 2. 합치기: prefix + new + suffix
            const mergedEvents = [
                ...this.prefixEvents,
                ...newEvents,
                ...this.suffixEvents,
            ];
            // 3. timestamp 정규화 + reindex
            (0, timestamp_utils_1.normalizeTimestamps)(mergedEvents);
            mergedEvents.forEach((ev, idx) => {
                ev.stepNo = idx + 1;
            });
            // 4. 원본 시나리오 업데이트
            const scenario = await this.storage.loadScenario(this.config.scenarioId);
            if (!scenario)
                throw new Error('원본 시나리오를 찾을 수 없습니다');
            scenario.events = mergedEvents;
            scenario.version = (scenario.version || 0) + 1;
            await this.storage.saveScenario(scenario);
            const result = {
                scenarioId: this.config.scenarioId,
                newEventsCount: newEvents.length,
                status: 'done',
            };
            emit({ phase: 'done', message: `완료: ${newEvents.length}개 새 이벤트로 교체됨` });
            // cleanup은 recorder.stop()이 이미 브라우저를 닫았으므로 별도 불필요
            this.browser = null;
            this.context = null;
            this.page = null;
            this.recorder = null;
            return result;
        }
        catch (err) {
            emit({ phase: 'error', message: err.message });
            await this.cleanup();
            throw err;
        }
    }
    async cleanup() {
        try {
            if (this.context)
                await this.context.close().catch(() => { });
            if (this.browser)
                await this.browser.close().catch(() => { });
        }
        catch {
            // ignore
        }
        this.browser = null;
        this.context = null;
        this.page = null;
        this.recorder = null;
    }
}
exports.PartialReRecorder = PartialReRecorder;
//# sourceMappingURL=partial-re-recorder.js.map