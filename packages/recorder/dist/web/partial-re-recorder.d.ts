/**
 * 부분 다시 녹화 오케스트레이터
 *
 * 시나리오의 특정 구간(fromIndex ~ toIndex)만 다시 녹화한다.
 * 1. 이전 스텝(0 ~ fromIndex-1)을 WebReplayer로 재생하여 브라우저를 올바른 상태로 이동
 * 2. 브라우저를 닫지 않고 Recording 모드로 전환
 * 3. 사용자가 새 동작을 녹화
 * 4. 녹화 중지 → 합치기: [prefix events] + [new events] + [suffix events]
 */
import { FileStorage } from '../storage/file-storage';
export interface PartialReRecordConfig {
    scenarioId: string;
    replaceFromIndex: number;
    replaceToIndex: number;
    scenarioDir: string;
    authProfileId?: string;
    onStatus?: (status: PartialReRecordStatus) => void;
}
export interface PartialReRecordStatus {
    phase: 'loading' | 'replaying' | 'recording' | 'stopping' | 'done' | 'error';
    replayProgress?: {
        current: number;
        total: number;
    };
    message?: string;
}
export declare class PartialReRecorder {
    private storage;
    private browser;
    private context;
    private page;
    private recorder;
    private config;
    private originalScenario;
    private prefixEvents;
    private suffixEvents;
    constructor(storage: FileStorage);
    start(config: PartialReRecordConfig): Promise<void>;
    stop(): Promise<{
        scenarioId: string;
        newEventsCount: number;
        status: 'done';
    }>;
    private cleanup;
}
