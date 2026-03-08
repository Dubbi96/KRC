/**
 * ScenarioValidator
 *
 * \uc2dc\ub098\ub9ac\uc624\uc758 \uad6c\uc870\uc801 \ubb34\uacb0\uc131\uc744 \uac80\uc0ac\ud55c\ub2e4.
 * - \ud544\uc218 \ud544\ub4dc \ub204\ub77d \uac80\uc0ac
 * - for_each/if \ub9c8\ucee4 \uc9dd \uac80\uc0ac
 * - \uc140\ub809\ud130 \uac74\uac15\ub3c4 \uacbd\uace0
 * - \ubcc0\uc218 \ucc38\uc870 \ubbf8\uc815\uc758 \uacbd\uace0
 * - API \uc694\uccad \uc124\uc815 \uac80\uc99d
 * - \ud0c0\uc784\uc544\uc6c3 \ubbf8\uc124\uc815 \uacbd\uace0
 */

import type { RecordingScenario, RecordingEvent } from '../types';

export interface ValidationIssue {
  level: 'error' | 'warning' | 'info';
  stepIndex?: number;
  field?: string;
  message: string;
  code: string;
}

export interface ScenarioValidationResult {
  issues: ValidationIssue[];
  summary: { errors: number; warnings: number; info: number };
}

export class ScenarioValidator {
  validate(scenario: RecordingScenario): ScenarioValidationResult {
    const issues: ValidationIssue[] = [
      ...this.checkRequiredFields(scenario),
      ...this.checkMarkerBalance(scenario),
      ...this.checkSelectorHealth(scenario),
      ...this.checkVariableReferences(scenario),
      ...this.checkApiRequests(scenario),
      ...this.checkTimeouts(scenario),
      ...this.checkOnFailPolicies(scenario),
    ];

    const summary = {
      errors: issues.filter(i => i.level === 'error').length,
      warnings: issues.filter(i => i.level === 'warning').length,
      info: issues.filter(i => i.level === 'info').length,
    };

    return { issues, summary };
  }

