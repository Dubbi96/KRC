import type { RecordingScenario, RecordingEvent, ReplayOptions, EventResult, TestResult, StepArtifacts } from '../types';
import { join } from 'path';
import { mkdirSync, existsSync, writeFileSync } from 'fs';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);
import { ResultCollector } from '../reporter/collector';
import { ReportGenerator } from '../reporter/generator';
import { VariableContext, resetSequences } from '../engine/variables';
import { AssertionEngine } from '../engine/assertions';
import {
  executeWaitForUser, executeApiRequest, executeSetVariable,
  executeRunScript, executeAssert, evaluatePostStepAssertions,
  executeImageMatch, type ExecutionContext
} from '../engine/step-executors';
import { normalizeTimestamps } from '../engine/timestamp-utils';

export class AndroidReplayer {
  private collector = new ResultCollector();
  private generator = new ReportGenerator();
  private currentDeviceId?: string;
  private currentPackage?: string;

  async replay(scenario: RecordingScenario, options: ReplayOptions = {}): Promise<TestResult> {
    const { speed = 1.0, delayBetweenEvents = 100, reportDir = './reports', stopOnFailure = true } = options;

    resetSequences();
    const variables = new VariableContext(scenario.variables);
    if (options.chainVariables) variables.merge(options.chainVariables);
    if (options.testDataSetName && scenario.testData) {
      const ds = scenario.testData.dataSets.find(d => d.name === options.testDataSetName);
      if (ds) variables.merge(ds.variables);
    }
    if (options.variables) variables.merge(options.variables);

    const assertionEngine = new AssertionEngine();
    const execCtx: ExecutionContext = {
      variables,
      assertionEngine,
      onWaitForUserStart: options.onWaitForUserStart,
      onWaitForUserEnd: options.onWaitForUserEnd,
    };

    this.collector.start(scenario.id, scenario.name, scenario.platform);

    let controller: any;
    try {
      const { AndroidController } = await import('@katab/device-manager');
      controller = new AndroidController(scenario.deviceId || '');
      this.currentDeviceId = scenario.deviceId;
      this.currentPackage = scenario.package;

      // 스크린샷 저장 디렉토리 생성
      const screenshotDir = join(reportDir, scenario.id, 'screenshots');
      if (!existsSync(screenshotDir)) mkdirSync(screenshotDir, { recursive: true });

      const events = scenario.events;
      if (events.length === 0) throw new Error('No events to replay');

      // timestamp 정규화: 역전/과대 gap 보정
      const tsFixed = normalizeTimestamps(events, { maxGap: 30000, defaultGap: 500 });
      if (tsFixed > 0) console.log(`[AndroidReplayer] timestamp 정규화: ${tsFixed}개 스텝 보정됨`);

      let prevTimestamp = events[0].timestamp;

      for (let i = 0; i < events.length; i++) {
        const event = events[i];
        if (event.disabled) {
          this.collector.addEventResult({ eventIndex: i, eventType: event.type, status: 'skipped', duration: 0, stepNo: event.stepNo, description: event.description });
          continue;
        }
        // wait_for_user, wait_for, wait 이벤트는 timestamp 기반 delay를 건너뜀
        if (i > 0 && event.type !== 'wait_for_user' && event.type !== 'wait_for' && event.type !== 'wait') {
          const wait = Math.max(0, (event.timestamp - prevTimestamp) / speed - delayBetweenEvents);
          if (wait > 0) await this.sleep(wait);
        }
        const result = await this.replayEvent(controller, event, i, execCtx, screenshotDir);
        this.collector.addEventResult(result);
        prevTimestamp = event.timestamp;
        if (result.status === 'failed' && stopOnFailure) break;
      }

      const testResult = this.collector.finish();
      testResult.variables = variables.getAll();
      testResult.tcId = scenario.tcId;
      testResult.testDataSetName = options.testDataSetName;
      const outDir = join(reportDir, scenario.id);
      this.generator.generateJSON(testResult, outDir);
      this.generator.generateHTML(testResult, outDir);
      return testResult;
    } catch (error: any) {
      const testResult = this.collector.finish(error.message, error.stack);
      testResult.variables = variables.getAll();
      const outDir = join(reportDir, scenario.id);
      this.generator.generateJSON(testResult, outDir);
      this.generator.generateHTML(testResult, outDir);
      return testResult;
    } finally {
      // Return to home screen after scenario completion (unless chain continues)
      if (controller && process.env.RETURN_TO_HOME !== 'false') {
        try {
          // Terminate the running app
          if (this.currentPackage) {
            await controller.stopApp(this.currentPackage);
            console.log(`[AndroidReplayer] Terminated app: ${this.currentPackage}`);
          }
          // Press Home button
          await controller.home();
          console.log('[AndroidReplayer] Returned to home screen');
        } catch (e: any) {
          console.warn(`[AndroidReplayer] Failed to return to home: ${e.message}`);
        }
      }
    }
  }

