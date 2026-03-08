/**
 * EventBuffer
 *
 * 녹화 이벤트를 버퍼링하고 디바운스/배치 방식으로 flush한다.
 * 매 이벤트마다 saveScenario()를 호출하는 대신,
 * 일정 시간 간격 또는 배치 크기에 도달했을 때만 실제 저장을 수행한다.
 *
 * 안전성:
 * - 저장 성공이 확인된 후에만 버퍼를 비운다 (데이터 유실 방지)
 * - 연속 실패 시 카운터를 추적하고 로그를 남긴다
 * - destroy() 시 남은 버퍼를 반드시 flush 시도한다
 */
import type { RecordingEvent } from '../types';
export declare class EventBuffer {
    private flushFn;
    private debounceMs;
    private batchSize;
    private buffer;
    private flushTimer;
    private flushPromise;
    private destroyed;
    private consecutiveFailures;
    /**
     * @param flushFn 버퍼에 쌓인 이벤트를 실제 저장하는 함수
     * @param debounceMs 디바운스 간격 (ms). 마지막 이벤트 후 이 시간이 지나면 flush
     * @param batchSize 배치 크기. 버퍼가 이 수에 도달하면 즉시 flush
     */
    constructor(flushFn: () => Promise<void>, debounceMs?: number, batchSize?: number);
    /**
     * 이벤트를 버퍼에 추가한다.
     * 배치 크기 도달 시 즉시 flush, 아니면 디바운스 flush 예약.
     */
    push(event: RecordingEvent): void;
    /** 현재 버퍼에 쌓인 이벤트 수 */
    get pendingCount(): number;
    /** 연속 저장 실패 횟수 */
    get failureCount(): number;
    /**
     * 버퍼의 이벤트를 즉시 flush한다.
     * 이미 flush 중이면 기존 Promise에 체이닝한다.
     */
    flush(): Promise<void>;
    /**
     * 남은 버퍼를 flush하고 버퍼를 비활성화한다.
     * stop/pause 등 상태 전환 시 호출한다.
     */
    destroy(): Promise<void>;
    private scheduleFlush;
    private cancelScheduledFlush;
    private doFlush;
}