  private checkRequiredFields(scenario: RecordingScenario): ValidationIssue[] {
    const issues: ValidationIssue[] = [];

    scenario.events.forEach((ev: RecordingEvent, i: number) => {
      if (ev.disabled) return;

      switch (ev.type) {
        case 'click':
        case 'fill':
        case 'select':
        case 'hover':
          if (!ev.selector && !ev.meta?.element) {
            issues.push({
              level: 'error', stepIndex: i, field: 'selector',
              message: `\uc2a4\ud15d #${i + 1} (${ev.type}): \uc140\ub809\ud130\uac00 \uc815\uc758\ub418\uc9c0 \uc54a\uc74c`,
              code: 'MISSING_SELECTOR',
            });
          }
          if ((ev.type === 'fill') && !ev.value && ev.value !== '') {
            issues.push({
              level: 'warning', stepIndex: i, field: 'value',
              message: `\uc2a4\ud15d #${i + 1} (fill): \uc785\ub825 \uac12\uc774 \ube44\uc5b4\uc788\uc74c`,
              code: 'MISSING_VALUE',
            });
          }
          // within 스코프 검증
          if (ev.within && !ev.within.selector) {
            issues.push({
              level: 'warning', stepIndex: i, field: 'within.selector',
              message: `\uc2a4\ud15d #${i + 1} (${ev.type}): within \uc2a4\ucf54\ud504\uc5d0 \uc140\ub809\ud130\uac00 \ube44\uc5b4\uc788\uc74c`,
              code: 'EMPTY_WITHIN_SELECTOR',
            });
          }
          break;

        case 'navigate':
          if (!ev.url) {
            issues.push({
              level: 'error', stepIndex: i, field: 'url',
              message: `\uc2a4\ud15d #${i + 1} (navigate): URL\uc774 \uc815\uc758\ub418\uc9c0 \uc54a\uc74c`,
              code: 'MISSING_URL',
            });
          }
          break;

        case 'extract_data':
          if (!ev.extractData?.selector) {
            issues.push({
              level: 'error', stepIndex: i, field: 'extractData.selector',
              message: `\uc2a4\ud15d #${i + 1} (extract_data): \uc140\ub809\ud130\uac00 \uc815\uc758\ub418\uc9c0 \uc54a\uc74c`,
              code: 'MISSING_SELECTOR',
            });
          }
          if (!ev.extractData?.captureAs) {
            issues.push({
              level: 'error', stepIndex: i, field: 'extractData.captureAs',
              message: `\uc2a4\ud15d #${i + 1} (extract_data): \uacb0\uacfc \ubcc0\uc218\uba85\uc774 \uc815\uc758\ub418\uc9c0 \uc54a\uc74c`,
              code: 'MISSING_CAPTURE_VAR',
            });
          }
          // within 스코프 검증
          if (ev.within && !ev.within.selector) {
            issues.push({
              level: 'warning', stepIndex: i, field: 'within.selector',
              message: `\uc2a4\ud15d #${i + 1} (extract_data): within \uc2a4\ucf54\ud504\uc5d0 \uc140\ub809\ud130\uac00 \ube44\uc5b4\uc788\uc74c`,
              code: 'EMPTY_WITHIN_SELECTOR',
            });
          }
          break;

        case 'set_variable':
          if (!ev.variableName) {
            issues.push({
              level: 'error', stepIndex: i, field: 'variableName',
              message: `\uc2a4\ud15d #${i + 1} (set_variable): \ubcc0\uc218\uba85\uc774 \uc815\uc758\ub418\uc9c0 \uc54a\uc74c`,
              code: 'MISSING_VARIABLE_NAME',
            });
          }
          break;

        case 'for_each_start':
          if (!ev.forEachConfig?.selector) {
            issues.push({
              level: 'error', stepIndex: i, field: 'forEachConfig.selector',
              message: `\uc2a4\ud15d #${i + 1} (for_each_start): \ubc18\ubcf5 \ub300\uc0c1 \uc140\ub809\ud130\uac00 \uc815\uc758\ub418\uc9c0 \uc54a\uc74c`,
              code: 'MISSING_SELECTOR',
            });
          }
          break;

        case 'if_start':
          if (!ev.ifCondition?.conditionType) {
            issues.push({
              level: 'error', stepIndex: i, field: 'ifCondition.conditionType',
              message: `\uc2a4\ud15d #${i + 1} (if_start): \uc870\uac74 \uc720\ud615\uc774 \uc815\uc758\ub418\uc9c0 \uc54a\uc74c`,
              code: 'MISSING_CONDITION_TYPE',
            });
          }
          break;

        case 'block_start':
          if (!ev.blockConfig?.name) {
            issues.push({
              level: 'warning', stepIndex: i, field: 'blockConfig.name',
              message: `스텝 #${i + 1} (block_start): 블록 이름이 지정되지 않음`,
              code: 'MISSING_BLOCK_NAME',
            });
          }
          break;

        case 'keyboard':
          if (!ev.keyboard?.key) {
            issues.push({
              level: 'error', stepIndex: i, field: 'keyboard.key',
              message: `\uc2a4\ud15d #${i + 1} (keyboard): \ud0a4 \uc870\ud569\uc774 \uc815\uc758\ub418\uc9c0 \uc54a\uc74c`,
              code: 'MISSING_KEY',
            });
          }
          break;

        case 'wait_for':
          if (!ev.waitForConfig?.waitType) {
            issues.push({
              level: 'error', stepIndex: i, field: 'waitForConfig.waitType',
              message: `\uc2a4\ud15d #${i + 1} (wait_for): \ub300\uae30 \uc720\ud615\uc774 \uc815\uc758\ub418\uc9c0 \uc54a\uc74c`,
              code: 'MISSING_WAIT_TYPE',
            });
          }
          break;

        case 'dialog':
          if (!ev.dialogConfig?.dialogType) {
            issues.push({
              level: 'error', stepIndex: i, field: 'dialogConfig.dialogType',
              message: `스텝 #${i + 1} (dialog): dialogConfig.dialogType이 정의되지 않음`,
              code: 'MISSING_DIALOG_CONFIG',
            });
          }
          break;

        case 'ocr_extract':
          if (!ev.ocrConfig) {
            issues.push({
              level: 'error', stepIndex: i, field: 'ocrConfig',
              message: `스텝 #${i + 1} (ocr_extract): ocrConfig가 정의되지 않음`,
              code: 'MISSING_OCR_CONFIG',
            });
          } else {
            if (!ev.ocrConfig.targetVar) {
              issues.push({
                level: 'error', stepIndex: i, field: 'ocrConfig.targetVar',
                message: `스텝 #${i + 1} (ocr_extract): targetVar(결과 변수명)가 정의되지 않음`,
                code: 'MISSING_TARGET_VAR',
              });
            }
            if (ev.ocrConfig.source === 'element' && !ev.ocrConfig.selector) {
              issues.push({
                level: 'error', stepIndex: i, field: 'ocrConfig.selector',
                message: `스텝 #${i + 1} (ocr_extract): source=element일 때 selector 필수`,
                code: 'MISSING_SELECTOR',
              });
            }
            if (ev.ocrConfig.source === 'viewport' && !ev.ocrConfig.region) {
              issues.push({
                level: 'error', stepIndex: i, field: 'ocrConfig.region',
                message: `스텝 #${i + 1} (ocr_extract): source=viewport일 때 region 필수`,
                code: 'MISSING_REGION',
              });
            }
            if (ev.ocrConfig.engine && ev.ocrConfig.engine !== 'tesseract') {
              issues.push({
                level: 'warning', stepIndex: i, field: 'ocrConfig.engine',
                message: `스텝 #${i + 1} (ocr_extract): engine="${ev.ocrConfig.engine}"는 현재 미지원 (tesseract만 사용 가능)`,
                code: 'UNSUPPORTED_OCR_ENGINE',
              });
            }
            if (ev.ocrConfig.postprocess?.regex) {
              try {
                new RegExp(ev.ocrConfig.postprocess.regex);
              } catch {
                issues.push({
                  level: 'warning', stepIndex: i, field: 'ocrConfig.postprocess.regex',
                  message: `스텝 #${i + 1} (ocr_extract): postprocess.regex가 유효한 정규식이 아님`,
                  code: 'INVALID_OCR_REGEX',
                });
              }
            }
          }
          break;

        case 'popup_opened':
        case 'popup_closed':
          // 구조적 마커 — 필수 필드 없음 (meta.pageId는 녹화 시 자동 부착)
          break;
      }
    });

    return issues;
  }

