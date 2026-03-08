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

export class EventBuffer {
  private buffer: RecordingEvent[] = [];
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private flushPromise: Promise<void> | null = null;
  private destroyed = false;
  private consecutiveFailures = 0;

  /**
   * @param flushFn 버퍼에 쌓인 이벤트를 실제 저장하는 함수
   * @param debounceMs 디바운스 간격 (ms). 마지막 이벤트 후 이 시간이 지나면 flush
   * @param batchSize 배치 크기. 버퍼가 이 수에 도달하면 즉시 flush
   */
  constructor(
    private flushFn: () => Promise<void>,
    private debounceMs: number = 500,
    private batchSize: number = 30,
  ) {}

  /**
   * 이벤트를 버퍼에 추가한다.
   * 배치 크기 도달 시 즉시 flush, 아니면 디바운스 flush 예약.
   */
  push(event: RecordingEvent): void {
    if (this.destroyed) return;

    this.buffer.push(event);

    if (this.buffer.length >= this.batchSize) {
      this.flush();
    } else {
      this.scheduleFlush();
    }
  }

  /** 현재 버퍼에 쌓인 이벤트 수 */
  get pendingCount(): number {
    return this.buffer.length;
  }

  /** 연속 저장 실패 횟수 */
  get failureCount(): number {
    return this.consecutiveFailures;
  }

  /**
   * 버퍼의 이벤트를 즉시 flush한다.
   * 이미 flush 중이면 기존 Promise에 체이닝한다.
   */
  flush(): Promise<void> {
    if (this.buffer.length === 0 && !this.flushPromise) {
      return Promise.resolve();
    }

    this.cancelScheduledFlush();

    if (this.flushPromise) {
      // 이미 flush 중이면 완료 후 다시 flush
      this.flushPromise = this.flushPromise.then(() => this.doFlush());
    } else {
      this.flushPromise = this.doFlush();
    }

    return this.flushPromise;
  }

  /**
   * 남은 버퍼를 flush하고 버퍼를 비활성화한다.
   * stop/pause 등 상태 전환 시 호출한다.
   */
  async destroy(): Promise<void> {
    this.destroyed = true;
    this.cancelScheduledFlush();

    if (this.flushPromise) {
      await this.flushPromise;
    }

    if (this.buffer.length > 0) {
      await this.doFlush();
    }
  }

  private scheduleFlush(): void {
    this.cancelScheduledFlush();
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      this.flush();
    }, this.debounceMs);
  }

  private cancelScheduledFlush(): void {
    if (this.flushTimer !== null) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
  }

  private async doFlush(): Promise<void> {
    if (this.buffer.length === 0) {
      this.flushPromise = null;
      return;
    }

    // 저장 시도 — 이벤트는 이미 scenario.events에 push되어 있으므로
    // flushFn은 현재 scenario 전체를 저장한다.
    // 성공한 경우에만 버퍼를 비운다.
    try {
      await this.flushFn();
      // 저장 성공 — 버퍼 클리어
      this.buffer = [];
      this.consecutiveFailures = 0;
    } catch (err) {
      // 저장 실패 — 버퍼를 유지하여 다음 flush에서 재시도
      this.consecutiveFailures++;
      if (this.consecutiveFailures <= 3) {
        console.warn(`[EventBuffer] Save failed (attempt ${this.consecutiveFailures}):`, err);
      } else if (this.consecutiveFailures === 4) {
        console.error(`[EventBuffer] Repeated save failures. Suppressing further warnings.`);
      }
    } finally {
      this.flushPromise = null;
    }
  }
}
