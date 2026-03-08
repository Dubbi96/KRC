"use strict";
/**
 * 탐색 그래프 저장소
 *
 * ExplorationGraph 데이터를 JSON 파일로 저장/로드/관리한다.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.GraphStorage = void 0;
const crypto_1 = require("crypto");
const fs_1 = require("fs");
const promises_1 = require("fs/promises");
const path_1 = require("path");
const state_fingerprint_1 = require("../explorer/state-fingerprint");
class GraphStorage {
    graphDir;
    constructor(baseDir = './scenarios') {
        this.graphDir = (0, path_1.join)(baseDir, '..', 'graphs');
        if (!(0, fs_1.existsSync)(this.graphDir)) {
            (0, fs_1.mkdirSync)(this.graphDir, { recursive: true });
        }
    }
    getGraphDir() {
        return this.graphDir;
    }
    getScreenshotDir(graphId) {
        const dir = (0, path_1.join)(this.graphDir, graphId, 'screenshots');
        if (!(0, fs_1.existsSync)(dir))
            (0, fs_1.mkdirSync)(dir, { recursive: true });
        return dir;
    }
    getScreenshotPath(graphId, nodeId) {
        return (0, path_1.join)(this.getScreenshotDir(graphId), `${nodeId}.jpg`);
    }
    // ─── CRUD ──────────────────────────────────────────────
    async save(graph) {
        graph.updatedAt = Date.now();
        const filePath = (0, path_1.join)(this.graphDir, `${graph.id}.json`);
        await (0, promises_1.writeFile)(filePath, JSON.stringify(graph, null, 2), 'utf-8');
    }
    async load(id) {
        const filePath = (0, path_1.join)(this.graphDir, `${id}.json`);
        try {
            const data = await (0, promises_1.readFile)(filePath, 'utf-8');
            return JSON.parse(data);
        }
        catch {
            return null;
        }
    }
    async list() {
        if (!(0, fs_1.existsSync)(this.graphDir))
            return [];
        const files = (await (0, promises_1.readdir)(this.graphDir)).filter(f => f.endsWith('.json'));
        const results = await Promise.allSettled(files.map(async (file) => {
            const data = await (0, promises_1.readFile)((0, path_1.join)(this.graphDir, file), 'utf-8');
            return JSON.parse(data);
        }));
        const graphs = results
            .filter((r) => r.status === 'fulfilled')
            .map(r => r.value);
        return graphs.sort((a, b) => b.updatedAt - a.updatedAt);
    }
    /** 경량 목록: 노드/엣지 전체 데이터 없이 요약만 반환 */
    async listSummaries() {
        const graphs = await this.list();
        return graphs.map(g => ({
            id: g.id,
            name: g.name,
            rootUrl: g.rootUrl,
            status: g.status,
            nodeCount: g.nodes.length,
            edgeCount: g.edges.length,
            createdAt: g.createdAt,
            updatedAt: g.updatedAt,
            deviceType: g.config.deviceType,
            rootCount: g.rootUrls?.length || 1,
        }));
    }
    async delete(id) {
        const filePath = (0, path_1.join)(this.graphDir, `${id}.json`);
        try {
            await (0, promises_1.unlink)(filePath);
            return true;
        }
        catch {
            return false;
        }
    }
    // ─── Graph Manipulation ────────────────────────────────
    async createGraph(name, rootUrl, allowedDomains, config) {
        const now = Date.now();
        const graph = {
            id: (0, crypto_1.randomUUID)(),
            name,
            rootUrl,
            rootUrls: [{
                    id: (0, crypto_1.randomUUID)(),
                    url: rootUrl,
                    label: '기본',
                    authProfileId: config?.authProfileId,
                    addedAt: now,
                }],
            allowedDomains,
            createdAt: now,
            updatedAt: now,
            nodes: [],
            edges: [],
            config: {
                maxDepth: 5,
                maxNodes: 500,
                crawlDelay: 1000,
                ignoreFragments: true,
                ...config,
            },
            status: 'idle',
        };
        await this.save(graph);
        return graph;
    }
    addRoot(graph, root) {
        if (!graph.rootUrls)
            graph.rootUrls = [];
        const newRoot = {
            ...root,
            id: (0, crypto_1.randomUUID)(),
            addedAt: Date.now(),
        };
        graph.rootUrls.push(newRoot);
        graph.updatedAt = Date.now();
        try {
            const hostname = new URL(root.url).hostname;
            if (!graph.allowedDomains.includes(hostname)) {
                graph.allowedDomains.push(hostname);
            }
        }
        catch { /* invalid URL */ }
        return newRoot;
    }
    removeRoot(graph, rootId) {
        if (!graph.rootUrls)
            return false;
        const idx = graph.rootUrls.findIndex(r => r.id === rootId);
        if (idx === -1)
            return false;
        graph.rootUrls.splice(idx, 1);
        graph.updatedAt = Date.now();
        return true;
    }
    addNode(graph, node) {
        // stateKey 기반 매칭 (DFS 탐색에서 사용)
        if (node.stateKey) {
            const existingByState = graph.nodes.find(n => n.stateKey === node.stateKey);
            if (existingByState) {
                if (existingByState.metadata) {
                    existingByState.metadata.visitCount = (existingByState.metadata.visitCount || 0) + 1;
                    existingByState.metadata.visitedAt = Date.now();
                }
                return existingByState;
            }
        }
        const enablePatterns = graph.config.enablePatternGrouping !== false;
        if (enablePatterns) {
            const pattern = this.extractUrlPattern(node.url);
            // stateKey가 있으면 패턴 그룹핑을 건너뛰고 새 노드 생성 (DFS는 DOM 기반 구분)
            if (!node.stateKey) {
                const existingByPattern = graph.nodes.find(n => n.metadata?.urlPattern === pattern);
                if (existingByPattern) {
                    if (existingByPattern.metadata) {
                        existingByPattern.metadata.visitCount = (existingByPattern.metadata.visitCount || 0) + 1;
                        existingByPattern.metadata.visitedAt = Date.now();
                        if (!existingByPattern.metadata.urlVariations) {
                            existingByPattern.metadata.urlVariations = [existingByPattern.url];
                        }
                        const normalizedNew = this.normalizeUrl(node.url);
                        if (!existingByPattern.metadata.urlVariations.includes(normalizedNew)) {
                            existingByPattern.metadata.urlVariations.push(normalizedNew);
                        }
                        if (node.title) {
                            if (!existingByPattern.metadata.variationTitles) {
                                existingByPattern.metadata.variationTitles = {};
                            }
                            existingByPattern.metadata.variationTitles[normalizedNew] = node.title;
                        }
                    }
                    return existingByPattern;
                }
            }
            const newNode = {
                ...node,
                id: (0, crypto_1.randomUUID)(),
                metadata: {
                    visitedAt: Date.now(),
                    visitCount: 1,
                    ...node.metadata,
                    urlPattern: pattern,
                    urlVariations: [this.normalizeUrl(node.url)],
                },
            };
            graph.nodes.push(newNode);
            graph.updatedAt = Date.now();
            return newNode;
        }
        // 패턴 그룹핑 OFF: 기존 동작 (정확한 URL 매칭)
        // stateKey가 있으면 이미 위에서 처리했으므로 URL 기반 매칭
        if (!node.stateKey) {
            const existing = graph.nodes.find(n => this.normalizeUrl(n.url) === this.normalizeUrl(node.url));
            if (existing) {
                if (existing.metadata) {
                    existing.metadata.visitCount = (existing.metadata.visitCount || 0) + 1;
                    existing.metadata.visitedAt = Date.now();
                }
                return existing;
            }
        }
        const newNode = {
            ...node,
            id: (0, crypto_1.randomUUID)(),
            metadata: {
                visitedAt: Date.now(),
                visitCount: 1,
                ...node.metadata,
            },
        };
        graph.nodes.push(newNode);
        graph.updatedAt = Date.now();
        return newNode;
    }
    addEdge(graph, edge) {
        // 같은 source→target 엣지가 이미 있으면 기존 엣지 반환
        const existing = graph.edges.find(e => e.source === edge.source && e.target === edge.target);
        if (existing)
            return existing;
        const newEdge = {
            ...edge,
            id: (0, crypto_1.randomUUID)(),
        };
        graph.edges.push(newEdge);
        graph.updatedAt = Date.now();
        return newEdge;
    }
    findNodeByUrl(graph, url) {
        const exact = graph.nodes.find(n => this.normalizeUrl(n.url) === this.normalizeUrl(url));
        if (exact)
            return exact;
        if (graph.config.enablePatternGrouping !== false) {
            return this.findNodeByPattern(graph, url);
        }
        return undefined;
    }
    findNodeByPattern(graph, url) {
        const pattern = this.extractUrlPattern(url);
        return graph.nodes.find(n => n.metadata?.urlPattern === pattern);
    }
    /** stateKey로 노드 검색 (DFS 탐색용) */
    findNodeByStateKey(graph, stateKey) {
        return graph.nodes.find(n => n.stateKey === stateKey);
    }
    /**
     * 특정 URL(State 정규화 기준)의 상태 노드 수를 반환 (SPA 폭발 방지용)
     *
     * CRITICAL: normalizeUrlForState()와 동일한 정규화 규칙을 사용해야 한다.
     * graphStorage.normalizeUrl()은 fragment/trailing slash만 처리하지만,
     * normalizeUrlForState()는 tracking 파라미터 제거 + 쿼리 정렬까지 수행하므로,
     * DFS에서 전달하는 normalizedUrl과 비교 시 반드시 같은 함수를 써야 한다.
     */
    countNodesForNormalizedUrl(graph, normalizedUrl) {
        return graph.nodes.filter(n => {
            try {
                return (0, state_fingerprint_1.normalizeUrlForState)(n.url) === normalizedUrl;
            }
            catch {
                return false;
            }
        }).length;
    }
    // ─── URL Normalization ─────────────────────────────────
    normalizeUrl(url, ignoreFragments = true) {
        try {
            const u = new URL(url);
            if (ignoreFragments)
                u.hash = '';
            // 끝 슬래시 정규화
            if (u.pathname.endsWith('/') && u.pathname.length > 1) {
                u.pathname = u.pathname.slice(0, -1);
            }
            return u.href;
        }
        catch {
            return url;
        }
    }
    /**
     * URL에서 패턴을 추출한다.
     * - 숫자 세그먼트(/123/) → :id
     * - UUID 패턴 → :id
     * - 긴 hex 문자열(8+자) → :id
     * - 쿼리 파라미터 전부 제거
     */
    extractUrlPattern(url) {
        try {
            const u = new URL(url);
            const segments = u.pathname.split('/').map(seg => {
                if (!seg)
                    return seg;
                if (/^\d+$/.test(seg))
                    return ':id';
                if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(seg))
                    return ':id';
                if (/^[0-9a-f]{8,}$/i.test(seg))
                    return ':id';
                return seg;
            });
            let path = segments.join('/');
            if (path.endsWith('/') && path.length > 1)
                path = path.slice(0, -1);
            return u.origin + path;
        }
        catch {
            return url;
        }
    }
    /**
     * 그래프에서 노드를 삭제하고 관련 엣지, 프로세스 참조, 스크린샷을 정리한다.
     * @returns 삭제 결과 요약
     */
    async deleteNode(graph, nodeId, processes, saveProcess) {
        const nodeIdx = graph.nodes.findIndex(n => n.id === nodeId);
        if (nodeIdx === -1)
            throw new Error('노드를 찾을 수 없습니다');
        const node = graph.nodes[nodeIdx];
        // 1) 연관 엣지 제거
        const edgesBefore = graph.edges.length;
        graph.edges = graph.edges.filter(e => e.source !== nodeId && e.target !== nodeId);
        const edgesRemoved = edgesBefore - graph.edges.length;
        // 2) 노드 제거
        graph.nodes.splice(nodeIdx, 1);
        // 3) 프로세스 참조 정리
        const processesUpdated = [];
        for (const proc of processes) {
            if (!proc.nodeIds.includes(nodeId))
                continue;
            proc.nodeIds = proc.nodeIds.filter(id => id !== nodeId);
            proc.edges = proc.edges.filter(e => e.source !== nodeId && e.target !== nodeId);
            if (proc.nodePositions)
                delete proc.nodePositions[nodeId];
            await saveProcess(proc);
            processesUpdated.push(proc.id);
        }
        // 4) 스크린샷 파일 삭제
        if (node.screenshot) {
            const ssPath = (0, path_1.join)(this.graphDir, node.screenshot);
            try {
                await (0, promises_1.unlink)(ssPath);
            }
            catch { /* 파일 없으면 무시 */ }
        }
        graph.updatedAt = Date.now();
        await this.save(graph);
        return { edgesRemoved, processesUpdated };
    }
    isAllowedDomain(url, allowedDomains) {
        try {
            const hostname = new URL(url).hostname;
            return allowedDomains.some(domain => hostname === domain || hostname.endsWith('.' + domain));
        }
        catch {
            return false;
        }
    }
}
exports.GraphStorage = GraphStorage;
//# sourceMappingURL=graph-storage.js.map