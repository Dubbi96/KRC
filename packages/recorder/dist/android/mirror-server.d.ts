import type { AndroidRecorder } from './recorder';
/**
 * Android 미러링 서버
 * ADB 스크린샷을 브라우저에 실시간 표시하고,
 * 클릭/스와이프/타이핑을 캡처하여 recorder에 전달
 */
export declare class AndroidMirrorServer {
    private recorder;
    private controller;
    private server;
    private screenSize;
    private actionInProgress;
    constructor(recorder: AndroidRecorder, controller: any);
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