  private async replayEvent(controller: any, event: RecordingEvent, index: number, execCtx: ExecutionContext, screenshotDir?: string): Promise<EventResult> {
    const start = Date.now();
    const vars = execCtx.variables;
    try {
      let extraResult: Partial<EventResult> = {};
      let resolvedBy: string | undefined;

      switch (event.type) {
        case 'tap': {
          // 시맨틱 기반 탭: androidSelector → meta.element → 좌표 fallback
          if (event.androidSelector) {
            const tapped = await this.tapBySelector(controller, event.androidSelector);
            if (tapped) {
              resolvedBy = `android_selector:${event.androidSelector.strategy}=${event.androidSelector.value}`;
            } else if (event.coordinates) {
              await controller.tap(event.coordinates.x, event.coordinates.y);
              resolvedBy = `coordinate_fallback(${event.coordinates.x},${event.coordinates.y})`;
            } else {
              throw new Error(
                `Cannot find element by selector (${event.androidSelector.strategy}=${event.androidSelector.value}) and no coordinates available.`
              );
            }
          } else if (event.meta?.element && (event.meta.element.resourceId || event.meta.element.contentDesc || event.meta.element.text)) {
            // meta.element에서 셀렉터 정보를 활용하여 시맨틱 탭 시도
            const selector = this.elementToSelector(event.meta.element);
            if (selector) {
              const tapped = await this.tapBySelector(controller, selector);
              if (tapped) {
                resolvedBy = `element_meta:${selector.strategy}=${selector.value}`;
              } else if (event.coordinates) {
                await controller.tap(event.coordinates.x, event.coordinates.y);
                resolvedBy = `coordinate_fallback(${event.coordinates.x},${event.coordinates.y})`;
              } else {
                throw new Error('Cannot find element by meta selector and no coordinates available.');
              }
            } else if (event.coordinates) {
              await controller.tap(event.coordinates.x, event.coordinates.y);
              resolvedBy = `coordinate(${event.coordinates.x},${event.coordinates.y})`;
            } else {
              throw new Error('Cannot replay tap: no selector or coordinates.');
            }
          } else if (event.coordinates) {
            await controller.tap(event.coordinates.x, event.coordinates.y);
            resolvedBy = `coordinate(${event.coordinates.x},${event.coordinates.y})`;
          } else {
            throw new Error(
              'Cannot replay tap: no androidSelector, element metadata, or coordinates. ' +
              'Re-record this scenario using mirror mode (--mirror).'
            );
          }
          break;
        }
        case 'swipe':
          if (event.from && event.to) {
            await controller.swipe({ from: event.from, to: event.to, duration: event.duration });
          } else {
            throw new Error('Cannot replay swipe: missing from/to coordinates.');
          }
          break;
        case 'type':
          if (event.text) await controller.type(vars.resolve(event.text));
          break;
        case 'longPress':
          if (event.coordinates) {
            await controller.longPress(event.coordinates.x, event.coordinates.y, event.duration || 1000);
          } else {
            throw new Error('Cannot replay longPress: no coordinates.');
          }
          break;
        case 'home': await controller.home(); break;
        case 'back': await controller.back(); break;
        case 'clear_app': {
          const pkg = event.clearAppBundleId || this.currentPackage;
          const deviceId = this.currentDeviceId;
          if (!pkg) throw new Error('Cannot clear app: no package specified');
          if (!deviceId) throw new Error('Cannot clear app: no deviceId');
          await controller.stopApp(pkg);
          await this.sleep(1000);
          break;
        }
        case 'wait_for_user': extraResult = await executeWaitForUser(event, execCtx); break;
        case 'api_request': extraResult = await executeApiRequest(event, execCtx); break;
        case 'set_variable': extraResult = await executeSetVariable(event, execCtx); break;
        case 'run_script': extraResult = await executeRunScript(event, execCtx); break;
        case 'assert': {
          const ar = await executeAssert(event, execCtx);
          extraResult = { assertionResults: ar.assertionResults, error: ar.error };
          break;
        }
        case 'image_match':
          extraResult = await executeImageMatch(event, execCtx);
          break;
        // 구조 마커: 블록 컨테이너 (실행 없음)
        case 'block_start':
        case 'block_end':
        // 구조 마커: 반복/조건 (Android replayer는 단일 step 실행이므로 noop)
        case 'for_each_start':
        case 'for_each_end':
        case 'if_start':
        case 'if_end':
          break;
      }

      const assertionResults = await evaluatePostStepAssertions(event, execCtx);
      const assertFailed = assertionResults.some(r => !r.passed && !r.assertion.optional);
      const hasError = extraResult.error || assertFailed;

      // ─── afterStep: 증거 수집 (screenshot) ───
      const artifacts = await this.collectStepArtifacts(controller, event, hasError);
      const screenshot = this.saveScreenshotToFile(artifacts, screenshotDir, index, hasError);

      return {
        eventIndex: index, eventType: event.type, status: hasError ? 'failed' : 'passed',
        duration: Date.now() - start, stepNo: event.stepNo, description: event.description,
        error: extraResult.error || (assertFailed ? assertionResults.filter(r => !r.passed).map(r => r.error).join('; ') : undefined),
        assertionResults: assertionResults.length > 0 ? assertionResults : extraResult.assertionResults,
        apiResponse: extraResult.apiResponse, capturedVariables: extraResult.capturedVariables,
        resolvedBy,
        artifacts,
        screenshot,
      };
    } catch (error: any) {
      const artifacts = await this.collectStepArtifacts(controller, event, true).catch(() => undefined);
      const screenshot = this.saveScreenshotToFile(artifacts, screenshotDir, index, true);
      return { eventIndex: index, eventType: event.type, status: 'failed', duration: Date.now() - start, error: error.message, stepNo: event.stepNo, description: event.description, artifacts, screenshot };
    }
  }