  private checkMarkerBalance(scenario: RecordingScenario): ValidationIssue[] {
    const issues: ValidationIssue[] = [];
    const stack: Array<{ type: string; index: number }> = [];

    scenario.events.forEach((ev: RecordingEvent, i: number) => {
      if (ev.disabled) return;

      if (ev.type === 'for_each_start' || ev.type === 'if_start' || ev.type === 'block_start') {
        stack.push({ type: ev.type, index: i });
      }
      if (ev.type === 'for_each_end') {
        const last = stack.pop();
        if (!last || last.type !== 'for_each_start') {
          issues.push({
            level: 'error', stepIndex: i,
            message: `\uc2a4\ud15d #${i + 1}: for_each_end\uc5d0 \ub300\uc751\ud558\ub294 for_each_start\uac00 \uc5c6\uc74c`,
            code: 'UNMATCHED_MARKER',
          });
        }
      }
      if (ev.type === 'if_end') {
        const last = stack.pop();
        if (!last || last.type !== 'if_start') {
          issues.push({
            level: 'error', stepIndex: i,
            message: `\uc2a4\ud15d #${i + 1}: if_end\uc5d0 \ub300\uc751\ud558\ub294 if_start\uac00 \uc5c6\uc74c`,
            code: 'UNMATCHED_MARKER',
          });
        }
      }
      if (ev.type === 'block_end') {
        const last = stack.pop();
        if (!last || last.type !== 'block_start') {
          issues.push({
            level: 'error', stepIndex: i,
            message: `스텝 #${i + 1}: block_end에 대응하는 block_start가 없음`,
            code: 'UNMATCHED_MARKER',
          });
        }
      }
    });

    // 남은 미닫힘 마커
    stack.forEach(s => {
      issues.push({
        level: 'error', stepIndex: s.index,
        message: `\uc2a4\ud15d #${s.index + 1}: ${s.type}\uc5d0 \ub300\uc751\ud558\ub294 end \ub9c8\ucee4\uac00 \uc5c6\uc74c`,
        code: 'UNMATCHED_MARKER',
      });
    });

    return issues;
  }

