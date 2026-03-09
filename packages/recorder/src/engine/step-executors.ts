/**
 * 새 이벤트 타입 실행기
 *
 * wait_for_user, api_request, assert, run_script, set_variable
 */

import type { Page, Locator } from 'playwright';
import { execSync } from 'child_process';
import type { RecordingEvent, EventResult, AssertionResult, ExtractDataConfig, ExtractTransform, WaitForConfig, IfConditionConfig, NetworkLogEntry, ImageMatchConfig, OcrExtractConfig, OcrResult, OcrPreprocess, CheckEmailConfig } from '../types';
import type { VariableContext } from './variables';
import { AssertionEngine, type AssertionContext } from './assertions';

/** 비디오 관련 어설션 타입 (재시도 대상) */
const VIDEO_ASSERTION_TYPES = new Set([
  'video_auto', 'video_playing', 'video_no_error', 'video_visual', 'stream_segments_loaded',
]);

/** 비디오 어설션 실패 시 재시도 — 라이브 스트림 등 로딩 지연 대응 (최소 2회, 총 ~10초 관측) */
async function retryVideoAssertions(
  assertions: any[],
  firstResults: AssertionResult[],
  assertCtx: AssertionContext,
  engine: AssertionEngine,
): Promise<AssertionResult[]> {
  let results = firstResults;
  let nonOptionalFails = results.filter(r => !r.passed && !r.assertion.optional);
  const hasVideoFails = nonOptionalFails.some(r => VIDEO_ASSERTION_TYPES.has(r.assertion.type));
  if (!hasVideoFails) return results;

  const maxRetries = 2;
  const retryDelayMs = 3500; // 첫 시도 ~3s + 대기 3.5s + 재시도 ~3s = ~10s

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    await new Promise(r => setTimeout(r, retryDelayMs));
    results = await engine.evaluateAll(assertions, assertCtx);
    nonOptionalFails = results.filter(r => !r.passed && !r.assertion.optional);
    if (nonOptionalFails.length === 0) break;
    // 비디오 어설션이 모두 통과했으면 더 이상 재시도 불필요
    if (!nonOptionalFails.some(r => VIDEO_ASSERTION_TYPES.has(r.assertion.type))) break;
  }

  return results;
}

export interface ExecutionContext {
  page?: Page;
  iosController?: any;                        // IOSController 인스턴스 (iOS assertion 평가용)
  variables: VariableContext;
  assertionEngine: AssertionEngine;
  lastApiResponse?: {
    status: number;
    headers: Record<string, string>;
    body: any;
  };
  networkLogs?: NetworkLogEntry[];            // 스트림 검증용 네트워크 로그 (ring buffer)
  lastIOSPageSource?: string;                 // 이전 스텝의 iOS pageSource XML (ios_screen_changed 용)
  onWaitForUserStart?: () => void;            // wait_for_user 시작 시 호출 (spinner 중지)
  onWaitForUserEnd?: () => void;              // wait_for_user 종료 시 호출 (spinner 재개)
  appiumKeepAlive?: () => Promise<void>;      // Appium 세션 keep-alive ping (wait_for_user 중 세션 타임아웃 방지)
}

// ─── Wait For User ────────────────────────────────────────

export async function executeWaitForUser(
  event: RecordingEvent,
  ctx: ExecutionContext
): Promise<Partial<EventResult>> {
  const config = event.waitForUser;
  if (!config) return { error: 'No waitForUser config' };

  // Spinner 중지 (있는 경우) - 먼저 중지하여 출력이 깨끗하게 표시되도록
  if (ctx.onWaitForUserStart) {
    ctx.onWaitForUserStart();
  }
  // Spinner가 완전히 중지되도록 약간의 지연 (spinner.clear() 후 출력이 깨끗하게 표시되도록)
  await new Promise(resolve => setTimeout(resolve, 100));

  const message = ctx.variables.resolve(config.message);

  // 동적으로 ESM 모듈 로드
  const chalk = (await import('chalk')).default;
  // Spinner 출력을 지우기 위해 새 줄 출력
  process.stdout.write('\n');
  console.log(chalk.bgYellow.black(' [WAIT] 사용자 입력 대기 '));
  console.log(chalk.yellow(`   ${message}`));

  // Appium 세션 keep-alive: 사용자 대기 중 세션 타임아웃(newCommandTimeout) 방지
  // 30초마다 경량 명령을 보내 세션 유지
  let keepAliveTimer: ReturnType<typeof setInterval> | null = null;
  if (ctx.appiumKeepAlive) {
    const keepAliveFn = ctx.appiumKeepAlive;
    keepAliveTimer = setInterval(async () => {
      try {
        await keepAliveFn();
      } catch {
        // keep-alive 실패는 무시 (세션이 이미 죽었을 수 있음)
      }
    }, 30_000);
  }

  const timeoutMs = config.timeout || 0;
  const startTime = Date.now();

  try {
    if (config.resumeOn === 'url_change' && ctx.page && config.resumeUrlPattern) {
      // URL 변경 감지까지 폴링
      const pattern = ctx.variables.resolve(config.resumeUrlPattern);
      console.log(chalk.gray(`   URL에 "${pattern}" 포함될 때까지 대기 중...`));
      while (true) {
        const url = ctx.page.url();
        if (url.includes(pattern)) {
          console.log(chalk.green(`   ✓ URL 변경 감지: ${url}`));
          break;
        }
        if (timeoutMs > 0 && Date.now() - startTime > timeoutMs) {
          return { error: `Timeout: URL did not change to match "${pattern}"` };
        }
        await sleep(500);
      }
    } else if (config.resumeOn === 'element_appear' && ctx.page && config.resumeSelector) {
      // 요소 출현까지 폴링
      const selector = ctx.variables.resolve(config.resumeSelector);
      console.log(chalk.gray(`   요소 "${selector}" 출현 대기 중...`));
      while (true) {
        try {
          const visible = await ctx.page.locator(selector).first().isVisible({ timeout: 1000 });
          if (visible) {
            console.log(chalk.green(`   ✓ 요소 출현 감지`));
            break;
          }
        } catch { /* 아직 안 나타남 */ }
        if (timeoutMs > 0 && Date.now() - startTime > timeoutMs) {
          return { error: `Timeout: Element "${selector}" did not appear` };
        }
        await sleep(500);
      }
    } else {
      // 기본: Enter 키 대기
      console.log(chalk.gray('   완료되면 Enter를 누르세요...'));
      try {
        await waitForEnter(timeoutMs);
        console.log(chalk.green('   ✓ 계속 진행'));
      } catch (err: any) {
        if (err.message?.includes('Timeout')) {
          return { error: err.message };
        }
        throw err;
      }
    }
  } finally {
    // keep-alive 타이머 정리
    if (keepAliveTimer) clearInterval(keepAliveTimer);
  }

  console.log('');

  // Spinner 재개 (있는 경우)
  if (ctx.onWaitForUserEnd) {
    ctx.onWaitForUserEnd();
  }

  return {};
}

function waitForEnter(timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const stdin = process.stdin;
    
    // stdin이 TTY가 아니면 즉시 resolve (예: 파이프나 리다이렉션)
    if (!stdin.isTTY) {
      console.log('   (stdin is not a TTY, skipping user input)');
      resolve();
      return;
    }

    const wasRaw = stdin.isRaw;
    stdin.setRawMode?.(false);
    stdin.resume();

    let timer: ReturnType<typeof setTimeout> | undefined;
    if (timeoutMs > 0) {
      timer = setTimeout(() => {
        stdin.removeListener('data', onData);
        stdin.pause();
        if (wasRaw !== undefined) stdin.setRawMode?.(wasRaw);
        reject(new Error('Timeout waiting for user input'));
      }, timeoutMs);
    }

    const onData = (data: Buffer) => {
      if (timer) clearTimeout(timer);
      stdin.removeListener('data', onData);
      stdin.pause();
      if (wasRaw !== undefined) stdin.setRawMode?.(wasRaw);
      resolve();
    };

    stdin.once('data', onData);
  });
}

// ─── API Request ──────────────────────────────────────────

