/**
 * 프로세스 Excel(.xlsx) 내보내기
 *
 * Process 엔티티 배열을 PROD.xlsx 템플릿과 동일한 4-시트 엑셀 파일로 변환한다.
 *   Sheet 1 – TestCases  : 프로세스당 1행 (테스트 메타데이터)
 *   Sheet 2 – StepsViewer: TC_ID 필터 뷰
 *   Sheet 3 – Steps      : 상세 스텝 (CSV 내보내기와 동일 로직)
 *   Sheet 4 – Lookups    : 드롭다운 값 목록
 */
import type { Process, PageNode, RecordingEvent } from '../types';
export declare class ProcessExcelExporter {
    /**
     * 여러 프로세스를 하나의 .xlsx Buffer로 변환
     */
    exportXLSX(items: Array<{
        process: Process;
        nodes: PageNode[];
        linkedEvents?: Array<{
            scenarioName: string;
            events: RecordingEvent[];
        }>;
    }>): Promise<Buffer>;
    private buildLookupsSheet;
    private buildTestCasesSheet;
    private buildStepsSheet;
    private buildStepsViewerSheet;
    private collectAllSteps;
    private buildSteps;
    private buildLinkedSteps;
    private eventToAction;
    private buildEdgeMap;
    private findEdgeBetween;
    private formatDate;
}