  private checkSelectorHealth(scenario: RecordingScenario): ValidationIssue[] {
    const issues: ValidationIssue[] = [];

    scenario.events.forEach((ev: RecordingEvent, i: number) => {
      if (ev.disabled || !ev.selector) return;

      const sel = ev.selector;
      if (sel.includes(':nth')) {
        issues.push({
          level: 'warning', stepIndex: i, field: 'selector',
          message: `\uc2a4\ud15d #${i + 1}: nth-child/nth-of-type \uc140\ub809\ud130\ub294 DOM \ubcc0\uacbd\uc5d0 \ucde8\uc57d`,
          code: 'FRAGILE_SELECTOR',
        });
      } else if ((sel.match(/>/g) || []).length > 3) {
        issues.push({
          level: 'warning', stepIndex: i, field: 'selector',
          message: `\uc2a4\ud15d #${i + 1}: \uae4a\uc740 CSS \uacbd\ub85c (${(sel.match(/>/g) || []).length}\ub2e8\uacc4)\ub294 \uc720\uc9c0\ubcf4\uc218 \uc5b4\ub824\uc6c0`,
          code: 'FRAGILE_SELECTOR',
        });
      } else if (sel.length > 100) {
        issues.push({
          level: 'warning', stepIndex: i, field: 'selector',
          message: `\uc2a4\ud15d #${i + 1}: \uacfc\ub3c4\ud558\uac8c \uae34 \uc140\ub809\ud130 (${sel.length}\uc790)`,
          code: 'FRAGILE_SELECTOR',
        });
      }

      // within.selector 건강도 검사
      if (ev.within?.selector) {
        const wSel = ev.within.selector;
        if (wSel.includes(':nth')) {
          issues.push({
            level: 'warning', stepIndex: i, field: 'within.selector',
            message: `\uc2a4\ud15d #${i + 1}: within \uc2a4\ucf54\ud504 \uc140\ub809\ud130\uc5d0 nth-child \uc0ac\uc6a9 \u2014 \ubd88\uc548\uc815\ud560 \uc218 \uc788\uc74c`,
            code: 'FRAGILE_WITHIN_SELECTOR',
          });
        }
      }

      // 더 안정적인 대안이 있는지
      if (ev.meta?.selectors && ev.meta.selectors.length > 0) {
        const better = ev.meta.selectors.find((s: string) =>
          s !== sel && (s.includes('data-testid') || s.startsWith('[role=') || s.includes('aria-label'))
        );
        if (better) {
          issues.push({
            level: 'info', stepIndex: i, field: 'selector',
            message: `\uc2a4\ud15d #${i + 1}: \ub354 \uc548\uc815\uc801\uc778 \uc140\ub809\ud130 \ub300\uc548 \uc874\uc7ac: ${better}`,
            code: 'BETTER_SELECTOR_AVAILABLE',
          });
        }
      }
    });

    return issues;
  }

  private checkVariableReferences(scenario: RecordingScenario): ValidationIssue[] {
    const issues: ValidationIssue[] = [];

    // 정의된 변수 수집
    const defined = new Set<string>(Object.keys(scenario.variables || {}));
    scenario.events.forEach((ev: RecordingEvent) => {
      if (ev.variableName) defined.add(ev.variableName);
      if (ev.extractData?.captureAs) defined.add(ev.extractData.captureAs);
      if (ev.ocrConfig?.targetVar) defined.add(ev.ocrConfig.targetVar);
      if (ev.apiRequest?.captureResponseAs) defined.add(ev.apiRequest.captureResponseAs);
      if (ev.apiRequest?.captureJsonPath) {
        for (const varName of Object.values(ev.apiRequest.captureJsonPath)) {
          defined.add(varName);
        }
      }
      if (ev.apiRequest?.captureHeaders) {
        for (const varName of Object.values(ev.apiRequest.captureHeaders)) {
          defined.add(varName);
        }
      }
      if (ev.forEachConfig?.itemVariable) defined.add(ev.forEachConfig.itemVariable);
      if (ev.forEachConfig?.countVariable) defined.add(ev.forEachConfig.countVariable);
      if (ev.script?.captureOutputAs) defined.add(ev.script.captureOutputAs);
    });
    // 내장 변수
    defined.add('__index');
    defined.add('__count');

    // 모든 문자열 필드에서 {{var}} 참조 스캔
    scenario.events.forEach((ev: RecordingEvent, i: number) => {
      if (ev.disabled) return;
      const json = JSON.stringify(ev);
      const refs = json.match(/\{\{(\w+)\}\}/g) || [];
      const seen = new Set<string>();
      refs.forEach((ref: string) => {
        const name = ref.replace(/[{}]/g, '');
        if (!defined.has(name) && !seen.has(name)) {
          seen.add(name);
          issues.push({
            level: 'warning', stepIndex: i,
            message: `\uc2a4\ud15d #${i + 1}: \ubcc0\uc218 "{{${name}}}"\uac00 \uc815\uc758\ub418\uc9c0 \uc54a\uc74c (\ub7f0\ud0c0\uc784 \ub610\ub294 CLI\uc5d0\uc11c \uc81c\uacf5 \ud544\uc694)`,
            code: 'UNDEFINED_VARIABLE',
          });
        }
      });
    });

    return issues;
  }