  // ─── 시맨틱 탭: androidSelector로 요소를 찾아 클릭 ──────

  /**
   * androidSelector로 UIAutomator dump에서 요소를 찾아 중심 좌표로 탭한다.
   * 성공 시 true, 실패 시 false (좌표 fallback 필요)
   */
  private async tapBySelector(
    controller: any,
    selector: { strategy: string; value: string }
  ): Promise<boolean> {
    try {
      const xml = await controller.getPageSource();
      if (!xml) return false;

      const { parsePageSource, findElementBySelector } = await import('./page-source-utils');
      const elements = parsePageSource(xml);
      const found = findElementBySelector(elements, selector as any);
      if (!found) return false;

      // 요소 중심 좌표로 탭
      const centerX = found.bounds.x + Math.round(found.bounds.width / 2);
      const centerY = found.bounds.y + Math.round(found.bounds.height / 2);
      await controller.tap(centerX, centerY);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * meta.element에서 최적의 androidSelector를 생성한다.
   * 우선순위: resource-id > content-desc > text
   */
  private elementToSelector(element: any): { strategy: string; value: string } | null {
    if (element.resourceId) {
      return { strategy: 'resource_id', value: element.resourceId };
    }
    if (element.contentDesc) {
      return { strategy: 'content_desc', value: element.contentDesc };
    }
    if (element.text) {
      return { strategy: 'text', value: element.text };
    }
    return null;
  }

  // ─── afterStep: 증거 수집 (screenshot) ────

  /**
   * 매 스텝 실행 후 스크린샷을 수집하여 디버깅 증거로 남긴다.
   * - 모든 UI 관련 스텝에서 수집 (report 시각적 증거용)
   * - set_variable, run_script, api_request 등 UI 없는 스텝은 스킵
   */
  private async collectStepArtifacts(
    controller: any,
    event: RecordingEvent,
    hasError: boolean | string | undefined
  ): Promise<StepArtifacts | undefined> {
    const noUITypes = new Set(['set_variable', 'run_script', 'api_request']);
    if (noUITypes.has(event.type) && !hasError) return undefined;

    const artifacts: StepArtifacts = { timestamp: Date.now() };

    try {
      const screenshotBase64 = await controller.screenshot?.();
      if (screenshotBase64) {
        artifacts.screenshotBase64 = screenshotBase64;
      }
    } catch {
      // 스크린샷 실패는 무시
    }

    try {
      const xml = await controller.getPageSource?.();
      if (xml && typeof xml === 'string') {
        artifacts.pageSourceXml = xml;
      }
    } catch {
      // pageSource 실패는 무시
    }

    return artifacts;
  }

  /**
   * artifacts의 base64 스크린샷을 파일로 저장하고 경로를 반환한다.
   */
  private saveScreenshotToFile(
    artifacts: StepArtifacts | undefined,
    screenshotDir: string | undefined,
    index: number,
    hasError: boolean | string | undefined
  ): string | undefined {
    if (!artifacts?.screenshotBase64 || !screenshotDir) return undefined;

    try {
      const stepNum = String(index + 1).padStart(3, '0');
      const suffix = hasError ? '_error' : '';
      const filename = `step_${stepNum}${suffix}.png`;
      const filePath = join(screenshotDir, filename);
      writeFileSync(filePath, Buffer.from(artifacts.screenshotBase64, 'base64'));
      return filePath;
    } catch {
      return undefined;
    }
  }

  private sleep(ms: number): Promise<void> { return new Promise(r => setTimeout(r, ms)); }
}
