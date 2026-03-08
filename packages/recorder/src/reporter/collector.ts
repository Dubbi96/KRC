import type { TestResult, EventResult, Platform } from '../types';

export class ResultCollector {
  private results: EventResult[] = [];
  private startTime = 0;
  private scenarioId = '';
  private scenarioName = '';
  private platform: Platform = 'web';

  start(scenarioId: string, scenarioName: string, platform: Platform): void {
    this.scenarioId = scenarioId;
    this.scenarioName = scenarioName;
    this.platform = platform;
    this.startTime = Date.now();
    this.results = [];
  }

  addEventResult(result: EventResult): void {
    this.results.push(result);
  }

  finish(error?: string, stackTrace?: string): TestResult {
    const completedAt = Date.now();
    const skipped = this.results.filter(r => r.status === 'skipped').length;
    const passed = this.results.filter(r => r.status === 'passed').length;
    const failed = this.results.filter(r => r.status === 'failed').length;

    // 어설션 요약 집계
    let assertTotal = 0, assertPassed = 0, assertFailed = 0;
    for (const ev of this.results) {
      if (ev.assertionResults && ev.assertionResults.length > 0) {
        for (const ar of ev.assertionResults) {
          assertTotal++;
          if (ar.passed) assertPassed++;
          else assertFailed++;
        }
      }
    }

    return {
      scenarioId: this.scenarioId,
      scenarioName: this.scenarioName,
      platform: this.platform,
      status: error ? 'failed' : this.results.every(r => r.status !== 'failed') ? 'passed' : 'failed',
      duration: completedAt - this.startTime,
      startedAt: this.startTime,
      completedAt,
      events: this.results,
      error,
      stackTrace,
      assertionsSummary: assertTotal > 0 ? { total: assertTotal, passed: assertPassed, failed: assertFailed } : undefined,
    };
  }
}