  private checkApiRequests(scenario: RecordingScenario): ValidationIssue[] {
    const issues: ValidationIssue[] = [];

    scenario.events.forEach((ev: RecordingEvent, i: number) => {
      if (ev.disabled || ev.type !== 'api_request' || !ev.apiRequest) return;

      if (!ev.apiRequest.url) {
        issues.push({
          level: 'error', stepIndex: i, field: 'apiRequest.url',
          message: `\uc2a4\ud15d #${i + 1} (api_request): URL\uc774 \uc815\uc758\ub418\uc9c0 \uc54a\uc74c`,
          code: 'MISSING_URL',
        });
      }

      if (ev.apiRequest.expectedStatus === undefined) {
        issues.push({
          level: 'warning', stepIndex: i, field: 'apiRequest.expectedStatus',
          message: `\uc2a4\ud15d #${i + 1} (api_request): expectedStatus\uac00 \ubbf8\uc124\uc815 (\ud14c\uc2a4\ud2b8 \uac80\uc99d\ub825 \uc57d\ud654)`,
          code: 'MISSING_EXPECTED_STATUS',
        });
      }

      if (ev.apiRequest.body && typeof ev.apiRequest.body === 'string') {
        try {
          JSON.parse(ev.apiRequest.body);
        } catch {
          issues.push({
            level: 'warning', stepIndex: i, field: 'apiRequest.body',
            message: `\uc2a4\ud15d #${i + 1} (api_request): body\uac00 \uc720\ud6a8\ud55c JSON\uc774 \uc544\ub2d8`,
            code: 'INVALID_JSON_BODY',
          });
        }
      }
    });

    return issues;
  }

  private checkTimeouts(scenario: RecordingScenario): ValidationIssue[] {
    const issues: ValidationIssue[] = [];

    scenario.events.forEach((ev: RecordingEvent, i: number) => {
      if (ev.disabled) return;

      if (ev.type === 'wait_for' && ev.waitForConfig) {
        if (!ev.waitForConfig.timeout) {
          issues.push({
            level: 'info', stepIndex: i, field: 'waitForConfig.timeout',
            message: `\uc2a4\ud15d #${i + 1} (wait_for): timeout \ubbf8\uc124\uc815 (\uae30\ubcf8\uac12 10\ucd08 \uc0ac\uc6a9)`,
            code: 'DEFAULT_TIMEOUT',
          });
        }
        if (ev.waitForConfig.waitType === 'element_visible' && !ev.waitForConfig.selector) {
          issues.push({
            level: 'error', stepIndex: i, field: 'waitForConfig.selector',
            message: `\uc2a4\ud15d #${i + 1} (wait_for): element_visible \ub300\uae30\uc5d0 \uc140\ub809\ud130\uac00 \ud544\uc694`,
            code: 'MISSING_SELECTOR',
          });
        }
        if (ev.waitForConfig.waitType === 'element_hidden' && !ev.waitForConfig.selector) {
          issues.push({
            level: 'error', stepIndex: i, field: 'waitForConfig.selector',
            message: `\uc2a4\ud15d #${i + 1} (wait_for): element_hidden \ub300\uae30\uc5d0 \uc140\ub809\ud130\uac00 \ud544\uc694`,
            code: 'MISSING_SELECTOR',
          });
        }
        if (ev.waitForConfig.waitType === 'url_change' && !ev.waitForConfig.urlPattern) {
          issues.push({
            level: 'info', stepIndex: i, field: 'waitForConfig.urlPattern',
            message: `\uc2a4\ud15d #${i + 1} (wait_for): url_change \ub300\uae30\uc5d0 URL \ud328\ud134 \ubbf8\uc124\uc815 (\uc544\ubb34 URL \ubcc0\uacbd\uc774\ub4e0 \uac10\uc9c0)`,
            code: 'MISSING_URL_PATTERN',
          });
        }
      }

      if (ev.type === 'for_each_start' && ev.forEachConfig && !ev.forEachConfig.maxIterations) {
        issues.push({
          level: 'warning', stepIndex: i, field: 'forEachConfig.maxIterations',
          message: `\uc2a4\ud15d #${i + 1} (for_each): maxIterations \ubbf8\uc124\uc815 (\ubb34\ud55c \ubc18\ubcf5 \uc704\ud5d8)`,
          code: 'MISSING_MAX_ITERATIONS',
        });
      }
    });

    return issues;
  }

