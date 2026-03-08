/**
 * iOS Pick 전용 서버
 * 디바이스 스크린샷을 브라우저에 실시간 표시하고,
 * 클릭한 위치의 요소를 분석하여 셀렉터를 생성.
 * mirror-server.ts와 독립적으로 동작 (녹화 불필요).
 */
export declare class IOSPickServer {
    private controller;
    private server;
    private viewportSize;
    private dashboardPort;
    private scenarioId;
    private lastPickResult;
    private mode;
    private stepIdx;
    private batchPlanId;
    private batchPlan;
    constructor(controller: any);
    start(port?: number, dashboardPort?: number, scenarioId?: string, mode?: string, stepIdx?: number, batchPlanId?: string): Promise<{
        url: string;
        port: number;
    }>;
    stop(): Promise<void>;
    private handleScreenshot;
    /**
     * 좌표를 받아서 pageSource에서 해당 위치의 요소를 찾고 셀렉터 생성
     */
    private handlePick;
    /**
     * 선택된 셀렉터를 대시보드에 전송
     */
    private handleApply;
    /**
     * 두 좌표로 영역을 잡아 스크린샷을 crop하고 대시보드에 전송
     * body: { x1, y1, x2, y2 }
     */
    private handlePickRegion;
    /**
     * 텍스트로 요소 검색 (label/name/value/accessibilityId 부분 일치)
     */
    private handleSearch;
    /**
     * 좌표만 대시보드에 전송 (셀렉터 없이)
     */
    private handleApplyCoordinates;
    /**
     * Batch apply: 모든 pick 결과를 dashboard에 일괄 전송
     */
    private handleBatchApply;
    private readBody;
    private serveHTML;
    /** Batch Pick 모드 HTML — step 큐 UI + 일괄 적용 */
    private serveBatchHTML;
    /** Image Match Pick 모드 전용 HTML — 두 점 클릭으로 영역 선택 + 캡처 */
    private serveImageMatchHTML;
}
