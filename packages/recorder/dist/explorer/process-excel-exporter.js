"use strict";
/**
 * 프로세스 Excel(.xlsx) 내보내기
 *
 * Process 엔티티 배열을 PROD.xlsx 템플릿과 동일한 4-시트 엑셀 파일로 변환한다.
 *   Sheet 1 – TestCases  : 프로세스당 1행 (테스트 메타데이터)
 *   Sheet 2 – StepsViewer: TC_ID 필터 뷰
 *   Sheet 3 – Steps      : 상세 스텝 (CSV 내보내기와 동일 로직)
 *   Sheet 4 – Lookups    : 드롭다운 값 목록
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.ProcessExcelExporter = void 0;
// eslint-disable-next-line @typescript-eslint/no-require-imports
const ExcelJS = require("exceljs");
// ── Lookup 상수 ──
const LOOKUPS = {
    Priority: ['P0', 'P1', 'P2', 'P3'],
    Severity: ['S0(Blocking)', 'S1(Critical)', 'S2(Major)', 'S3(Minor)', 'S4(Trivial)'],
    Type: ['Smoke', 'Regression', 'Functional', 'UAT', 'Exploratory', 'NonFunctional'],
    Automation: ['Manual', 'Auto', 'Candidate'],
    Status: ['Draft', 'Ready', 'Deprecated'],
    ExecStatus: ['Not Run', 'Pass', 'Fail', 'Blocked', 'Skipped'],
    Platform: ['Web', 'Mobile Web', 'WebView(App)', 'API'],
    Env: ['Local', 'Dev', 'QA', 'Stage', 'Prod-like'],
    Risk: ['High', 'Medium', 'Low'],
};
// ── 헤더 스타일 ──
const HEADER_FILL = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FF2D3748' },
};
const HEADER_FONT = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
const HEADER_BORDER = {
    bottom: { style: 'thin', color: { argb: 'FF4A5568' } },
};
class ProcessExcelExporter {
    /**
     * 여러 프로세스를 하나의 .xlsx Buffer로 변환
     */
    async exportXLSX(items) {
        const workbook = new ExcelJS.Workbook();
        workbook.creator = 'Katab';
        workbook.created = new Date();
        this.buildLookupsSheet(workbook);
        this.buildTestCasesSheet(workbook, items);
        const allSteps = this.collectAllSteps(items);
        this.buildStepsSheet(workbook, allSteps);
        this.buildStepsViewerSheet(workbook, items, allSteps);
        const arrayBuffer = await workbook.xlsx.writeBuffer();
        return Buffer.from(arrayBuffer);
    }
    // ────────────────────────────────────────────────────────────
    // Sheet 4: Lookups
    // ────────────────────────────────────────────────────────────
    buildLookupsSheet(wb) {
        const ws = wb.addWorksheet('Lookups');
        const categories = Object.entries(LOOKUPS);
        categories.forEach(([name, values], colIdx) => {
            const col = colIdx + 1;
            const headerCell = ws.getCell(1, col);
            headerCell.value = name;
            headerCell.font = HEADER_FONT;
            headerCell.fill = HEADER_FILL;
            values.forEach((v, rowIdx) => {
                ws.getCell(rowIdx + 2, col).value = v;
            });
            // 컬럼 너비
            ws.getColumn(col).width = Math.max(name.length, ...values.map(v => v.length)) + 4;
        });
    }
    // ────────────────────────────────────────────────────────────
    // Sheet 1: TestCases
    // ────────────────────────────────────────────────────────────
    buildTestCasesSheet(wb, items) {
        const ws = wb.addWorksheet('TestCases');
        const headers = [
            'TC_ID', 'Title', 'Module', 'Feature', 'Requirement_ID',
            'Type', 'Priority', 'Severity', 'Risk', 'Platform',
            'Environment', 'Browser/Device', 'Automation', 'Automation_ID',
            'Preconditions', 'Expected Result (Summary)',
            'Postconditions/Cleanup', 'Owner', 'Reviewer', 'Status',
            'Tags', 'Defect_ID', 'Notes', 'Created', 'Updated',
            'Version', 'Last Executed', 'Execution Status', 'Evidence Link',
        ];
        // 헤더 행
        const headerRow = ws.addRow(headers);
        headerRow.eachCell((cell) => {
            cell.font = HEADER_FONT;
            cell.fill = HEADER_FILL;
            cell.border = HEADER_BORDER;
        });
        ws.views = [{ state: 'frozen', ySplit: 1, xSplit: 0 }];
        // 데이터 행
        for (const { process: p } of items) {
            const m = p.testMeta || {};
            ws.addRow([
                m.tcId || p.name,
                p.name,
                m.module || '',
                m.feature || '',
                m.requirementId || '',
                m.type || '',
                m.priority || '',
                m.severity || '',
                m.risk || '',
                m.platform || 'Web',
                m.environment || '',
                m.browserDevice || '',
                m.automation || 'Manual',
                m.automationId || '',
                m.preconditions || '',
                m.expectedResultSummary || '',
                m.postconditions || '',
                m.owner || '',
                m.reviewer || '',
                m.status || 'Draft',
                (p.tags || []).join(', '),
                m.defectId || '',
                m.notes || '',
                this.formatDate(p.createdAt),
                this.formatDate(p.updatedAt),
                m.version || '',
                '', // Last Executed
                m.executionStatus || 'Not Run',
                m.evidenceLink || '',
            ]);
        }
        // 데이터 검증 (드롭다운) – Type(F), Priority(G), Severity(H), Risk(I),
        // Platform(J), Environment(K), Automation(M), Status(T), ExecStatus(AB)
        const validationMap = [
            ['Type', 'F', LOOKUPS.Type.length],
            ['Priority', 'G', LOOKUPS.Priority.length],
            ['Severity', 'H', LOOKUPS.Severity.length],
            ['Risk', 'I', LOOKUPS.Risk.length],
            ['Platform', 'J', LOOKUPS.Platform.length],
            ['Env', 'K', LOOKUPS.Env.length],
            ['Automation', 'M', LOOKUPS.Automation.length],
            ['Status', 'T', LOOKUPS.Status.length],
            ['ExecStatus', 'AB', LOOKUPS.ExecStatus.length],
        ];
        const lookupColMap = {};
        Object.keys(LOOKUPS).forEach((name, idx) => {
            lookupColMap[name] = String.fromCharCode(65 + idx); // A, B, C, ...
        });
        const lastDataRow = items.length + 1;
        for (const [lookupName, tcCol] of validationMap) {
            const lCol = lookupColMap[lookupName];
            const lLen = LOOKUPS[lookupName].length;
            for (let r = 2; r <= lastDataRow; r++) {
                ws.getCell(`${tcCol}${r}`).dataValidation = {
                    type: 'list',
                    allowBlank: true,
                    formulae: [`Lookups!$${lCol}$2:$${lCol}$${lLen + 1}`],
                };
            }
        }
        // 컬럼 너비 자동조정
        headers.forEach((h, i) => {
            ws.getColumn(i + 1).width = Math.max(h.length + 2, 14);
        });
    }
    // ────────────────────────────────────────────────────────────
    // Sheet 3: Steps
    // ────────────────────────────────────────────────────────────
    buildStepsSheet(wb, steps) {
        const ws = wb.addWorksheet('Steps');
        const headers = [
            'TC_ID', 'Step_No', 'Action', 'URL', 'Button DOM',
            'Test Data', 'Expected Result', 'Assertion/Wait Hint',
            'Screenshot? (Y/N)', 'Notes',
        ];
        const headerRow = ws.addRow(headers);
        headerRow.eachCell((cell) => {
            cell.font = HEADER_FONT;
            cell.fill = HEADER_FILL;
            cell.border = HEADER_BORDER;
        });
        ws.views = [{ state: 'frozen', ySplit: 1, xSplit: 0 }];
        for (const s of steps) {
            ws.addRow([
                s.tcId, s.stepNo, s.action, s.url, s.buttonDom,
                s.testData, s.expectedResult, s.assertionHint,
                s.screenshot, s.notes,
            ]);
        }
        // 컬럼 너비
        const widths = [22, 8, 30, 40, 40, 20, 30, 24, 14, 24];
        widths.forEach((w, i) => { ws.getColumn(i + 1).width = w; });
    }
    // ────────────────────────────────────────────────────────────
    // Sheet 2: StepsViewer
    // ────────────────────────────────────────────────────────────
    buildStepsViewerSheet(wb, items, allSteps) {
        const ws = wb.addWorksheet('StepsViewer');
        // Row 1: 제목
        ws.getCell('A1').value = 'Steps Viewer';
        ws.getCell('A1').font = { bold: true, size: 14 };
        // Row 2: TC_ID 필터 선택
        ws.getCell('A2').value = 'TC_ID 선택';
        ws.getCell('A2').font = { bold: true };
        const tcIds = items.map(it => it.process.testMeta?.tcId || it.process.name);
        ws.getCell('B2').value = tcIds[0] || '';
        ws.getCell('B2').dataValidation = {
            type: 'list',
            allowBlank: false,
            formulae: [`"${tcIds.join(',')}"`],
        };
        ws.getCell('D2').value = 'B2에서 TC_ID를 고른 뒤, 필터에서 Match=TRUE만 남기면 해당 케이스 Step만 보입니다.';
        ws.getCell('D2').font = { italic: true, color: { argb: 'FF718096' } };
        // Row 3: 빈 행
        // Row 4: 헤더
        const headers = [
            'TC_ID', 'Step_No', 'Action', 'Test Data',
            'Expected Result', 'Assertion/Wait Hint',
            'Screenshot? (Y/N)', 'Notes', 'Match',
        ];
        const headerRow = ws.getRow(4);
        headers.forEach((h, i) => {
            const cell = headerRow.getCell(i + 1);
            cell.value = h;
            cell.font = HEADER_FONT;
            cell.fill = HEADER_FILL;
            cell.border = HEADER_BORDER;
        });
        // Row 5+: 데이터 + Match 수식
        let rowNum = 5;
        for (const s of allSteps) {
            const row = ws.getRow(rowNum);
            row.getCell(1).value = s.tcId;
            row.getCell(2).value = s.stepNo;
            row.getCell(3).value = s.action;
            row.getCell(4).value = s.testData;
            row.getCell(5).value = s.expectedResult;
            row.getCell(6).value = s.assertionHint;
            row.getCell(7).value = s.screenshot;
            row.getCell(8).value = s.notes;
            row.getCell(9).value = { formula: `A${rowNum}=$B$2` };
            rowNum++;
        }
        // 컬럼 너비
        const widths = [22, 8, 30, 20, 30, 24, 14, 24, 8];
        widths.forEach((w, i) => { ws.getColumn(i + 1).width = w; });
    }
    // ────────────────────────────────────────────────────────────
    // 스텝 수집 (CSV exporter 로직 재사용)
    // ────────────────────────────────────────────────────────────
    collectAllSteps(items) {
        const allSteps = [];
        for (const { process: p, nodes, linkedEvents } of items) {
            const tcId = p.testMeta?.tcId || p.name;
            if (linkedEvents && linkedEvents.length > 0) {
                allSteps.push(...this.buildLinkedSteps(tcId, linkedEvents));
            }
            else {
                allSteps.push(...this.buildSteps(p, nodes));
            }
        }
        return allSteps;
    }
    buildSteps(process, nodes) {
        const nodeMap = new Map(nodes.map(n => [n.id, n]));
        const rows = [];
        const tcId = process.testMeta?.tcId || process.name;
        // 1) 성공 경로
        const successEdgeMap = this.buildEdgeMap(process.edges, 'success');
        let stepNo = 1;
        for (let i = 0; i < process.nodeIds.length; i++) {
            const nodeId = process.nodeIds[i];
            const node = nodeMap.get(nodeId);
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
            rows.push({
                tcId,
                stepNo,
                action,
                url: node?.url || '',
                buttonDom: '',
                testData: '',
                expectedResult,
                assertionHint: '',
                screenshot: node?.screenshot ? 'Y' : 'N',
                notes: node?.title || '',
            });
            stepNo++;
        }
        // 2) 자기참조 엣지
        const selfRefEdges = process.edges.filter(e => e.target === e.source);
        let selfIdx = 1;
        for (const edge of selfRefEdges) {
            const node = nodeMap.get(edge.source);
            const eType = edge.type || 'success';
            rows.push({
                tcId: `${tcId}-SELF-${selfIdx}`,
                stepNo: 1,
                action: edge.condition || '인페이지 검증',
                url: node?.url || '',
                buttonDom: '',
                testData: '',
                expectedResult: eType === 'failure' ? '실패 시 동일 페이지 유지' : '성공 시 동일 페이지 검증',
                assertionHint: '',
                screenshot: node?.screenshot ? 'Y' : 'N',
                notes: `자기참조: ${node?.title || ''}`,
            });
            selfIdx++;
        }
        // 3) 종료 엣지
        const terminationEdges = process.edges.filter(e => !e.target);
        let termIdx = 1;
        for (const edge of terminationEdges) {
            const sourceNode = nodeMap.get(edge.source);
            const eType = edge.type || 'success';
            rows.push({
                tcId: `${tcId}-END-${termIdx}`,
                stepNo: 1,
                action: edge.condition || (eType === 'failure' ? '실패 종료' : '정상 종료'),
                url: sourceNode?.url || '',
                buttonDom: '',
                testData: '',
                expectedResult: '플로우 종료',
                assertionHint: '',
                screenshot: sourceNode?.screenshot ? 'Y' : 'N',
                notes: `종료 분기: ${sourceNode?.title || ''}`,
            });
            termIdx++;
        }
        // 4) 실패 분기
        const failureEdges = process.edges.filter(e => e.type === 'failure' && e.target && e.target !== e.source);
        let failIdx = 1;
        for (const edge of failureEdges) {
            const sourceNode = nodeMap.get(edge.source);
            const targetNode = nodeMap.get(edge.target);
            const failTcId = `${tcId}-FAIL-${failIdx}`;
            rows.push({
                tcId: failTcId,
                stepNo: 1,
                action: '진입',
                url: sourceNode?.url || '',
                buttonDom: '',
                testData: '',
                expectedResult: '페이지 정상 로드',
                assertionHint: '',
                screenshot: sourceNode?.screenshot ? 'Y' : 'N',
                notes: `실패 분기 출발: ${sourceNode?.title || ''}`,
            });
            rows.push({
                tcId: failTcId,
                stepNo: 2,
                action: edge.condition || '실패 조건',
                url: targetNode?.url || '',
                buttonDom: '',
                testData: '',
                expectedResult: '실패 시 예상 결과',
                assertionHint: '',
                screenshot: targetNode?.screenshot ? 'Y' : 'N',
                notes: `실패 도착: ${targetNode?.title || ''}`,
            });
            failIdx++;
        }
        return rows;
    }
    // ────────────────────────────────────────────────────────────
    // 연결된 시나리오 이벤트 → 상세 스텝 변환
    // ────────────────────────────────────────────────────────────
    buildLinkedSteps(tcId, linkedEvents) {
        const rows = [];
        let stepNo = 1;
        for (const { scenarioName, events } of linkedEvents) {
            // 시나리오 구분 헤더 행
            rows.push({
                tcId,
                stepNo,
                action: `[시나리오: ${scenarioName}]`,
                url: '',
                buttonDom: '',
                testData: '',
                expectedResult: '',
                assertionHint: '',
                screenshot: 'N',
                notes: `시나리오 시작: ${scenarioName}`,
            });
            stepNo++;
            for (const event of events) {
                if (event.disabled)
                    continue;
                const action = this.eventToAction(event);
                const url = event.url || '';
                const selector = event.selector || '';
                const value = event.value || event.text || '';
                // 어설션 힌트 조합
                let assertionHint = '';
                if (event.assertions?.length) {
                    assertionHint = event.assertions
                        .map(a => `${a.type}: ${a.expected}`)
                        .join('; ');
                }
                else if (event.assertion) {
                    assertionHint = `${event.assertion.type}: ${event.assertion.expected}`;
                }
                rows.push({
                    tcId,
                    stepNo,
                    action,
                    url,
                    buttonDom: selector,
                    testData: value,
                    expectedResult: event.description || action,
                    assertionHint,
                    screenshot: event.takeScreenshot ? 'Y' : (event.meta?.screenshot ? 'Y' : 'N'),
                    notes: event.notes || '',
                });
                stepNo++;
            }
        }
        return rows;
    }
    eventToAction(event) {
        const typeMap = {
            click: '클릭',
            fill: '입력',
            select: '선택',
            navigate: '페이지 이동',
            wait: '대기',
            tap: '탭',
            swipe: '스와이프',
            scroll: '스크롤',
            type: '텍스트 입력',
            hover: '호버',
            keyboard: '키보드',
            assert: '검증',
            api_request: 'API 호출',
            wait_for_user: '수동 대기',
            run_script: '스크립트 실행',
            set_variable: '변수 설정',
            extract_data: '데이터 추출',
            wait_for: '자동 대기',
            longPress: '길게 누르기',
            home: '홈 버튼',
            back: '뒤로가기',
            clear_app: '앱 초기화',
            for_each_start: '반복 시작',
            for_each_end: '반복 종료',
            if_start: '조건 시작',
            if_end: '조건 종료',
        };
        const label = typeMap[event.type] || event.type;
        if (event.description)
            return `${label}: ${event.description}`;
        if (event.selector) {
            const short = event.selector.length > 40 ? event.selector.substring(0, 37) + '...' : event.selector;
            return `${label} (${short})`;
        }
        if (event.url)
            return `${label}: ${event.url}`;
        return label;
    }
    // ── 유틸 ──
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
    formatDate(ts) {
        if (!ts)
            return '';
        const d = new Date(ts);
        return d.toISOString().slice(0, 10); // YYYY-MM-DD
    }
}
exports.ProcessExcelExporter = ProcessExcelExporter;
//# sourceMappingURL=process-excel-exporter.js.map