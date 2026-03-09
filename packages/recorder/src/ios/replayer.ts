import type { RecordingScenario, RecordingEvent, ReplayOptions, EventResult, TestResult, StepArtifacts } from '../types';
import { join } from 'path';
import { mkdirSync, existsSync, writeFileSync } from 'fs';
import { ResultCollector } from '../reporter/collector';
import { ReportGenerator } from '../reporter/generator';
import { VariableContext, resetSequences } from '../engine/variables';
import { AssertionEngine } from '../engine/assertions';
import {
  executeWaitForUser, executeApiRequest, executeSetVariable,
  executeRunScript, executeAssert, evaluatePostStepAssertions,
  executeWaitFor, executeImageMatch, executeCheckEmail, evaluateIfCondition,
  type ExecutionContext
} from '../engine/step-executors';
import { parsePageSource } from './page-source-utils';
import { NetworkLogCollector } from '../engine/network-collector';
import { normalizeTimestamps } from '../engine/timestamp-utils';

export class IOSReplayer {
  private collector = new ResultCollector();
  private generator = new ReportGenerator();
  private currentBundleId?: string;
  private networkCollector?: NetworkLogCollector;

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

    // ─── 네트워크 로그 수집기 초기화 ───
    this.networkCollector = new NetworkLogCollector();
    if (options.networkLogFile) {
      this.networkCollector.watchMitmproxyLog(options.networkLogFile);
    }
    if (options.networkHarFile) {
      this.networkCollector.importHar(options.networkHarFile);
    }

    const assertionEngine = new AssertionEngine();
    const execCtx: ExecutionContext = {
      variables,
      assertionEngine,
      onWaitForUserStart: options.onWaitForUserStart,
      onWaitForUserEnd: options.onWaitForUserEnd,
    };

    this.collector.start(scenario.id, scenario.name, scenario.platform);

    const { IOSController } = await import('@katab/device-manager');
    const controller = new IOSController(
      scenario.udid || '', scenario.appiumServerUrl || 'http://localhost:4723', {}
    );

    // If a standby session exists (from KRC device connect), reuse it instead of creating new WDA
    const reusingSession = !!scenario.existingAppiumSessionId;