  private checkOnFailPolicies(scenario: RecordingScenario): ValidationIssue[] {
    const issues: ValidationIssue[] = [];
    const totalSteps = scenario.events.length;

    scenario.events.forEach((ev: RecordingEvent, i: number) => {
      if (ev.disabled || !ev.onFail) return;

      const policy = ev.onFail;

      // jump 대상 유효성
      if (policy.action === 'jump') {
        if (policy.jumpToStep === undefined || policy.jumpToStep < 0 || policy.jumpToStep >= totalSteps) {
          issues.push({
            level: 'error', stepIndex: i, field: 'onFail.jumpToStep',
            message: `스텝 #${i + 1}: onFail.jumpToStep(${policy.jumpToStep})이 유효하지 않음 (0~${totalSteps - 1})`,
            code: 'INVALID_ONFAIL_JUMP',
          });
        }
        // 자기 자신으로의 무한 점프 경고
        if (policy.jumpToStep === i && !policy.maxRetry) {
          issues.push({
            level: 'warning', stepIndex: i, field: 'onFail.jumpToStep',
            message: `스텝 #${i + 1}: 자기 자신으로 점프하면서 maxRetry 미설정 — 무한 루프 위험`,
            code: 'ONFAIL_SELF_JUMP_NO_LIMIT',
          });
        }
      }

      // retry 검증
      if (policy.action === 'retry') {
        if (!policy.maxRetry || policy.maxRetry < 1) {
          issues.push({
            level: 'warning', stepIndex: i, field: 'onFail.maxRetry',
            message: `스텝 #${i + 1}: onFail.retry에 maxRetry 미설정 (기본 1회)`,
            code: 'ONFAIL_RETRY_NO_LIMIT',
          });
        }
        if (policy.maxRetry && policy.maxRetry > 10) {
          issues.push({
            level: 'warning', stepIndex: i, field: 'onFail.maxRetry',
            message: `스텝 #${i + 1}: maxRetry=${policy.maxRetry}는 과도할 수 있음`,
            code: 'ONFAIL_EXCESSIVE_RETRY',
          });
        }
      }

      // fallback_route 검증
      if (policy.action === 'fallback_route') {
        if (!policy.fallbackSteps || policy.fallbackSteps.length === 0) {
          issues.push({
            level: 'error', stepIndex: i, field: 'onFail.fallbackSteps',
            message: `스텝 #${i + 1}: fallback_route에 대체 루트 스텝이 정의되지 않음`,
            code: 'ONFAIL_NO_FALLBACK_STEPS',
          });
        } else {
          policy.fallbackSteps.forEach(step => {
            if (step < 0 || step >= totalSteps) {
              issues.push({
                level: 'error', stepIndex: i, field: 'onFail.fallbackSteps',
                message: `스텝 #${i + 1}: fallback 대상 스텝(${step})이 유효하지 않음`,
                code: 'INVALID_ONFAIL_FALLBACK_STEP',
              });
            }
          });
        }
      }
    });

    return issues;
  }
}