export async function executeApiRequest(
  event: RecordingEvent,
  ctx: ExecutionContext
): Promise<Partial<EventResult>> {
  const config = event.apiRequest;
  if (!config) return { error: 'No apiRequest config' };

  const url = ctx.variables.resolve(config.url).trim();
  const method = config.method || 'GET';
  const timeout = config.timeout || 30000;
  const captured: Record<string, string> = {};

  // 헤더 치환
  const headers: Record<string, string> = {};
  if (config.headers) {
    for (const [k, v] of Object.entries(config.headers)) {
      headers[k] = ctx.variables.resolve(v);
    }
  }

  // usePageCookies: Playwright 컨텍스트 쿠키를 자동으로 Cookie 헤더에 추가
  if (config.usePageCookies && ctx.page) {
    try {
      const origin = new URL(url).origin;
      const cookies = await ctx.page.context().cookies(origin);
      if (cookies.length > 0) {
        const cookieHeader = cookies.map(c => `${c.name}=${c.value}`).join('; ');
        headers['Cookie'] = headers['Cookie'] ? headers['Cookie'] + '; ' + cookieHeader : cookieHeader;
      }
    } catch { /* 쿠키 추출 실패 시 무시 */ }
  }

  // body 치환
  let body: string | undefined;
  if (config.body) {
    if (typeof config.body === 'string') {
      body = ctx.variables.resolve(config.body);
    } else {
      body = JSON.stringify(ctx.variables.resolveObject(config.body));
      if (!headers['Content-Type']) headers['Content-Type'] = 'application/json';
    }
  }

  const apiStart = Date.now();
  const controller = new AbortController();
  // body 읽기까지 포함하여 전체 타임아웃 — clearTimeout을 응답 완료 후에 호출
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(url, {
      method,
      headers,
      body: method !== 'GET' ? body : undefined,
      signal: controller.signal,
    });

    const responseHeaders: Record<string, string> = {};
    response.headers.forEach((v, k) => { responseHeaders[k] = v; });

    let responseBody: any;
    const contentType = response.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      responseBody = await response.json();
    } else {
      responseBody = await response.text();
    }

    // body 읽기 완료 후 타임아웃 해제
    clearTimeout(timeoutId);

    const apiDuration = Date.now() - apiStart;

    // 응답 변수 캡처
    if (config.captureResponseAs) {
      const val = typeof responseBody === 'string' ? responseBody : JSON.stringify(responseBody);
      ctx.variables.set(config.captureResponseAs, val);
      captured[config.captureResponseAs] = val;
    }

    // 헤더 변수 캡처
    if (config.captureHeaders) {
      for (const [headerName, varName] of Object.entries(config.captureHeaders)) {
        const val = responseHeaders[headerName.toLowerCase()] || '';
        ctx.variables.set(varName, val);
        captured[varName] = val;
      }
    }

    // JSON path 변수 캡처
    if (config.captureJsonPath && responseBody && typeof responseBody === 'object') {
      for (const [jsonPath, varName] of Object.entries(config.captureJsonPath)) {
        try {
          const val = resolveJsonPath(responseBody, jsonPath);
          const strVal = val !== undefined && val !== null ? (typeof val === 'object' ? JSON.stringify(val) : String(val)) : '';
          ctx.variables.set(varName, strVal);
          captured[varName] = strVal;
        } catch { /* JSON path 해석 실패 시 무시 */ }
      }
    }

    // captureExpression: JS 표현식으로 응답 가공 후 변수 저장
    if (config.captureExpression && config.captureExpressionAs) {
      try {
        // {{변수}} 치환 후 expression 평가
        const resolvedExpr = ctx.variables.resolve(config.captureExpression);
        const fn = new Function('res', `return (${resolvedExpr})(res)`);
        const result = fn(responseBody);
        const strVal = result !== undefined && result !== null ? (typeof result === 'object' ? JSON.stringify(result) : String(result)) : '';
        ctx.variables.set(config.captureExpressionAs, strVal);
        captured[config.captureExpressionAs] = strVal;
      } catch (exprErr: any) {
        /* captureExpression 실행 실패 시 에러를 기록하되 계속 진행 */
        captured[config.captureExpressionAs] = `[Expression Error: ${exprErr.message}]`;
      }
    }

    // 저장된 API response를 context에 반영
    ctx.lastApiResponse = { status: response.status, headers: responseHeaders, body: responseBody };

    // expectedStatus 검사 (명시적)
    if (config.expectedStatus && response.status !== config.expectedStatus) {
      return {
        error: `API responded ${response.status}, expected ${config.expectedStatus}`,
        apiResponse: { status: response.status, headers: responseHeaders, body: responseBody, duration: apiDuration },
        capturedVariables: Object.keys(captured).length > 0 ? captured : undefined,
      };
    }

    // Default: 4xx/5xx 응답은 실패로 처리 (expectedStatus 미지정 시)
    if (!config.expectedStatus && response.status >= 400) {
      return {
        error: `API HTTP error ${response.status}: ${method} ${url}`,
        apiResponse: { status: response.status, headers: responseHeaders, body: responseBody, duration: apiDuration },
        capturedVariables: Object.keys(captured).length > 0 ? captured : undefined,
      };
    }

    // successCondition 검사 (응답 body 기반 pass/fail)
    if (config.successCondition && responseBody != null) {
      const { jsonPath, operator, expected } = config.successCondition;
      const resolvedExpected = ctx.variables.resolve(expected);
      let actual: any;
      try {
        actual = typeof responseBody === 'object'
          ? resolveJsonPath(responseBody, jsonPath)
          : responseBody;
      } catch { actual = undefined; }

      const passed = evaluateCondition(actual, operator, resolvedExpected);
      if (!passed) {
        return {
          error: `API 성공 조건 실패: ${jsonPath} ${operator} "${resolvedExpected}" (실제값: ${JSON.stringify(actual)})`,
          apiResponse: { status: response.status, headers: responseHeaders, body: responseBody, duration: apiDuration },
          capturedVariables: Object.keys(captured).length > 0 ? captured : undefined,
        };
      }
    }

    return {
      apiResponse: { status: response.status, headers: responseHeaders, body: responseBody, duration: apiDuration },
      capturedVariables: Object.keys(captured).length > 0 ? captured : undefined,
    };
  } catch (err: any) {
    clearTimeout(timeoutId);
    if (err.name === 'AbortError') {
      return {
        error: `API 타임아웃 (${timeout}ms): ${method} ${url}`,
        apiResponse: { status: 0, headers: {}, body: null, duration: Date.now() - apiStart },
      };
    }
    return { error: `API request failed: ${err.message}` };
  }
}

// ─── Set Variable ─────────────────────────────────────────

export async function executeSetVariable(
  event: RecordingEvent,
  ctx: ExecutionContext
): Promise<Partial<EventResult>> {
  const name = event.variableName;
  if (!name) return { error: 'No variableName specified' };

  const captured: Record<string, string> = {};

  if (event.variableExpression) {
    // JS expression 평가 (page context 또는 간단한 eval)
    try {
      let result: string;
      if (ctx.page) {
        const code = ctx.variables.resolve(event.variableExpression);
        result = String(await ctx.page.evaluate(code));
      } else {
        // page 없으면 변수 컨텍스트만으로 평가
        const code = ctx.variables.resolve(event.variableExpression);
        const fn = new Function('vars', `return ${code}`);
        result = String(fn(ctx.variables.getAll()));
      }
      ctx.variables.set(name, result);
      captured[name] = result;
    } catch (err: any) {
      return { error: `Expression eval failed: ${err.message}` };
    }
  } else if (event.variableValue !== undefined) {
    const resolved = ctx.variables.resolve(event.variableValue);
    ctx.variables.set(name, resolved);
    captured[name] = resolved;
  } else {
    return { error: 'No variableValue or variableExpression specified' };
  }

  return { capturedVariables: captured };
}

// ─── Run Script ───────────────────────────────────────────

export async function executeRunScript(
  event: RecordingEvent,
  ctx: ExecutionContext
): Promise<Partial<EventResult>> {
  const config = event.script;
  if (!config) return { error: 'No script config' };

  const code = ctx.variables.resolve(config.code);
  const timeout = config.timeout || 10000;
  const captured: Record<string, string> = {};

  try {
    let output: string;

    if (config.language === 'javascript') {
      if (ctx.page) {
        output = String(await ctx.page.evaluate(code));
      } else {
        const fn = new Function('vars', code);
        output = String(fn(ctx.variables.getAll()));
      }
    } else {
      // shell
      output = execSync(code, { encoding: 'utf-8', timeout }).trim();
    }

    if (config.captureOutputAs) {
      ctx.variables.set(config.captureOutputAs, output);
      captured[config.captureOutputAs] = output;
    }

    return { capturedVariables: Object.keys(captured).length > 0 ? captured : undefined };
  } catch (err: any) {
    return { error: `Script execution failed: ${err.message}` };
  }
}

// ─── Assert Step ──────────────────────────────────────────

export async function executeAssert(
  event: RecordingEvent,
  ctx: ExecutionContext
): Promise<{ assertionResults: AssertionResult[]; error?: string }> {
  const assertions = event.assertions || (event.assertion ? [event.assertion] : []);
  if (assertions.length === 0) return { assertionResults: [], error: 'No assertions defined' };

  const assertCtx: AssertionContext = {
    page: ctx.page,
    iosController: ctx.iosController,
    variables: ctx.variables,
    lastApiResponse: ctx.lastApiResponse,
    networkLogs: ctx.networkLogs,
  };

  let results = await ctx.assertionEngine.evaluateAll(assertions, assertCtx);

  // 비디오 어설션 실패 시 재시도 (라이브 스트림 로딩 지연 대응)
  results = await retryVideoAssertions(assertions, results, assertCtx, ctx.assertionEngine);

  // optional이 아닌 것 중에 fail이 있으면 step 실패
  const nonOptionalFails = results.filter(r => !r.passed && !r.assertion.optional);
  const error = nonOptionalFails.length > 0
    ? nonOptionalFails.map(r => r.error || 'Assertion failed').join('; ')
    : undefined;

  return { assertionResults: results, error };
}

// ─── Post-Step Assertions ─────────────────────────────────

