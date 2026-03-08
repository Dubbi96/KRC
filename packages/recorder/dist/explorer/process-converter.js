"use strict";
/**
 * 프로세스 변환기
 *
 * 탐색 그래프에서 선택한 노드 경로를 Process 엔티티로 추출한다.
 * 각 노드 간 전환 조건을 자유 텍스트로 정의할 수 있다.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.ProcessConverter = void 0;
const crypto_1 = require("crypto");
class ProcessConverter {
    processStorage;
    constructor(processStorage) {
        this.processStorage = processStorage;
    }
    /**
     * 선택한 노드 ID 경로를 Process로 변환
     */
    createProcess(graph, nodeIds, name) {
        if (nodeIds.length === 0)
            throw new Error('노드를 선택해야 합니다');
        const now = Date.now();
        const edges = [];
        for (let i = 0; i < nodeIds.length - 1; i++) {
            const sourceId = nodeIds[i];
            const targetId = nodeIds[i + 1];
            // 원본 그래프에서 엣지 조회
            const originalEdge = graph.edges.find(e => e.source === sourceId && e.target === targetId);
            edges.push({
                id: (0, crypto_1.randomUUID)(),
                source: sourceId,
                target: targetId,
                condition: originalEdge?.linkText || '',
                type: 'success',
                originalEdgeId: originalEdge?.id,
            });
        }
        const process = {
            id: (0, crypto_1.randomUUID)(),
            name,
            graphId: graph.id,
            nodeIds,
            edges,
            createdAt: now,
            updatedAt: now,
            tags: ['from-graph'],
        };
        return process;
    }
    /**
     * 프로세스를 저장
     */
    async saveProcess(process) {
        await this.processStorage.save(process);
    }
    /**
     * 그래프에서 두 노드 사이의 최단 경로 찾기 (BFS)
     */
    findShortestPath(graph, startNodeId, endNodeId) {
        if (startNodeId === endNodeId)
            return [startNodeId];
        const visited = new Set();
        const queue = [[startNodeId, [startNodeId]]];
        visited.add(startNodeId);
        while (queue.length > 0) {
            const [current, path] = queue.shift();
            const outEdges = graph.edges.filter(e => e.source === current);
            for (const edge of outEdges) {
                if (edge.target === endNodeId) {
                    return [...path, endNodeId];
                }
                if (!visited.has(edge.target)) {
                    visited.add(edge.target);
                    queue.push([edge.target, [...path, edge.target]]);
                }
            }
        }
        return null;
    }
    /**
     * 모든 가능한 경로 찾기 (DFS, 깊이 제한)
     */
    findAllPaths(graph, startNodeId, endNodeId, maxDepth = 10) {
        const paths = [];
        const dfs = (current, path, visited, depth) => {
            if (depth > maxDepth)
                return;
            if (current === endNodeId) {
                paths.push([...path]);
                return;
            }
            const outEdges = graph.edges.filter(e => e.source === current);
            for (const edge of outEdges) {
                if (!visited.has(edge.target)) {
                    visited.add(edge.target);
                    path.push(edge.target);
                    dfs(edge.target, path, visited, depth + 1);
                    path.pop();
                    visited.delete(edge.target);
                }
            }
        };
        const visited = new Set([startNodeId]);
        dfs(startNodeId, [startNodeId], visited, 0);
        return paths;
    }
}
exports.ProcessConverter = ProcessConverter;
//# sourceMappingURL=process-converter.js.map