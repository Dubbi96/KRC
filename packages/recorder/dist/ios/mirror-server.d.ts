import type { IOSRecorder } from './recorder';
/**
 * iOS 미러링 서버
 * 디바이스 스크린샷을 브라우저에 실시간 표시하고,
 * 클릭/스와이프/타이핑을 캡처하여 recorder에 전달
 */
export declare class IOSMirrorServer {
    private recorder;
    private controller;
    private server;
    private viewportSize;
    private actionInProgress;
    constructor(recorder: IOSRecorder, controller: any);
    start(port?: number): Promise<{
        url: string;
        port: number;
    }>;
    stop(): Promise<void>;
    private handleScreenshot;
    private handleAction;
    private readBody;
    private serveHTML;
}