/** 기존 이벤트(click, fill 등) 실행 후 부착된 어설션을 평가 */
export async function evaluatePostStepAssertions(
  event: RecordingEvent,
  ctx: ExecutionContext
): Promise<AssertionResult[]> {
  const assertions = event.assertions || (event.assertion ? [event.assertion] : []);
  if (assertions.length === 0) return [];

  // ios_screen_changed assertion에 이전 pageSource 주입
  for (const assertion of assertions) {
    if (assertion.type === 'ios_screen_changed' && ctx.lastIOSPageSource && !assertion.previousPageSource) {
      assertion.previousPageSource = ctx.lastIOSPageSource;
    }
  }

  const assertCtx: AssertionContext = {
    page: ctx.page,
    iosController: ctx.iosController,
    variables: ctx.variables,
    lastApiResponse: ctx.lastApiResponse,
    networkLogs: ctx.networkLogs,
  };

  let results = await ctx.assertionEngine.evaluateAll(assertions, assertCtx);

  // 비디오 어설션 실패 시 재시도 (라이브 스트림 로딩 지연 대응)
  results = await retryVideoAssertions(assertions, results, assertCtx, ctx.assertionEngine);

  return results;
}

// ─── JSON Path 해석 유틸 ─────────────────────────────────

/** 간단한 JSON path 해석: $.data.user.id, $.items[0].name 등 지원 */
function resolveJsonPath(obj: any, path: string): any {
  if (!obj || !path) return undefined;
  // $. 접두사 제거
  let p = path.startsWith('$.') ? path.slice(2) : path.startsWith('$') ? path.slice(1) : path;
  if (p.startsWith('.')) p = p.slice(1);

  const segments = p.split(/\.|\[(\d+)\]/).filter(Boolean);
  let current = obj;
  for (const seg of segments) {
    if (current === undefined || current === null) return undefined;
    const idx = Number(seg);
    if (!isNaN(idx) && Array.isArray(current)) {
      current = current[idx];
    } else {
      current = current[seg];
    }
  }
  return current;
}

// ─── Success Condition 평가 ───────────────────────────────

function evaluateCondition(actual: any, op: string, expected: string): boolean {
  const strActual = actual != null ? String(actual) : '';
  const numActual = Number(actual);
  const numExpected = Number(expected);
  switch (op) {
    case '==':  return strActual === expected;
    case '!=':  return strActual !== expected;
    case '>':   return numActual > numExpected;
    case '>=':  return numActual >= numExpected;
    case '<':   return numActual < numExpected;
    case '<=':  return numActual <= numExpected;
    case 'contains':     return strActual.includes(expected);
    case 'not_contains': return !strActual.includes(expected);
    default: return true;
  }
}

// ─── Extract Transform 파이프라인 ─────────────────────────

function applyTransforms(value: string, transforms: ExtractTransform[]): string {
  let result = value;
  for (const t of transforms) {
    switch (t.type) {
      case 'trim':
        result = result.trim();
        break;
      case 'regex': {
        if (!t.pattern) break;
        const regex = new RegExp(t.pattern);
        const match = result.match(regex);
        if (match) {
          const group = t.group !== undefined ? t.group : 1;
          result = match[group] !== undefined ? match[group] : match[0];
        }
        break;
      }
      case 'replace': {
        if (!t.pattern) break;
        result = result.replace(new RegExp(t.pattern, 'g'), t.replacement || '');
        break;
      }
      case 'number_only':
        result = result.replace(/[^\d.-]/g, '');
        break;
      case 'jsonPath': {
        if (!t.pattern) break;
        try {
          const parsed = JSON.parse(result);
          const extracted = resolveJsonPath(parsed, t.pattern);
          result = extracted !== undefined && extracted !== null
            ? (typeof extracted === 'object' ? JSON.stringify(extracted) : String(extracted))
            : '';
        } catch { /* JSON 파싱 실패 시 원본 유지 */ }
        break;
      }
    }
  }
  return result;
}

// ─── Extract Data ─────────────────────────────────────────

export async function executeExtractData(
  event: RecordingEvent,
  ctx: ExecutionContext
): Promise<Partial<EventResult>> {
  const config = event.extractData;
  if (!config) return { error: 'No extractData config' };

  const captured: Record<string, string> = {};

  try {
    let result: string;

    // URL 추출 타입은 page의 URL에서 직접 추출 (selector 불필요)
    if (config.extractType === 'url_param' || config.extractType === 'url_path') {
      if (!ctx.page) return { error: 'No page context for URL extraction' };
      const currentUrl = ctx.page.url();
      const parsed = new URL(currentUrl);

      if (config.extractType === 'url_param') {
        const paramName = config.urlParam || config.selector; // urlParam 우선, fallback to selector
        result = parsed.searchParams.get(paramName) || '';
      } else {
        // url_path: 경로 세그먼트 추출 (예: /orders/12345 에서 인덱스 1 = "12345")
        const pathParts = parsed.pathname.split('/').filter(Boolean);
        const idx = config.urlPathIndex !== undefined ? config.urlPathIndex : 0;
        result = pathParts[idx] || '';
      }
    } else {
      // DOM 기반 추출 — page 필요
      if (!ctx.page) return { error: 'No page context for extract_data' };

      // ── Within Scope for extract_data ──
      let scopeRoot: Page | Locator = ctx.page;
      if (event.within?.selector) {
        const withinSel = ctx.variables.resolve(event.within.selector);
        let scopeLocator = ctx.page.locator(withinSel);
        if (event.within.hasText) {
          const withinText = ctx.variables.resolve(event.within.hasText);
          scopeLocator = scopeLocator.filter({ hasText: withinText });
        }
        scopeRoot = scopeLocator.first();
      }

      const selector = ctx.variables.resolve(config.selector);

      if (config.extractType === 'count') {
        const count = await scopeRoot.locator(selector).count();
        result = String(count);
      } else {
        switch (config.extractType) {
          case 'text':
            result = (await scopeRoot.locator(selector).first().textContent()) || '';
            break;
          case 'attribute':
            if (!config.attribute) return { error: 'No attribute specified for extractType=attribute' };
            result = (await scopeRoot.locator(selector).first().getAttribute(config.attribute)) || '';
            break;
          case 'innerHTML':
            result = await scopeRoot.locator(selector).first().innerHTML();
            break;
          case 'value':
            result = await scopeRoot.locator(selector).first().inputValue();
            break;
          case 'table': {
            const rowSel = config.rowSelector || 'tr';
            const cellSel = config.cellSelector || 'td,th';
            const rows = scopeRoot.locator(selector).locator(rowSel);
            const rowCount = await rows.count();
            const table: string[][] = [];
            for (let r = 0; r < rowCount; r++) {
              const cells = rows.nth(r).locator(cellSel);
              const cellCount = await cells.count();
              const row: string[] = [];
              for (let c = 0; c < cellCount; c++) {
                row.push((await cells.nth(c).textContent()) || '');
              }
              table.push(row);
            }
            result = JSON.stringify(table);
            break;
          }
          case 'list': {
            const items = scopeRoot.locator(selector);
            const count = await items.count();
            const list: string[] = [];
            for (let j = 0; j < count; j++) {
              list.push((await items.nth(j).textContent()) || '');
            }
            result = JSON.stringify(list);
            break;
          }
          default:
            return { error: `Unknown extractType: ${config.extractType}` };
        }
      }
    }

    // Transform 파이프라인 적용
    if (config.transform && config.transform.length > 0) {
      result = applyTransforms(result, config.transform);
    }

    // assertNotEmpty 검사
    if (config.assertNotEmpty && (!result || !result.trim())) {
      return {
        error: `Extract data for "${config.captureAs}": value is empty (assertNotEmpty)`,
        capturedVariables: { [config.captureAs]: '' },
      };
    }

    ctx.variables.set(config.captureAs, result);
    captured[config.captureAs] = result;
    return { capturedVariables: captured };
  } catch (err: any) {
    return { error: `Data extraction failed: ${err.message}` };
  }
}

// ─── Wait For (자동 대기) ─────────────────────────────────

