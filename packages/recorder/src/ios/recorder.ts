import { randomUUID } from 'crypto';
import type { RecordingScenario, RecordingEvent, RecordingConfig } from '../types';
import { FileStorage } from '../storage/file-storage';
import { EventBuffer } from '../web/event-buffer';
import { parsePageSource, diffUITrees } from './page-source-utils';
import { suggestAssertionsFromDiff } from './assertion-suggester';

export class IOSRecorder {
  private scenario: RecordingScenario | null = null;
  private storage: FileStorage;
  private controller: any = null;
  private eventMonitor: ReturnType<typeof setInterval> | null = null;
  private previousPageSource: string | null = null;
  private stopping = false;
  private pendingEnrich: Promise<void> | null = null;
  private eventBuffer: EventBuffer | null = null;

  /** assertion diff용: 이전 tap의 after 스냅샷 (현재 tap의 before로 재사용) */
  private lastPageSourceSnapshot: string | null = null;
  /** assertion diff용: tap 직전에 swap된 before 스냅샷 */
  private snapshotBeforeTap: string | null = null;

  constructor(
    private udid: string,
    private config: RecordingConfig = {},
    storage?: FileStorage
  ) {
    this.storage = storage || new FileStorage(config.outputDir);
  }

  /** IOSController 인스턴스 접근 (미러 서버용) */
  getController(): any { return this.controller; }

  async start(): Promise<string> {
    if (this.scenario) throw new Error('Recording already started');

    const scenarioId = randomUUID();
    const appiumServerUrl = this.config.appiumServerUrl || 'http://localhost:4723';

    const { IOSController } = await import('@katab/device-manager');
    this.controller = new IOSController(this.udid, appiumServerUrl, this.config.controlOptions || {});
    await this.controller.createSession(this.config.bundleId);

    this.scenario = {
      id: scenarioId,
      name: this.config.sessionName || `iOS Recording - ${new Date().toISOString()}`,
      platform: 'ios',
      deviceType: 'ios',
      udid: this.udid,
      bundleId: this.config.bundleId,
      appiumServerUrl,
      startedAt: Date.now(),
      events: [],
    };

    // 이벤트 버퍼 초기화: compact 모드로 저장하여 I/O 최적화
    this.eventBuffer = new EventBuffer(
      () => this.storage.saveScenario(this.scenario!, { compact: true }),
      500,  // 500ms 디바운스
      30,   // 30개 이벤트마다 즉시 flush
    );

    // 미러 모드에서는 폴링 모니터링 불필요 (미러 UI에서 직접 조작)
    if (!this.config.mirror) {
      this.startEventMonitoring();
    }
    return scenarioId;
  }

  private startEventMonitoring(): void {
    if (!this.controller || !this.scenario) return;

    let lastCheckTime = Date.now();
    let consecutiveChanges = 0;

    this.eventMonitor = setInterval(async () => {
      try {
        if (!this.controller || !this.scenario) return;
        const sessionId = this.controller.currentSessionId;
        if (!sessionId) return;

        const { executeAppiumAction } = await import('@katab/device-manager');
        const currentPageSource = await executeAppiumAction(
          this.controller.serverUrl, sessionId, 'source', {}
        ).catch(() => null);
        if (!currentPageSource) return;

        const sourceStr = JSON.stringify(currentPageSource);
        const now = Date.now();
        const timeSinceLastChange = now - lastCheckTime;

        if (this.previousPageSource && this.previousPageSource !== sourceStr) {
          consecutiveChanges++;
          lastCheckTime = now;

          let eventType: RecordingEvent['type'] = 'tap';
          if (consecutiveChanges > 1 && timeSinceLastChange < 500) eventType = 'swipe';

          this.recordEvent({
            type: eventType,
            timestamp: now,
            meta: { source: 'device_direct_interaction' },
          });
        } else if (consecutiveChanges > 0 && timeSinceLastChange > 1000) {
          consecutiveChanges = 0;
        }

        this.previousPageSource = sourceStr;
      } catch (error: any) {
        if (error.message?.includes('invalid session') || error.message?.includes('session not found')) {
          this.stop().catch(() => {});
        }
      }
    }, 1000);
  }

  recordEvent(event: RecordingEvent): void {
    if (!this.scenario) return;
    this.scenario.events.push(event);
    this.eventBuffer?.push(event);
  }

