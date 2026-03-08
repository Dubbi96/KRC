"use strict";
/**
 * 프로세스 CSV 내보내기
 *
 * Process 엔티티를 scenarios_steps.csv 형식으로 변환한다.
 * 성공 경로는 nodeIds 순서로, 실패 분기는 별도 TC_ID로 출력.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.ProcessExporter = void 0;
const CSV_HEADER = 'TC_ID,Step_No,Action,URL,Button DOM,Test Data,Expected Result,Assertion/Wait Hint,Screenshot? (Y/N),Notes';
class ProcessExporter {
    /**
     * Process + 노드 목록을 CSV 문자열로 변환 (BOM 포함)
     */
    exportCSV(process, nodes) {
        const BOM = '\uFEFF';
        const nodeMap = new Map(nodes.map(n => [n.id, n]));
        const rows = [CSV_HEADER];
        // 1) 성공 경로: nodeIds 순서대로 순회
        const successEdgeMap = this.buildEdgeMap(process.edges, 'success');
        let stepNo = 1;
        for (let i = 0; i < process.nodeIds.length; i++) {
            const nodeId = process.nodeIds[i];
            const node = nodeMap.get(nodeId);
            const title = node?.title || '';
            const url = node?.url || '';
            // 이전 노드 → 현재 노드 성공 엣지 조건
            let action = '';
            let expectedResult = '';
            if (i === 0) {
                action = '진입';
                expectedResult = '페이지 정상 로드';
            }
            else {
                const prevId = process.nodeIds[i - 1];
                const edge = this.findEdgeBetween(successEdgeMap, prevId, nodeId);
                action = edge?.condition || '페이지 이동';
                expectedResult = '정상 전환';
            }
            rows.push(this.formatRow(process.name, stepNo, action, url, '', // Button DOM
            '', // Test Data
            expectedResult, '', // Assertion/Wait Hint
            node?.screenshot ? 'Y' : 'N', title));
            stepNo++;
        }
        // 2) 자기참조 엣지: 동일 노드 내 검증 (인페이지 밸리데이션)
        const selfRefEdges = process.edges.filter(e => e.target === e.source);
        let selfIdx = 1;
        for (const edge of selfRefEdges) {
            const node = nodeMap.get(edge.source);
            const eType = edge.type || 'success';
            const tcId = `${process.name}-SELF-${selfIdx}`;
            rows.push(this.formatRow(tcId, 1, edge.condition || '인페이지 검증', node?.url || '', '', '', eType === 'failure' ? '실패 시 동일 페이지 유지' : '성공 시 동일 페이지 검증', '', node?.screenshot ? 'Y' : 'N', `자기참조: ${node?.title || ''}`));
            selfIdx++;
        }
        // 3) 종료 엣지: target 없음 (플로우 종결)
        const terminationEdges = process.edges.filter(e => !e.target);
        let termIdx = 1;
        for (const edge of terminationEdges) {
            const sourceNode = nodeMap.get(edge.source);
            const eType = edge.type || 'success';
            const tcId = `${process.name}-END-${termIdx}`;
            rows.push(this.formatRow(tcId, 1, edge.condition || (eType === 'failure' ? '실패 종료' : '정상 종료'), sourceNode?.url || '', '', '', '플로우 종료', '', sourceNode?.screenshot ? 'Y' : 'N', `종료 분기: ${sourceNode?.title || ''}`));
            termIdx++;
        }
        // 4) 실패 분기: 다른 노드로 이동하는 failure 엣지
        const failureEdges = process.edges.filter(e => e.type === 'failure' && e.target && e.target !== e.source);
        let failIdx = 1;
        for (const edge of failureEdges) {
            const sourceNode = nodeMap.get(edge.source);
            const targetNode = nodeMap.get(edge.target);
            const tcId = `${process.name}-FAIL-${failIdx}`;
            // 소스 노드 (실패 출발점)
            rows.push(this.formatRow(tcId, 1, '진입', sourceNode?.url || '', '', '', '페이지 정상 로드', '', sourceNode?.screenshot ? 'Y' : 'N', `실패 분기 출발: ${sourceNode?.title || ''}`));
            // 실패 전환
            rows.push(this.formatRow(tcId, 2, edge.condition || '실패 조건', targetNode?.url || '', '', '', '실패 시 예상 결과', '', targetNode?.screenshot ? 'Y' : 'N', `실패 도착: ${targetNode?.title || ''}`));
            failIdx++;
        }
        return BOM + rows.join('\n');
    }
    buildEdgeMap(edges, type) {
        const map = new Map();
        for (const e of edges) {
            const eType = e.type || 'success';
            if (eType !== type)
                continue;
            const list = map.get(e.source) || [];
            list.push(e);
            map.set(e.source, list);
        }
        return map;
    }
    findEdgeBetween(edgeMap, source, target) {
        const edges = edgeMap.get(source);
        if (!edges)
            return undefined;
        return edges.find(e => e.target === target);
    }
    formatRow(tcId, stepNo, action, url, buttonDom, testData, expectedResult, assertionHint, screenshot, notes) {
        return [
            this.csvEscape(tcId),
            stepNo.toFixed(1),
            this.csvEscape(action),
            this.csvEscape(url),
            this.csvEscape(buttonDom),
            this.csvEscape(testData),
            this.csvEscape(expectedResult),
            this.csvEscape(assertionHint),
            screenshot,
            this.csvEscape(notes),
        ].join(',');
    }
    csvEscape(value) {
        if (!value)
            return '';
        if (value.includes(',') || value.includes('"') || value.includes('\n')) {
            return '"' + value.replace(/"/g, '""') + '"';
        }
        return value;
    }
}
exports.ProcessExporter = ProcessExporter;
//# sourceMappingURL=process-exporter.js.map