export async function executeWaitFor(
  event: RecordingEvent,
  ctx: ExecutionContext
): Promise<Partial<EventResult>> {
  const config = event.waitForConfig;
  if (!config) return { error: 'No waitForConfig' };

  const timeout = config.timeout || 30000;

  try {
    switch (config.waitType) {
      // ─── iOS 대기 타입 ──────────────────────────────────
      case 'ios_element_visible':
        return await executeIOSWaitFor(config, ctx, 'visible');
      case 'ios_element_not_exists':
        return await executeIOSWaitFor(config, ctx, 'not_exists');
      case 'ios_text_contains':
        return await executeIOSWaitForText(config, ctx);

      // ─── 웹 대기 타입 ──────────────────────────────────
      case 'element_visible': {
        if (!ctx.page) return { error: 'No page context for wait_for' };
        const sel = ctx.variables.resolve(config.selector || '');
        if (!sel) return { error: 'No selector for element_visible wait' };
        await ctx.page.locator(sel).first().waitFor({ state: 'visible', timeout });
        break;
      }
      case 'element_hidden': {
        if (!ctx.page) return { error: 'No page context for wait_for' };
        const sel = ctx.variables.resolve(config.selector || '');
        if (!sel) return { error: 'No selector for element_hidden wait' };
        await ctx.page.locator(sel).first().waitFor({ state: 'hidden', timeout });
        break;
      }
      case 'url_change': {
        if (!ctx.page) return { error: 'No page context for wait_for' };
        const pattern = ctx.variables.resolve(config.urlPattern || '');
        if (!pattern) return { error: 'No urlPattern for url_change wait' };

        const globPattern = `**/*${pattern}*`;
        const currentUrl = ctx.page.url();

        // 이미 URL이 매칭된 상태면 즉시 성공 (click이 이미 URL을 바꾼 경우)
        const alreadyMatched = currentUrl.includes(pattern);
        if (!alreadyMatched) {
          const waitUntil = config.waitUntil || 'domcontentloaded';
          await ctx.page.waitForURL(globPattern, { waitUntil, timeout });
        }
        break;
      }
      case 'network_idle':
        if (!ctx.page) return { error: 'No page context for wait_for' };
        await ctx.page.waitForLoadState('networkidle', { timeout });
        break;
      default:
        return { error: `Unknown waitType: ${config.waitType}` };
    }
    return {};
  } catch (err: any) {
    return { error: `Wait condition failed: ${err.message}` };
  }
}

// ─── iOS Wait For (pageSource 폴링 기반) ──────────────────

/**
 * iOS 요소 대기: pageSource를 주기적으로 폴링하며
 * 지정 요소가 나타나거나(visible) 사라질 때까지(not_exists) 대기
 */
async function executeIOSWaitFor(
  config: import('../types').WaitForConfig,
  ctx: ExecutionContext,
  mode: 'visible' | 'not_exists'
): Promise<Partial<EventResult>> {
  if (!ctx.iosController) return { error: 'No iOS controller for ios wait_for' };

  const selector = config.iosSelector;
  if (!selector) return { error: 'No iosSelector for iOS wait_for' };

  const timeout = config.timeout || 30000;
  const pollInterval = config.pollInterval || 1000;
  const deadline = Date.now() + timeout;

  const { parsePageSource, findElementBySelector } = await import('../ios/page-source-utils');

  while (Date.now() < deadline) {
    try {
      const xml = await ctx.iosController.getPageSource?.();
      if (xml && typeof xml === 'string') {
        const elements = parsePageSource(xml);
        const found = findElementBySelector(elements, selector);

        if (mode === 'visible' && found && found.visible) {
          return {};  // 요소 발견 + visible → 성공
        }
        if (mode === 'not_exists' && !found) {
          return {};  // 요소 미존재 → 성공
        }
      }
    } catch {
      // pageSource 조회 실패는 무시하고 재시도
    }

    // 타임아웃 초과 확인 후 폴링
    if (Date.now() + pollInterval > deadline) break;
    await sleep(pollInterval);
  }

  const desc = mode === 'visible'
    ? `iOS 요소가 ${timeout}ms 내에 나타나지 않음: ${selector.strategy}=${selector.value}`
    : `iOS 요소가 ${timeout}ms 내에 사라지지 않음: ${selector.strategy}=${selector.value}`;
  return { error: desc };
}

/**
 * iOS 텍스트 대기: pageSource를 주기적으로 폴링하며
 * 특정 텍스트가 포함될 때까지 대기
 */
async function executeIOSWaitForText(
  config: import('../types').WaitForConfig,
  ctx: ExecutionContext
): Promise<Partial<EventResult>> {
  if (!ctx.iosController) return { error: 'No iOS controller for ios_text_contains wait' };

  const expectedText = config.iosExpectedText;
  if (!expectedText) return { error: 'No iosExpectedText for ios_text_contains wait' };

  const resolved = ctx.variables.resolve(expectedText);
  const timeout = config.timeout || 30000;
  const pollInterval = config.pollInterval || 1000;
  const deadline = Date.now() + timeout;

  while (Date.now() < deadline) {
    try {
      const xml = await ctx.iosController.getPageSource?.();
      if (xml && typeof xml === 'string' && xml.includes(resolved)) {
        return {};  // 텍스트 발견 → 성공
      }
    } catch {
      // pageSource 조회 실패는 무시하고 재시도
    }

    if (Date.now() + pollInterval > deadline) break;
    await sleep(pollInterval);
  }

  return { error: `iOS 화면에 "${resolved}" 텍스트가 ${timeout}ms 내에 나타나지 않음` };
}

// ─── If Condition 평가 ────────────────────────────────────

export async function evaluateIfCondition(
  event: RecordingEvent,
  ctx: ExecutionContext
): Promise<boolean> {
  const config = event.ifCondition;
  if (!config) return false;

  try {
    switch (config.conditionType) {
      case 'element_exists': {
        if (!ctx.page || !config.selector) return false;
        const sel = ctx.variables.resolve(config.selector);
        const count = await ctx.page.locator(sel).count();
        return count > 0;
      }
      case 'element_visible': {
        if (!ctx.page || !config.selector) return false;
        const sel = ctx.variables.resolve(config.selector);
        try {
          return await ctx.page.locator(sel).first().isVisible();
        } catch {
          return false;
        }
      }
      case 'variable_equals': {
        if (!config.variable) return false;
        const actual = ctx.variables.get(config.variable) || '';
        const expected = ctx.variables.resolve(config.expected || '');
        return actual === expected;
      }
      case 'variable_contains': {
        if (!config.variable) return false;
        const actual = ctx.variables.get(config.variable) || '';
        const expected = ctx.variables.resolve(config.expected || '');
        return actual.includes(expected);
      }
      case 'url_contains': {
        if (!ctx.page) return false;
        const pattern = ctx.variables.resolve(config.expected || '');
        return ctx.page.url().includes(pattern);
      }
      case 'ios_alert_present': {
        // iOS 시스템 알럿 존재 여부 확인 (Appium W3C Alert API)
        if (!ctx.iosController) return false;
        try {
          return await ctx.iosController.isAlertPresent();
        } catch {
          return false;
        }
      }
      case 'ios_element_visible':
      case 'ios_element_exists': {
        // iOS 요소 조건: iosSelector 또는 pageSource 기반 검색
        if (!config.iosSelector) return false;

        // 방법 1: Appium find element로 요소 존재 확인
        if (ctx.iosController) {
          try {
            const controller = ctx.iosController;
            const { executeAppiumAction } = await import('@katab/device-manager');
            const sessionId = controller.currentSessionId;
            const serverUrl = controller.serverUrl;
            if (!sessionId) return false;

            let using: string;
            let value = config.iosSelector.value;
            const xcuiType = config.iosElementType ? `XCUIElementType${config.iosElementType}` : null;

            switch (config.iosSelector.strategy) {
              case 'accessibility_id':
                using = 'accessibility id';
                break;
              case 'name':
                if (xcuiType) {
                  using = '-ios predicate string';
                  value = `type == '${xcuiType}' AND name == '${config.iosSelector.value}'`;
                } else {
                  using = 'name';
                }
                break;
              case 'label':
                using = '-ios predicate string';
                value = xcuiType
                  ? `type == '${xcuiType}' AND label == "${config.iosSelector.value}"`
                  : `label == "${config.iosSelector.value}"`;
                break;
              default:
                using = 'name';
            }

            const resp = await executeAppiumAction(serverUrl, sessionId, 'element', { using, value });
            const elementId = resp.value?.ELEMENT || resp.value?.elementId;
            if (!elementId) return false;

            if (config.conditionType === 'ios_element_visible') {
              // displayed 속성으로 가시성 확인
              try {
                const attrResp = await executeAppiumAction(serverUrl, sessionId, `element/${elementId}/displayed`, {});
                return attrResp.value === true;
              } catch {
                return true; // displayed API 실패 시 존재하면 visible로 간주
              }
            }
            return true; // ios_element_exists: 요소가 있으면 true
          } catch {
            return false;
          }
        }

        // 방법 2: pageSource XML에서 검색 (iosController 없는 경우)
        if (ctx.lastIOSPageSource && config.iosSelector.value) {
          const xml = ctx.lastIOSPageSource;
          const searchValue = config.iosSelector.value;
          // name 또는 label 속성에서 검색
          const namePattern = new RegExp(`name="${searchValue.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"`);
          const labelPattern = new RegExp(`label="${searchValue.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"`);
          return namePattern.test(xml) || labelPattern.test(xml);
        }

        return false;
      }
      case 'custom': {
        if (!config.expression) return false;
        const code = ctx.variables.resolve(config.expression);
        if (ctx.page) {
          return Boolean(await ctx.page.evaluate(code));
        }
        const fn = new Function('vars', `return ${code}`);
        return Boolean(fn(ctx.variables.getAll()));
      }
      default:
        return false;
    }
  } catch {
    return false;
  }
}

// ─── Image Match ─────────────────────────────────────────

/**
 * 화면 스크린샷과 기준 이미지를 pixelmatch로 비교
 * DOM이 없는 웹뷰/하이브리드 앱에서 요소 출현 확인용
 *
 * Web replayer: page.screenshot() 사용
 * iOS replayer: controller.screenshot() 사용
 */