    try {
      if (reusingSession) {
        console.log(`[IOSReplayer] Reusing standby Appium session: ${scenario.existingAppiumSessionId}`);
        controller.attachSession(scenario.existingAppiumSessionId!);
        // Activate the target app if bundleId is specified
        if (scenario.bundleId) {
          try {
            const { executeAppiumAction } = await import('@katab/device-manager');
            await executeAppiumAction(
              scenario.appiumServerUrl || 'http://localhost:4723',
              scenario.existingAppiumSessionId!,
              'appium/device/activate_app',
              { bundleId: scenario.bundleId },
            );
          } catch (e: any) {
            console.warn(`[IOSReplayer] activate_app failed (non-fatal): ${e.message}`);
          }
        }
      } else {
        await controller.createSession(scenario.bundleId);
      }

      // iOS assertion 평가를 위해 controller를 execCtx에 전달
      execCtx.iosController = controller;
      // Appium 세션 keep-alive: wait_for_user 중 newCommandTimeout 방지
      execCtx.appiumKeepAlive = async () => {
        try { await controller.getPageSource(); } catch { /* ignore */ }
      };
      this.currentBundleId = scenario.bundleId;

      // 스크린샷 저장 디렉토리 생성
      const screenshotDir = join(reportDir, scenario.id, 'screenshots');
      if (!existsSync(screenshotDir)) mkdirSync(screenshotDir, { recursive: true });

      const events = scenario.events;
      if (events.length === 0) throw new Error('No events to replay');

      // timestamp 정규화: 역전/과대 gap 보정
      const tsFixed = normalizeTimestamps(events, { maxGap: 30000, defaultGap: 500 });
      if (tsFixed > 0) console.log(`[IOSReplayer] timestamp 정규화: ${tsFixed}개 스텝 보정됨`);

      let prevTimestamp = events[0].timestamp;
      let lastPageSource: string | undefined;

      for (let i = 0; i < events.length; i++) {
        const event = events[i];
        if (event.disabled) {
          this.collector.addEventResult({ eventIndex: i, eventType: event.type, status: 'skipped', duration: 0, stepNo: event.stepNo, description: event.description });
          continue;
        }

        // ─── if 조건 분기 처리 ───
        if (event.type === 'if_start') {
          // pageSource를 최신 상태로 갱신 (조건 평가 정확도 향상)
          try { lastPageSource = await controller.getPageSource() || undefined; } catch { /* 무시 */ }
          execCtx.lastIOSPageSource = lastPageSource;

          const conditionMet = await evaluateIfCondition(event, execCtx);
          const condDesc = event.ifCondition
            ? `${event.ifCondition.conditionType}: ${event.ifCondition.iosSelector?.value || event.ifCondition.selector || event.ifCondition.variable || ''}`
            : '';
          console.log(`[IOSReplayer] Step ${event.stepNo}: if 조건 평가 (${condDesc}) → ${conditionMet ? 'TRUE' : 'FALSE'}`);

          this.collector.addEventResult({
            eventIndex: i, eventType: 'if_start', status: 'passed', duration: 0,
            stepNo: event.stepNo, description: `${event.description || 'if'} [${conditionMet ? '조건 충족' : '조건 미충족 → 스킵'}]`,
          });
          prevTimestamp = event.timestamp;

          if (!conditionMet) {
            // 조건 미충족: if_end까지 모든 스텝 스킵
            const endIdx = this.findMatchingEnd(events, i, 'if_start', 'if_end');
            for (let skip = i + 1; skip < endIdx; skip++) {
              this.collector.addEventResult({
                eventIndex: skip, eventType: events[skip].type, status: 'skipped', duration: 0,
                stepNo: events[skip].stepNo, description: events[skip].description || '(if 조건 미충족 스킵)',
              });
            }
            // if_end 마커 기록
            this.collector.addEventResult({
              eventIndex: endIdx, eventType: 'if_end', status: 'passed', duration: 0,
              stepNo: events[endIdx].stepNo, description: events[endIdx].description || 'if 종료',
            });
            i = endIdx;
          }
          continue;
        }
        if (event.type === 'if_end') {
          this.collector.addEventResult({
            eventIndex: i, eventType: 'if_end', status: 'passed', duration: 0,
            stepNo: event.stepNo, description: event.description || 'if 종료',
          });
          prevTimestamp = event.timestamp;
          continue;
        }

        // wait_for_user, wait_for, wait 이벤트는 timestamp 기반 delay를 건너뜀
        if (i > 0 && event.type !== 'wait_for_user' && event.type !== 'wait_for' && event.type !== 'wait') {
          const wait = Math.max(0, (event.timestamp - prevTimestamp) / speed - delayBetweenEvents);
          if (wait > 0) {
            // 10초 이상 대기 시 WDA keep-alive ping (WDA 유휴 타임아웃 방지)
            if (wait > 10000) {
              const chunks = Math.ceil(wait / 10000);
              const chunkTime = wait / chunks;
              for (let c = 0; c < chunks; c++) {
                await this.sleep(chunkTime);
                if (c < chunks - 1) {
                  try { await controller.getWindowSize(); } catch { /* keep-alive ping 실패 무시 */ }
                }
              }
            } else {
              await this.sleep(wait);
            }
          }
        }
        // 매 스텝 전에 네트워크 로그 스냅샷을 execCtx에 갱신
        if (this.networkCollector) {
          execCtx.networkLogs = this.networkCollector.snapshot();
        }
        // ios_screen_changed를 위해 이전 pageSource를 execCtx에 설정
        execCtx.lastIOSPageSource = lastPageSource;

        // wait_for_user 이벤트는 즉시 실행
        const result = await this.replayEvent(controller, event, i, execCtx, screenshotDir);
        this.collector.addEventResult(result);
        prevTimestamp = event.timestamp;

        // ─── UI 액션 후 안정화 대기 ───
        // tap, type, swipe 등 UI 변경 액션 실행 후, 화면이 안정될 때까지 대기
        // 편집된 시나리오의 timestamp gap이 부정확해도 안전하게 동작
        const UI_ACTION_TYPES = new Set(['tap', 'type', 'swipe', 'scroll']);
        if (result.status === 'passed' && UI_ACTION_TYPES.has(event.type)) {
          await this.waitForUISettle(controller, lastPageSource, 500, 3000);
        }

        // 스텝 실행 후: 현재 pageSource를 다음 스텝의 "이전"으로 저장
        // artifacts에서 이미 수집된 경우 재활용, 아니면 새로 수집
        if (result.artifacts?.pageSourceXml) {
          lastPageSource = result.artifacts.pageSourceXml;
        } else {
          try { lastPageSource = await controller.getPageSource() || undefined; } catch { /* 무시 */ }
        }

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
      this.networkCollector?.destroy();
      // Don't close the session if reusing standby — WDA must stay running
      if (!reusingSession) {
        await controller.closeSession().catch(() => {});
      } else {
        console.log('[IOSReplayer] Keeping standby session alive (not closing WDA)');
        // Return to home screen after scenario completion (unless chain continues)
        if (process.env.RETURN_TO_HOME !== 'false') {
          try {
            // Terminate the running app
            if (this.currentBundleId && scenario.existingAppiumSessionId) {
              const { executeAppiumAction } = await import('@katab/device-manager');
              await executeAppiumAction(
                scenario.appiumServerUrl || 'http://localhost:4723',
                scenario.existingAppiumSessionId,
                'appium/device/terminate_app',
                { bundleId: this.currentBundleId },
              );
              console.log(`[IOSReplayer] Terminated app: ${this.currentBundleId}`);
            }
            // Press Home button
            await controller.home();
            console.log('[IOSReplayer] Returned to home screen');
          } catch (e: any) {
            console.warn(`[IOSReplayer] Failed to return to home: ${e.message}`);
          }
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
        case 'wait': {
          await this.sleep(event.duration || 1000);
          break;
        }
        case 'tap': {
          // 키보드 키 (meta.element.type === "Key")는 iosSelector를 무시하고 좌표/bounds로 탭
          // Appium element find가 키보드 키에 대해 매우 느리거나 멈추기 때문
          const isKeyboardKey = event.meta?.element?.type === 'Key';
          if (isKeyboardKey) {
            const el = event.meta!.element! as any;
            // 유효한 좌표가 있으면 좌표 사용, 없으면 bounds 중앙 계산
            const hasValidCoords = event.coordinates && (event.coordinates.x !== 0 || event.coordinates.y !== 0);
            if (hasValidCoords) {
              await controller.tap(event.coordinates!.x, event.coordinates!.y);
              resolvedBy = `keyboard_key_coord(${event.coordinates!.x},${event.coordinates!.y})`;
            } else if (el.bounds) {
              const cx = Math.round(el.bounds.x + el.bounds.width / 2);
              const cy = Math.round(el.bounds.y + el.bounds.height / 2);
              console.log(`[IOSReplayer] Step ${event.stepNo}: 키보드 키 "${el.name || el.label}" bounds 중앙 탭 (${cx},${cy})`);
              await controller.tap(cx, cy);
              resolvedBy = `keyboard_key_bounds(${cx},${cy})`;
            } else {
              throw new Error(`Keyboard key "${el.name || el.label}" has no valid coordinates or bounds.`);
            }
            console.log(`[IOSReplayer] Step ${event.stepNo} TAP resolved by: ${resolvedBy}`);
            break;
          }

          // 시맨틱 기반 탭: iosSelector → meta.element → 좌표
          // iosSelector가 명시적으로 설정된 경우 최우선 사용
          if (event.iosSelector) {
            const elementType = event.meta?.element?.type;
            const tapped = await this.tapBySelector(controller, event.iosSelector, { elementType, hintCoordinates: event.coordinates });
            if (tapped) {
              resolvedBy = `ios_selector:${event.iosSelector.strategy}=${event.iosSelector.value}`;
            } else if (event.coordinates) {
              console.warn(`[IOSReplayer] Step ${event.stepNo}: iosSelector 실패 (${event.iosSelector.strategy}=${event.iosSelector.value}), 좌표 fallback`);
              await controller.tap(event.coordinates.x, event.coordinates.y);
              resolvedBy = `coordinate_fallback(${event.coordinates.x},${event.coordinates.y})`;
            } else {
              throw new Error(
                `Cannot find element by selector (${event.iosSelector.strategy}=${event.iosSelector.value}) and no coordinates available.`
              );
            }
          } else if (event.meta?.element && (event.meta.element.accessibilityId || event.meta.element.name || event.meta.element.label)) {
            // meta.element에서 셀렉터 정보를 활용하여 시맨틱 탭 시도
            // 단, 좌표가 있고 meta.element가 모호한 경우(type이 Other이고 unique한 식별자 없음) 좌표 우선
            const el = event.meta.element;
            // 키보드 전체 요소 (UIKeyboardLayoutStar 등)는 개별 키가 아니므로 좌표 사용
            const isKeyboardContainer = !!(el.name && /^UIKeyboard/i.test(el.name));
            const isAmbiguous = isKeyboardContainer || (el.type === 'Other' && !el.accessibilityId && (
              (el.name && el.name === el.label) || // name과 label이 같으면 앱 자체일 가능성 높음
              (!el.name && !el.label)
            ));

            if (isAmbiguous && event.coordinates) {
              // 모호한 meta.element (앱 이름 등) → 좌표 직접 사용
              console.log(`[IOSReplayer] Step ${event.stepNo}: meta.element 모호 (type=Other, name="${el.name}"), 좌표 사용 (${event.coordinates.x},${event.coordinates.y})`);
              await controller.tap(event.coordinates.x, event.coordinates.y);
              resolvedBy = `coordinate_skip_ambiguous(${event.coordinates.x},${event.coordinates.y})`;
            } else {
              const selector = this.elementToSelector(el);
              if (selector) {
                console.log(`[IOSReplayer] Step ${event.stepNo}: meta.element 셀렉터 시도 (${selector.strategy}=${selector.value})`);
                const tapped = await this.tapBySelector(controller, selector);
                if (tapped) {
                  resolvedBy = `element_meta:${selector.strategy}=${selector.value}`;
                } else if (event.coordinates) {
                  console.warn(`[IOSReplayer] Step ${event.stepNo}: 셀렉터 실패, 좌표 fallback (${event.coordinates.x},${event.coordinates.y})`);
                  await controller.tap(event.coordinates.x, event.coordinates.y);
                  resolvedBy = `coordinate_fallback(${event.coordinates.x},${event.coordinates.y})`;
                } else {
                  await controller.tapElement(el);
                  resolvedBy = 'element_bounds_fallback';
                }
              } else {
                // 셀렉터 생성 불가 → 좌표 우선, 없으면 tapElement
                if (event.coordinates) {
                  await controller.tap(event.coordinates.x, event.coordinates.y);
                  resolvedBy = `coordinate_no_selector(${event.coordinates.x},${event.coordinates.y})`;
                } else {
                  await controller.tapElement(el);
                  resolvedBy = 'tapElement_legacy';
                }
              }
            }
          } else if (event.coordinates) {
            await controller.tap(event.coordinates.x, event.coordinates.y);
            resolvedBy = `coordinate(${event.coordinates.x},${event.coordinates.y})`;
          } else {
            throw new Error(
              'Cannot replay tap: no iosSelector, element metadata, or coordinates. ' +
              'Re-record this scenario using mirror mode (--mirror).'
            );
          }
          console.log(`[IOSReplayer] Step ${event.stepNo} TAP resolved by: ${resolvedBy}`);
          break;
        }
        case 'swipe':
        case 'scroll':
          if (event.from && event.to) {
            await controller.swipe({ from: event.from, to: event.to, duration: event.duration });
          } else {
            throw new Error(
              'Cannot replay swipe/scroll: missing from/to coordinates. ' +
              'Re-record this scenario using mirror mode (--mirror).'
            );
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
          const bundleId = event.clearAppBundleId || this.currentBundleId;
          if (!bundleId) throw new Error('Cannot clear app: no bundleId specified');
          // Close only (avoid uninstall/clear fallback). Keep app terminated.
          await controller.stopApp(bundleId);
          await this.sleep(1000);
          break;
        }
        case 'wait_for_user':
          // wait_for_user 이벤트 즉시 실행 (디버깅용)
          extraResult = await executeWaitForUser(event, execCtx);
          break;
        case 'api_request': {
          extraResult = await executeApiRequest(event, execCtx);
          // api_request 결과를 네트워크 로그에도 등록
          if (this.networkCollector && extraResult.apiResponse) {
            const resp = extraResult.apiResponse;
            this.networkCollector.add({
              url: vars.resolve(event.apiRequest?.url || ''),
              method: event.apiRequest?.method,
              status: resp.status || 0,
              contentType: resp.headers?.['content-type'] || '',
              contentLength: -1,
              timestamp: Date.now(),
              duration: resp.duration,
              responseBody: typeof resp.body === 'string'
                ? resp.body
                : JSON.stringify(resp.body),
            });
          }
          break;
        }
        case 'set_variable': extraResult = await executeSetVariable(event, execCtx); break;
        case 'run_script': extraResult = await executeRunScript(event, execCtx); break;
        case 'assert': {
          const ar = await executeAssert(event, execCtx);
          extraResult = { assertionResults: ar.assertionResults, error: ar.error };
          break;
        }
        case 'wait_for':
          extraResult = await executeWaitFor(event, execCtx);
          break;
        case 'image_match':
          extraResult = await executeImageMatch(event, execCtx);
          break;
        case 'check_email':
          extraResult = await executeCheckEmail(event, execCtx);
          break;
        // iOS 시스템 알럿 처리
        case 'ios_alert_accept': {
          console.log(`[IOSReplayer] Step ${event.stepNo}: 시스템 알럿 확인(Accept) 시도`);
          await controller.acceptAlert();
          console.log(`[IOSReplayer] Step ${event.stepNo}: 시스템 알럿 확인 완료`);
          break;
        }
        case 'ios_alert_dismiss': {
          console.log(`[IOSReplayer] Step ${event.stepNo}: 시스템 알럿 취소(Dismiss) 시도`);
          await controller.dismissAlert();
          console.log(`[IOSReplayer] Step ${event.stepNo}: 시스템 알럿 취소 완료`);
          break;
        }
        // 구조 마커: 블록 컨테이너 (실행 없음)
        case 'block_start':
        case 'block_end':
        // 구조 마커: 반복/조건 (iOS replayer는 단일 step 실행이므로 noop)
        case 'for_each_start':
        case 'for_each_end':
        case 'if_start':
        case 'if_end':
          break;
      }

      const assertionResults = await evaluatePostStepAssertions(event, execCtx);
      const assertFailed = assertionResults.some(r => !r.passed && !r.assertion.optional);
      const hasError = extraResult.error || assertFailed;

      // ─── afterStep: 증거 수집 (screenshot + pageSource) ───
      const artifacts = await this.collectStepArtifacts(controller, event, hasError);

      // ─── 스크린샷을 파일로 저장 (report용) ───
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
      // 실패 시에도 증거 수집 시도
      const artifacts = await this.collectStepArtifacts(controller, event, true).catch(() => undefined);
      const screenshot = this.saveScreenshotToFile(artifacts, screenshotDir, index, true);
      return {
        eventIndex: index, eventType: event.type, status: 'failed',
        duration: Date.now() - start, error: error.message,
        stepNo: event.stepNo, description: event.description,
        artifacts,
        screenshot,
      };
    }
  }

  // ─── 시맨틱 탭: iosSelector로 요소를 찾아 클릭 ──────────

  /**
   * iosSelector로 Appium에서 요소를 찾아 직접 클릭한다.
   * 성공 시 true, 실패 시 false (좌표 fallback 필요)
   */
  /** XML 엔티티 디코딩 (&#10; → \n 등) */
  private decodeXmlEntities(s: string): string {
    return s
      .replace(/&#(\d+);/g, (_m: string, code: string) => String.fromCharCode(parseInt(code, 10)))
      .replace(/&#x([0-9a-fA-F]+);/g, (_m: string, hex: string) => String.fromCharCode(parseInt(hex, 16)))
      .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
      .replace(/&apos;/g, "'").replace(/&quot;/g, '"');
  }

  private async tapBySelector(
    controller: any,
    selector: { strategy: string; value: string },
    options: { maxRetries?: number; retryInterval?: number; elementType?: string; hintCoordinates?: { x: number; y: number } } = {},
  ): Promise<boolean> {
    const { maxRetries = 3, retryInterval = 1000, elementType, hintCoordinates } = options;
    const { executeAppiumAction } = await import('@katab/device-manager');
    const sessionId = controller.currentSessionId;
    const serverUrl = controller.serverUrl;
    if (!sessionId) return false;

    // XML 엔티티 디코딩: 기존 시나리오에 &#10; 등이 저장되어 있을 수 있음
    const decodedValue = this.decodeXmlEntities(selector.value);

    // elementType이 있고 name/label 전략이면 predicate로 타입+이름을 결합하여
    // 동일 name의 다른 타입 요소(예: StaticText vs TextField)를 구분한다
    const xcuiType = elementType ? `XCUIElementType${elementType}` : null;

    // 검색 전략 목록 구축 (첫 번째가 기본, 나머지는 fallback)
    const strategies: Array<{ using: string; value: string; label: string }> = [];

    switch (selector.strategy) {
      case 'accessibility_id':
        strategies.push({ using: 'accessibility id', value: decodedValue, label: 'exact' });
        break;
      case 'name': {
        if (xcuiType) {
          strategies.push({ using: '-ios predicate string', value: `type == '${xcuiType}' AND name == '${decodedValue}'`, label: 'type+name' });
        } else {
          strategies.push({ using: 'name', value: decodedValue, label: 'exact' });
        }
        // Fallback: CONTAINS predicate (줄바꿈/특수문자로 exact match 실패 시)
        const firstLine = decodedValue.split('\n')[0].trim();
        if (firstLine.length >= 4 && firstLine !== decodedValue) {
          // 여러 줄 텍스트 → 첫 줄로 CONTAINS 검색
          const escaped = firstLine.replace(/'/g, "\\'");
          strategies.push({ using: '-ios predicate string', value: `name CONTAINS '${escaped}'`, label: 'contains_firstline' });
        }
        break;
      }
      case 'label': {
        const escapedDecoded = decodedValue.replace(/"/g, '\\"');
        if (xcuiType) {
          strategies.push({ using: '-ios predicate string', value: `type == '${xcuiType}' AND label == "${escapedDecoded}"`, label: 'type+label' });
        } else {
          strategies.push({ using: '-ios predicate string', value: `label == "${escapedDecoded}"`, label: 'exact' });
        }
        // Fallback: CONTAINS
        const firstLineL = decodedValue.split('\n')[0].trim();
        if (firstLineL.length >= 4 && firstLineL !== decodedValue) {
          const escaped = firstLineL.replace(/"/g, '\\"');
          strategies.push({ using: '-ios predicate string', value: `label CONTAINS "${escaped}"`, label: 'contains_firstline' });
        }
        break;
      }
      case 'xpath':
        strategies.push({ using: 'xpath', value: decodedValue, label: 'xpath' });
        break;
      default:
        return false;
    }

    // 각 전략을 순회하며 시도
    for (const strat of strategies) {
      for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
          const elementResponse = await executeAppiumAction(
            serverUrl, sessionId, 'element',
            { using: strat.using, value: strat.value }
          );
          const elementId = elementResponse.value?.ELEMENT || elementResponse.value?.elementId;
          if (!elementId) {
            if (attempt < maxRetries) {
              if (strat === strategies[0]) {
                console.log(`[IOSReplayer] tapBySelector: ${selector.strategy}=${selector.value} 실패, ${retryInterval}ms 후 재시도 (${attempt + 1}/${maxRetries})`);
              }
              await this.sleep(retryInterval);
              continue;
            }
            break; // 다음 전략으로
          }

          // 요소 발견 → rect 기반 좌표 탭 (element/click 대신)
          // element/click은 요소 중앙을 탭하지만, 라디오버튼/체크박스는
          // 텍스트 라벨 왼쪽에 있으므로 rect 기반으로 정확한 위치에 탭
          try {
            const rectResp = await executeAppiumAction(
              serverUrl, sessionId, `element/${elementId}/rect`, {}
            );
            const rect = rectResp.value || rectResp;
            if (rect && rect.x !== undefined && rect.y !== undefined) {
              // hintCoordinates가 있고 요소의 왼쪽에 위치하면 → 라디오/체크박스 영역
              // hintCoordinates.x를 사용하여 정확한 X 위치에 탭
              let tapX: number;
              if (hintCoordinates && hintCoordinates.x < rect.x) {
                // 녹화 시 좌표가 요소 왼쪽 (라디오/체크박스 영역) → 녹화 좌표 사용
                tapX = hintCoordinates.x;
              } else {
                tapX = rect.x + rect.width / 2;
              }
              const tapY = rect.y + rect.height / 2;
              await controller.tap(tapX, tapY);
              if (strat.label !== 'exact' && strat.label !== 'type+name' && strat.label !== 'type+label') {
                console.log(`[IOSReplayer] tapBySelector: ${strat.label} fallback으로 요소 발견`);
              }
              return true;
            }
          } catch {
            // rect 실패 시 element/click fallback
          }

          // rect 가져오기 실패 → 기존 element/click 사용
          await executeAppiumAction(
            serverUrl, sessionId, `element/${elementId}/click`, {}
          );
          return true;
        } catch {
          if (attempt < maxRetries) {
            if (strat === strategies[0]) {
              console.log(`[IOSReplayer] tapBySelector: ${selector.strategy}=${selector.value} 실패, ${retryInterval}ms 후 재시도 (${attempt + 1}/${maxRetries})`);
            }
            await this.sleep(retryInterval);
            continue;
          }
          break; // 다음 전략으로
        }
      }
    }
    return false;
  }

  /**
   * meta.element에서 최적의 iosSelector를 생성한다.
   * 우선순위: accessibilityId > name > label
   */
  private elementToSelector(element: any): { strategy: string; value: string } | null {
    if (element.accessibilityId) {
      return { strategy: 'accessibility_id', value: element.accessibilityId };
    }
    if (element.name) {
      return { strategy: 'name', value: element.name };
    }
    if (element.label) {
      return { strategy: 'label', value: element.label };
    }
    return null;
  }

  // ─── afterStep: 증거 수집 (screenshot + pageSource) ────

  /**
   * 매 스텝 실행 후 스크린샷과 pageSource를 수집하여 디버깅 증거로 남긴다.
   * - 모든 UI 관련 스텝에서 스크린샷 수집 (report 시각적 증거용)
   * - set_variable, run_script, api_request 등 UI 없는 스텝은 스킵
   */
  private async collectStepArtifacts(
    controller: any,
    event: RecordingEvent,
    hasError: boolean | string | undefined
  ): Promise<StepArtifacts | undefined> {
    // UI 변화 없는 스텝 타입은 증거 수집 스킵 (wait는 전후 화면 확인이 의미 있으므로 포함)
    const noUITypes = new Set(['set_variable', 'run_script', 'api_request']);
    if (noUITypes.has(event.type) && !hasError) return undefined;

    const artifacts: StepArtifacts = { timestamp: Date.now() };

    try {
      // 스크린샷 수집 — 모든 UI 스텝에서 항상 수집 (report 증거용)
      const screenshotBase64 = await controller.screenshot?.();
      if (screenshotBase64) {
        artifacts.screenshotBase64 = screenshotBase64;
      }
    } catch {
      // 스크린샷 실패는 무시
    }

    try {
      // pageSource 수집 + 요약 생성
      const xml = await controller.getPageSource?.();
      if (xml && typeof xml === 'string') {
        artifacts.pageSourceXml = xml;
        // 요약: 요소 수와 주요 텍스트 추출
        const elements = parsePageSource(xml);
        const visibleTexts = elements
          .filter(el => el.visible && el.label)
          .map(el => el.label!)
          .slice(0, 10);
        artifacts.pageSourceSummary = `요소 ${elements.length}개, visible 텍스트: [${visibleTexts.join(', ')}]`;
      }
    } catch {
      // pageSource 실패는 무시
    }

    return artifacts;
  }

  /**
   * artifacts의 base64 스크린샷을 파일로 저장하고 경로를 반환한다.
   * report HTML에서 img src로 사용할 수 있는 상대 경로를 반환한다.
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

  /**
   * 중첩 구조의 매칭 end 마커를 찾는다.
   * 예: if_start → if_end, for_each_start → for_each_end
   */
  private findMatchingEnd(events: RecordingEvent[], startIdx: number, startType: string, endType: string): number {
    let depth = 0;
    for (let j = startIdx; j < events.length; j++) {
      if (events[j].type === startType) depth++;
      if (events[j].type === endType) {
        depth--;
        if (depth === 0) return j;
      }
    }
    throw new Error(`No matching ${endType} found for ${startType} at index ${startIdx}`);
  }

  /**
   * UI 액션 후 화면 안정화 대기
   *
   * 최소 minWait ms 대기 후, pageSource를 비교하여 변화가 멈출 때까지 대기.
   * maxWait ms 이내에 안정화되지 않으면 타임아웃.
   *
   * 이를 통해 timestamp gap이 부정확한 시나리오에서도
   * 다음 스텝 실행 전 UI가 준비된 상태를 보장한다.
   */
  private async waitForUISettle(
    controller: any,
    prevPageSource: string | undefined,
    minWait: number = 500,
    maxWait: number = 3000,
  ): Promise<void> {
    // 최소 대기
    await this.sleep(minWait);

    // pageSource 기반 안정화 체크 (최대 maxWait - minWait ms 추가 대기)
    const pollInterval = 500;
    const deadline = Date.now() + (maxWait - minWait);
    let lastSource: string | undefined;

    try {
      lastSource = await controller.getPageSource();
    } catch {
      return; // pageSource 실패 시 최소 대기만으로 진행
    }

    // 이전 pageSource가 없으면 비교 불가 → 최소 대기만으로 충분
    if (!prevPageSource) return;

    // 이미 변화가 있으면 안정화 대기
    if (lastSource === prevPageSource) return; // 변화 없으면 바로 진행

    while (Date.now() < deadline) {
      await this.sleep(pollInterval);
      try {
        const current = await controller.getPageSource();
        if (current === lastSource) {
          // 연속 2회 동일 → 안정화됨
          return;
        }
        lastSource = current;
      } catch {
        return; // 오류 시 진행
      }
    }
  }
}
