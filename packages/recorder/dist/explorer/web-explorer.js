"use strict";
/**
 * 웹 탐색기
 *
 * Playwright를 사용하여 웹 페이지를 수동/자동으로 탐색하고,
 * 그래프 형태로 페이지 연결 구조를 수집한다.
 *
 * - 수동 모드: 사용자가 클릭할 때마다 노드/엣지 추가
 * - 자동 크롤링: 링크를 자동으로 따라가며 그래프 구축
 * - 도메인 경계 검사, 팝업 처리, 인증 프로필 지원
 */
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
exports.WebExplorer = void 0;
const crypto_1 = require("crypto");
const fs_1 = require("fs");
const device_presets_1 = require("../web/device-presets");
const state_fingerprint_1 = require("./state-fingerprint");
const action_extractor_1 = require("./action-extractor");
const explorer_config_1 = require("./explorer-config");
class WebExplorer {
    graphStorage;
    authStore;
    browser = null; // Playwright Browser
    context = null; // Playwright BrowserContext
    page = null; // Playwright Page
    session = null;
    callbacks = {};
    crawlAbortController = { aborted: false };
    navigationHistory = []; // nodeId 히스토리 (뒤로가기용)
    constructor(graphStorage, authStore) {
        this.graphStorage = graphStorage;
        this.authStore = authStore;
    }
    // ─── 탐색 세션 관리 ───────────────────────────────────
    async startSession(graphId, callbacks, headless = false, options) {
        const graph = await this.graphStorage.load(graphId);
        if (!graph)
            throw new Error(`Graph not found: ${graphId}`);
        const startUrl = options?.startUrl || graph.rootUrl;
        const authProfileId = options?.authProfileId || graph.config.authProfileId;
        this.callbacks = callbacks || {};
        this.crawlAbortController = { aborted: false };
        this.navigationHistory = [];
        // Playwright 브라우저 시작
        const { chromium } = await Promise.resolve().then(() => __importStar(require('playwright')));
        this.browser = await chromium.launch({
            headless,
            args: ['--disable-popup-blocking'],
        });
        const deviceConfig = await (0, device_presets_1.resolveDeviceConfig)(graph.config.deviceType);
        this.context = await this.browser.newContext((0, device_presets_1.toContextOptions)(deviceConfig));
        // 1) 쿠키 주입 (context-level, 페이지 불필요)
        if (authProfileId) {
            try {
                await this.authStore.injectIntoContext(this.context, authProfileId);
            }
            catch (e) {
                this.callbacks.onError?.(`인증 프로필 쿠키 주입 실패: ${e.message}`);
            }
        }
        this.page = await this.context.newPage();
        // 팝업 처리
        this.context.on('page', async (newPage) => {
            await this.handlePopup(newPage, graph);
        });
        // 페이지 이동 감지 (수동 탐색용)
        this.page.on('framenavigated', async (frame) => {
            if (frame === this.page.mainFrame()) {
                await this.handleNavigation(this.page, graph, 'manual');
            }
        });
        // 2) 시작 URL로 이동
        await this.page.goto(startUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });
        // 3) localStorage/sessionStorage 주입 (도메인 컨텍스트 확보 후) + reload
        if (authProfileId) {
            try {
                const hasStorage = await this.authStore.injectStorageIntoPage(this.page, authProfileId);
                if (hasStorage) {
                    await this.page.reload({ waitUntil: 'domcontentloaded' });
                }
            }
            catch (e) {
                this.callbacks.onError?.(`인증 프로필 스토리지 주입 실패: ${e.message}`);
            }
        }
        // 페이지 렌더링 대기 + 타이틀 캡처 (CSR 대응)
        const title = await this.waitForPageReady(this.page);
        const rootNode = this.graphStorage.addNode(graph, {
            url: startUrl,
            title,
            domain: new URL(startUrl).hostname,
            metadata: { visitedAt: Date.now(), visitCount: 1 },
        });
        // 스크린샷 캡처 (렌더링 완료 후)
        await this.captureScreenshot(this.page, graph.id, rootNode);
        graph.status = 'exploring';
        await this.graphStorage.save(graph);
        this.session = {
            graphId,
            status: 'exploring',
            currentUrl: startUrl,
            currentNodeId: rootNode.id,
            visitedUrls: [this.getVisitedKey(startUrl, graph)],
            queuedUrls: [],
            stats: {
                nodesDiscovered: 1,
                edgesDiscovered: 0,
                pagesVisited: 1,
                startedAt: Date.now(),
                lastActivityAt: Date.now(),
            },
        };
        this.navigationHistory = [rootNode.id];
        this.callbacks.onNodeAdded?.(rootNode, graph);
        this.callbacks.onStatusChanged?.('exploring');
        return this.session;
    }
    async stopSession() {
        this.crawlAbortController.aborted = true;
        if (this.session) {
            this.session.status = 'stopped';
            const graph = await this.graphStorage.load(this.session.graphId);
            if (graph) {
                graph.status = 'stopped';
                await this.graphStorage.save(graph);
            }
            this.callbacks.onStatusChanged?.('stopped');
        }
        await this.cleanup();
    }
    async cleanup() {
        try {
            if (this.page)
                await this.page.close().catch(() => { });
        }
        catch { }
        try {
            if (this.context)
                await this.context.close().catch(() => { });
        }
        catch { }
        try {
            if (this.browser)
                await this.browser.close().catch(() => { });
        }
        catch { }
        this.page = null;
        this.context = null;
        this.browser = null;
    }
    getSession() {
        return this.session;
    }
    // ─── 수동 탐색 ────────────────────────────────────────
    /**
     * 사용자가 지정한 URL로 이동 (수동 탐색)
     */
    async navigateTo(url) {
        if (!this.page || !this.session)
            throw new Error('세션이 시작되지 않았습니다');
        const graph = await this.graphStorage.load(this.session.graphId);
        if (!graph)
            throw new Error('그래프를 찾을 수 없습니다');
        // 도메인 체크
        if (!this.graphStorage.isAllowedDomain(url, graph.allowedDomains)) {
            this.callbacks.onError?.(`도메인 밖 URL입니다: ${url}`);
            return null;
        }
        const prevNodeId = this.session.currentNodeId;
        try {
            await this.page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 });
        }
        catch (e) {
            this.callbacks.onError?.(`페이지 이동 실패: ${e.message}`);
            return null;
        }
        // 페이지 렌더링 대기 + 타이틀 캡처 (CSR 대응)
        const title = await this.waitForPageReady(this.page);
        const currentUrl = this.page.url();
        const node = this.graphStorage.addNode(graph, {
            url: currentUrl,
            title,
            domain: new URL(currentUrl).hostname,
            metadata: { visitedAt: Date.now(), visitCount: 1 },
        });
        // 엣지 추가 (이전 노드 → 현재 노드)
        if (prevNodeId && prevNodeId !== node.id) {
            const edge = this.graphStorage.addEdge(graph, {
                source: prevNodeId,
                target: node.id,
                linkUrl: url,
                metadata: { discoveredAt: Date.now(), discoveredBy: 'manual' },
            });
            this.callbacks.onEdgeAdded?.({ source: prevNodeId, target: node.id, linkUrl: url }, graph);
            this.session.stats.edgesDiscovered = graph.edges.length;
        }
        // 스크린샷 캡처 (렌더링 완료 후)
        await this.captureScreenshot(this.page, graph.id, node);
        this.session.currentUrl = currentUrl;
        this.session.currentNodeId = node.id;
        this.session.stats.nodesDiscovered = graph.nodes.length;
        this.session.stats.pagesVisited++;
        this.session.stats.lastActivityAt = Date.now();
        this.navigationHistory.push(node.id);
        const visitKey = this.getVisitedKey(currentUrl, graph);
        if (!this.session.visitedUrls.includes(visitKey)) {
            this.session.visitedUrls.push(visitKey);
        }
        await this.graphStorage.save(graph);
        this.callbacks.onNodeAdded?.(node, graph);
        this.callbacks.onPageVisited?.(currentUrl, title);
        return node;
    }
    /**
     * 현재 페이지의 링크 목록 추출
     */
    async extractLinks() {
        if (!this.page)
            return [];
        // lazy-loaded 콘텐츠를 위해 페이지 하단까지 스크롤
        await this.page.evaluate(`(() => {
      window.scrollTo(0, document.body.scrollHeight);
    })()`).catch(() => { });
        await this.delay(300);
        const graph = await this.graphStorage.load(this.session.graphId);
        if (!graph)
            return [];
        const links = await this.page.evaluate(`(() => {
      var results = [];
      document.querySelectorAll('a[href]').forEach(function(a) {
        var href = a.getAttribute('href');
        if (!href) return;
        if (href.startsWith('#') || href.startsWith('javascript:') || href.startsWith('mailto:') || href.startsWith('tel:')) return;

        var absoluteUrl;
        try {
          absoluteUrl = new URL(href, window.location.href).href;
        } catch(e) {
          return;
        }

        var selector = '';
        if (a.id) selector = '#' + a.id;
        else if (a.getAttribute('data-testid')) selector = '[data-testid="' + a.getAttribute('data-testid') + '"]';
        else {
          var classes = Array.from(a.classList).slice(0, 3).join('.');
          if (classes) selector = 'a.' + classes;
          else selector = 'a[href="' + href.replace(/"/g, '\\\\"') + '"]';
        }

        results.push({
          url: absoluteUrl,
          text: (a.textContent || '').trim().substring(0, 100),
          selector: selector
        });
      });
      return results;
    })()`);
        // 도메인 필터링
        return links.filter(link => this.graphStorage.isAllowedDomain(link.url, graph.allowedDomains));
    }
    // ─── 자동 크롤링 ──────────────────────────────────────
    /**
     * 현재 그래프에서 아직 방문하지 않은 링크를 자동으로 따라가며 탐색
     */
    async startCrawl(options) {
        if (!this.page || !this.session)
            throw new Error('세션이 시작되지 않았습니다');
        const graph = await this.graphStorage.load(this.session.graphId);
        if (!graph)
            throw new Error('그래프를 찾을 수 없습니다');
        this.crawlAbortController = { aborted: false };
        this.session.status = 'crawling';
        graph.status = 'crawling';
        await this.graphStorage.save(graph);
        this.callbacks.onStatusChanged?.('crawling');
        const maxDepth = options?.maxDepth ?? graph.config.maxDepth ?? 5;
        const maxNodes = options?.maxNodes ?? graph.config.maxNodes ?? 500;
        const crawlDelay = graph.config.crawlDelay ?? 1000;
        // BFS 큐: [url, parentNodeId, depth]
        const queue = [];
        // 현재 페이지의 링크를 큐에 추가
        const currentLinks = await this.extractLinks();
        const currentNodeId = this.session.currentNodeId;
        for (const link of currentLinks) {
            const visitKey = this.getVisitedKey(link.url, graph);
            if (!this.session.visitedUrls.includes(visitKey)) {
                queue.push([link.url, currentNodeId, 1]);
            }
        }
        this.session.queuedUrls = queue.map(q => q[0]);
        while (queue.length > 0 && !this.crawlAbortController.aborted) {
            if (graph.nodes.length >= maxNodes) {
                this.callbacks.onError?.(`최대 노드 수(${maxNodes}) 도달`);
                break;
            }
            const [url, parentNodeId, depth] = queue.shift();
            if (depth > maxDepth)
                continue;
            const visitKeyUrl = this.getVisitedKey(url, graph);
            if (this.session.visitedUrls.includes(visitKeyUrl))
                continue;
            // 도메인 체크
            const latestGraph = await this.graphStorage.load(this.session.graphId);
            if (!latestGraph)
                break;
            if (!this.graphStorage.isAllowedDomain(url, latestGraph.allowedDomains))
                continue;
            try {
                await this.page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 });
                // 페이지 렌더링 대기 + 타이틀 캡처 (CSR 대응)
                const title = await this.waitForPageReady(this.page);
                // 크롤링 전용 추가 딜레이
                if (crawlDelay > 500)
                    await this.delay(crawlDelay - 500);
                const actualUrl = this.page.url();
                // 리다이렉트 후 도메인 재확인
                if (!this.graphStorage.isAllowedDomain(actualUrl, latestGraph.allowedDomains))
                    continue;
                this.session.visitedUrls.push(this.getVisitedKey(actualUrl, latestGraph));
                const node = this.graphStorage.addNode(latestGraph, {
                    url: actualUrl,
                    title,
                    domain: new URL(actualUrl).hostname,
                    metadata: { visitedAt: Date.now(), visitCount: 1 },
                });
                // 스크린샷 캡처
                await this.captureScreenshot(this.page, latestGraph.id, node);
                // 엣지 추가
                if (parentNodeId !== node.id) {
                    this.graphStorage.addEdge(latestGraph, {
                        source: parentNodeId,
                        target: node.id,
                        linkUrl: url,
                        metadata: { discoveredAt: Date.now(), discoveredBy: 'crawl' },
                    });
                    this.session.stats.edgesDiscovered = latestGraph.edges.length;
                    this.callbacks.onEdgeAdded?.({ source: parentNodeId, target: node.id, linkUrl: url }, latestGraph);
                }
                this.session.stats.nodesDiscovered = latestGraph.nodes.length;
                this.session.stats.pagesVisited++;
                this.session.stats.lastActivityAt = Date.now();
                this.session.currentUrl = actualUrl;
                this.session.currentNodeId = node.id;
                await this.graphStorage.save(latestGraph);
                this.callbacks.onNodeAdded?.(node, latestGraph);
                this.callbacks.onPageVisited?.(actualUrl, title);
                // 새 링크 추출 후 큐에 추가
                const newLinks = await this.extractLinks();
                const outLinks = newLinks.length;
                if (node.metadata)
                    node.metadata.outLinks = outLinks;
                for (const link of newLinks) {
                    const linkVisitKey = this.getVisitedKey(link.url, latestGraph);
                    if (!this.session.visitedUrls.includes(linkVisitKey)) {
                        const alreadyQueued = queue.some(q => this.getVisitedKey(q[0], latestGraph) === linkVisitKey);
                        if (!alreadyQueued) {
                            queue.push([link.url, node.id, depth + 1]);
                        }
                    }
                }
                this.session.queuedUrls = queue.map(q => q[0]);
                this.callbacks.onCrawlProgress?.(this.session.stats.pagesVisited, queue.length, this.session.stats.nodesDiscovered);
            }
            catch (e) {
                this.callbacks.onError?.(`크롤링 실패 (${url}): ${e.message}`);
                continue;
            }
        }
        // 크롤링 완료
        if (!this.crawlAbortController.aborted) {
            this.session.status = 'completed';
            const finalGraph = await this.graphStorage.load(this.session.graphId);
            if (finalGraph) {
                finalGraph.status = 'completed';
                await this.graphStorage.save(finalGraph);
            }
            this.callbacks.onStatusChanged?.('completed');
        }
    }
    /**
     * 크롤링 일시 중지
     */
    pauseCrawl() {
        this.crawlAbortController.aborted = true;
        if (this.session) {
            this.session.status = 'paused';
            this.callbacks.onStatusChanged?.('paused');
        }
    }
    // ─── DFS 기반 동적 크롤링 ──────────────────────────────
    /**
     * DFS 기반 동적 크롤링을 시작한다.
     *
     * 기존 BFS 크롤링(startCrawl)이 a[href] 링크만 따라가는 반면,
     * DFS 크롤링은 버튼, 탭, 메뉴 등 클릭 가능한 모든 액션을 실행하여
     * SPA 내부의 숨겨진 상태까지 "구석구석" 탐색한다.
     *
     * 핵심 설계 (Crawljax 참고):
     * 1. State = URL + DOM fingerprint → 같은 URL이라도 DOM이 다르면 다른 상태
     * 2. Action = 클릭 가능 요소 (링크, 버튼, 탭, 메뉴)
     * 3. DFS 스택으로 깊게 들어가되, 폭발 방지 파라미터로 제한
     * 4. 위험 액션(logout, delete, 결제 등) 자동 차단
     *
     * @param options DFS 크롤링 설정 (미지정 시 기본값 또는 graph.config.dfs 사용)
     */
    async startDfsCrawl(options) {
        if (!this.page || !this.session)
            throw new Error('세션이 시작되지 않았습니다');
        const graph = await this.graphStorage.load(this.session.graphId);
        if (!graph)
            throw new Error('그래프를 찾을 수 없습니다');
        this.crawlAbortController = { aborted: false };
        this.session.status = 'dfs_crawling';
        graph.status = 'dfs_crawling';
        await this.graphStorage.save(graph);
        this.callbacks.onStatusChanged?.('dfs_crawling');
        // 설정 병합: options > graph.config.dfs > DEFAULT_DFS_LIMITS
        const limits = {
            ...explorer_config_1.DEFAULT_DFS_LIMITS,
            ...(graph.config.dfs || {}),
            ...(options || {}),
        };
        const startTime = Date.now();
        const visitedStates = new Set();
        const visitedEdges = new Set(); // stateKey + actionSelector 조합
        let actionsExecuted = 0;
        // 현재 페이지의 초기 상태 생성
        const initialUrl = this.page.url();
        const initialFingerprint = await (0, state_fingerprint_1.waitForDomStable)(this.page);
        const initialNormalizedUrl = (0, state_fingerprint_1.normalizeUrlForState)(initialUrl);
        const initialStateKey = (0, state_fingerprint_1.makeStateKey)(initialNormalizedUrl, initialFingerprint);
        // 기존 노드에 stateKey 업데이트
        const currentNode = graph.nodes.find(n => n.id === this.session.currentNodeId);
        if (currentNode) {
            currentNode.stateKey = initialStateKey;
            if (currentNode.metadata)
                currentNode.metadata.fingerprint = initialFingerprint;
        }
        // DFS 스택 초기화
        const stack = [{
                stateKey: initialStateKey,
                url: initialUrl,
                depth: 0,
                actionPath: [],
            }];
        while (stack.length > 0 && !this.crawlAbortController.aborted) {
            // 시간 제한 확인
            const elapsed = Date.now() - startTime;
            if (elapsed > limits.timeBudgetMs) {
                this.callbacks.onError?.(`DFS 시간 제한 도달 (${Math.round(elapsed / 1000)}초)`);
                break;
            }
            // 상태 수 제한 확인
            if (visitedStates.size >= limits.maxStates) {
                this.callbacks.onError?.(`최대 상태 수(${limits.maxStates}) 도달`);
                break;
            }
            const item = stack.pop();
            // 이미 방문한 상태면 스킵
            if (visitedStates.has(item.stateKey))
                continue;
            // 깊이 제한 확인
            if (item.depth > limits.maxDepth)
                continue;
            // 해당 상태로 네비게이션 (초기 상태가 아닌 경우)
            if (item.url !== this.page.url()) {
                try {
                    await this.page.goto(item.url, { waitUntil: 'domcontentloaded', timeout: 15000 });
                    await this.waitForPageReady(this.page);
                }
                catch (e) {
                    this.callbacks.onError?.(`DFS 네비게이션 실패 (${item.url}): ${e.message}`);
                    continue;
                }
            }
            // 상태 방문 기록
            visitedStates.add(item.stateKey);
            // 같은 URL의 상태 수 제한 (SPA 탭 폭발 방지)
            const normalizedUrl = (0, state_fingerprint_1.normalizeUrlForState)(this.page.url());
            const sameUrlCount = this.graphStorage.countNodesForNormalizedUrl(graph, normalizedUrl);
            if (sameUrlCount >= limits.maxSameUrlStates) {
                continue;
            }
            // 진행 상태 콜백
            this.callbacks.onDfsCrawlProgress?.({
                visitedStates: visitedStates.size,
                currentDepth: item.depth,
                actionsExecuted,
                stackSize: stack.length,
                elapsedMs: Date.now() - startTime,
            });
            // 액션 후보 추출
            let actions;
            try {
                actions = await (0, action_extractor_1.extractActions)(this.page);
            }
            catch (e) {
                this.callbacks.onError?.(`액션 추출 실패: ${e.message}`);
                continue;
            }
            // 안전한 액션만 필터링
            const safeActions = (0, action_extractor_1.filterSafeActions)(actions, limits.executeUnknownRisk);
            const actionsToExecute = safeActions.slice(0, limits.maxActionsPerState);
            // 현재 상태에서 각 액션 실행
            for (const action of actionsToExecute) {
                if (this.crawlAbortController.aborted)
                    break;
                if (Date.now() - startTime > limits.timeBudgetMs)
                    break;
                // 이미 실행한 엣지(상태+액션 조합)면 스킵
                const edgeKey = `${item.stateKey}::${action.selector}::${action.text || ''}`;
                if (visitedEdges.has(edgeKey))
                    continue;
                visitedEdges.add(edgeKey);
                // 현재 URL 기억 (복원용)
                const beforeUrl = this.page.url();
                try {
                    // 액션 실행
                    if (action.type === 'navigate' && action.href) {
                        // 링크 네비게이션
                        const latestGraph = await this.graphStorage.load(this.session.graphId);
                        if (!latestGraph)
                            break;
                        if (!this.graphStorage.isAllowedDomain(action.href, latestGraph.allowedDomains))
                            continue;
                        await this.page.goto(action.href, { waitUntil: 'domcontentloaded', timeout: 15000 });
                    }
                    else {
                        // 클릭 액션
                        await this.page.click(action.selector, { timeout: 5000 }).catch(async () => {
                            // CSS 셀렉터 클릭 실패 시 좌표 기반 클릭
                            if (action.bbox) {
                                await this.page.mouse.click(action.bbox.x + action.bbox.width / 2, action.bbox.y + action.bbox.height / 2);
                            }
                        });
                    }
                    actionsExecuted++;
                    // 상태 변화 대기
                    await this.delay(limits.actionDelayMs);
                    const newFingerprint = await (0, state_fingerprint_1.waitForDomStable)(this.page);
                    const newUrl = this.page.url();
                    const newNormalizedUrl = (0, state_fingerprint_1.normalizeUrlForState)(newUrl);
                    const newStateKey = (0, state_fingerprint_1.makeStateKey)(newNormalizedUrl, newFingerprint);
                    // 도메인 체크
                    const latestGraph = await this.graphStorage.load(this.session.graphId);
                    if (!latestGraph)
                        break;
                    try {
                        if (!this.graphStorage.isAllowedDomain(newUrl, latestGraph.allowedDomains)) {
                            // 도메인 밖이면 원래 페이지로 복원
                            await this.page.goto(beforeUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });
                            await this.waitForPageReady(this.page);
                            continue;
                        }
                    }
                    catch {
                        continue;
                    }
                    // 새 상태 → 노드/엣지 생성
                    const title = await this.waitForPageReady(this.page);
                    const newNode = this.graphStorage.addNode(latestGraph, {
                        url: newUrl,
                        title,
                        domain: new URL(newUrl).hostname,
                        stateKey: newStateKey,
                        metadata: {
                            visitedAt: Date.now(),
                            visitCount: 1,
                            fingerprint: newFingerprint,
                            depth: item.depth + 1,
                        },
                    });
                    // 스크린샷 캡처
                    await this.captureScreenshot(this.page, latestGraph.id, newNode);
                    // 현재 상태의 노드 찾기
                    const fromNode = latestGraph.nodes.find(n => n.stateKey === item.stateKey);
                    if (fromNode && fromNode.id !== newNode.id) {
                        this.graphStorage.addEdge(latestGraph, {
                            source: fromNode.id,
                            target: newNode.id,
                            linkUrl: newUrl,
                            linkText: action.text,
                            linkSelector: action.selector,
                            metadata: {
                                discoveredAt: Date.now(),
                                discoveredBy: 'dfs',
                                action: {
                                    type: action.type,
                                    selector: action.selector,
                                    text: action.text,
                                    role: action.role,
                                },
                            },
                        });
                        this.session.stats.edgesDiscovered = latestGraph.edges.length;
                        this.callbacks.onEdgeAdded?.({ source: fromNode.id, target: newNode.id, linkUrl: newUrl }, latestGraph);
                    }
                    this.session.stats.nodesDiscovered = latestGraph.nodes.length;
                    this.session.stats.pagesVisited++;
                    this.session.stats.lastActivityAt = Date.now();
                    this.session.currentUrl = newUrl;
                    this.session.currentNodeId = newNode.id;
                    await this.graphStorage.save(latestGraph);
                    this.callbacks.onNodeAdded?.(newNode, latestGraph);
                    this.callbacks.onPageVisited?.(newUrl, title);
                    this.callbacks.onActionExecuted?.(action, item.stateKey, newStateKey);
                    // 새 상태가 아직 미방문이면 스택에 추가
                    if (!visitedStates.has(newStateKey)) {
                        stack.push({
                            stateKey: newStateKey,
                            url: newUrl,
                            depth: item.depth + 1,
                            actionPath: [...item.actionPath, { url: newUrl, selector: action.selector }],
                        });
                    }
                    // 원래 상태로 복원 (다음 액션 실행을 위해)
                    if (newUrl !== beforeUrl) {
                        try {
                            await this.page.goto(beforeUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });
                            await this.waitForPageReady(this.page);
                        }
                        catch {
                            // 복원 실패 시 다음 상태부터 계속
                            break;
                        }
                    }
                    else {
                        // URL은 같지만 DOM이 변했을 수 있음 (SPA 탭/모달)
                        // 뒤로가기로 복원 시도
                        try {
                            await this.page.goBack({ waitUntil: 'domcontentloaded', timeout: 5000 });
                            await this.delay(300);
                        }
                        catch {
                            // 뒤로가기 실패해도 계속 진행
                        }
                    }
                }
                catch (e) {
                    this.callbacks.onError?.(`DFS 액션 실행 실패 (${action.text || action.selector}): ${e.message}`);
                    // 페이지 상태가 불안정할 수 있으므로 원래 URL로 복원 시도
                    try {
                        if (this.page.url() !== beforeUrl) {
                            await this.page.goto(beforeUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });
                            await this.waitForPageReady(this.page);
                        }
                    }
                    catch {
                        // 복원도 실패하면 다음 스택 항목으로
                        break;
                    }
                    continue;
                }
            }
        }
        // DFS 크롤링 완료
        if (!this.crawlAbortController.aborted) {
            this.session.status = 'completed';
            const finalGraph = await this.graphStorage.load(this.session.graphId);
            if (finalGraph) {
                finalGraph.status = 'completed';
                await this.graphStorage.save(finalGraph);
            }
            this.callbacks.onStatusChanged?.('completed');
        }
        // 최종 통계 콜백
        this.callbacks.onDfsCrawlProgress?.({
            visitedStates: visitedStates.size,
            currentDepth: 0,
            actionsExecuted,
            stackSize: 0,
            elapsedMs: Date.now() - startTime,
        });
    }
    // ─── 팝업 처리 ────────────────────────────────────────
    async handlePopup(newPage, graph) {
        try {
            await newPage.waitForLoadState('domcontentloaded', { timeout: 10000 });
            const popupUrl = newPage.url();
            const isAllowed = this.graphStorage.isAllowedDomain(popupUrl, graph.allowedDomains);
            // 허용 도메인인 경우에만 노드로 캡처
            if (isAllowed) {
                const title = await this.waitForPageReady(newPage);
                const node = this.graphStorage.addNode(graph, {
                    url: popupUrl,
                    title: `[팝업] ${title || '팝업'}`,
                    domain: new URL(popupUrl).hostname,
                    metadata: { visitedAt: Date.now(), visitCount: 1, isPopup: true },
                });
                await this.captureScreenshot(newPage, graph.id, node);
                if (this.session?.currentNodeId && this.session.currentNodeId !== node.id) {
                    this.graphStorage.addEdge(graph, {
                        source: this.session.currentNodeId,
                        target: node.id,
                        linkUrl: popupUrl,
                        metadata: { discoveredAt: Date.now(), discoveredBy: 'manual' },
                    });
                }
                if (this.session?.currentNodeId) {
                    const currentNode = graph.nodes.find(n => n.id === this.session.currentNodeId);
                    if (currentNode?.metadata) {
                        currentNode.metadata.popupCount = (currentNode.metadata.popupCount || 0) + 1;
                    }
                }
                await this.graphStorage.save(graph);
                this.callbacks.onNodeAdded?.(node, graph);
                // 팝업 내 네비게이션도 추적
                newPage.on('framenavigated', async (frame) => {
                    if (frame === newPage.mainFrame()) {
                        await this.handleNavigation(newPage, graph, 'manual');
                    }
                });
            }
            // 팝업은 도메인에 관계없이 항상 열어둠 — 본인인증 등 외부 팝업도 유지
        }
        catch {
            // 로드 자체가 실패한 팝업만 닫음
            try {
                await newPage.close();
            }
            catch { }
        }
    }
    // ─── 페이지 이동 감지 ──────────────────────────────────
    async handleNavigation(page, graph, mode) {
        if (!this.session || mode === 'crawl')
            return; // 크롤링 모드에서는 별도 처리
        const currentUrl = page.url();
        if (currentUrl === 'about:blank')
            return;
        // 도메인 체크
        if (!this.graphStorage.isAllowedDomain(currentUrl, graph.allowedDomains)) {
            return;
        }
        const latestGraph = await this.graphStorage.load(this.session.graphId);
        if (!latestGraph)
            return;
        // 페이지 렌더링 대기 + 타이틀 캡처 (CSR 대응)
        const title = await this.waitForPageReady(page);
        const prevNodeId = this.session.currentNodeId;
        const node = this.graphStorage.addNode(latestGraph, {
            url: currentUrl,
            title,
            domain: new URL(currentUrl).hostname,
            metadata: { visitedAt: Date.now(), visitCount: 1 },
        });
        // 스크린샷 캡처 (렌더링 완료 후)
        await this.captureScreenshot(page, latestGraph.id, node);
        if (prevNodeId && prevNodeId !== node.id) {
            this.graphStorage.addEdge(latestGraph, {
                source: prevNodeId,
                target: node.id,
                linkUrl: currentUrl,
                metadata: { discoveredAt: Date.now(), discoveredBy: mode },
            });
            this.session.stats.edgesDiscovered = latestGraph.edges.length;
        }
        this.session.currentUrl = currentUrl;
        this.session.currentNodeId = node.id;
        this.session.stats.nodesDiscovered = latestGraph.nodes.length;
        this.session.stats.lastActivityAt = Date.now();
        const navVisitKey = this.getVisitedKey(currentUrl, latestGraph);
        if (!this.session.visitedUrls.includes(navVisitKey)) {
            this.session.visitedUrls.push(navVisitKey);
            this.session.stats.pagesVisited++;
        }
        await this.graphStorage.save(latestGraph);
        this.callbacks.onNodeAdded?.(node, latestGraph);
        this.callbacks.onPageVisited?.(currentUrl, title);
    }
    // ─── 뒤로가기 (수동 탐색용) ───────────────────────────
    async goBack() {
        if (!this.page || !this.session)
            throw new Error('세션이 시작되지 않았습니다');
        if (this.navigationHistory.length < 2) {
            this.callbacks.onError?.('이전 페이지가 없습니다');
            return null;
        }
        const graph = await this.graphStorage.load(this.session.graphId);
        if (!graph)
            throw new Error('그래프를 찾을 수 없습니다');
        // 현재 노드 제거, 이전 노드로 이동
        this.navigationHistory.pop();
        const prevNodeId = this.navigationHistory[this.navigationHistory.length - 1];
        const prevNode = graph.nodes.find(n => n.id === prevNodeId);
        if (!prevNode) {
            this.callbacks.onError?.('이전 노드를 찾을 수 없습니다');
            return null;
        }
        try {
            await this.page.goto(prevNode.url, { waitUntil: 'domcontentloaded', timeout: 15000 });
        }
        catch (e) {
            this.callbacks.onError?.(`뒤로가기 실패: ${e.message}`);
            return null;
        }
        this.session.currentUrl = prevNode.url;
        this.session.currentNodeId = prevNode.id;
        this.session.stats.lastActivityAt = Date.now();
        this.callbacks.onPageVisited?.(prevNode.url, prevNode.title);
        return prevNode;
    }
    // ─── 현재 페이지 수동 캡처 (쿼리파라미터 포함 정확한 URL 기준) ──
    async captureCurrentPage() {
        if (!this.page || !this.session)
            throw new Error('세션이 시작되지 않았습니다');
        const graph = await this.graphStorage.load(this.session.graphId);
        if (!graph)
            throw new Error('그래프를 찾을 수 없습니다');
        const currentUrl = this.page.url();
        if (currentUrl === 'about:blank') {
            this.callbacks.onError?.('캡처할 페이지가 없습니다');
            return null;
        }
        // 정확한 URL 일치 (쿼리파라미터 포함) 중복 방지
        const normalizedCurrent = this.graphStorage.normalizeUrl(currentUrl);
        const exactDup = graph.nodes.find(n => this.graphStorage.normalizeUrl(n.url) === normalizedCurrent);
        if (exactDup) {
            this.callbacks.onError?.('동일한 URL의 노드가 이미 존재합니다: ' + currentUrl);
            return exactDup;
        }
        // 패턴 그룹핑을 우회하여 새 노드를 직접 생성
        const title = await this.waitForPageReady(this.page);
        const prevNodeId = this.session.currentNodeId;
        const newNode = {
            url: currentUrl,
            title,
            domain: new URL(currentUrl).hostname,
            id: (0, crypto_1.randomUUID)(),
            metadata: {
                visitedAt: Date.now(),
                visitCount: 1,
            },
        };
        graph.nodes.push(newNode);
        graph.updatedAt = Date.now();
        // 스크린샷 캡처
        await this.captureScreenshot(this.page, graph.id, newNode);
        // 이전 노드 → 현재 노드 엣지 추가
        if (prevNodeId && prevNodeId !== newNode.id) {
            this.graphStorage.addEdge(graph, {
                source: prevNodeId,
                target: newNode.id,
                linkUrl: currentUrl,
                metadata: { discoveredAt: Date.now(), discoveredBy: 'manual' },
            });
            this.session.stats.edgesDiscovered = graph.edges.length;
        }
        this.session.currentUrl = currentUrl;
        this.session.currentNodeId = newNode.id;
        this.session.stats.nodesDiscovered = graph.nodes.length;
        this.session.stats.lastActivityAt = Date.now();
        this.navigationHistory.push(newNode.id);
        await this.graphStorage.save(graph);
        this.callbacks.onNodeAdded?.(newNode, graph);
        this.callbacks.onPageVisited?.(currentUrl, title);
        return newNode;
    }
    // ─── 유틸리티 ──────────────────────────────────────────
    /**
     * 페이지 스크린샷을 썸네일로 캡처하여 저장
     */
    async captureScreenshot(page, graphId, node) {
        if (node.screenshot)
            return; // 이미 스크린샷이 있으면 스킵
        try {
            const screenshotPath = this.graphStorage.getScreenshotPath(graphId, node.id);
            const buffer = await page.screenshot({
                type: 'jpeg',
                quality: 60,
            });
            (0, fs_1.writeFileSync)(screenshotPath, buffer);
            node.screenshot = `${graphId}/screenshots/${node.id}.jpg`;
        }
        catch {
            // 스크린샷 실패는 무시 (노드 생성에 영향 없음)
        }
    }
    /**
     * 패턴 그룹핑 여부에 따라 방문 키 결정
     * ON이면 패턴 기반, OFF이면 normalizedUrl 기반
     */
    getVisitedKey(url, graph) {
        if (graph.config.enablePatternGrouping !== false) {
            return this.graphStorage.extractUrlPattern(url);
        }
        return this.graphStorage.normalizeUrl(url);
    }
    /**
     * 페이지 콘텐츠가 실제로 렌더링될 때까지 대기
     *
     * CSR(React, Vue 등)은 domcontentloaded 후에도 실제 콘텐츠 렌더링이
     * 한참 뒤에 완료된다. 이 메서드는 networkidle을 짧은 타임아웃으로 시도하여
     * 동적 콘텐츠 로드 완료를 기다린 후, document.title을 다시 캡처한다.
     */
    async waitForPageReady(page) {
        // 1) networkidle 대기 (최대 5초, 실패해도 무시)
        try {
            await page.waitForLoadState('networkidle', { timeout: 5000 });
        }
        catch {
            // 타임아웃이면 넘어감 — 이미 domcontentloaded은 통과한 상태
        }
        // 2) 추가 짧은 대기 — CSR 프레임워크의 hydration/rendering 여유
        await this.delay(500);
        // 3) 최종 타이틀 캡처 (CSR 앱은 이 시점에 document.title이 갱신됨)
        const title = await page.title().catch(() => '');
        return title;
    }
    delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}
exports.WebExplorer = WebExplorer;
//# sourceMappingURL=web-explorer.js.map