export async function executeImageMatch(
  event: RecordingEvent,
  ctx: ExecutionContext
): Promise<Partial<EventResult>> {
  const cfg = event.imageMatchConfig;
  if (!cfg || !cfg.templateBase64) {
    return { error: 'image_match: templateBase64가 설정되지 않음' };
  }

  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const pixelmatch = require('pixelmatch');
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { PNG } = require('pngjs');

  const timeout = cfg.timeout ?? 10000;
  const poll = cfg.pollInterval ?? 500;
  const threshold = cfg.threshold ?? 0.1;
  const maxDiffPercent = cfg.maxDiffPercent ?? 5;
  const deadline = Date.now() + timeout;

  // 기준 이미지 디코딩
  const templateBuf = Buffer.from(cfg.templateBase64, 'base64');
  const template = PNG.sync.read(templateBuf);

  // 마지막 비교 데이터 보관 (report용)
  let lastShotBase64 = '';
  let lastDiffBase64 = '';
  let lastDiffPercent = 100;

  while (Date.now() < deadline) {
    try {
      let shotBuf: Buffer;

      if (ctx.page) {
        // Web replayer: Playwright screenshot
        const screenshotOpts: any = {};
        if (cfg.clip) screenshotOpts.clip = cfg.clip;
        shotBuf = await ctx.page.screenshot(screenshotOpts) as Buffer;
      } else if (ctx.iosController) {
        // iOS replayer: controller screenshot
        const base64 = await ctx.iosController.screenshot();
        shotBuf = Buffer.from(base64, 'base64');
      } else {
        return { error: 'image_match: page 또는 iosController가 없음' };
      }

      const shot = PNG.sync.read(shotBuf);

      // clip이 있고 web이 아닌 경우(iOS), 수동으로 crop
      let croppedShot: any = shot;
      if (cfg.clip && !ctx.page) {
        const { x, y, width, height } = cfg.clip;
        const cropped = new PNG({ width, height });
        PNG.bitblt(shot, cropped, x, y, width, height, 0, 0);
        croppedShot = cropped;
      }

      // 크기가 다르면 실패하지 않고 재시도
      if (croppedShot.width !== template.width || croppedShot.height !== template.height) {
        // 크기 불일치 시에도 스크린샷은 보관
        lastShotBase64 = PNG.sync.write(croppedShot).toString('base64');
        await sleep(poll);
        continue;
      }

      // diff 이미지 생성
      const diffOutput = new PNG({ width: template.width, height: template.height });
      const totalPixels = template.width * template.height;
      const diffPixels = pixelmatch(
        template.data, croppedShot.data, diffOutput.data,
        template.width, template.height,
        { threshold }
      );

      const diffPercent = (diffPixels / totalPixels) * 100;

      // 비교 데이터 보관
      lastShotBase64 = PNG.sync.write(croppedShot).toString('base64');
      lastDiffBase64 = PNG.sync.write(diffOutput).toString('base64');
      lastDiffPercent = diffPercent;

      if (diffPercent <= maxDiffPercent) {
        return {
          // 성공: diff 정보 포함
          imageMatchData: {
            templateBase64: cfg.templateBase64,
            screenshotBase64: lastShotBase64,
            diffBase64: lastDiffBase64,
            diffPercent: Math.round(diffPercent * 100) / 100,
            matched: true,
            clip: cfg.clip,
          },
        };
      }

      // diff가 너무 큰 경우 재시도
      await sleep(poll);
    } catch (e: any) {
      // 스크린샷 실패 시 재시도
      await sleep(poll);
    }
  }

  return {
    error: `image_match: ${timeout}ms 내에 이미지 매칭 실패 (threshold=${threshold}, maxDiffPercent=${maxDiffPercent}%, lastDiff=${Math.round(lastDiffPercent * 100) / 100}%)`,
    imageMatchData: lastShotBase64 ? {
      templateBase64: cfg.templateBase64,
      screenshotBase64: lastShotBase64,
      diffBase64: lastDiffBase64 || undefined,
      diffPercent: Math.round(lastDiffPercent * 100) / 100,
      matched: false,
      clip: cfg.clip,
    } : undefined,
  };
}

// ─── OCR Extract ──────────────────────────────────────────

/**
 * 이미지에서 OCR로 텍스트를 추출하여 변수에 저장.
 *
 * 실행 흐름:
 * 1. source에 따라 element/region/page 스크린샷 캡처 (PNG buffer)
 * 2. 전처리 (grayscale, threshold, scale, invert)
 * 3. OCR 수행 (로컬 Tesseract 1차 → 실패 시 전처리 변경 재시도)
 * 4. 후처리 (regex, stripSpaces, upper/lower, trim)
 * 5. confidence 검사
 * 6. vars[targetVar] = processedText
 * 7. 디버그 아티팩트 저장 (out/ocr/)
 */
export async function executeOcrExtract(
  event: RecordingEvent,
  ctx: ExecutionContext,
  reportDir?: string,
): Promise<Partial<EventResult>> {
  const config = event.ocrConfig;
  if (!config) return { error: 'No ocrConfig specified' };
  if (!config.targetVar) return { error: 'No targetVar specified in ocrConfig' };

  // 엔진 가드
  const engine = config.engine || 'tesseract';
  if (engine !== 'tesseract' && engine !== 'claude_vision') {
    return { error: `ocr_extract: 지원하지 않는 OCR 엔진 "${engine}". tesseract 또는 claude_vision만 지원됩니다.` };
  }

  const captured: Record<string, string> = {};
  const timeout = config.timeoutMs || 15000;
  const deadline = Date.now() + timeout;
  const confidenceThreshold = config.confidenceThreshold ?? 0.0;
  const shouldRetry = config.retryWithPreprocess !== false;
  const psm = config.psm ?? 6; // 기본 6 (uniform block), 캡차용 7 (single line) 권장
  const charWhitelist = config.charWhitelist; // 문자 제한 (예: '0123456789')

  try {
    // ── Step 1: 이미지 캡처 ──
    let imageBuf: Buffer;

    if (config.source === 'element') {
      if (!ctx.page) return { error: 'ocr_extract: page context가 없음' };
      if (!config.selector) return { error: 'ocr_extract: source=element일 때 selector 필수' };

      const selector = ctx.variables.resolve(config.selector);
      const locator = ctx.page.locator(selector).first();
      await locator.waitFor({ state: 'visible', timeout: Math.min(5000, Math.max(deadline - Date.now(), 0)) });

      // element 스크린샷 (padding 추가: 글자가 테두리에 붙는 경우 정확도 향상)
      imageBuf = await locator.screenshot({ timeout: Math.min(5000, Math.max(deadline - Date.now(), 0)) }) as Buffer;

    } else if (config.source === 'viewport') {
      if (!ctx.page) return { error: 'ocr_extract: page context가 없음' };
      if (!config.region) return { error: 'ocr_extract: source=viewport일 때 region 필수' };

      imageBuf = await ctx.page.screenshot({
        clip: config.region,
        timeout: Math.min(5000, Math.max(deadline - Date.now(), 0)),
      }) as Buffer;

    } else {
      // page: 전체 페이지 스크린샷
      if (!ctx.page) return { error: 'ocr_extract: page context가 없음' };
      imageBuf = await ctx.page.screenshot({
        timeout: Math.min(5000, Math.max(deadline - Date.now(), 0)),
      }) as Buffer;
    }

    // ── Step 2: 이미지 전처리 (pngjs 기반) ──
    const preprocessOpts = config.preprocess || {};
    const processedBuf = preprocessImage(imageBuf, preprocessOpts);

    // ── Step 3: OCR 수행 ──
    let ocrText = '';
    let confidence = 0;
    let engineUsed = engine;
    let retryCount = 0;

    if (engine === 'claude_vision') {
      // Claude Vision API 사용
      const result = await runClaudeVisionOcr(imageBuf, config.charWhitelist, deadline);
      ocrText = result.text;
      confidence = result.confidence;
    } else {
      // Tesseract 사용
      const firstResult = await runTesseractOcr(processedBuf, config.language || 'eng', deadline, psm, charWhitelist);
      ocrText = firstResult.text;
      confidence = firstResult.confidence;

      // confidence 미달 + 재시도 가능 시: 전처리 변경 후 재시도
      if (confidence < confidenceThreshold && shouldRetry && Date.now() < deadline) {
        retryCount++;
        const altPreprocess: OcrPreprocess = {
          ...preprocessOpts,
          grayscale: true,
          threshold: true,
          scale: (preprocessOpts.scale || 1) >= 2 ? 3 : 2,
        };
        const altBuf = preprocessImage(imageBuf, altPreprocess);
        const altResult = await runTesseractOcr(altBuf, config.language || 'eng', deadline, psm, charWhitelist);

        if (altResult.confidence > confidence) {
          ocrText = altResult.text;
          confidence = altResult.confidence;
        }
      }
    }

    // ── Step 4: 후처리 ──
    let processedText = ocrText;
    if (config.postprocess) {
      const pp = config.postprocess;
      if (pp.trimWhitespace !== false) processedText = processedText.trim();
      if (pp.stripSpaces) processedText = processedText.replace(/\s+/g, '');
      if (pp.regex) {
        try {
          const regex = new RegExp(pp.regex);
          const match = processedText.match(regex);
          if (match) {
            processedText = match[1] !== undefined ? match[1] : match[0];
          } else {
            // regex 매칭 실패 → OCR 결과가 기대한 형식이 아님
            const ocrResult: OcrResult = {
              rawText: ocrText,
              processedText,
              confidence,
              engine: engineUsed,
              preprocessApplied: preprocessOpts,
              retryCount,
            };
            return {
              error: `ocr_extract: 후처리 regex "${pp.regex}" 매칭 실패 (OCR 원본: "${ocrText.substring(0, 50)}")`,
              ocrResult,
              capturedVariables: { [config.targetVar]: '' },
            };
          }
        } catch { /* regex 오류 시 원본 유지 */ }
      }
      if (pp.upper) processedText = processedText.toUpperCase();
      if (pp.lower) processedText = processedText.toLowerCase();
    }

    // ── Step 5: confidence 검사 ──
    if (confidence < confidenceThreshold) {
      const ocrResult: OcrResult = {
        rawText: ocrText,
        processedText,
        confidence,
        engine: engineUsed,
        preprocessApplied: preprocessOpts,
        retryCount,
      };
      return {
        error: `ocr_extract: 신뢰도 미달 (${(confidence * 100).toFixed(1)}% < ${(confidenceThreshold * 100).toFixed(1)}%)`,
        ocrResult,
        capturedVariables: { [config.targetVar]: processedText },
      };
    }

    // ── Step 6: 변수 저장 ──
    ctx.variables.set(config.targetVar, processedText);
    captured[config.targetVar] = processedText;

    // ── Step 7: 디버그 아티팩트 저장 ──
    let imagePath: string | undefined;
    if (reportDir) {
      try {
        const { mkdirSync, writeFileSync, existsSync } = await import('fs');
        const { join, resolve: resolvePath } = await import('path');
        const ocrDir = join(reportDir, 'ocr');
        if (!existsSync(ocrDir)) mkdirSync(ocrDir, { recursive: true });

        // targetVar sanitize: 파일명에 안전한 문자만 허용 (path traversal 방지)
        const targetVarSafe = config.targetVar.replace(/[^A-Za-z0-9_.-]/g, '_');
        const stepNo = event.stepNo || 0;
        const imgFile = join(ocrDir, `step_${String(stepNo).padStart(3, '0')}_${targetVarSafe}.png`);

        // 경로가 ocrDir 내부인지 검증 (이중 안전장치)
        if (!resolvePath(imgFile).startsWith(resolvePath(ocrDir))) {
          throw new Error('아티팩트 경로가 허용된 디렉토리를 벗어남');
        }

        writeFileSync(imgFile, processedBuf);
        imagePath = imgFile;

        // JSON 메타데이터
        const metaFile = join(ocrDir, `step_${String(stepNo).padStart(3, '0')}_${targetVarSafe}.json`);
        writeFileSync(metaFile, JSON.stringify({
          rawText: ocrText,
          processedText,
          confidence,
          engine: engineUsed,
          preprocess: preprocessOpts,
          postprocess: config.postprocess,
          retryCount,
          source: config.source,
          selector: config.selector,
          region: config.region,
        }, null, 2));
      } catch {
        // 아티팩트 저장 실패는 치명적이지 않음
      }
    }

    const ocrResult: OcrResult = {
      rawText: ocrText,
      processedText,
      confidence,
      engine: engineUsed,
      imagePath,
      preprocessApplied: preprocessOpts,
      retryCount,
    };

    return {
      capturedVariables: captured,
      ocrResult,
    };
  } catch (err: any) {
    return { error: `ocr_extract 실패: ${err.message}` };
  }
}

