import type { TestResult } from '../types';
export declare class ReportGenerator {
    generateHTML(result: TestResult, outputDir: string): string;
    generateJSON(result: TestResult, outputDir: string): string;
    private buildHTML;
    /** 개별 이벤트 행 생성 */
    private buildEventRow;
    /** 어설션 결과 목록 */
    private buildAssertionList;
    /** 최종 변수 상태 섹션 */
    private buildVariablesSection;
    /** image_match 비교 결과 이미지 3개 표시 */
    private buildImageMatchCompare;
    /** OCR 결과 표시 */
    private buildOcrResult;
    private esc;
}
