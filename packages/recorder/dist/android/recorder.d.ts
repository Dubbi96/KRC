import type { RecordingScenario, RecordingEvent, RecordingConfig } from '../types';
import { FileStorage } from '../storage/file-storage';
export declare class AndroidRecorder {
    private deviceId;
    private config;
    private scenario;
    private storage;
    private controller;
    private eventMonitor;
    private previousUIHierarchy;
    private eventBuffer;
    private stopping;
    private pendingEnrich;
    /** assertion diff용: 이전 tap의 after 스냅샷 (현재 tap의 before로 재사용) */
    private lastPageSourceSnapshot;
    /** assertion diff용: tap 직전에 swap된 before 스냅샷 */
    private snapshotBeforeTap;
    constructor(deviceId: string, config?: RecordingConfig, storage?: FileStorage);
    start(): Promise<string>;
    private startEventMonitoring;
    private getUIHierarchy;
    recordEvent(event: RecordingEvent): void;
    /**
     * 마지막 녹화 이벤트에 요소 메타데이터 보강 + assertion 추천
     * tap 후 비동기로 호출하여 resource-id, content-desc, text 등을 기록하고,
     * UI 트리 diff 기반으로 assertion 후보를 생성한다.
     */
    enrichLastEventWithElement(x: number, y: number): Promise<void>;
    tap(x: number, y: number): Promise<void>;
    swipe(from: {
        x: number;
        y: number;
    }, to: {
        x: number;
        y: number;
    }, duration?: number): Promise<void>;
    type(text: string): Promise<void>;
    stop(): Promise<RecordingScenario>;
    getController(): any;
    getScenario(): RecordingScenario | null;
}