/**
 * pngjs 기반 이미지 전처리
 * - grayscale: RGB를 가중 평균 회색조로 변환
 * - threshold: 회색조 128 기준 이진화
 * - invert: 픽셀 반전
 * - scale: 이미지 확대 (nearest neighbor, OCR 정확도 향상)
 */
function preprocessImage(buf: Buffer, opts: OcrPreprocess): Buffer {
  if (!opts.grayscale && !opts.threshold && !opts.invert && (!opts.scale || opts.scale <= 1)) {
    return buf; // 전처리 불필요
  }

  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { PNG } = require('pngjs');
  let img = PNG.sync.read(buf);

  // Scale (nearest neighbor)
  if (opts.scale && opts.scale > 1) {
    const s = Math.round(opts.scale);
    const newW = img.width * s;
    const newH = img.height * s;
    const scaled = new PNG({ width: newW, height: newH });
    for (let y = 0; y < newH; y++) {
      for (let x = 0; x < newW; x++) {
        const srcX = Math.floor(x / s);
        const srcY = Math.floor(y / s);
        const srcIdx = (srcY * img.width + srcX) * 4;
        const dstIdx = (y * newW + x) * 4;
        scaled.data[dstIdx] = img.data[srcIdx];
        scaled.data[dstIdx + 1] = img.data[srcIdx + 1];
        scaled.data[dstIdx + 2] = img.data[srcIdx + 2];
        scaled.data[dstIdx + 3] = img.data[srcIdx + 3];
      }
    }
    img = scaled;
  }

  // Grayscale / Threshold / Invert
  const data = img.data;
  for (let i = 0; i < data.length; i += 4) {
    let r = data[i], g = data[i + 1], b = data[i + 2];

    if (opts.grayscale || opts.threshold) {
      const gray = Math.round(r * 0.299 + g * 0.587 + b * 0.114);
      if (opts.threshold) {
        const val = gray >= 128 ? 255 : 0;
        r = g = b = val;
      } else {
        r = g = b = gray;
      }
    }

    if (opts.invert) {
      r = 255 - r;
      g = 255 - g;
      b = 255 - b;
    }

    data[i] = r;
    data[i + 1] = g;
    data[i + 2] = b;
  }

  return PNG.sync.write(img);
}

/**
 * Claude Vision API를 사용한 OCR 수행
 * 이미지를 Claude API에 전송하여 텍스트를 추출합니다.
 * CAPTCHA 등 Tesseract로 인식이 어려운 경우에 적합합니다.
 *
 * 환경변수 ANTHROPIC_API_KEY 필요
 */
