/**
 * Android Pick 전용 서버
 * 디바이스 스크린샷을 브라우저에 실시간 표시하고,
 * 클릭한 위치의 요소를 분석하여 셀렉터를 생성.
 * iOS pick-server.ts와 동일한 인터페이스 제공.
 */
export declare class AndroidPickServer {
    private controller;
    private server;
    private screenSize;
    private dashboardPort;
    private scenarioId;
    private lastPickResult;
    constructor(controller: any);
    start(port?: number, dashboardPort?: number, scenarioId?: string): Promise<{
        url: string;
        port: number;
    }>;
    stop(): Promise<void>;
    private handleScreenshot;
    /**
     * 좌표를 받아서 UIAutomator dump에서 해당 위치의 요소를 찾고 셀렉터 생성
     */
    private handlePick;
    /**
     * 선택된 셀렉터를 대시보드에 전송
     */
    private handleApply;
    private readBody;
    private serveHTML;
}