  /**
   * 마지막 녹화 이벤트에 요소 메타데이터 보강 + assertion 추천
   * tap 후 비동기로 호출하여 accessibilityId, label, name 등을 기록하고,
   * UI 트리 diff 기반으로 assertion 후보를 생성한다.
   */
  async enrichLastEventWithElement(x: number, y: number): Promise<void> {
    if (this.stopping || !this.controller || !this.scenario || this.scenario.events.length === 0) return;
    const enrichJob = (async () => {
      try {
        // 1) pageSource 가져오기 (after 스냅샷) + 좌표로 요소 찾기
        const pageSourceXml: string | null = await this.controller.getPageSource?.()
          ?? null;

        const element = await this.controller.findElementAtCoordinates(x, y);
        if (element && this.scenario) {
          const lastEvent = this.scenario.events[this.scenario.events.length - 1];
          if (!lastEvent.meta) lastEvent.meta = {};
          lastEvent.meta.element = {
            type: element.type,
            label: element.label,
            name: element.name,
            accessibilityId: element.accessibilityId,
          };

          // 2) UI 트리 diff 기반 assertion 추천
          if (pageSourceXml && this.snapshotBeforeTap) {
            try {
              const beforeElements = parsePageSource(this.snapshotBeforeTap);
              const afterElements = parsePageSource(pageSourceXml);
              const diff = diffUITrees(beforeElements, afterElements);

              const suggestions = suggestAssertionsFromDiff(diff, {
                type: element.type,
                label: element.label,
                name: element.name,
                accessibilityId: element.accessibilityId,
              });

              if (suggestions.length > 0) {
                lastEvent.meta.suggestedAssertions = suggestions;
              }
            } catch {
              // diff/추천 실패는 무시 (보조 기능)
            }
          }

          // 3) 현재 pageSource를 다음 tap의 before로 캐시
          if (pageSourceXml) {
            this.lastPageSourceSnapshot = pageSourceXml;
          }

          // enrich 후 버퍼에 flush 트리거 (이벤트가 이미 수정되었으므로)
          this.eventBuffer?.flush();
        }
      } catch {
        // 요소 찾기 실패는 무시 (보조 정보일 뿐)
      } finally {
        this.pendingEnrich = null;
        this.snapshotBeforeTap = null;
      }
    })();
    this.pendingEnrich = enrichJob;
    return enrichJob;
  }

  async tap(x: number, y: number): Promise<void> {
    if (!this.controller) throw new Error('Recording not started');

    // 이전 tap의 after 스냅샷을 현재 tap의 before로 swap (추가 pageSource 호출 없음)
    this.snapshotBeforeTap = this.lastPageSourceSnapshot;

    await this.controller.tap(x, y);
    this.recordEvent({ type: 'tap', timestamp: Date.now(), coordinates: { x, y }, meta: { source: 'programmatic' } });
  }

  async swipe(from: { x: number; y: number }, to: { x: number; y: number }, duration?: number): Promise<void> {
    if (!this.controller) throw new Error('Recording not started');
    await this.controller.swipe({ from, to, duration });
    this.recordEvent({ type: 'swipe', timestamp: Date.now(), from, to, duration, meta: { source: 'programmatic' } });
  }

  async type(text: string): Promise<void> {
    if (!this.controller) throw new Error('Recording not started');
    await this.controller.type(text);
    this.recordEvent({ type: 'type', timestamp: Date.now(), text, meta: { source: 'programmatic' } });
  }

  async stop(): Promise<RecordingScenario> {
    if (!this.scenario) throw new Error('No active recording');

    // 1) 더 이상 새 작업 수락 안 함
    this.stopping = true;

    // 2) 모니터링 중단
    if (this.eventMonitor) { clearInterval(this.eventMonitor); this.eventMonitor = null; }

    // 3) 진행 중인 enrich 대기 (최대 2초)
    if (this.pendingEnrich) {
      await Promise.race([this.pendingEnrich, new Promise(r => setTimeout(r, 2000))]);
      this.pendingEnrich = null;
    }

    // 4) 버퍼에 남은 이벤트를 모두 flush
    if (this.eventBuffer) {
      await this.eventBuffer.destroy();
      this.eventBuffer = null;
    }

    // 5) Appium 세션 종료 (최대 5초 타임아웃)
    if (this.controller) {
      await Promise.race([
        this.controller.closeSession().catch(() => {}),
        new Promise(r => setTimeout(r, 5000)),
      ]);
      this.controller = null;
    }

    // 6) 시나리오 최종 저장 — pretty print로 사람이 읽기 쉽게
    this.scenario.stoppedAt = Date.now();
    await this.storage.saveScenario(this.scenario);
    const scenario = this.scenario;
    this.scenario = null;
    this.previousPageSource = null;
    this.lastPageSourceSnapshot = null;
    this.snapshotBeforeTap = null;
    this.stopping = false;
    return scenario;
  }

  getScenario(): RecordingScenario | null { return this.scenario; }
}