async function runClaudeVisionOcr(
  imageBuf: Buffer,
  charWhitelist?: string,
  deadline?: number,
): Promise<{ text: string; confidence: number }> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error(
      'ocr_extract(claude_vision): ANTHROPIC_API_KEY 환경변수가 설정되지 않았습니다.\n' +
      '  export ANTHROPIC_API_KEY=sk-ant-...',
    );
  }

  const base64Image = imageBuf.toString('base64');

  let promptText = '이 이미지에서 텍스트/숫자를 읽어주세요. 텍스트/숫자만 반환하고 다른 설명은 하지 마세요.';
  if (charWhitelist) {
    promptText += ` 허용되는 문자: ${charWhitelist}`;
  }

  const timeoutMs = deadline ? Math.max(deadline - Date.now(), 5000) : 30000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 100,
        messages: [{
          role: 'user',
          content: [
            {
              type: 'image',
              source: {
                type: 'base64',
                media_type: 'image/png',
                data: base64Image,
              },
            },
            {
              type: 'text',
              text: promptText,
            },
          ],
        }],
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const errBody = await response.text();
      throw new Error(`Claude API 오류 (${response.status}): ${errBody.substring(0, 200)}`);
    }

    const result = await response.json() as {
      content: Array<{ type: string; text?: string }>;
    };

    const textContent = result.content?.find((c: { type: string }) => c.type === 'text');
    const extractedText = textContent?.text?.trim() || '';

    return {
      text: extractedText,
      confidence: extractedText.length > 0 ? 0.95 : 0.0, // Claude 결과는 높은 신뢰도
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Tesseract OCR 실행 (node-tesseract-ocr 또는 CLI fallback)
 *
 * 전략:
 * 1. tesseract CLI가 설치되어 있으면 직접 호출 (가장 범용적)
 * 2. tesseract가 없으면 에러 메시지로 설치 안내
 */
async function runTesseractOcr(
  imageBuf: Buffer,
  language: string,
  deadline: number,
  psm: number = 6,
  charWhitelist?: string,
): Promise<{ text: string; confidence: number }> {
  const { writeFileSync, unlinkSync, readFileSync, existsSync } = await import('fs');
  const { join } = await import('path');
  const { spawnSync } = await import('child_process');
  const { tmpdir } = await import('os');

  // language 화이트리스트 검증 (command injection 방지)
  if (!/^[A-Za-z0-9+_]+$/.test(language)) {
    throw new Error(`ocr_extract: 유효하지 않은 language 값 "${language}". 영문/숫자/+/_ 만 허용됩니다.`);
  }

  const tmpFile = join(tmpdir(), `katab_ocr_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.png`);
  const outBase = tmpFile.replace('.png', '_out');
  const outTsv = outBase + '.tsv';
  const outTxt = outBase + '.txt';

  try {
    writeFileSync(tmpFile, imageBuf);

    const timeoutMs = Math.max(deadline - Date.now(), 1000);

    // TSV 출력으로 confidence 포함 결과 획득 (spawnSync: shell 해석 없이 args 배열로 실행)
    const psmStr = String(psm);
    const baseArgs = [tmpFile, outBase, '-l', language, '--psm', psmStr];
    // charWhitelist가 지정된 경우 tessedit_char_whitelist 옵션 추가 (숫자만 인식 등)
    if (charWhitelist && /^[A-Za-z0-9 ]+$/.test(charWhitelist)) {
      baseArgs.push('-c', `tessedit_char_whitelist=${charWhitelist}`);
    }
    const tsvResult = spawnSync('tesseract', [...baseArgs, 'tsv'], {
      encoding: 'utf-8', timeout: timeoutMs, stdio: ['pipe', 'pipe', 'pipe'],
    });

    if (tsvResult.error || tsvResult.status !== 0) {
      // tsv 실패 시 일반 텍스트 모드 폴백
      const txtResult = spawnSync('tesseract', baseArgs, {
        encoding: 'utf-8', timeout: timeoutMs, stdio: ['pipe', 'pipe', 'pipe'],
      });

      if (txtResult.error) {
        const errMsg = txtResult.error.message || '';
        if (errMsg.includes('ENOENT') || errMsg.includes('not found') || errMsg.includes('command not found')) {
          throw new Error(
            'tesseract CLI가 설치되어 있지 않습니다.\n' +
            '  macOS: brew install tesseract\n' +
            '  Ubuntu: sudo apt install tesseract-ocr\n' +
            '  한국어: brew install tesseract-lang (또는 sudo apt install tesseract-ocr-kor)',
          );
        }
        throw txtResult.error;
      }
      if (txtResult.status !== 0) {
        throw new Error(`tesseract 실행 실패 (exit code ${txtResult.status}): ${txtResult.stderr || ''}`);
      }
    }

    // 결과 파싱
    let text = '';
    let avgConfidence = 0;

    if (existsSync(outTsv)) {
      const tsv = readFileSync(outTsv, 'utf-8');
      const lines = tsv.split('\n').slice(1); // 헤더 제거
      const words: string[] = [];
      const confidences: number[] = [];

      for (const line of lines) {
        const cols = line.split('\t');
        if (cols.length >= 12) {
          const conf = parseFloat(cols[10]);
          const word = cols[11]?.trim();
          if (word && conf >= 0) {
            words.push(word);
            confidences.push(conf);
          }
        }
      }

      text = words.join(' ');
      avgConfidence = confidences.length > 0
        ? confidences.reduce((a, b) => a + b, 0) / confidences.length / 100
        : 0;
    } else if (existsSync(outTxt)) {
      text = readFileSync(outTxt, 'utf-8').trim();
      avgConfidence = text.length > 0 ? 0.5 : 0; // 텍스트 모드는 confidence 추정 불가
    }

    return { text, confidence: avgConfidence };
  } finally {
    // 임시 파일 정리
    try { unlinkSync(tmpFile); } catch { /* ignore */ }
    try { if (existsSync(outTsv)) unlinkSync(outTsv); } catch { /* ignore */ }
    try { if (existsSync(outTxt)) unlinkSync(outTxt); } catch { /* ignore */ }
  }
}

// ─── Check Email (IMAP 이메일 인증) ───────────────────────

const IMAP_PRESETS: Record<string, { host: string; port: number }> = {
  gmail:   { host: 'imap.gmail.com',        port: 993 },
  naver:   { host: 'imap.naver.com',        port: 993 },
  outlook: { host: 'outlook.office365.com', port: 993 },
};

/**
 * IMAP으로 이메일 수신함에 접속 → 인증 이메일 검색 → 본문에서 인증 링크 추출
 * → (선택) 브라우저에서 해당 링크 열기
 */
export async function executeCheckEmail(
  event: RecordingEvent,
  ctx: ExecutionContext
): Promise<Partial<EventResult>> {
  const config = event.checkEmail;
  if (!config) return { error: 'No checkEmail config' };

  const captured: Record<string, string> = {};

  // 변수 치환
  const user = ctx.variables.resolve(config.user);
  const pass = ctx.variables.resolve(config.pass);
  const from = config.from ? ctx.variables.resolve(config.from) : undefined;
  const subject = config.subject ? ctx.variables.resolve(config.subject) : undefined;

  if (!user || !pass) return { error: 'check_email: user와 pass는 필수입니다' };

  // host/port 결정
  const preset = config.provider !== 'custom' ? IMAP_PRESETS[config.provider] : null;
  const host = config.host || preset?.host;
  const port = config.port || preset?.port || 993;

  if (!host) return { error: 'check_email: host가 설정되지 않음 (custom provider일 때 host 필수)' };

  const timeout = config.timeout || 60000;
  const pollInterval = config.pollInterval || 5000;
  const linkIndex = config.linkIndex || 0;
  const navigateToLink = config.navigateToLink !== false;
  const deadline = Date.now() + timeout;

  // linkPattern 처리:
  // - 사용자가 URL 프리픽스를 그대로 넣는 경우가 많으므로
  //   "http"로 시작하고 regex 메타문자가 의도적으로 보이지 않으면 이스케이프 후 .* 추가
  // - 기본 패턴은 모든 URL 추출
  const defaultLinkPattern = 'https?://[^\\s"<>\']+';
  let linkPatternStr: string;
  if (!config.linkPattern) {
    linkPatternStr = defaultLinkPattern;
  } else if (looksLikeLiteralUrl(config.linkPattern)) {
    // URL 리터럴 → regex 특수문자 이스케이프 후 나머지 URL도 캡처
    linkPatternStr = escapeRegexForUrl(config.linkPattern) + '[^\\s"<>\']*';
  } else {
    linkPatternStr = config.linkPattern;
  }

  let linkRegex: RegExp;
  try {
    linkRegex = new RegExp(linkPatternStr, 'gi');
  } catch (regexErr: any) {
    return { error: `check_email: linkPattern 정규식 오류 — ${regexErr.message}\n  입력값: "${config.linkPattern}"\n  힌트: URL을 그대로 넣으면 자동 이스케이프됩니다. 수동 정규식은 올바른 regex 문법이어야 합니다.` };
  }

  // 스텝 시작 시간 기록
  const stepStartTime = new Date();

  const maxRetries = Math.ceil(timeout / pollInterval);
  let authVerified = false;   // 최초 인증 성공 여부
  let lastError = '';          // 마지막 에러 (진단용)

  console.log(`[check_email] ${host}:${port} / user=${user} / from=${from || '(any)'} / subject="${subject || '(any)'}"`);
  console.log(`[check_email] linkPattern: ${linkPatternStr}`);

  try {
    const { ImapFlow } = await import('imapflow');

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      if (Date.now() >= deadline) break;

      let client: InstanceType<typeof ImapFlow> | null = null;
      try {
        client = new ImapFlow({
          host,
          port,
          secure: true,
          auth: { user, pass },
          logger: false,
        });

        await client.connect();
        authVerified = true;

        const lock = await client.getMailboxLock('INBOX');
        try {
          // SEARCH 기준:
          // - seen: false (읽지 않은 메일)을 기본으로 시도
          // - since: 오늘 날짜 (IMAP SINCE는 날짜 단위 비교)
          // - from, subject: 선택적 필터
          //
          // 첫 시도에서 unseen으로 못 찾으면, seen 필터 제거 후 재검색
          // (이미 다른 클라이언트에서 읽은 경우 대비)
          const todayDate = new Date(stepStartTime);
          todayDate.setHours(0, 0, 0, 0);

          const baseCriteria: any = { since: todayDate };
          if (from) baseCriteria.from = from;
          if (subject) baseCriteria.subject = subject;

          // 1차: unseen만 검색
          let messages = await client.search({ ...baseCriteria, seen: false });

          // 2차: unseen이 없으면 seen 포함 전체 검색 (이미 읽힌 이메일도 확인)
          if (!messages || messages.length === 0) {
            messages = await client.search(baseCriteria);
          }

          if (!messages || messages.length === 0) {
            lock.release();
            await client.logout().catch(() => {});
            client = null;
            console.log(`[check_email] 폴링 ${attempt + 1}/${maxRetries}: 조건에 맞는 이메일 없음, ${pollInterval}ms 후 재시도...`);
            const waitTime = Math.min(pollInterval, deadline - Date.now());
            if (waitTime > 0) await sleep(waitTime);
            continue;
          }

          console.log(`[check_email] ${messages.length}개 이메일 발견, 최신 메일 분석 중...`);

          // 가장 최신 메일부터 역순으로 시도 (최신 인증 메일이 맞을 확률 높음)
          for (let mi = messages.length - 1; mi >= 0; mi--) {
            const uid = messages[mi];
            const message = await client.fetchOne(uid, { source: true });

            if (!message || !message.source) continue;

            // MIME에서 HTML 본문 추출
            const rawSource = message.source.toString();
            const htmlBody = extractHtmlFromMime(rawSource);

            if (!htmlBody) {
              console.log(`[check_email] UID ${uid}: HTML 본문 없음, 다음 메일 시도`);
              continue;
            }

            // HTML 엔티티 디코딩 및 링크 추출
            const decodedHtml = decodeHtmlEntities(htmlBody);

            // href 속성에서 URL 우선 추출 (버튼 링크 포함)
            const hrefLinks = extractHrefLinks(decodedHtml);
            // 정규식 패턴 매칭
            const regexLinks: string[] = [];
            let match: RegExpExecArray | null;
            linkRegex.lastIndex = 0;
            while ((match = linkRegex.exec(decodedHtml)) !== null) {
              const url = match[0]
                .replace(/&amp;/gi, '&')
                .replace(/["'><].*$/, '');  // 잘려 들어온 HTML 태그 제거
              if (!regexLinks.includes(url)) regexLinks.push(url);
            }

            // href에서 추출한 링크 중 패턴 매칭되는 것 우선, 없으면 regex 결과 사용
            let matchedLinks: string[] = [];
            if (config.linkPattern) {
              const testRegex = new RegExp(linkPatternStr, 'i');
              matchedLinks = hrefLinks.filter(l => testRegex.test(l));
              if (matchedLinks.length === 0) matchedLinks = regexLinks;
            } else {
              matchedLinks = hrefLinks.length > 0 ? hrefLinks : regexLinks;
            }

            if (matchedLinks.length === 0) {
              console.log(`[check_email] UID ${uid}: 패턴에 맞는 링크 없음, 다음 메일 시도`);
              continue;
            }

            const targetUrl = matchedLinks[Math.min(linkIndex, matchedLinks.length - 1)];
            console.log(`[check_email] 인증 링크 발견: ${targetUrl.substring(0, 80)}...`);

            // 변수에 URL 저장
            if (config.captureUrlAs) {
              ctx.variables.set(config.captureUrlAs, targetUrl);
              captured[config.captureUrlAs] = targetUrl;
            }

            // \Seen 플래그 설정
            await client.messageFlagsAdd(uid, ['\\Seen']).catch(() => {});

            // 선택적 삭제
            if (config.deleteAfterRead) {
              await client.messageDelete(uid).catch(() => {});
            }

            lock.release();
            await client.logout().catch(() => {});

            // 새 탭에서 인증 링크 열기 (원래 페이지 유지)
            if (navigateToLink && ctx.page) {
              console.log(`[check_email] 새 탭에서 인증 링크 열기...`);
              const newTab = await ctx.page.context().newPage();
              try {
                await newTab.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
                // 인증 처리를 위해 잠시 대기
                await sleep(2000);
              } finally {
                await newTab.close().catch(() => {});
              }
              console.log(`[check_email] 인증 완료, 새 탭 닫음. 원래 페이지 유지.`);
            }

            return {
              capturedVariables: Object.keys(captured).length > 0 ? captured : undefined,
            };
          }

          // 메일은 있지만 링크를 못 찾은 경우 — 재시도
          lock.release();
          await client.logout().catch(() => {});
          client = null;
          console.log(`[check_email] 폴링 ${attempt + 1}/${maxRetries}: 메일 발견했지만 패턴 매칭 링크 없음, 재시도...`);
          const waitTime = Math.min(pollInterval, deadline - Date.now());
          if (waitTime > 0) await sleep(waitTime);
          continue;

        } catch (innerErr) {
          lock.release();
          throw innerErr;
        }
      } catch (err: any) {
        if (client) {
          await client.logout().catch(() => {});
        }

        const errMsg = err.message || String(err);
        lastError = errMsg;

        // 인증 에러는 즉시 실패 (재시도 의미 없음)
        if (!authVerified && isAuthError(errMsg)) {
          const hint = config.provider === 'gmail'
            ? '\n  Gmail은 앱 비밀번호가 필요합니다: Google 계정 → 보안 → 2단계 인증 → 앱 비밀번호'
            : config.provider === 'naver'
            ? '\n  네이버는 IMAP 설정을 활성화해야 합니다: 메일 → 설정 → POP3/IMAP 설정'
            : '';
          return { error: `check_email 인증 실패: ${errMsg}${hint}` };
        }

        console.log(`[check_email] 연결 오류 (attempt ${attempt + 1}): ${errMsg}`);
        if (Date.now() < deadline) {
          const waitTime = Math.min(pollInterval, deadline - Date.now());
          if (waitTime > 0) await sleep(waitTime);
          continue;
        }
        return { error: `check_email IMAP 오류: ${errMsg}` };
      }
    }

    const hint = lastError ? `\n  마지막 오류: ${lastError}` : '';
    return { error: `check_email: ${timeout}ms 내에 조건에 맞는 이메일을 찾지 못함${hint}\n  from=${from || '(any)'}, subject="${subject || '(any)'}"` };
  } catch (err: any) {
    return { error: `check_email 실패: ${err.message}` };
  }
}

/** 인증/로그인 에러 판별 */
function isAuthError(msg: string): boolean {
  const lower = msg.toLowerCase();
  return lower.includes('auth') || lower.includes('login') || lower.includes('credential')
    || lower.includes('password') || lower.includes('invalid') || lower.includes('no auth')
    || lower.includes('application-specific') || lower.includes('web login required');
}

/** linkPattern이 리터럴 URL처럼 보이는지 판별 (http로 시작, regex 메타문자 의도 없음) */
function looksLikeLiteralUrl(pattern: string): boolean {
  if (!pattern.startsWith('http')) return false;
  // 명시적 regex 문법이 보이면 false (캡처 그룹, 문자 클래스, 앵커 등)
  if (/[[\]()^$|+*{}]/.test(pattern.replace(/\\\\/g, ''))) return false;
  // . 과 ? 만 있으면 URL 리터럴로 간주 (URL에 자주 등장하는 문자)
  return true;
}

/** URL 리터럴용 regex 이스케이프 (. ? 등 특수문자 처리) */
function escapeRegexForUrl(url: string): string {
  return url.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** HTML href 속성에서 URL 추출 (버튼/링크의 href) */
function extractHrefLinks(html: string): string[] {
  const links: string[] = [];
  const hrefRegex = /href\s*=\s*["']([^"']+)["']/gi;
  let m: RegExpExecArray | null;
  while ((m = hrefRegex.exec(html)) !== null) {
    let url = m[1].replace(/&amp;/gi, '&').trim();
    if (url.startsWith('http') && !links.includes(url)) {
      links.push(url);
    }
  }
  return links;
}

/** MIME raw source에서 HTML 본문 추출 (base64/quoted-printable 디코딩 포함) */
function extractHtmlFromMime(rawSource: string): string | null {
  // ^Content-Transfer-Encoding 을 줄의 시작에서만 매칭 (DKIM h= 등에 끼인 값 무시)
  const CTE_REGEX = /^Content-Transfer-Encoding:\s*([\w-]+)/im;

  // text/html 파트 탐색 (multipart 메일)
  const parts = rawSource.split(/--[^\r\n]+/);

  for (const part of parts) {
    const lowerPart = part.toLowerCase();
    if (!lowerPart.includes('content-type') || !lowerPart.includes('text/html')) continue;

    // Content-Transfer-Encoding 확인 — 줄 시작에서만 매칭
    const encodingMatch = part.match(CTE_REGEX);
    const encoding = encodingMatch ? encodingMatch[1].toLowerCase() : '7bit';

    // 헤더와 본문 분리 (빈 줄로 구분)
    const headerBodySplit = part.split(/\r?\n\r?\n/);
    if (headerBodySplit.length < 2) continue;
    const body = headerBodySplit.slice(1).join('\n\n');

    if (encoding === 'base64') {
      try {
        const cleaned = body.replace(/[\r\n\s]/g, '');
        return Buffer.from(cleaned, 'base64').toString('utf-8');
      } catch { continue; }
    } else if (encoding === 'quoted-printable') {
      return decodeQuotedPrintable(body);
    } else {
      return body;
    }
  }

  // multipart가 아닌 단일 HTML 메일
  if (rawSource.toLowerCase().includes('content-type') && rawSource.toLowerCase().includes('text/html')) {
    const encodingMatch = rawSource.match(CTE_REGEX);
    const encoding = encodingMatch ? encodingMatch[1].toLowerCase() : '7bit';
    const headerBodySplit = rawSource.split(/\r?\n\r?\n/);
    if (headerBodySplit.length >= 2) {
      const body = headerBodySplit.slice(1).join('\n\n');
      if (encoding === 'base64') {
        try {
          const cleaned = body.replace(/[\r\n\s]/g, '');
          return Buffer.from(cleaned, 'base64').toString('utf-8');
        } catch { return null; }
      } else if (encoding === 'quoted-printable') {
        return decodeQuotedPrintable(body);
      }
      return body;
    }
  }

  return null;
}

/** Quoted-Printable 디코딩 */
function decodeQuotedPrintable(str: string): string {
  return str
    .replace(/=\r?\n/g, '')  // soft line breaks
    .replace(/=([0-9A-Fa-f]{2})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
}

/** 기본 HTML 엔티티 디코딩 */
function decodeHtmlEntities(html: string): string {
  return html
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&#(\d+);/g, (_, num) => String.fromCharCode(parseInt(num, 10)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
}

// ─── Utils ────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}
