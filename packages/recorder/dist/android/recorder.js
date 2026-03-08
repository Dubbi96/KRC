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
exports.AndroidRecorder = void 0;
const crypto_1 = require("crypto");
const child_process_1 = require("child_process");
const util_1 = require("util");
const file_storage_1 = require("../storage/file-storage");
const event_buffer_1 = require("../web/event-buffer");
const page_source_utils_1 = require("./page-source-utils");
const assertion_suggester_1 = require("./assertion-suggester");
const execAsync = (0, util_1.promisify)(child_process_1.exec);
class AndroidRecorder {
    deviceId;
    config;
    scenario = null;
    storage;
    controller = null;
    eventMonitor = null;
    previousUIHierarchy = null;
    eventBuffer = null;
    stopping = false;
    pendingEnrich = null;
    /** assertion diff용: 이전 tap의 after 스냅샷 (현재 tap의 before로 재사용) */
    lastPageSourceSnapshot = null;
    /** assertion diff용: tap 직전에 swap된 before 스냅샷 */
    snapshotBeforeTap = null;
    constructor(deviceId, config = {}, storage) {
        this.deviceId = deviceId;
        this.config = config;
        this.storage = storage || new file_storage_1.FileStorage(config.outputDir);
    }
    async start() {
        if (this.scenario)
            throw new Error('Recording already started');
        const scenarioId = (0, crypto_1.randomUUID)();
        const { AndroidController } = await Promise.resolve().then(() => __importStar(require('@katab/device-manager')));
        this.controller = new AndroidController(this.deviceId);
        // 디바이스 정보 수집
        const screenSize = await this.controller.getScreenSize().catch(() => ({ width: 1080, height: 1920 }));
        const currentActivity = await this.controller.getCurrentActivity().catch(() => null);
        this.scenario = {
            id: scenarioId,
            name: this.config.sessionName || `Android Recording - ${new Date().toISOString()}`,
            platform: 'android',
            deviceType: 'android',
            deviceId: this.deviceId,
            package: this.config.package || currentActivity?.package,
            appiumServerUrl: this.config.appiumServerUrl,
            metadata: {
                viewport: screenSize,
            },
            startedAt: Date.now(),
            events: [],
        };
        // 이벤트 버퍼 초기화: compact 모드로 저장하여 I/O 최적화
        this.eventBuffer = new event_buffer_1.EventBuffer(() => this.storage.saveScenario(this.scenario, { compact: true }), 500, // 500ms 디바운스
        30);
        this.startEventMonitoring();
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
                const currentUI = await this.getUIHierarchy();
                if (!currentUI)
                    return;
                const now = Date.now();
                const timeSinceLastChange = now - lastCheckTime;
                if (this.previousUIHierarchy && this.previousUIHierarchy !== currentUI) {
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
                this.previousUIHierarchy = currentUI;
            }
            catch {
                // ignore monitoring errors
            }
        }, 1000);
    }
    async getUIHierarchy() {
        try {
            const { stdout } = await execAsync(`adb -s ${this.deviceId} shell "uiautomator dump /sdcard/ui_dump.xml && cat /sdcard/ui_dump.xml"`, { timeout: 10000, maxBuffer: 5 * 1024 * 1024 });
            const xmlStart = stdout.indexOf('<?xml');
            if (xmlStart >= 0)
                return stdout.substring(xmlStart);
            return null;
        }
        catch {
            return null;
        }
    }
    recordEvent(event) {
        if (!this.scenario)
            return;
        this.scenario.events.push(event);
        this.eventBuffer?.push(event);
    }
    /**
     * 마지막 녹화 이벤트에 요소 메타데이터 보강 + assertion 추천
     * tap 후 비동기로 호출하여 resource-id, content-desc, text 등을 기록하고,
     * UI 트리 diff 기반으로 assertion 후보를 생성한다.
     */
    async enrichLastEventWithElement(x, y) {
        if (this.stopping || !this.controller || !this.scenario || this.scenario.events.length === 0)
            return;
        const enrichJob = (async () => {
            try {
                // 1) UIAutomator dump 가져오기 (after 스냅샷) + 좌표로 요소 찾기
                const pageSourceXml = await this.controller.getPageSource?.()
                    ?? null;
                const element = await this.controller.findElementAtCoordinates(x, y);
                if (element && this.scenario) {
                    const lastEvent = this.scenario.events[this.scenario.events.length - 1];
                    if (!lastEvent.meta)
                        lastEvent.meta = {};
                    lastEvent.meta.element = {
                        type: element.shortType,
                        name: element.resourceId,
                        accessibilityId: element.contentDesc,
                        textContent: element.text,
                        boundingBox: element.bounds,
                        isEnabled: element.enabled,
                    };
                    // 2) UI 트리 diff 기반 assertion 추천
                    if (pageSourceXml && this.snapshotBeforeTap) {
                        try {
                            const beforeElements = (0, page_source_utils_1.parsePageSource)(this.snapshotBeforeTap);
                            const afterElements = (0, page_source_utils_1.parsePageSource)(pageSourceXml);
                            const diff = (0, page_source_utils_1.diffUITrees)(beforeElements, afterElements);
                            const suggestions = (0, assertion_suggester_1.suggestAssertionsFromDiff)(diff, {
                                type: element.type,
                                shortType: element.shortType,
                                resourceId: element.resourceId,
                                contentDesc: element.contentDesc,
                                text: element.text,
                                enabled: element.enabled,
                                clickable: element.clickable,
                                bounds: element.bounds,
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
                    // enrich 후 버퍼에 flush 트리거
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
        // 이전 tap의 after 스냅샷을 현재 tap의 before로 swap
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
        // 5) 시나리오 최종 저장 — pretty print로 사람이 읽기 쉽게
        this.scenario.stoppedAt = Date.now();
        await this.storage.saveScenario(this.scenario);
        const scenario = this.scenario;
        this.scenario = null;
        this.previousUIHierarchy = null;
        this.lastPageSourceSnapshot = null;
        this.snapshotBeforeTap = null;
        this.stopping = false;
        this.controller = null;
        return scenario;
    }
    getController() { return this.controller; }
    getScenario() { return this.scenario; }
}
exports.AndroidRecorder = AndroidRecorder;
//# sourceMappingURL=recorder.js.map