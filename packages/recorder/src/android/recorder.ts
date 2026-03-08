import { randomUUID } from 'crypto';
import { exec } from 'child_process';
import { promisify } from 'util';
import type { RecordingScenario, RecordingEvent, RecordingConfig } from '../types';
import { FileStorage } from '../storage/file-storage';
import { EventBuffer } from '../web/event-buffer';
import { parsePageSource, diffUITrees } from './page-source-utils';
import { suggestAssertionsFromDiff } from './assertion-suggester';

const execAsync = promisify(exec);

export class AndroidRecorder {
  private scenario: RecordingScenario | null = null;
  private storage: FileStorage;
  private controller: any = null;
  private eventMonitor: ReturnType<typeof setInterval> | null = null;
  private previousUIHierarchy: string | null = null;
  private eventBuffer: EventBuffer | null = null;
  private stopping = false;
  private pendingEnrich: Promise<void> | null = null;

  /** assertion diff용: 이전 tap의 after 스냅샷 (현재 tap의 before로 재사용) */
  private lastPageSourceSnapshot: string | null = null;
  /** assertion diff용: tap 직전에 swap된 before 스냅샷 */
  private snapshotBeforeTap: string | null = null;

  constructor(
    private deviceId: string,
    private config: RecordingConfig = {},
    storage?: FileStorage
  ) {
    this.storage = storage || new FileStorage(config.outputDir);
  }

  async start(): Promise<string> {
    if (this.scenario) throw new Error('Recording already started');

    const scenarioId = randomUUID();
    const { AndroidController } = await import('@katab/device-manager');
    this.controller = new AndroidController(this.deviceId);

    // 디바이스 정보 수집
    const screenSize = await this.controller.getScreenSize().catch(() => ({ width: 1080, height: 1920 }));
    const currentActivity = await this.controller.getCurrentActivity().catch(() => null);

    this.scenario = {
      id: scenarioId,
      name: this.config.sessionName || `Android Recording - ${new Date().toISOString()}`,
      platform: 'android',
      deviceType: 'android',
      deviceId: this.deviceId,
      package: this.config.package || currentActivity?.package,
      appiumServerUrl: this.config.appiumServerUrl,
      metadata: {
        viewport: screenSize,
      },
      startedAt: Date.now(),
      events: [],
    };

    // 이벤트 버퍼 초기화: compact 모드로 저장하여 I/O 최적화
    this.eventBuffer = new EventBuffer(
      () => this.storage.saveScenario(this.scenario!, { compact: true }),
      500,  // 500ms 디바운스
      30,   // 30개 이벤트마다 즉시 flush
    );

    this.startEventMonitoring();
    return scenarioId;
  }

  private startEventMonitoring(): void {
    if (!this.controller || !this.scenario) return;

    let lastCheckTime = Date.now();
    let consecutiveChanges = 0;

    this.eventMonitor = setInterval(async () => {
      try {
        if (!this.controller || !this.scenario) return;
        const currentUI = await this.getUIHierarchy();
        if (!currentUI) return;

        const now = Date.now();
        const timeSinceLastChange = now - lastCheckTime;

        if (this.previousUIHierarchy && this.previousUIHierarchy !== currentUI) {
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

        this.previousUIHierarchy = currentUI;
      } catch {
        // ignore monitoring errors
      }
    }, 1000);
  }

  private async getUIHierarchy(): Promise<string | null> {
    try {
      const { stdout } = await execAsync(
        `adb -s ${this.deviceId} shell "uiautomator dump /sdcard/ui_dump.xml && cat /sdcard/ui_dump.xml"`,
        { timeout: 10000, maxBuffer: 5 * 1024 * 1024 }
      );
      const xmlStart = stdout.indexOf('<?xml');
      if (xmlStart >= 0) return stdout.substring(xmlStart);
      return null;
    } catch {
      return null;
    }
  }

  recordEvent(event: RecordingEvent): void {
    if (!this.scenario) return;
    this.scenario.events.push(event);
    this.eventBuffer?.push(event);
  }

  /**
   * 마지막 녹화 이벤트에 요소 메타데이터 보강 + assertion 추천
   * tap 후 비동기로 호출하여 resource-id, content-desc, text 등을 기록하고,
   * UI 트리 diff 기반으로 assertion 후보를 생성한다.
   */
  async enrichLastEventWithElement(x: number, y: number): Promise<void> {
    if (this.stopping || !this.controller || !this.scenario || this.scenario.events.length === 0) return;
    const enrichJob = (async () => {
      try {
        // 1) UIAutomator dump 가져오기 (after 스냅샷) + 좌표로 요소 찾기
        const pageSourceXml: string | null = await this.controller.getPageSource?.()
          ?? null;

        const element = await this.controller.findElementAtCoordinates(x, y);
        if (element && this.scenario) {
          const lastEvent = this.scenario.events[this.scenario.events.length - 1];
          if (!lastEvent.meta) lastEvent.meta = {};
          lastEvent.meta.element = {
            type: element.shortType,
            name: element.resourceId,
            accessibilityId: element.contentDesc,
            textContent: element.text,
            boundingBox: element.bounds,
            isEnabled: element.enabled,
          };

          // 2) UI 트리 diff 기반 assertion 추천
          if (pageSourceXml && this.snapshotBeforeTap) {
            try {
              const beforeElements = parsePageSource(this.snapshotBeforeTap);
              const afterElements = parsePageSource(pageSourceXml);
              const diff = diffUITrees(beforeElements, afterElements);

              const suggestions = suggestAssertionsFromDiff(diff, {
                type: element.type,
                shortType: element.shortType,
                resourceId: element.resourceId,
                contentDesc: element.contentDesc,
                text: element.text,
                enabled: element.enabled,
                clickable: element.clickable,
                bounds: element.bounds,
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

          // enrich 후 버퍼에 flush 트리거
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

    // 이전 tap의 after 스냅샷을 현재 tap의 before로 swap
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

    // 5) 시나리오 최종 저장 — pretty print로 사람이 읽기 쉽게
    this.scenario.stoppedAt = Date.now();
    await this.storage.saveScenario(this.scenario);
    const scenario = this.scenario;
    this.scenario = null;
    this.previousUIHierarchy = null;
    this.lastPageSourceSnapshot = null;
    this.snapshotBeforeTap = null;
    this.stopping = false;
    this.controller = null;
    return scenario;
  }

  getController(): any { return this.controller; }
  getScenario(): RecordingScenario | null { return this.scenario; }
}
