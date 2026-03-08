/**
 * 프로세스 CSV 내보내기
 *
 * Process 엔티티를 scenarios_steps.csv 형식으로 변환한다.
 * 성공 경로는 nodeIds 순서로, 실패 분기는 별도 TC_ID로 출력.
 */
import type { Process, PageNode } from '../types';
export declare class ProcessExporter {
    /**
     * Process + 노드 목록을 CSV 문자열로 변환 (BOM 포함)
     */
    exportCSV(process: Process, nodes: PageNode[]): string;
    private buildEdgeMap;
    private findEdgeBetween;
    private formatRow;
    private csvEscape;
}
