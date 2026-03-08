"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.IOSRecorder = void 0;
const crypto_1 = require("crypto");
const file_storage_1 = require("../storage/file-storage");
const event_buffer_1 = require("../web/event-buffer");
const page_source_utils_1 = require("./page-source-utils");
const assertion_suggester_1 = require("./assertion-suggester");
class IOSRecorder {
    udid;
    config;
    scenario = null;
    storage;
    controller = null;
    eventMonitor = null;
    previousPageSource = null;
    stopping = false;
    pendingEnrich = null;
    eventBuffer = null;
    /** assertion diff용: 이전 tap의 after 스냅샷 (현재 tap의 before로 재사용) */
    lastPageSourceSnapshot = null;
    /** assertion diff용: tap 직전에 swap된 before 스냅샷 */
    snapshotBeforeTap = null;
    constructor(udid, config = {}, storage) {
        this.udid = udid;
        this.config = config;
        this.storage = storage || new file_storage_1.FileStorage(config.outputDir);
    }
    /** IOSController 인스턴스 접근 (미러 서버용) */
    getController() { return this.controller; }
    async start() {
        if (this.scenario)
            throw new Error('Recording already started');
        const scenarioId = (0, crypto_1.randomUUID)();
        const appiumServerUrl = this.config.appiumServerUrl || 'http://localhost:4723';
        const { IOSController } = await Promise.resolve().then(() => __importStar(require('@katab/device-manager')));
        this.controller = new IOSController(this.udid, appiumServerUrl, this.config.controlOptions || {});
        await this.controller.createSession(this.config.bundleId);
        this.scenario = {
            id: scenarioId,
            name: this.config.sessionName || `iOS Recording - ${new Date().toISOString()}`,
            platform: 'ios',
            deviceType: 'ios',
            udid: this.udid,
            bundleId: this.config.bundleId,
            appiumServerUrl,
            startedAt: Date.now(),
            events: [],
        };
        // 이벤트 버퍼 초기화: compact 모드로 저장하여 I/O 최적화
        this.eventBuffer = new event_buffer_1.EventBuffer(() => this.storage.saveScenario(this.scenario, { compact: true }), 500, // 500ms 디바운스
        30);
        // 미러 모드에서는 폴링 모니터링 불필요 (미러 UI에서 직접 조작)
        if (!this.config.mirror) {
            this.startEventMonitoring();
        }
        return scenarioId;
    }
    startEventMonitoring() {
        if (!this.controller || !this.scenario)
            return;
        let lastCheckTime = Date.now();
        let consecutiveChanges = 0;
        this.eventMonitor = setInterval(async () => {
            try {
                if (!this.controller || !this.scenario)
                    return;
                const sessionId = this.controller.currentSessionId;
                if (!sessionId)
                    return;
                const { executeAppiumAction } = await Promise.resolve().then(() => __importStar(require('@katab/device-manager')));
                const currentPageSource = await executeAppiumAction(this.controller.serverUrl, sessionId, 'source', {}).catch(() => null);
                if (!currentPageSource)
                    return;
                const sourceStr = JSON.stringify(currentPageSource);
                const now = Date.now();
                const timeSinceLastChange = now - lastCheckTime;
                if (this.previousPageSource && this.previousPageSource !== sourceStr) {
                    consecutiveChanges++;
                    lastCheckTime = now;
                    let eventType = 'tap';
                    if (consecutiveChanges > 1 && timeSinceLastChange < 500)
                        eventType = 'swipe';
                    this.recordEvent({
                        type: eventType,
                        timestamp: now,
                        meta: { source: 'device_direct_interaction' },
                    });
                }
                else if (consecutiveChanges > 0 && timeSinceLastChange > 1000) {
                    consecutiveChanges = 0;
                }
                this.previousPageSource = sourceStr;
            }
            catch (error) {
                if (error.message?.includes('invalid session') || error.message?.includes('session not found')) {
                    this.stop().catch(() => { });
                }
            }
        }, 1000);
    }
    recordEvent(event) {
        if (!this.scenario)
            return;
        this.scenario.events.push(event);
        this.eventBuffer?.push(event);
    }
    /**
     * 마지막 녹화 이벤트에 요소 메타데이터 보강 + assertion 추천
     * tap 후 비동기로 호출하여 accessibilityId, label, name 등을 기록하고,
     * UI 트리 diff 기반으로 assertion 후보를 생성한다.
     */
    async enrichLastEventWithElement(x, y) {
        if (this.stopping || !this.controller || !this.scenario || this.scenario.events.length === 0)
            return;
        const enrichJob = (async () => {
            try {
                // 1) pageSource 가져오기 (after 스냅샷) + 좌표로 요소 찾기
                const pageSourceXml = await this.controller.getPageSource?.()
                    ?? null;
                const element = await this.controller.findElementAtCoordinates(x, y);
                if (element && this.scenario) {
                    const lastEvent = this.scenario.events[this.scenario.events.length - 1];
                    if (!lastEvent.meta)
                        lastEvent.meta = {};
                    lastEvent.meta.element = {
                        type: element.type,
                        label: element.label,
                        name: element.name,
                        accessibilityId: element.accessibilityId,
                    };
                    // 2) UI 트리 diff 기반 assertion 추천
                    if (pageSourceXml && this.snapshotBeforeTap) {
                        try {
                            const beforeElements = (0, page_source_utils_1.parsePageSource)(this.snapshotBeforeTap);
                            const afterElements = (0, page_source_utils_1.parsePageSource)(pageSourceXml);
                            const diff = (0, page_source_utils_1.diffUITrees)(beforeElements, afterElements);
                            const suggestions = (0, assertion_suggester_1.suggestAssertionsFromDiff)(diff, {
                                type: element.type,
                                label: element.label,
                                name: element.name,
                                accessibilityId: element.accessibilityId,
                            });
                            if (suggestions.length > 0) {
                                lastEvent.meta.suggestedAssertions = suggestions;
                            }
                        }
                        catch {
                            // diff/추천 실패는 무시 (보조 기능)
                        }
                    }
                    // 3) 현재 pageSource를 다음 tap의 before로 캐시
                    if (pageSourceXml) {
                        this.lastPageSourceSnapshot = pageSourceXml;
                    }
                    // enrich 후 버퍼에 flush 트리거 (이벤트가 이미 수정되었으므로)
                    this.eventBuffer?.flush();
                }
            }
            catch {
                // 요소 찾기 실패는 무시 (보조 정보일 뿐)
            }
            finally {
                this.pendingEnrich = null;
                this.snapshotBeforeTap = null;
            }
        })();
        this.pendingEnrich = enrichJob;
        return enrichJob;
    }
    async tap(x, y) {
        if (!this.controller)
            throw new Error('Recording not started');
        // 이전 tap의 after 스냅샷을 현재 tap의 before로 swap (추가 pageSource 호출 없음)
        this.snapshotBeforeTap = this.lastPageSourceSnapshot;
        await this.controller.tap(x, y);
        this.recordEvent({ type: 'tap', timestamp: Date.now(), coordinates: { x, y }, meta: { source: 'programmatic' } });
    }
    async swipe(from, to, duration) {
        if (!this.controller)
            throw new Error('Recording not started');
        await this.controller.swipe({ from, to, duration });
        this.recordEvent({ type: 'swipe', timestamp: Date.now(), from, to, duration, meta: { source: 'programmatic' } });
    }
    async type(text) {
        if (!this.controller)
            throw new Error('Recording not started');
        await this.controller.type(text);
        this.recordEvent({ type: 'type', timestamp: Date.now(), text, meta: { source: 'programmatic' } });
    }
    async stop() {
        if (!this.scenario)
            throw new Error('No active recording');
        // 1) 더 이상 새 작업 수락 안 함
        this.stopping = true;
        // 2) 모니터링 중단
        if (this.eventMonitor) {
            clearInterval(this.eventMonitor);
            this.eventMonitor = null;
        }
        // 3) 진행 중인 enrich 대기 (최대 2초)
        if (this.pendingEnrich) {
            await Promise.race([this.pendingEnrich, new Promise(r => setTimeout(r, 2000))]);
            this.pendingEnrich = null;
        }
        // 4) 버퍼에 남은 이벤트를 모두 flush
        if (this.eventBuffer) {
            await this.eventBuffer.destroy();
            this.eventBuffer = null;
        }
        // 5) Appium 세션 종료 (최대 5초 타임아웃)
        if (this.controller) {
            await Promise.race([
                this.controller.closeSession().catch(() => { }),
                new Promise(r => setTimeout(r, 5000)),
            ]);
            this.controller = null;
        }
        // 6) 시나리오 최종 저장 — pretty print로 사람이 읽기 쉽게
        this.scenario.stoppedAt = Date.now();
        await this.storage.saveScenario(this.scenario);
        const scenario = this.scenario;
        this.scenario = null;
        this.previousPageSource = null;
        this.lastPageSourceSnapshot = null;
        this.snapshotBeforeTap = null;
        this.stopping = false;
        return scenario;
    }
    getScenario() { return this.scenario; }
}
exports.IOSRecorder = IOSRecorder;
//# sourceMappingURL=recorder.js.map