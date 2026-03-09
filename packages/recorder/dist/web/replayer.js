"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.WebReplayer = void 0;
const playwright_1 = require("playwright");
const path_1 = require("path");
const fs_1 = require("fs");
const collector_1 = require("../reporter/collector");
const generator_1 = require("../reporter/generator");
const variables_1 = require("../engine/variables");
const assertions_1 = require("../engine/assertions");
const step_executors_1 = require("../engine/step-executors");
const device_presets_1 = require("./device-presets");
const auth_store_1 = require("../dashboard/auth-store");
const page_registry_1 = require("./page-registry");
const locator_resolver_1 = require("./locator-resolver");
const timestamp_utils_1 = require("../engine/timestamp-utils");
class WebReplayer {
    collector = new collector_1.ResultCollector();
    generator = new generator_1.ReportGenerator();
    pageRegistry = new page_registry_1.PageRegistry();
    locatorResolver = new locator_resolver_1.LocatorResolver();
    /** healedLocator 결과를 시나리오 이벤트에 반영 (다음 실행에서 우선 사용) */
    applyHealedLocator(event, healed) {
        if (!event.meta)
            event.meta = {};
        if (!event.meta.healedLocators)
            event.meta.healedLocators = [];
        // 동일 전략의 기존 기록이 있으면 successCount 업데이트
        const existing = event.meta.healedLocators.find(h => h.locator.kind === healed.locator.kind && h.locator.value === healed.locator.value);
        if (existing) {
            existing.successCount++;
            existing.healedAt = healed.healedAt;
        }
        else {
            event.meta.healedLocators.push(healed);
        }
    }
    /** 기존 healedLocator로 resolve 성공 시 successCount를 누적한다 (학습 루프) */
    bumpHealedLocatorSuccess(event, usedHealed) {
        const healedList = event.meta?.healedLocators;
        if (!healedList)
            return;
        const match = healedList.find(h => h.locator.kind === usedHealed.locator.kind && h.locator.value === usedHealed.locator.value);
        if (match) {
            match.successCount++;
            match.healedAt = Date.now();
        }
    }
    /**
     * resolveElement 대신 locatorResolver.resolve에 전달할 옵션을 구성한다.
     * within 스코프 처리, matchText 해석을 포함.
     */
    buildResolverOptions(page, event, vars, deadline) {
        let scopeRoot = page;
        let scopeDescription = '';
        if (event.within?.selector) {
            const withinSel = this.safeSelector(vars.resolve(event.within.selector));
            let scopeLocator = page.locator(withinSel);
            if (event.within.hasText) {
                const withinText = vars.resolve(event.within.hasText);
                scopeLocator = scopeLocator.filter({ hasText: withinText });
                scopeDescription = `within(${withinSel}, hasText="${withinText}")`;
            }
            else {
                scopeDescription = `within(${withinSel})`;
            }
            scopeRoot = scopeLocator.first();
        }
        const matchText = event.matchText ? vars.resolve(event.matchText) : undefined;
        return {
            scopeRoot,
            scopeDescription,
            deadline,
            variables: vars,
            matchText,
        };
    }
    async replay(scenario, options = {}) {
        const { speed = 1.0, delayBetweenEvents = 100, takeScreenshots = false, reportDir = './reports', stopOnFailure = true, } = options;
        // 시퀀스 카운터 초기화 (런 단위)
        (0, variables_1.resetSequences)();
        // 변수 컨텍스트 초기화
        const variables = new variables_1.VariableContext(scenario.variables);
        if (options.testDataSetName && scenario.testData) {
            const dataSet = scenario.testData.dataSets.find(d => d.name === options.testDataSetName);
            if (dataSet)
                variables.merge(dataSet.variables);
        }
        // 체인 변수 병합 (이전 시나리오에서 전달, scenario.variables보다 높고 CLI --var보다 낮은 우선순위)
        if (options.chainVariables)
            variables.merge(options.chainVariables);
        if (options.variables)
            variables.merge(options.variables);
        const assertionEngine = new assertions_1.AssertionEngine();
        this.collector.start(scenario.id, scenario.name, scenario.platform);
        const browserType = scenario.metadata?.browser || 'chromium';
        const launcher = browserType === 'firefox' ? playwright_1.firefox : browserType === 'webkit' ? playwright_1.webkit : playwright_1.chromium;
        // 체인 실행: 기존 브라우저/컨텍스트/페이지가 있으면 재사용
        const browser = options.existingBrowser || await launcher.launch({ headless: options.headless || false });
        // 디바이스 에뮬레이션: option > scenario metadata > legacy viewport 순서로 결정
        const effectiveDeviceType = options.deviceType || scenario.metadata?.deviceType;
        const deviceConfig = await (0, device_presets_1.resolveDeviceConfig)(effectiveDeviceType);
        const contextOptions = effectiveDeviceType
            ? (0, device_presets_1.toContextOptions)(deviceConfig)
            : { viewport: scenario.metadata?.viewport || { width: 1280, height: 720 } };
        const context = options.existingContext || await browser.newContext(contextOptions);
        const page = options.existingPage || await context.newPage();
        const ownsBrowser = !options.existingBrowser;
        // 인증 프로필 주입 (기존 컨텍스트 재사용 시에는 이미 주입되었으므로 스킵)
        if (options.authProfileId && !options.existingContext) {
            try {
                const authStore = new auth_store_1.AuthStore(reportDir.replace(/[/\\]reports$/, '/scenarios'));
                await authStore.injectIntoContext(context, options.authProfileId);
            }
            catch (err) {
                // 인증 주입 실패는 치명적이지 않음 — 경고 후 계속 진행
                console.warn(`[WebReplayer] Auth injection failed: ${err.message}`);
            }
        }
        // PageRegistry 초기화 — 메인 페이지 등록 및 팝업 자동 감지
        this.pageRegistry.clear();
        this.pageRegistry.registerMain(page);
        context.on('page', async (popup) => {
            const popupId = this.pageRegistry.registerPopup(popup);
            popup.on('close', () => this.pageRegistry.remove(popupId));
        });
        // 항상 스크린샷 디렉토리 생성 (실패 시 스크린샷은 항상 캡처)
        const screenshotDir = (0, path_1.join)(reportDir, scenario.id, 'screenshots');
        if (!(0, fs_1.existsSync)(screenshotDir))
            (0, fs_1.mkdirSync)(screenshotDir, { recursive: true });
        // ── 네트워크 로그 수집 (스트림 검증용 ring buffer) ──
        const NETWORK_LOG_MAX = 500;
        const networkLogs = [];
        const mediaPattern = /\.(m3u8|mpd|ts|m4s|mp4|aac|webm|fmp4)(\?|$)/i;
        page.on('response', (response) => {
            try {
                const url = response.url();
                if (!mediaPattern.test(url))
                    return;
                const entry = {
                    url,
                    status: response.status(),
                    contentType: response.headers()['content-type'] || '',
                    contentLength: parseInt(response.headers()['content-length'] || '-1', 10),
                    timestamp: Date.now(),
                };
                networkLogs.push(entry);
                // ring buffer: 오래된 항목 제거
                if (networkLogs.length > NETWORK_LOG_MAX) {
                    networkLogs.splice(0, networkLogs.length - NETWORK_LOG_MAX);
                }
            }
            catch {
                // response 처리 실패 무시 (페이지 닫힘 등)
            }
        });
        const execCtx = {
            page,
            variables,
            assertionEngine,
            networkLogs,
            onWaitForUserStart: options.onWaitForUserStart,
            onWaitForUserEnd: options.onWaitForUserEnd,
        };
        try {
            const events = scenario.events;
            if (events.length === 0)
                throw new Error('No events to replay');
            // timestamp 정규화: 역전/과대 gap 보정
            const tsFixed = (0, timestamp_utils_1.normalizeTimestamps)(events, { maxGap: 10000, defaultGap: 300 });
            if (tsFixed > 0)
                console.log(`[WebReplayer] timestamp 정규화: ${tsFixed}개 스텝 보정됨`);
            let prevTimestamp = events[0].timestamp;
            let authStorageInjected = false;
            // 스텝 범위 실행 지원
            const fromStep = options.fromStep ?? 0;
            const toStep = options.toStep ?? events.length - 1;
            for (let i = 0; i < events.length; i++) {
                const event = events[i];
                // 범위 밖 스텝 스킵
                if (i < fromStep || i > toStep) {
                    this.collector.addEventResult({
                        eventIndex: i, eventType: event.type, status: 'skipped', duration: 0,
                        stepNo: event.stepNo, description: event.description || '범위 외 스킵',
                    });
                    continue;
                }
                // disabled 스킵
                if (event.disabled) {
                    this.collector.addEventResult({
                        eventIndex: i, eventType: event.type, status: 'skipped', duration: 0,
                        stepNo: event.stepNo, description: event.description,
                    });
                    continue;
                }
                // 녹화 일시정지/재개 마커 이벤트 스킵
                if (event.type === 'navigate' && event.meta?.source &&
                    (event.meta.source === 'recording_paused' || event.meta.source === 'recording_unpaused')) {
                    this.collector.addEventResult({
                        eventIndex: i, eventType: event.type, status: 'skipped', duration: 0,
                        stepNo: event.stepNo,
                        description: event.description || (event.meta.source === 'recording_paused' ? '녹화 일시정지' : '녹화 재개'),
                    });
                    continue;
                }
                // ─── 제어 흐름: for_each 루프 ───
                if (event.type === 'for_each_start') {
                    const config = event.forEachConfig;
                    if (!config?.selector) {
                        this.collector.addEventResult({
                            eventIndex: i, eventType: event.type, status: 'failed', duration: 0,
                            stepNo: event.stepNo, description: event.description,
                            error: 'No forEachConfig or selector specified',
                        });
                        if (stopOnFailure)
                            break;
                        continue;
                    }
                    const sel = variables.resolve(config.selector);
                    const count = await page.locator(sel).count();
                    const endIdx = this.findMatchingEnd(events, i, 'for_each_start', 'for_each_end');
                    const innerSteps = events.slice(i + 1, endIdx);
                    const maxIter = Math.min(count, config.maxIterations || 100);
                    // for_each_start 자체를 passed로 기록
                    this.collector.addEventResult({
                        eventIndex: i, eventType: event.type, status: 'passed', duration: 0,
                        stepNo: event.stepNo, description: event.description || `반복 ${count}개 (max ${config.maxIterations || 100})`,
                        capturedVariables: { __count: String(count) },
                    });
                    let loopBroken = false;
                    for (let iter = 0; iter < maxIter; iter++) {
                        variables.set(config.itemVariable || '__index', String(iter));
                        variables.set(config.countVariable || '__count', String(count));
                        variables.set('__item_selector', `${sel} >> nth=${iter}`);
                        for (const innerEvent of innerSteps) {
                            if (innerEvent.disabled)
                                continue;
                            const result = await this.replayEvent(page, innerEvent, i, screenshotDir, execCtx, takeScreenshots);
                            this.collector.addEventResult(result);
                            if (result.status === 'failed' && stopOnFailure) {
                                loopBroken = true;
                                break;
                            }
                        }
                        if (loopBroken)
                            break;
                    }
                    if (loopBroken && stopOnFailure)
                        break;
                    i = endIdx; // for_each_end로 점프
                    prevTimestamp = event.timestamp;
                    continue;
                }
                if (event.type === 'for_each_end') {
                    // 단독으로 만나면 마커만 — 스킵
                    this.collector.addEventResult({
                        eventIndex: i, eventType: event.type, status: 'passed', duration: 0,
                        stepNo: event.stepNo, description: event.description || '반복 종료',
                    });
                    continue;
                }
                // ─── 제어 흐름: if 조건 ───
                if (event.type === 'if_start') {
                    const conditionMet = await (0, step_executors_1.evaluateIfCondition)(event, execCtx);
                    this.collector.addEventResult({
                        eventIndex: i, eventType: event.type, status: 'passed', duration: 0,
                        stepNo: event.stepNo,
                        description: event.description || `조건: ${conditionMet ? '충족' : '불충족'}`,
                    });
                    if (!conditionMet) {
                        const endIdx = this.findMatchingEnd(events, i, 'if_start', 'if_end');
                        // 스킵된 스텝들 기록
                        for (let s = i + 1; s < endIdx; s++) {
                            this.collector.addEventResult({
                                eventIndex: s, eventType: events[s].type, status: 'skipped', duration: 0,
                                stepNo: events[s].stepNo, description: events[s].description,
                            });
                        }
                        i = endIdx; // if_end로 점프
                    }
                    prevTimestamp = event.timestamp;
                    continue;
                }
                if (event.type === 'if_end') {
                    this.collector.addEventResult({
                        eventIndex: i, eventType: event.type, status: 'passed', duration: 0,
                        stepNo: event.stepNo, description: event.description || '조건 종료',
                    });
                    continue;
                }
                // ─── 제어 흐름: block 컨테이너 (구조 마커 — 실행 없음) ───
                if (event.type === 'block_start') {
                    this.collector.addEventResult({
                        eventIndex: i, eventType: event.type, status: 'passed', duration: 0,
                        stepNo: event.stepNo,
                        description: event.description || `블록: ${event.blockConfig?.name || ''}`,
                    });
                    prevTimestamp = event.timestamp;
                    continue;
                }
                if (event.type === 'block_end') {
                    this.collector.addEventResult({
                        eventIndex: i, eventType: event.type, status: 'passed', duration: 0,
                        stepNo: event.stepNo, description: event.description || '블록 종료',
                    });
                    prevTimestamp = event.timestamp;
                    continue;
                }
                // ─── popup_opened: 새 팝업 페이지 대기 + 등록 ───
                if (event.type === 'popup_opened') {
                    const expectedPageId = event.meta?.pageId;
                    const popupStart = Date.now();
                    // 1) registry에 이미 등록된 페이지 확인 (context.on('page')가 먼저 실행된 경우)
                    let popupPage = expectedPageId ? this.pageRegistry.get(expectedPageId) : undefined;
                    // 2) registry에 없으면 — 이미 열렸지만 등록 안 된 페이지를 context.pages()에서 탐색
                    if (!popupPage) {
                        const registeredPages = new Set([...this.pageRegistry.getAll().values()]);
                        const unregistered = context.pages().find((p) => !registeredPages.has(p));
                        if (unregistered) {
                            if (expectedPageId) {
                                this.pageRegistry.register(expectedPageId, unregistered);
                                unregistered.on('close', () => this.pageRegistry.remove(expectedPageId));
                            }
                            popupPage = unregistered;
                        }
                    }
                    // 3) 아직 열리지 않았으면 waitForEvent으로 대기
                    if (!popupPage) {
                        try {
                            const newPage = await context.waitForEvent('page', { timeout: 15000 });
                            if (expectedPageId) {
                                this.pageRegistry.register(expectedPageId, newPage);
                                newPage.on('close', () => this.pageRegistry.remove(expectedPageId));
                            }
                            popupPage = newPage;
                        }
                        catch {
                            this.collector.addEventResult({
                                eventIndex: i, eventType: 'popup_opened', status: 'failed',
                                duration: Date.now() - popupStart, stepNo: event.stepNo,
                                description: event.description || '팝업 대기',
                                error: `팝업 "${expectedPageId}" 이(가) 시간 내에 나타나지 않음`,
                            });
                            if (stopOnFailure)
                                break;
                            prevTimestamp = event.timestamp;
                            continue;
                        }
                    }
                    // 팝업 로드 대기 (여기 도달 시 popupPage는 반드시 할당됨 — 미할당 분기는 continue로 탈출)
                    try {
                        await popupPage.waitForLoadState('domcontentloaded', { timeout: 15000 });
                    }
                    catch { /* non-critical */ }
                    this.collector.addEventResult({
                        eventIndex: i, eventType: 'popup_opened', status: 'passed',
                        duration: Date.now() - popupStart, stepNo: event.stepNo,
                        description: event.description || `팝업 열림: ${expectedPageId}`,
                    });
                    prevTimestamp = event.timestamp;
                    continue;
                }
                // ─── popup_closed: 팝업 페이지 닫기 ───
                if (event.type === 'popup_closed') {
                    const targetPageId = event.meta?.pageId;
                    const closeStart = Date.now();
                    if (targetPageId) {
                        const targetPage = this.pageRegistry.get(targetPageId);
                        if (targetPage) {
                            await targetPage.close().catch(() => { });
                            this.pageRegistry.remove(targetPageId);
                        }
                    }
                    this.collector.addEventResult({
                        eventIndex: i, eventType: 'popup_closed', status: 'passed',
                        duration: Date.now() - closeStart, stepNo: event.stepNo,
                        description: event.description || `팝업 닫힘: ${targetPageId}`,
                    });
                    prevTimestamp = event.timestamp;
                    continue;
                }
                // ─── 단독 dialog: 이전 액션이 트리거하지 않는 경우 ───
                if (event.type === 'dialog') {
                    const dialogStart = Date.now();
                    const dialogConfig = event.dialogConfig;
                    if (!dialogConfig) {
                        this.collector.addEventResult({
                            eventIndex: i, eventType: 'dialog', status: 'failed', duration: 0,
                            error: 'dialogConfig 없음', stepNo: event.stepNo, description: event.description,
                        });
                        if (stopOnFailure)
                            break;
                        prevTimestamp = event.timestamp;
                        continue;
                    }
                    const dialogPage = this.resolvePageForEvent(event, page);
                    // 다이얼로그 핸들러 등록 + 타임아웃 대기
                    try {
                        await new Promise((resolve, reject) => {
                            const timeout = setTimeout(() => {
                                dialogPage.removeListener('dialog', handler);
                                reject(new Error(`${dialogConfig.dialogType} 다이얼로그가 10초 내에 나타나지 않음`));
                            }, 10000);
                            const handler = async (dialog) => {
                                clearTimeout(timeout);
                                try {
                                    if (dialogConfig.action === 'accept') {
                                        if (dialogConfig.dialogType === 'prompt' && dialogConfig.promptText !== undefined) {
                                            await dialog.accept(dialogConfig.promptText);
                                        }
                                        else {
                                            await dialog.accept();
                                        }
                                    }
                                    else {
                                        await dialog.dismiss();
                                    }
                                    resolve();
                                }
                                catch (err) {
                                    reject(err);
                                }
                            };
                            dialogPage.once('dialog', handler);
                        });
                        this.collector.addEventResult({
                            eventIndex: i, eventType: 'dialog', status: 'passed',
                            duration: Date.now() - dialogStart, stepNo: event.stepNo,
                            description: event.description || `${dialogConfig.dialogType}: ${dialogConfig.action}`,
                        });
                    }
                    catch (err) {
                        this.collector.addEventResult({
                            eventIndex: i, eventType: 'dialog', status: 'failed',
                            duration: Date.now() - dialogStart, error: err.message,
                            stepNo: event.stepNo, description: event.description,
                        });
                        if (stopOnFailure)
                            break;
                    }
                    prevTimestamp = event.timestamp;
                    continue;
                }
                if (i > 0 && event.type !== 'wait_for_user' && event.type !== 'wait_for' && event.type !== 'wait') {
                    const wait = Math.max(0, (event.timestamp - prevTimestamp) / speed - delayBetweenEvents);
                    if (wait > 0)
                        await this.sleep(wait);
                }
                // ─── 액션 + dialog 번들링 ───
                // 현재 이벤트(click 등) 직후 dialog 이벤트가 오면,
                // dialog handler를 미리 등록한 뒤 액션을 실행 (Playwright는 미처리 다이얼로그를 auto-dismiss)
                const nextEvent = i + 1 < events.length ? events[i + 1] : null;
                if (nextEvent?.type === 'dialog' && nextEvent.dialogConfig && !nextEvent.disabled) {
                    const dlgConfig = nextEvent.dialogConfig;
                    const dlgPage = this.resolvePageForEvent(nextEvent, page);
                    // 다이얼로그 핸들러 사전 등록
                    const dialogHandled = new Promise((resolve) => {
                        const handler = async (dialog) => {
                            try {
                                if (dlgConfig.action === 'accept') {
                                    if (dlgConfig.dialogType === 'prompt' && dlgConfig.promptText !== undefined) {
                                        await dialog.accept(dlgConfig.promptText);
                                    }
                                    else {
                                        await dialog.accept();
                                    }
                                }
                                else {
                                    await dialog.dismiss();
                                }
                            }
                            catch { /* best effort */ }
                            resolve();
                        };
                        dlgPage.once('dialog', handler);
                    });
                    // 트리거 액션(현재 이벤트) 실행
                    const eventPage = this.resolvePageForEvent(event, page);
                    execCtx.page = eventPage;
                    const triggerResult = await this.replayEvent(eventPage, event, i, screenshotDir, execCtx, takeScreenshots);
                    this.collector.addEventResult(triggerResult);
                    // 다이얼로그 처리 대기 (최대 5초)
                    const dlgStart = Date.now();
                    await Promise.race([
                        dialogHandled,
                        new Promise(r => setTimeout(r, 5000)),
                    ]);
                    this.collector.addEventResult({
                        eventIndex: i + 1, eventType: 'dialog', status: 'passed',
                        duration: Date.now() - dlgStart, stepNo: nextEvent.stepNo,
                        description: nextEvent.description || `${dlgConfig.dialogType}: ${dlgConfig.action}`,
                    });
                    prevTimestamp = nextEvent.timestamp;
                    i++; // dialog 이벤트 건너뜀 (이미 처리됨)
                    if (triggerResult.status === 'failed' && stopOnFailure)
                        break;
                    continue;
                }
                // ─── click + wait_for(url_change) 번들링 ───
                // click 직후 wait_for(url_change, normalizedFrom='navigate')가 오면
                // Promise.all로 묶어서 "이미 지나간 URL 변화를 못 잡는" 경쟁 조건 방지
                const shouldBundle = event.type === 'click' &&
                    nextEvent?.type === 'wait_for' &&
                    nextEvent?.waitForConfig?.waitType === 'url_change' &&
                    nextEvent?.meta?.normalizedFrom === 'navigate' &&
                    !nextEvent?.disabled;
                if (shouldBundle && nextEvent) {
                    const bundleStart = Date.now();
                    const urlPattern = nextEvent.waitForConfig.urlPattern || '';
                    const resolvedPattern = variables.resolve(urlPattern);
                    const globPattern = `**/*${resolvedPattern}*`;
                    const waitTimeout = nextEvent.waitForConfig.timeout || 30000;
                    const waitUntil = nextEvent.waitForConfig.waitUntil || 'domcontentloaded';
                    try {
                        // click과 waitForURL을 동시에 시작하여 경쟁 조건 방지
                        const stepTimeout = Math.max(WebReplayer.getStepTimeout(nextEvent), WebReplayer.STEP_TIMEOUT);
                        const deadline = Date.now() + stepTimeout;
                        // 이미 URL이 매칭된 상태인지 확인
                        const currentUrl = page.url();
                        const alreadyMatched = resolvedPattern && currentUrl.includes(resolvedPattern);
                        if (alreadyMatched) {
                            // 이미 URL 매칭 → click만 실행
                            const clickResult = await this.replayEvent(page, event, i, screenshotDir, execCtx, takeScreenshots);
                            this.collector.addEventResult(clickResult);
                            // wait_for는 즉시 성공
                            this.collector.addEventResult({
                                eventIndex: i + 1, eventType: 'wait_for', status: 'passed',
                                duration: 0, stepNo: nextEvent.stepNo,
                                description: nextEvent.description || `URL 이미 매칭: ${resolvedPattern}`,
                            });
                        }
                        else {
                            // Promise.all: waitForURL 리스너를 먼저 걸고, click 실행
                            const waitPromise = page.waitForURL(globPattern, {
                                waitUntil,
                                timeout: Math.min(waitTimeout, Math.max(deadline - Date.now(), 0)),
                            });
                            const clickResult = await this.replayEvent(page, event, i, screenshotDir, execCtx, takeScreenshots);
                            this.collector.addEventResult(clickResult);
                            if (clickResult.status === 'failed' && stopOnFailure) {
                                // click 실패 시 wait_for도 실패 처리
                                this.collector.addEventResult({
                                    eventIndex: i + 1, eventType: 'wait_for', status: 'failed',
                                    duration: Date.now() - bundleStart, stepNo: nextEvent.stepNo,
                                    description: nextEvent.description, error: 'Skipped: preceding click failed',
                                });
                                prevTimestamp = event.timestamp;
                                i++; // wait_for 건너뜀
                                break;
                            }
                            // waitForURL 완료 대기
                            await waitPromise;
                            this.collector.addEventResult({
                                eventIndex: i + 1, eventType: 'wait_for', status: 'passed',
                                duration: Date.now() - bundleStart, stepNo: nextEvent.stepNo,
                                description: nextEvent.description,
                            });
                        }
                    }
                    catch (err) {
                        // wait_for 실패 — click은 이미 성공했을 수 있음
                        this.collector.addEventResult({
                            eventIndex: i + 1, eventType: 'wait_for', status: 'failed',
                            duration: Date.now() - bundleStart, stepNo: nextEvent.stepNo,
                            description: nextEvent.description,
                            error: `번들 URL 대기 실패: ${err.message}`,
                        });
                        if (stopOnFailure) {
                            prevTimestamp = event.timestamp;
                            i++;
                            break;
                        }
                    }
                    prevTimestamp = nextEvent.timestamp;
                    i++; // wait_for 이벤트 건너뜀 (이미 처리됨)
                    continue;
                }
                // 이벤트에 기록된 pageId로 올바른 페이지 해석
                const eventPage = this.resolvePageForEvent(event, page);
                execCtx.page = eventPage;
                const result = await this.replayEvent(eventPage, event, i, screenshotDir, execCtx, takeScreenshots);
                this.collector.addEventResult(result);
                prevTimestamp = event.timestamp;
                // 첫 번째 navigate 성공 후 인증 스토리지 주입 (localStorage/sessionStorage)
                if (!authStorageInjected && options.authProfileId && !options.existingContext &&
                    event.type === 'navigate' && result.status === 'passed') {
                    authStorageInjected = true;
                    try {
                        const authStore = new auth_store_1.AuthStore(reportDir.replace(/[/\\]reports$/, '/scenarios'));
                        const hasStorage = await authStore.injectStorageIntoPage(page, options.authProfileId);
                        if (hasStorage) {
                            await page.reload({ waitUntil: 'domcontentloaded' });
                        }
                    }
                    catch {
                        // non-critical
                    }
                }
                if (result.status === 'failed' && stopOnFailure)
                    break;
            }
            const testResult = this.collector.finish();
            testResult.variables = variables.getAll();
            testResult.tcId = scenario.tcId;
            testResult.testDataSetName = options.testDataSetName;
            const outDir = (0, path_1.join)(reportDir, scenario.id);
            this.generator.generateJSON(testResult, outDir);
            this.generator.generateHTML(testResult, outDir);
            return testResult;
        }
        catch (error) {
            const testResult = this.collector.finish(error.message, error.stack);
            testResult.variables = variables.getAll();
            const outDir = (0, path_1.join)(reportDir, scenario.id);
            this.generator.generateJSON(testResult, outDir);
            this.generator.generateHTML(testResult, outDir);
            return testResult;
        }
        finally {
            if (!options.skipBrowserClose) {
                // context.close()가 소속 page를 모두 닫으므로 수동 page.close() 불필요
                await context.close().catch(() => { });
                this.pageRegistry.clear();
                if (ownsBrowser)
                    await browser.close().catch(() => { });
            }
        }
    }
    /**
     * 이벤트에 기록된 meta.pageId로 올바른 Page를 해석한다.
     * pageId가 없거나 'main'이면 fallbackPage를 반환한다.
     *
     * Fallback 정책 (pageId가 registry에 없는 경우):
     * 1) registry에 등록된 page 중 닫히지 않은 마지막 page 사용
     * 2) 모든 page가 닫혔으면 fallbackPage(main) 사용
     * 경고 로그를 남겨서 flaky 디버깅에 도움을 준다.
     */
    resolvePageForEvent(event, fallbackPage) {
        const pageId = event.meta?.pageId;
        if (!pageId || pageId === 'main')
            return fallbackPage;
        const resolved = this.pageRegistry.get(pageId);
        if (resolved)
            return resolved;
        // pageId가 registry에 없음 — popup이 자동으로 닫혔거나 redirect로 교체된 경우
        console.warn(`[WebReplayer] pageId "${pageId}" not found in registry, using fallback`);
        // registry에 등록된 page 중 닫히지 않은 마지막 page
        const allPages = [...this.pageRegistry.getAll().values()];
        for (let j = allPages.length - 1; j >= 0; j--) {
            if (!allPages[j].isClosed())
                return allPages[j];
        }
        return fallbackPage;
    }
    /** 스텝 단위 타임아웃 (ms) — 이 시간 내에 완료되지 않으면 즉시 실패 처리 */
    static STEP_TIMEOUT = 30_000;
    /** 이벤트 특성에 따른 동적 타임아웃 계산 */
    static getStepTimeout(event) {
        // wait_for(url_change)에서 외부 도메인이면 60초
        if (event.type === 'wait_for' && event.waitForConfig?.waitType === 'url_change') {
            if (event.meta?.isExternalDomain)
                return 60_000;
            return event.waitForConfig.timeout || WebReplayer.STEP_TIMEOUT;
        }
        // navigate에서 외부 page_load면 60초
        if (event.type === 'navigate' && event.meta?.source === 'page_load') {
            return 60_000;
        }
        return WebReplayer.STEP_TIMEOUT;
    }
    async replayEvent(page, event, index, screenshotDir, execCtx, globalScreenshots) {
        const start = Date.now();
        // wait 이벤트는 의도적 대기이므로 타임아웃 적용하지 않음
        if (event.type === 'wait') {
            await this.sleep(event.duration || 1000);
            return {
                eventIndex: index, eventType: event.type, status: 'passed',
                duration: Date.now() - start,
                stepNo: event.stepNo, description: event.description,
            };
        }
        // deadline 기반: executeStep 내부의 모든 await가 deadline을 참조
        const stepTimeout = WebReplayer.getStepTimeout(event);
        const deadline = Date.now() + stepTimeout;
        const result = await this.executeStep(page, event, index, screenshotDir, execCtx, globalScreenshots, start, deadline);
        return result;
    }
    /** replayEvent 내부 실제 실행 로직 (deadline으로 전체 시간 제어) */
    async executeStep(page, event, index, screenshotDir, execCtx, globalScreenshots, start, deadline) {
        const shouldScreenshot = event.takeScreenshot ?? globalScreenshots;
        const vars = execCtx.variables;
        try {
            let extraResult = {};
            // deadline 초과 확인 헬퍼 (Playwright에서 timeout=0은 무한대기이므로 최소 1ms 보장)
            const remaining = () => Math.max(deadline - Date.now(), 1);
            const checkDeadline = () => {
                if (Date.now() >= deadline)
                    throw new Error(`⏱ 스텝 타임아웃 (${WebReplayer.STEP_TIMEOUT / 1000}초 초과)`);
            };
            switch (event.type) {
                case 'navigate': {
                    if (event.url) {
                        const targetUrl = vars.resolve(event.url);
                        const source = event.meta?.source;
                        // "관측된 이동"과 "명시적 이동"을 구분하여 처리
                        // - 관측된 이동(page_load, spa_*): 이전 click/submit 등의 결과로 URL이 바뀐 것
                        //   → goto를 다시 하면 SPA 상태/세션/스토리지가 초기화될 위험이 있음
                        //   → waitForURL로 이동 완료만 확인
                        // - 명시적 이동(explicit_goto, 첫 번째 navigate, about:blank): 사용자가 직접 지시한 이동
                        //   → goto로 실제 이동 수행
                        const isObserved = source === 'page_load' ||
                            (typeof source === 'string' && source.startsWith('spa_'));
                        // 체인 모드에서 새 page가 about:blank이거나, 시나리오의 첫 navigate(index 기준)인 경우
                        const currentUrl = page.url();
                        const isInitial = index === 0 || currentUrl === 'about:blank' || currentUrl === '';
                        const isExplicit = source === 'explicit_goto';
                        if (isExplicit || isInitial || !isObserved) {
                            // 명시적 이동 또는 첫 navigate: 실제 goto 수행
                            await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: Math.min(remaining(), 30000) });
                            // 전체 페이지 로드 시 networkidle 대기 (AJAX 완료 보장)
                            if (source !== 'spa_pushState' && source !== 'spa_replaceState') {
                                try {
                                    await page.waitForLoadState('networkidle', { timeout: Math.min(remaining(), 3000) });
                                }
                                catch {
                                    // networkidle 타임아웃은 치명적이지 않음
                                }
                            }
                        }
                        else {
                            // 관측된 이동: 이전 액션(click 등)이 이미 이동을 유발했으므로 대기만
                            // 1) 이미 URL이 매칭된 상태면 즉시 성공
                            let alreadyAtTarget = false;
                            try {
                                const currentUrl = page.url();
                                const urlObj = new URL(targetUrl);
                                alreadyAtTarget = currentUrl.includes(urlObj.pathname);
                            }
                            catch {
                                alreadyAtTarget = page.url().includes(targetUrl);
                            }
                            if (!alreadyAtTarget) {
                                try {
                                    await page.waitForURL(targetUrl, {
                                        waitUntil: 'domcontentloaded',
                                        timeout: Math.min(remaining(), 30000),
                                    });
                                }
                                catch {
                                    // URL이 정확히 매치되지 않으면 glob 패턴으로 재시도
                                    try {
                                        const urlObj = new URL(targetUrl);
                                        const pathPattern = `**${urlObj.pathname}**`;
                                        await page.waitForURL(pathPattern, {
                                            waitUntil: 'domcontentloaded',
                                            timeout: Math.min(remaining(), 10000),
                                        });
                                    }
                                    catch {
                                        // 이동 대기 실패 — 이미 해당 페이지에 있을 수 있으므로 계속 진행
                                    }
                                }
                            }
                            // SPA 이동이 아닌 경우 로드 상태 확인 (domcontentloaded만, networkidle 대신)
                            if (source === 'page_load') {
                                try {
                                    await page.waitForLoadState('domcontentloaded', { timeout: Math.min(remaining(), 5000) });
                                }
                                catch {
                                    // non-fatal
                                }
                            }
                        }
                    }
                    break;
                }
                case 'click': {
                    checkDeadline();
                    await this.restoreScrollPosition(page, event);
                    const resolveOpts = this.buildResolverOptions(page, event, vars, deadline);
                    try {
                        const clickResult = await this.resolveWithScrollDiscovery(page, event, resolveOpts);
                        checkDeadline();
                        // self-heal 성공 시 healedLocator를 이벤트에 기록
                        if (clickResult.healedLocator) {
                            this.applyHealedLocator(event, clickResult.healedLocator);
                        }
                        // 기존 healed locator로 성공 시 successCount 누적
                        if (clickResult.usedHealedLocator) {
                            this.bumpHealedLocatorSuccess(event, clickResult.usedHealedLocator);
                        }
                        // scrollIntoViewIfNeeded — 요소가 뷰포트 밖이면 스크롤
                        try {
                            await clickResult.locator.scrollIntoViewIfNeeded({ timeout: Math.min(remaining(), 1000) });
                        }
                        catch { /* non-critical */ }
                        // captureResolvedAs: 클릭 전에 요소 textContent를 변수로 캡처 (클릭 후 DOM이 변경될 수 있으므로)
                        if (event.captureResolvedAs) {
                            try {
                                const rawText = await clickResult.locator.textContent({ timeout: Math.min(remaining(), 1000) });
                                const captured = (rawText || '').trim();
                                vars.set(event.captureResolvedAs, captured);
                                extraResult.capturedVariables = {
                                    ...(extraResult.capturedVariables || {}),
                                    [event.captureResolvedAs]: captured,
                                };
                            }
                            catch {
                                console.warn(`[WebReplayer] captureResolvedAs: textContent 추출 실패 "${event.captureResolvedAs}"`);
                            }
                        }
                        // 1차: 일반 클릭 시도
                        try {
                            await clickResult.locator.click({ timeout: Math.min(remaining(), 2000) });
                        }
                        catch (clickErr) {
                            // 2차: force 클릭 (overlay가 가리는 경우 대비)
                            if (Date.now() < deadline) {
                                await clickResult.locator.click({ force: true, timeout: Math.min(remaining(), 1500) });
                                extraResult.resolvedBy = clickResult.resolvedBy + ' (force)';
                            }
                            else {
                                throw clickErr;
                            }
                        }
                        if (!extraResult.resolvedBy)
                            extraResult.resolvedBy = clickResult.resolvedBy;
                    }
                    catch (resolveError) {
                        // 좌표 기반 폴백: 모든 전략 + self-heal 실패 시 녹화된 boundingBox 좌표로 클릭
                        if (event.captureResolvedAs) {
                            console.warn(`[WebReplayer] captureResolvedAs 건너뜀: 요소 resolve 실패, 좌표 클릭으로 폴백`);
                        }
                        const bbox = event.meta?.element?.boundingBox;
                        if (bbox && bbox.width > 0 && bbox.height > 0) {
                            try {
                                await page.evaluate(`window.scrollTo(${Math.max(0, bbox.x - 100)}, ${Math.max(0, bbox.y - 200)})`);
                                await this.sleep(200);
                            }
                            catch { /* non-critical */ }
                            const centerX = bbox.x + bbox.width / 2;
                            const centerY = bbox.y + bbox.height / 2;
                            await page.mouse.click(centerX, centerY);
                            extraResult.resolvedBy = `coordinate-fallback: (${Math.round(centerX)}, ${Math.round(centerY)})`;
                        }
                        else {
                            throw resolveError;
                        }
                    }
                    break;
                }
                case 'fill': {
                    if (event.value !== undefined) {
                        checkDeadline();
                        await this.restoreScrollPosition(page, event);
                        const fillResolveOpts = this.buildResolverOptions(page, event, vars, deadline);
                        const fillResult = await this.resolveWithScrollDiscovery(page, event, fillResolveOpts);
                        if (fillResult.healedLocator)
                            this.applyHealedLocator(event, fillResult.healedLocator);
                        if (fillResult.usedHealedLocator)
                            this.bumpHealedLocatorSuccess(event, fillResult.usedHealedLocator);
                        checkDeadline();
                        const resolvedFillValue = vars.resolve(event.value);
                        if (event.captureResolvedAs) {
                            vars.set(event.captureResolvedAs, resolvedFillValue);
                            extraResult.capturedVariables = {
                                ...(extraResult.capturedVariables || {}),
                                [event.captureResolvedAs]: resolvedFillValue,
                            };
                        }
                        const elemRole = event.meta?.element?.role;
                        const elemType = event.meta?.element?.type;
                        const isCheckable = elemRole === 'checkbox' || elemRole === 'radio' ||
                            (elemType === 'input' && await fillResult.locator.getAttribute('type').catch(() => '')
                                .then((t) => t === 'checkbox' || t === 'radio'));
                        if (isCheckable) {
                            await fillResult.locator.click({ timeout: Math.min(remaining(), 2000) });
                        }
                        else {
                            // 명시적으로 클릭하여 포커스 보장 (연속 fill 시 이전 필드에 입력되는 버그 방지)
                            try {
                                await fillResult.locator.click({ timeout: Math.min(remaining(), 1500) });
                            }
                            catch { /* click 실패해도 fill 시도 */ }
                            await fillResult.locator.fill(resolvedFillValue, { timeout: Math.min(remaining(), 2000) });
                        }
                        extraResult.resolvedBy = fillResult.resolvedBy;
                    }
                    break;
                }
                case 'select': {
                    if (event.value !== undefined) {
                        checkDeadline();
                        await this.restoreScrollPosition(page, event);
                        const selectResolveOpts = this.buildResolverOptions(page, event, vars, deadline);
                        const selectResult = await this.resolveWithScrollDiscovery(page, event, selectResolveOpts);
                        if (selectResult.healedLocator)
                            this.applyHealedLocator(event, selectResult.healedLocator);
                        if (selectResult.usedHealedLocator)
                            this.bumpHealedLocatorSuccess(event, selectResult.usedHealedLocator);
                        checkDeadline();
                        await selectResult.locator.selectOption(vars.resolve(event.value), { timeout: Math.min(remaining(), 2000) });
                        extraResult.resolvedBy = selectResult.resolvedBy;
                    }
                    break;
                }
                // 새 이벤트
                case 'wait_for_user':
                    extraResult = await (0, step_executors_1.executeWaitForUser)(event, execCtx);
                    break;
                case 'api_request':
                    extraResult = await (0, step_executors_1.executeApiRequest)(event, execCtx);
                    break;
                case 'set_variable':
                    extraResult = await (0, step_executors_1.executeSetVariable)(event, execCtx);
                    break;
                case 'run_script':
                    extraResult = await (0, step_executors_1.executeRunScript)(event, execCtx);
                    break;
                case 'assert': {
                    const ar = await (0, step_executors_1.executeAssert)(event, execCtx);
                    extraResult = { assertionResults: ar.assertionResults, error: ar.error };
                    break;
                }
                // RPA 확장
                case 'extract_data':
                    extraResult = await (0, step_executors_1.executeExtractData)(event, execCtx);
                    break;
                case 'keyboard': {
                    const kbConfig = event.keyboard;
                    if (kbConfig) {
                        if (kbConfig.selector) {
                            checkDeadline();
                            await this.restoreScrollPosition(page, event);
                            const kbEvent = { ...event, selector: kbConfig.selector };
                            const kbResolveOpts = this.buildResolverOptions(page, kbEvent, vars, deadline);
                            const kbResult = await this.resolveWithScrollDiscovery(page, kbEvent, kbResolveOpts);
                            if (kbResult.healedLocator)
                                this.applyHealedLocator(event, kbResult.healedLocator);
                            if (kbResult.usedHealedLocator)
                                this.bumpHealedLocatorSuccess(event, kbResult.usedHealedLocator);
                            await kbResult.locator.focus({ timeout: Math.min(remaining(), 2000) });
                            extraResult.resolvedBy = kbResult.resolvedBy;
                        }
                        await page.keyboard.press(kbConfig.key);
                    }
                    break;
                }
                case 'hover': {
                    checkDeadline();
                    await this.restoreScrollPosition(page, event);
                    const hoverResolveOpts = this.buildResolverOptions(page, event, vars, deadline);
                    const hoverResult = await this.resolveWithScrollDiscovery(page, event, hoverResolveOpts);
                    if (hoverResult.healedLocator)
                        this.applyHealedLocator(event, hoverResult.healedLocator);
                    if (hoverResult.usedHealedLocator)
                        this.bumpHealedLocatorSuccess(event, hoverResult.usedHealedLocator);
                    checkDeadline();
                    // captureResolvedAs: hover 전에 요소 textContent를 변수로 캡처
                    if (event.captureResolvedAs) {
                        try {
                            const rawText = await hoverResult.locator.textContent({ timeout: Math.min(remaining(), 1000) });
                            const captured = (rawText || '').trim();
                            vars.set(event.captureResolvedAs, captured);
                            extraResult.capturedVariables = {
                                ...(extraResult.capturedVariables || {}),
                                [event.captureResolvedAs]: captured,
                            };
                        }
                        catch {
                            console.warn(`[WebReplayer] captureResolvedAs: textContent 추출 실패 "${event.captureResolvedAs}"`);
                        }
                    }
                    await hoverResult.locator.hover({ timeout: Math.min(remaining(), 2000) });
                    extraResult.resolvedBy = hoverResult.resolvedBy;
                    break;
                }
                case 'wait_for':
                    extraResult = await (0, step_executors_1.executeWaitFor)(event, execCtx);
                    break;
                case 'image_match':
                    extraResult = await (0, step_executors_1.executeImageMatch)(event, execCtx);
                    break;
                case 'check_email':
                    extraResult = await (0, step_executors_1.executeCheckEmail)(event, execCtx);
                    break;
                case 'ocr_extract': {
                    // screenshotDir = reportDir/scenarioId/screenshots → 부모로 이동하여 ocr 디렉토리 생성
                    const ocrReportDir = screenshotDir ? (0, path_1.join)(screenshotDir, '..') : undefined;
                    extraResult = await (0, step_executors_1.executeOcrExtract)(event, execCtx, ocrReportDir);
                    break;
                }
                default:
                    break;
            }
            // 부착된 어설션 평가
            const assertionResults = await (0, step_executors_1.evaluatePostStepAssertions)(event, execCtx);
            const assertFailed = assertionResults.some(r => !r.passed && !r.assertion.optional);
            const hasError = extraResult.error || assertFailed;
            let screenshot;
            let screenshotBase64;
            if (screenshotDir) {
                if (hasError) {
                    screenshot = (0, path_1.join)(screenshotDir, `step_${String(index + 1).padStart(3, '0')}_error.png`);
                    await page.screenshot({ path: screenshot }).catch(() => { });
                }
                else if (shouldScreenshot) {
                    screenshot = (0, path_1.join)(screenshotDir, `step_${String(index + 1).padStart(3, '0')}.png`);
                    await page.screenshot({ path: screenshot }).catch(() => { });
                }
            }
            // Always capture a small JPEG screenshot as base64 for cloud reports
            try {
                const buf = await page.screenshot({ type: 'jpeg', quality: 50, timeout: 3000 });
                screenshotBase64 = buf.toString('base64');
            }
            catch { /* ignore screenshot failure */ }
            // 실패 시 현재 페이지 URL 포함
            let errorMsg = extraResult.error || (assertFailed ? assertionResults.filter(r => !r.passed).map(r => r.error).join('; ') : undefined);
            if (hasError) {
                let currentUrl = 'unknown';
                try {
                    currentUrl = page.url();
                }
                catch { /* ignore */ }
                errorMsg = `${errorMsg || 'Unknown error'} [page: ${currentUrl}]`;
            }
            return {
                eventIndex: index, eventType: event.type,
                status: hasError ? 'failed' : 'passed',
                duration: Date.now() - start, screenshot,
                stepNo: event.stepNo, description: event.description,
                resolvedBy: extraResult.resolvedBy,
                error: errorMsg,
                assertionResults: assertionResults.length > 0 ? assertionResults : extraResult.assertionResults,
                apiResponse: extraResult.apiResponse,
                capturedVariables: extraResult.capturedVariables,
                artifacts: screenshotBase64 ? { screenshotBase64, timestamp: Date.now() } : undefined,
            };
        }
        catch (error) {
            const isTimeout = error.message?.includes('스텝 타임아웃');
            const screenshotSuffix = isTimeout ? '_timeout' : '_error';
            let screenshot;
            let screenshotBase64;
            if (screenshotDir) {
                screenshot = (0, path_1.join)(screenshotDir, `step_${String(index + 1).padStart(3, '0')}${screenshotSuffix}.png`);
                await page.screenshot({ path: screenshot }).catch(() => { });
            }
            // Always capture base64 screenshot for cloud reports
            try {
                const buf = await page.screenshot({ type: 'jpeg', quality: 50, timeout: 3000 });
                screenshotBase64 = buf.toString('base64');
            }
            catch { /* ignore */ }
            let currentUrl = 'unknown';
            try {
                currentUrl = page.url();
            }
            catch { /* ignore */ }
            let detailedError;
            if (isTimeout) {
                // 타임아웃 전용 상세 메시지
                const selectorInfo = event.selector ? `"${event.selector}"` : '(없음)';
                detailedError =
                    `⏱ 스텝 타임아웃 (${WebReplayer.STEP_TIMEOUT / 1000}초 초과)\n` +
                        `  이벤트: ${event.type} | 셀렉터: ${selectorInfo}\n` +
                        `  현재 페이지: ${currentUrl}\n` +
                        `  원인: 요소를 찾지 못했거나, 페이지 로딩이 완료되지 않았습니다.\n` +
                        `  힌트: 브라우저 DevTools에서 해당 요소가 존재하는지 확인하세요.`;
            }
            else {
                detailedError = error.message;
                if (event.selector || event.meta?.selectors) {
                    const tried = [];
                    if (event.selector)
                        tried.push(`primary: "${event.selector}"`);
                    const fallbacks = event.meta?.selectors || [];
                    if (fallbacks.length > 0)
                        tried.push(`fallbacks: ${fallbacks.length}개`);
                    const elem = event.meta?.element;
                    if (elem) {
                        const semInfo = [];
                        if (elem.testId)
                            semInfo.push(`testId="${elem.testId}"`);
                        if (elem.role)
                            semInfo.push(`role="${elem.role}"`);
                        if (elem.label)
                            semInfo.push(`label="${elem.label}"`);
                        if (elem.placeholder)
                            semInfo.push(`placeholder="${elem.placeholder}"`);
                        if (semInfo.length)
                            tried.push(`semantic: ${semInfo.join(', ')}`);
                    }
                    detailedError = `${detailedError}\n` +
                        `  시도한 셀렉터: ${tried.join(' → ')}\n` +
                        `  현재 페이지: ${currentUrl}`;
                }
                else {
                    detailedError = `${detailedError}\n  현재 페이지: ${currentUrl}`;
                }
            }
            return {
                eventIndex: index, eventType: event.type, status: 'failed',
                duration: Date.now() - start, error: detailedError, screenshot,
                stepNo: event.stepNo, description: event.description,
                artifacts: screenshotBase64 ? { screenshotBase64, timestamp: Date.now() } : undefined,
            };
        }
    }
    /** CSS 특수문자가 포함된 selector를 안전한 형태로 변환 */
    safeSelector(sel) {
        const idMatch = sel.match(/^#([^\s[]+)$/);
        if (idMatch) {
            const idValue = idMatch[1];
            if (/^[0-9]/.test(idValue) || /[.:\\[\]()>+~,\s"']/.test(idValue)) {
                return `[id="${this.escapeAttributeValue(idValue)}"]`;
            }
            return sel;
        }
        const attrMatch = sel.match(/^\[(\w[\w-]*)="(.*)"\]$/);
        if (attrMatch) {
            const escaped = this.escapeAttributeValue(attrMatch[2]);
            if (escaped !== attrMatch[2])
                return `[${attrMatch[1]}="${escaped}"]`;
        }
        return sel;
    }
    escapeAttributeValue(val) {
        return val.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    }
    /**
     * 녹화 시점의 스크롤 위치를 복원하여 lazy-load/fold 하단 요소 접근성을 보장한다.
     * 실패해도 무시 — 스크롤 복원은 보조적 수단이므로 치명적이지 않음.
     */
    async restoreScrollPosition(page, event) {
        const ctx = event.meta?.pageContext;
        if (!ctx || ctx.scrollY === undefined)
            return;
        try {
            await page.evaluate(`window.scrollTo(${ctx.scrollX || 0}, ${ctx.scrollY || 0})`);
            // 스크롤 트리거 lazy-load가 시작될 수 있도록 짧은 대기
            await this.sleep(100);
        }
        catch {
            // non-critical
        }
    }
    /**
     * 요소가 즉시 발견되지 않을 때 점진적 스크롤로 페이지를 탐색하여
     * 레이지 로딩, 동적 렌더링, 뷰포트 밖 요소를 발견한다.
     *
     * 탐색 순서:
     * 1. 녹화된 스크롤 위치에서 resolve 시도 (기존 동작)
     * 2. 실패 시 → 페이지를 뷰포트 70% 단위로 점진 스크롤하며 재시도
     * 3. 각 스크롤 위치에서 300ms 대기 (레이지 로딩 트리거)
     * 4. 성공 시 즉시 반환, 전부 실패 시 마지막 에러 throw
     */
    async resolveWithScrollDiscovery(page, event, opts) {
        // 1차: 녹화된 스크롤 위치에서 시도 (빠른 경로)
        try {
            return await this.locatorResolver.resolve(page, event, opts);
        }
        catch (firstError) {
            // deadline이 이미 초과했으면 즉시 throw
            if (opts.deadline - Date.now() < 2000)
                throw firstError;
            // 2차: 점진적 스크롤 탐색
            const dims = await page.evaluate(`(() => ({ scrollHeight: document.documentElement.scrollHeight, viewportHeight: window.innerHeight }))()`);
            const step = Math.floor(dims.viewportHeight * 0.7);
            const maxY = dims.scrollHeight - dims.viewportHeight;
            // 스크롤 위치 후보 생성: 녹화 위치 주변 → 페이지 전체
            const recordedY = event.meta?.pageContext?.scrollY ?? 0;
            const positions = [];
            // 녹화 위치 ±1스텝 우선
            for (const delta of [0, -step, step, -step * 2, step * 2]) {
                const y = Math.max(0, Math.min(maxY, recordedY + delta));
                if (!positions.includes(y))
                    positions.push(y);
            }
            // 나머지 페이지 (위→아래)
            for (let y = 0; y <= maxY; y += step) {
                if (!positions.includes(y))
                    positions.push(y);
            }
            for (const y of positions) {
                if (opts.deadline - Date.now() < 1500)
                    break; // 시간 부족하면 중단
                try {
                    await page.evaluate(`window.scrollTo(0, ${y})`);
                    await this.sleep(300); // 레이지 로딩 대기
                    return await this.locatorResolver.resolve(page, event, {
                        ...opts,
                        deadline: Math.min(opts.deadline, Date.now() + 1500), // 위치당 최대 1.5초
                    });
                }
                catch {
                    continue; // 다음 스크롤 위치
                }
            }
            // 녹화 위치로 복원 후 원래 에러 throw
            await this.restoreScrollPosition(page, event);
            throw firstError;
        }
    }
    /**
     * 중첩 마커 짝 매칭: startType에 대응하는 endType의 인덱스를 반환.
     * 중첩된 동일 마커 쌍을 올바르게 처리한다.
     */
    findMatchingEnd(events, startIdx, startType, endType) {
        let depth = 0;
        for (let j = startIdx; j < events.length; j++) {
            if (events[j].type === startType)
                depth++;
            if (events[j].type === endType) {
                depth--;
                if (depth === 0)
                    return j;
            }
        }
        throw new Error(`${startType}에 대응하는 ${endType}를 찾을 수 없습니다 (인덱스 ${startIdx})`);
    }
    sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
}
exports.WebReplayer = WebReplayer;
//# sourceMappingURL=replayer.js.map