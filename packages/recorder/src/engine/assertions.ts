/**
 * 어설션 엔진
 *
 * URL, 요소, 텍스트, HTTP 상태, 변수 등을 검증한다.
 * Playwright Page 또는 모바일 컨텍스트에서 동작.
 */

import type { Page } from 'playwright';
import type { Assertion, AssertionResult, NetworkLogEntry } from '../types';
import type { VariableContext } from './variables';

export interface AssertionContext {
  page?: Page;
  iosController?: any;         // IOSController 인스턴스 (iOS assertion 평가용)
  variables: VariableContext;
  lastApiResponse?: {
    status: number;
    headers: Record<string, string>;
    body: any;
  };
  networkLogs?: NetworkLogEntry[];  // 스트림 검증용 네트워크 로그
}

export class AssertionEngine {
  /** evaluateAll 호출 중 동일 selector에 대한 visual check 결과 캐시 */
  private _visualCheckCache: Map<string, AssertionResult> | null = null;

  /** 단일 어설션 평가 */
  async evaluate(assertion: Assertion, ctx: AssertionContext): Promise<AssertionResult> {
    const expected = ctx.variables.resolve(assertion.expected);
    const target = assertion.target ? ctx.variables.resolve(assertion.target) : undefined;

    try {
      switch (assertion.type) {
        case 'url_contains':
          return this.checkUrl(assertion, ctx, (url) => url.includes(expected));
        case 'url_equals':
          return this.checkUrl(assertion, ctx, (url) => url === expected);
        case 'url_matches':
          return this.checkUrl(assertion, ctx, (url) => new RegExp(expected).test(url));

        case 'element_exists':
          return await this.checkElement(assertion, ctx, target!, true);
        case 'element_not_exists':
          return await this.checkElement(assertion, ctx, target!, false);
        case 'element_visible':
          return await this.checkElementVisible(assertion, ctx, target!);

        case 'text_contains':
          return await this.checkPageText(assertion, ctx, (text) => text.includes(expected));
        case 'text_equals':
          return await this.checkPageText(assertion, ctx, (text) => text.trim() === expected.trim());

        case 'element_text_contains':
          return await this.checkElementText(assertion, ctx, target!, (text) => text.includes(expected));
        case 'element_text_equals':
          return await this.checkElementText(assertion, ctx, target!, (text) => text.trim() === expected.trim());

        case 'element_attribute_equals':
          return await this.checkElementAttribute(assertion, ctx, target!, assertion.attribute!, expected);

        case 'http_status':
          return this.checkHttpStatus(assertion, ctx, parseInt(expected, 10));
        case 'response_body_contains':
          return this.checkResponseBody(assertion, ctx, expected);

        case 'variable_equals':
          return this.checkVariable(assertion, ctx, target!, expected);

        case 'video_playing':
          return await this.checkVideoPlaying(assertion, ctx, target!);
        case 'video_no_error':
          return await this.checkVideoNoError(assertion, ctx, target!);
        case 'video_auto':
          return await this.checkVideoAuto(assertion, ctx, target!);
        case 'video_visual':
          return await this.checkVideoVisual(assertion, ctx, target!);
        case 'stream_segments_loaded':
          return this.checkStreamSegmentsLoaded(assertion, ctx);

        case 'custom':
          return await this.checkCustom(assertion, ctx, expected);

        // ─── iOS Assertions (pageSource XML 기반) ─────
        case 'ios_element_visible':
          return await this.checkIOSElementVisible(assertion, ctx);
        case 'ios_element_not_exists':
          return await this.checkIOSElementNotExists(assertion, ctx);
        case 'ios_text_contains':
          return this.checkIOSTextContains(assertion, ctx, expected);
        case 'ios_text_absent':
          return await this.checkIOSTextAbsent(assertion, ctx, expected);
        case 'ios_element_value_equals':
          return await this.checkIOSElementValueEquals(assertion, ctx, expected);
        case 'ios_list_count':
          return await this.checkIOSListCount(assertion, ctx);
        case 'ios_no_alert':
          return await this.checkIOSNoAlert(assertion, ctx);
        case 'ios_screen_changed':
          return await this.checkIOSScreenChanged(assertion, ctx);

        // ─── Network Assertions (프록시/네트워크 로그 기반) ─
        case 'network_request_sent':
          return this.checkNetworkRequestSent(assertion, ctx);
        case 'network_response_status':
          return this.checkNetworkResponseStatus(assertion, ctx);
        case 'network_response_json':
          return this.checkNetworkResponseJson(assertion, ctx);
        case 'network_image_loads':
          return this.checkNetworkImageLoads(assertion, ctx);
        case 'network_no_errors':
          return this.checkNetworkNoErrors(assertion, ctx);

        default:
          return { assertion, passed: false, error: `Unknown assertion type: ${assertion.type}` };
      }
    } catch (err: any) {
      return { assertion, passed: false, error: err.message };
    }
  }

  /** 복수 어설션 평가 */
  async evaluateAll(assertions: Assertion[], ctx: AssertionContext): Promise<AssertionResult[]> {
    this._visualCheckCache = new Map();
    const results: AssertionResult[] = [];
    try {
      for (const a of assertions) {
        results.push(await this.evaluate(a, ctx));
      }
    } finally {
      this._visualCheckCache = null;
    }
    return results;
  }

  // ─── URL 검증 ───────────────────────────────────────────

  private checkUrl(
    assertion: Assertion, ctx: AssertionContext,
    check: (url: string) => boolean
  ): AssertionResult {
    if (!ctx.page) return { assertion, passed: false, error: 'No page context' };
    const actual = ctx.page.url();
    const passed = check(actual);
    return { assertion, passed, actual, error: passed ? undefined : assertion.message || `URL check failed: "${actual}"` };
  }

  // ─── Element 검증 ──────────────────────────────────────

  private async checkElement(
    assertion: Assertion, ctx: AssertionContext,
    selector: string, shouldExist: boolean
  ): Promise<AssertionResult> {
    if (!ctx.page) return { assertion, passed: false, error: 'No page context' };
    const count = await ctx.page.locator(selector).count();
    const exists = count > 0;
    const passed = shouldExist ? exists : !exists;
    return { assertion, passed, actual: `count=${count}`, error: passed ? undefined : assertion.message || `Element ${shouldExist ? 'not found' : 'unexpectedly found'}: ${selector}` };
  }

  private async checkElementVisible(
    assertion: Assertion, ctx: AssertionContext, selector: string
  ): Promise<AssertionResult> {
    if (!ctx.page) return { assertion, passed: false, error: 'No page context' };
    try {
      const visible = await ctx.page.locator(selector).first().isVisible({ timeout: 3000 });
      return { assertion, passed: visible, actual: `visible=${visible}`, error: visible ? undefined : assertion.message || `Element not visible: ${selector}` };
    } catch {
      return { assertion, passed: false, actual: 'not found', error: assertion.message || `Element not found: ${selector}` };
    }
  }

  // ─── Text 검증 ──────────────────────────────────────────

  private async checkPageText(
    assertion: Assertion, ctx: AssertionContext,
    check: (text: string) => boolean
  ): Promise<AssertionResult> {
    if (!ctx.page) return { assertion, passed: false, error: 'No page context' };
    const text = await ctx.page.textContent('body') || '';
    const passed = check(text);
    return { assertion, passed, actual: text.substring(0, 200), error: passed ? undefined : assertion.message || 'Page text check failed' };
  }

  private async checkElementText(
    assertion: Assertion, ctx: AssertionContext,
    selector: string, check: (text: string) => boolean
  ): Promise<AssertionResult> {
    if (!ctx.page) return { assertion, passed: false, error: 'No page context' };
    try {
      const text = await ctx.page.locator(selector).first().textContent({ timeout: 3000 }) || '';
      const passed = check(text);
      return { assertion, passed, actual: text, error: passed ? undefined : assertion.message || `Element text check failed: "${text}"` };
    } catch {
      return { assertion, passed: false, error: assertion.message || `Element not found: ${selector}` };
    }
  }

  private async checkElementAttribute(
    assertion: Assertion, ctx: AssertionContext,
    selector: string, attribute: string, expected: string
  ): Promise<AssertionResult> {
    if (!ctx.page) return { assertion, passed: false, error: 'No page context' };
    try {
      const actual = await ctx.page.locator(selector).first().getAttribute(attribute, { timeout: 3000 });
      const passed = actual === expected;
      return { assertion, passed, actual: actual || 'null', error: passed ? undefined : assertion.message || `Attribute "${attribute}" = "${actual}", expected "${expected}"` };
    } catch {
      return { assertion, passed: false, error: assertion.message || `Element not found: ${selector}` };
    }
  }

  // ─── HTTP 검증 ──────────────────────────────────────────

  private checkHttpStatus(
    assertion: Assertion, ctx: AssertionContext, expected: number
  ): AssertionResult {
    if (!ctx.lastApiResponse) return { assertion, passed: false, error: 'No API response available' };
    const actual = ctx.lastApiResponse.status;
    const passed = actual === expected;
    return { assertion, passed, actual: String(actual), error: passed ? undefined : assertion.message || `HTTP ${actual}, expected ${expected}` };
  }

  private checkResponseBody(
    assertion: Assertion, ctx: AssertionContext, expected: string
  ): AssertionResult {
    if (!ctx.lastApiResponse) return { assertion, passed: false, error: 'No API response available' };
    const body = typeof ctx.lastApiResponse.body === 'string' ? ctx.lastApiResponse.body : JSON.stringify(ctx.lastApiResponse.body);
    const passed = body.includes(expected);
    return { assertion, passed, actual: body.substring(0, 200), error: passed ? undefined : assertion.message || 'Response body check failed' };
  }

  // ─── Variable 검증 ─────────────────────────────────────

  private checkVariable(
    assertion: Assertion, ctx: AssertionContext, name: string, expected: string
  ): AssertionResult {
    const actual = ctx.variables.get(name);
    const passed = actual === expected;
    return { assertion, passed, actual: actual || 'undefined', error: passed ? undefined : assertion.message || `Variable "${name}" = "${actual}", expected "${expected}"` };
  }

  // ─── Custom JS Expression ──────────────────────────────

  private async checkCustom(
    assertion: Assertion, ctx: AssertionContext, expression: string
  ): Promise<AssertionResult> {
    if (!ctx.page) return { assertion, passed: false, error: 'No page context for custom assertion' };
    try {
      const result = await ctx.page.evaluate(expression);
      const passed = !!result;
      return { assertion, passed, actual: String(result), error: passed ? undefined : assertion.message || `Custom expression returned falsy: ${result}` };
    } catch (err: any) {
      return { assertion, passed: false, error: err.message };
    }
  }

  // ─── Video 검증 ─────────────────────────────────────────

  /**
   * <video> 요소를 찾는 공통 JS 스크립트.
   * 대부분의 커스텀 플레이어에서 <video>와 overlay는 형제 관계이므로
   * 자식 → 부모 컨테이너 → 조상 → 페이지 전역 순으로 탐색한다.
   */
  private static readonly FIND_VIDEO_JS = `
    var el = document.querySelector(selector);
    if (!el) { /* selector 자체를 못 찾으면 null */ }
    else if (el.tagName === 'VIDEO') { /* 직접 video를 가리킴 */ }
    else {
      // 1) 자식에서 <video> 탐색
      var v = el.querySelector('video');
      // 2) 없으면 부모 컨테이너에서 형제 <video> 탐색
      if (!v && el.parentElement) v = el.parentElement.querySelector('video');
      // 3) 없으면 한 단계 더 올라가서 탐색
      if (!v && el.parentElement && el.parentElement.parentElement) v = el.parentElement.parentElement.querySelector('video');
      // 4) 없으면 페이지 전역에서 첫 번째 <video> 탐색
      if (!v) v = document.querySelector('video');
      // 5) 없으면 same-origin iframe 내부에서 <video> 탐색
      if (!v) {
        try {
          var iframes = document.querySelectorAll('iframe');
          for (var i = 0; i < iframes.length && !v; i++) {
            try { v = iframes[i].contentDocument && iframes[i].contentDocument.querySelector('video'); }
            catch(e) { /* cross-origin 접근 차단 — 무시 */ }
          }
        } catch(e) {}
      }
      el = v;
    }
  `;

  /**
   * video_playing: <video> 요소가 실제로 재생 중인지 검증
   *
   * 검증 로직:
   * 1. selector로 video 요소 탐색 (컨테이너면 내부 video 탐색)
   * 2. t0 = currentTime, paused, ended, videoWidth/Height 확인
   * 3. observeMs(기본 2초) 대기
   * 4. t1 = currentTime
   * 5. t1 - t0 >= minTimeAdvance(기본 0.5초) && paused=false && ended=false && (선택) w/h > 0
   */
  private async checkVideoPlaying(
    assertion: Assertion, ctx: AssertionContext, selector: string
  ): Promise<AssertionResult> {
    if (!ctx.page) return { assertion, passed: false, error: 'No page context' };

    const observeMs = assertion.videoConfig?.observeMs ?? 2000;
    const minAdvance = assertion.videoConfig?.minTimeAdvance ?? 0.5;
    const requireDim = assertion.videoConfig?.requireDimension ?? true;

    // page.evaluate에 전달할 JS — 문자열로 전달하여 DOM 타입 문제 회피
    const videoStateScript = `(selector) => {
      ${AssertionEngine.FIND_VIDEO_JS}
      if (!el) return null;
      return {
        currentTime: el.currentTime,
        paused: el.paused,
        ended: el.ended,
        videoWidth: el.videoWidth,
        videoHeight: el.videoHeight,
        readyState: el.readyState,
        networkState: el.networkState,
      };
    }`;

    try {
      // 1단계: 초기 상태 측정
      const t0State: any = await ctx.page.evaluate(videoStateScript, selector);

      if (!t0State) {
        // 폴백 1: iframe 내부에서 <video> 탐색 (Playwright frames API — cross-origin 지원)
        const iframeState: any = await this.findVideoStateInFrames(ctx.page, selector);
        if (iframeState) {
          // iframe에서 찾음 → 여기서부터 DOM 기반 검증 진행
          if (iframeState.paused) {
            return { assertion, passed: false, actual: `[iframe] paused=true`, error: assertion.message || '(iframe) 영상이 일시정지 상태입니다' };
          }
          if (iframeState.ended) {
            return { assertion, passed: false, actual: `[iframe] ended=true`, error: assertion.message || '(iframe) 영상이 종료된 상태입니다' };
          }
          await new Promise(r => setTimeout(r, observeMs));
          const iframeT1: any = await this.findVideoStateInFrames(ctx.page, selector);
          if (iframeT1) {
            const adv = iframeT1.currentTime - iframeState.currentTime;
            const passed = adv >= minAdvance && !iframeT1.paused && !iframeT1.ended;
            return {
              assertion, passed,
              actual: `[video_playing→iframe] advance=${adv.toFixed(2)}s, paused=${iframeT1.paused}, ended=${iframeT1.ended}, ${iframeT1.videoWidth}×${iframeT1.videoHeight}`,
              error: passed ? undefined : assertion.message || `(iframe) 영상 재생 검증 실패: advance=${adv.toFixed(2)}s`,
            };
          }
        }

        // 폴백 2: 시각적 프레임 비교
        const visualResult = await this.checkVideoVisual(assertion, ctx, selector);
        if (visualResult.passed) {
          return { ...visualResult, actual: `[video_playing→visual_fallback] ${visualResult.actual || ''}` };
        }

        // 폴백 3: stream_segments_loaded 네트워크 기반
        const streamResult = this.checkStreamSegmentsLoaded(assertion, ctx);
        if (streamResult.passed) {
          return { ...streamResult, actual: `[video_playing→stream_fallback] ${streamResult.actual || ''}` };
        }

        return {
          assertion, passed: false,
          actual: 'video not found (DOM/iframe/visual/stream all failed)',
          error: assertion.message || `<video> 요소/iframe/시각적 변화/스트림 네트워크 검증 모두 실패: ${selector}`,
        };
      }

      if (t0State.paused) {
        return {
          assertion, passed: false,
          actual: `paused=true, currentTime=${t0State.currentTime}`,
          error: assertion.message || '영상이 일시정지 상태입니다 (paused=true)',
        };
      }

      if (t0State.ended) {
        return {
          assertion, passed: false,
          actual: `ended=true, currentTime=${t0State.currentTime}`,
          error: assertion.message || '영상이 종료된 상태입니다 (ended=true)',
        };
      }

      // 2단계: 관측 시간 대기
      await new Promise(r => setTimeout(r, observeMs));

      // 3단계: 두 번째 상태 측정
      const t1State: any = await ctx.page.evaluate(videoStateScript, selector);

      if (!t1State) {
        return {
          assertion, passed: false, actual: 'video disappeared during observation',
          error: assertion.message || '관측 중 video 요소가 사라졌습니다',
        };
      }

      // 4단계: 판정
      const timeAdvance = t1State.currentTime - t0State.currentTime;
      const details: string[] = [];
      let passed = true;

      if (timeAdvance < minAdvance) {
        passed = false;
        details.push(`currentTime 증가량 ${timeAdvance.toFixed(2)}s < 최소 ${minAdvance}s`);
      }

      if (t1State.paused) {
        passed = false;
        details.push('paused=true (관측 후)');
      }

      if (t1State.ended) {
        passed = false;
        details.push('ended=true (관측 후)');
      }

      if (requireDim && (t1State.videoWidth === 0 || t1State.videoHeight === 0)) {
        passed = false;
        details.push(`videoWidth=${t1State.videoWidth}, videoHeight=${t1State.videoHeight}`);
      }

      const actual = `advance=${timeAdvance.toFixed(2)}s, paused=${t1State.paused}, ended=${t1State.ended}, ` +
        `${t1State.videoWidth}×${t1State.videoHeight}, readyState=${t0State.readyState}`;

      return {
        assertion, passed, actual,
        error: passed ? undefined : assertion.message || `영상 재생 검증 실패: ${details.join(', ')}`,
      };
    } catch (err: any) {
      return { assertion, passed: false, error: err.message };
    }
  }

  /**
   * video_no_error: <video> 요소에 에러가 없는지 검증
   *
   * video.error === null 이면 통과
   */
  private async checkVideoNoError(
    assertion: Assertion, ctx: AssertionContext, selector: string
  ): Promise<AssertionResult> {
    if (!ctx.page) return { assertion, passed: false, error: 'No page context' };

    try {
      const state: any = await ctx.page.evaluate(`(selector) => {
        ${AssertionEngine.FIND_VIDEO_JS}
        if (!el) return null;
        var err = el.error;
        return {
          hasError: err !== null,
          errorCode: err ? err.code : null,
          errorMessage: err ? err.message : null,
          networkState: el.networkState,
          readyState: el.readyState,
        };
      }`, selector);

      if (!state) {
        // 폴백 1: iframe 내부에서 <video> 에러 상태 조회
        const iframeState: any = await this.findVideoErrorStateInFrames(ctx.page!);
        if (iframeState) {
          const passed = !iframeState.hasError;
          const actual = iframeState.hasError
            ? `[iframe] error.code=${iframeState.errorCode}, message="${iframeState.errorMessage}"`
            : `[video_no_error→iframe] no error, networkState=${iframeState.networkState}, readyState=${iframeState.readyState}`;
          return {
            assertion, passed, actual,
            error: passed ? undefined : assertion.message || `(iframe) 영상 에러: code=${iframeState.errorCode}`,
          };
        }

        // 폴백 2: 시각적 프레임 비교 — 프레임이 변하면 에러 없이 재생 중으로 추론
        const visualResult = await this.checkVideoVisual(assertion, ctx, selector);
        if (visualResult.passed) {
          return {
            ...visualResult,
            actual: `[video_no_error→visual_fallback] no error inferred (frames changing), ${visualResult.actual || ''}`,
          };
        }

        // 폴백 3: 네트워크 기반으로 에러 여부 판단
        const streamResult = this.checkStreamSegmentsLoaded(assertion, ctx);
        if (streamResult.passed) {
          return {
            ...streamResult,
            actual: `[video_no_error→stream_fallback] no segment errors, ${streamResult.actual || ''}`,
          };
        }

        return {
          assertion, passed: false,
          actual: 'video not found (DOM/iframe/visual/stream all failed)',
          error: assertion.message || `<video> 요소/iframe/시각적 변화/스트림 네트워크 검증 모두 실패: ${selector}`,
        };
      }

      const passed = !state.hasError;
      const actual = state.hasError
        ? `error.code=${state.errorCode}, message="${state.errorMessage}"`
        : `no error, networkState=${state.networkState}, readyState=${state.readyState}`;

      return {
        assertion, passed, actual,
        error: passed ? undefined : assertion.message || `영상 에러 발생: code=${state.errorCode}, "${state.errorMessage}"`,
      };
    } catch (err: any) {
      return { assertion, passed: false, error: err.message };
    }
  }

  // ─── Video Auto (video_playing → stream_segments_loaded 폴백) ─

  /**
   * video_auto: HTML5 video_playing을 먼저 시도하고,
   * video 요소가 없는 경우에만 stream_segments_loaded로 폴백한다.
   *
   * 폴백 조건: video 요소를 찾을 수 없을 때만.
   * paused=true 또는 ended=true는 폴백하지 않고 그대로 실패 반환.
   */
  private async checkVideoAuto(
    assertion: Assertion, ctx: AssertionContext, selector: string
  ): Promise<AssertionResult> {
    if (!ctx.page) return { assertion, passed: false, error: 'No page context' };

    // 1단계: video 요소 존재 여부 확인
    const videoCheckScript = `(selector) => {
      ${AssertionEngine.FIND_VIDEO_JS}
      return el ? true : false;
    }`;

    try {
      const hasVideo = await ctx.page.evaluate(videoCheckScript, selector);

      if (hasVideo) {
        // video 요소가 있으면 video_playing 로직 그대로 실행
        const result = await this.checkVideoPlaying(assertion, ctx, selector);
        // video_playing 결과에 video_auto 전략 표기
        return {
          ...result,
          actual: `[video_auto→video_playing] ${result.actual || ''}`,
        };
      }

      // 2단계: iframe 내부에서 <video> 탐색
      const iframeState: any = await this.findVideoStateInFrames(ctx.page, selector);
      if (iframeState && !iframeState.paused && !iframeState.ended) {
        return {
          assertion, passed: true,
          actual: `[video_auto→iframe] currentTime=${iframeState.currentTime}, ${iframeState.videoWidth}×${iframeState.videoHeight}`,
        };
      }

      // 3단계: 시각적 프레임 비교
      const visualResult = await this.checkVideoVisual(assertion, ctx, selector);
      if (visualResult.passed) {
        return { ...visualResult, actual: `[video_auto→visual] ${visualResult.actual || ''}` };
      }

      // 4단계: stream_segments_loaded 네트워크 기반 폴백
      const streamResult = this.checkStreamSegmentsLoaded(assertion, ctx);
      return {
        ...streamResult,
        actual: `[video_auto→stream_segments_loaded] ${streamResult.actual || ''}`,
      };
    } catch (err: any) {
      return { assertion, passed: false, error: err.message };
    }
  }

  // ─── iframe Frame Search (Playwright frames() API) ────────

  /**
   * Playwright의 page.frames() API로 모든 iframe (cross-origin 포함) 내에서
   * <video> 요소 상태를 조회한다.
   * page.evaluate의 contentDocument와 달리 cross-origin iframe에도 접근 가능.
   */
  private async findVideoStateInFrames(
    page: Page, selector: string
  ): Promise<any> {
    const stateScript = `() => {
      var el = document.querySelector('video');
      if (!el) return null;
      return {
        currentTime: el.currentTime,
        paused: el.paused,
        ended: el.ended,
        videoWidth: el.videoWidth,
        videoHeight: el.videoHeight,
        readyState: el.readyState,
        networkState: el.networkState,
      };
    }`;

    for (const frame of page.frames()) {
      if (frame === page.mainFrame()) continue;
      try {
        const result = await frame.evaluate(stateScript);
        if (result) return result;
      } catch { /* frame detached or navigation error — skip */ }
    }
    return null;
  }

  /**
   * Playwright frames() API로 모든 iframe 내에서 <video> 에러 상태를 조회.
   */
  private async findVideoErrorStateInFrames(
    page: Page
  ): Promise<any> {
    const errorScript = `() => {
      var el = document.querySelector('video');
      if (!el) return null;
      var err = el.error;
      return {
        hasError: err !== null,
        errorCode: err ? err.code : null,
        errorMessage: err ? err.message : null,
        networkState: el.networkState,
        readyState: el.readyState,
      };
    }`;

    for (const frame of page.frames()) {
      if (frame === page.mainFrame()) continue;
      try {
        const result = await frame.evaluate(errorScript);
        if (result) return result;
      } catch { /* skip */ }
    }
    return null;
  }

  // ─── Video Visual (시각적 프레임 비교) ────────────────────

  /**
   * video_visual: 지정 영역의 스크린샷 2장을 비교하여 픽셀 변화로
   * 영상 재생 여부를 감지한다.
   *
   * <video> 요소 없이도 동작하며, canvas 렌더러/iframe/WebRTC 등
   * 모든 비디오 기술에 적용 가능하다.
   *
   * 검증 로직:
   * 1. selector 영역 또는 clip 영역의 스크린샷 캡처 (t0)
   * 2. observeMs 대기
   * 3. 동일 영역 스크린샷 캡처 (t1)
   * 4. 바이트 레벨 차이 비율 계산
   * 5. changeThreshold 이상이면 통과
   */
  private async checkVideoVisual(
    assertion: Assertion, ctx: AssertionContext, selector: string
  ): Promise<AssertionResult> {
    if (!ctx.page) return { assertion, passed: false, error: 'No page context' };

    const config = assertion.visualConfig || {};
    const observeMs = config.observeMs ?? 1500;
    const changeThreshold = config.changeThreshold ?? 0.005; // 0.5%

    // 캐시: evaluateAll 내에서 동일 selector에 대한 중복 visual check 방지
    // video_playing/video_no_error/video_auto가 모두 fallback으로 이 메서드를 호출하면
    // 누적 대기 시간(~6s)으로 인해 마지막 직접 호출 시 프레임이 안정화되어 실패할 수 있다.
    const cacheKey = `${selector}|${observeMs}`;
    if (this._visualCheckCache) {
      const cached = this._visualCheckCache.get(cacheKey);
      if (cached) {
        return { ...cached, assertion };
      }
    }

    try {
      // 스크린샷 대상 결정
      let screenshotOpts: Record<string, any> = { type: 'png' as const };
      if (config.clip) {
        screenshotOpts.clip = config.clip;
      }

      let buf1: Buffer;
      let buf2: Buffer;

      if (selector && !config.clip) {
        // selector가 있으면 해당 요소만 캡처
        const element = ctx.page.locator(selector).first();
        // 요소 존재 확인
        const count = await element.count();
        if (count === 0) {
          return {
            assertion, passed: false,
            actual: `selector "${selector}" not found`,
            error: `시각적 비교 대상을 찾을 수 없습니다: ${selector}`,
          };
        }
        buf1 = await element.screenshot({ type: 'png' });
        await new Promise(r => setTimeout(r, observeMs));
        buf2 = await element.screenshot({ type: 'png' });
      } else {
        // clip 또는 전체 페이지
        buf1 = await ctx.page.screenshot(screenshotOpts);
        await new Promise(r => setTimeout(r, observeMs));
        buf2 = await ctx.page.screenshot(screenshotOpts);
      }

      // 바이트 레벨 비교
      const len = Math.min(buf1.length, buf2.length);
      let diffBytes = 0;

      // 크기가 다르면 확실히 변화
      if (buf1.length !== buf2.length) {
        const result: AssertionResult = {
          assertion, passed: true,
          actual: `[video_visual] 프레임 크기 변화: ${buf1.length} → ${buf2.length} bytes (${observeMs}ms 간격)`,
        };
        if (this._visualCheckCache) this._visualCheckCache.set(cacheKey, result);
        return result;
      }

      for (let i = 0; i < len; i++) {
        if (buf1[i] !== buf2[i]) diffBytes++;
      }

      const changeRatio = diffBytes / len;
      const passed = changeRatio >= changeThreshold;
      const pct = (changeRatio * 100).toFixed(2);
      const thresholdPct = (changeThreshold * 100).toFixed(2);

      const result: AssertionResult = {
        assertion, passed,
        actual: `[video_visual] ${pct}% 변화 감지 (${observeMs}ms 간격, 임계값 ${thresholdPct}%)`,
        error: passed ? undefined :
          assertion.message || `영상 프레임 변화 미감지: ${pct}% < ${thresholdPct}% (${observeMs}ms 관측)`,
      };
      if (this._visualCheckCache) this._visualCheckCache.set(cacheKey, result);
      return result;
    } catch (err: any) {
      return { assertion, passed: false, error: `visual check failed: ${err.message}` };
    }
  }

  // ─── Stream Segments Loaded (네트워크 기반 HLS/DASH 검증) ─

  /**
   * stream_segments_loaded: 네트워크 로그에서 HLS/DASH 매니페스트와
   * 세그먼트 응답을 분석하여 스트리밍이 정상 로드되는지 검증한다.
   *
   * 검증 로직:
   * 1. windowMs(기본 5초) 이내의 네트워크 로그 필터링
   * 2. manifestPattern으로 매니페스트 응답 카운트
   * 3. segmentPattern으로 세그먼트 응답 카운트
   * 4. allowedStatus, requireSegmentBytes 조건 확인
   * 5. minManifestResponses, minSegmentResponses 이상이면 통과
   */
  private checkStreamSegmentsLoaded(
    assertion: Assertion, ctx: AssertionContext
  ): AssertionResult {
    if (!ctx.networkLogs || ctx.networkLogs.length === 0) {
      return {
        assertion, passed: false, actual: 'no network logs',
        error: assertion.message || '네트워크 로그가 없습니다. 스트림 검증을 수행할 수 없습니다.',
      };
    }

    const config = assertion.streamConfig || {};
    const manifestPattern = new RegExp(config.manifestPattern || '\\.(m3u8|mpd)(\\?|$)', 'i');
    const segmentPattern = new RegExp(config.segmentPattern || '\\.(ts|m4s|mp4)(\\?|$)', 'i');
    const windowMs = config.windowMs ?? 5000;
    const minSegments = config.minSegmentResponses ?? 2;
    const minManifests = config.minManifestResponses ?? 1;
    const allowedStatus = new Set(config.allowedStatus || [200, 206]);
    const requireBytes = config.requireSegmentBytes ?? 1000;

    const now = Date.now();
    const cutoff = now - windowMs;

    // 윈도우 내 로그 필터링
    const windowLogs = ctx.networkLogs.filter(log => log.timestamp >= cutoff);

    if (windowLogs.length === 0) {
      return {
        assertion, passed: false,
        actual: `window=${windowMs}ms 내 미디어 네트워크 로그 0건`,
        error: assertion.message || `최근 ${windowMs}ms 이내에 미디어 네트워크 요청이 없습니다.`,
      };
    }

    // 매니페스트/세그먼트 분류
    let manifestCount = 0;
    let segmentCount = 0;
    let segmentBytesOk = 0;
    let segmentStatusFail = 0;
    const manifestUrls: string[] = [];
    const segmentUrls: string[] = [];

    for (const log of windowLogs) {
      const isManifest = manifestPattern.test(log.url);
      const isSegment = segmentPattern.test(log.url);

      if (isManifest && allowedStatus.has(log.status)) {
        manifestCount++;
        manifestUrls.push(log.url.substring(log.url.lastIndexOf('/') + 1, log.url.lastIndexOf('/') + 40));
      }

      if (isSegment) {
        if (!allowedStatus.has(log.status)) {
          segmentStatusFail++;
          continue;
        }
        segmentCount++;
        segmentUrls.push(log.url.substring(log.url.lastIndexOf('/') + 1, log.url.lastIndexOf('/') + 40));
        if (requireBytes > 0 && log.contentLength >= requireBytes) {
          segmentBytesOk++;
        } else if (requireBytes <= 0 || log.contentLength < 0) {
          // contentLength 미제공(-1)이면 통과 (서버가 Transfer-Encoding: chunked 사용)
          segmentBytesOk++;
        }
      }
    }

    // 판정
    const details: string[] = [];
    let passed = true;

    if (manifestCount < minManifests) {
      passed = false;
      details.push(`매니페스트 ${manifestCount}개 < 최소 ${minManifests}개`);
    }

    if (segmentCount < minSegments) {
      passed = false;
      details.push(`세그먼트 ${segmentCount}개 < 최소 ${minSegments}개`);
    }

    if (requireBytes > 0 && segmentBytesOk < minSegments && segmentCount >= minSegments) {
      passed = false;
      details.push(`바이트 조건 충족 세그먼트 ${segmentBytesOk}개 < ${minSegments}개 (최소 ${requireBytes} bytes)`);
    }

    if (segmentStatusFail > 0) {
      details.push(`상태코드 실패 세그먼트 ${segmentStatusFail}개`);
    }

    const actual =
      `manifests=${manifestCount}, segments=${segmentCount}, ` +
      `bytesOk=${segmentBytesOk}, statusFail=${segmentStatusFail}, ` +
      `window=${windowMs}ms, totalLogs=${windowLogs.length}`;

    return {
      assertion, passed, actual,
      error: passed ? undefined : assertion.message || `스트림 검증 실패: ${details.join(', ')}`,
    };
  }

  // ─── iOS Assertions (pageSource XML 기반) ──────────────

  /** iOS pageSource 캐시 (동일 평가 사이클 내 1회만 호출) */
  private iosPageSourceCache: { xml: string; timestamp: number } | null = null;
  private static readonly IOS_CACHE_TTL = 2000; // 2초

  private async getIOSPageSource(ctx: AssertionContext): Promise<string | null> {
    if (!ctx.iosController) return null;

    const now = Date.now();
    if (this.iosPageSourceCache && now - this.iosPageSourceCache.timestamp < AssertionEngine.IOS_CACHE_TTL) {
      return this.iosPageSourceCache.xml;
    }

    const xml = await ctx.iosController.getPageSource?.();
    if (xml && typeof xml === 'string') {
      this.iosPageSourceCache = { xml, timestamp: now };
      return xml;
    }
    return null;
  }

  /**
   * ios_element_visible: iosSelector로 지정된 요소가 화면에 visible인지 검증
   */
  private async checkIOSElementVisible(
    assertion: Assertion, ctx: AssertionContext
  ): Promise<AssertionResult> {
    if (!ctx.iosController) return { assertion, passed: false, error: 'No iOS controller context' };

    const xml = await this.getIOSPageSource(ctx);
    if (!xml) return { assertion, passed: false, error: 'Failed to get iOS pageSource' };

    const { parsePageSource, findElementBySelector } = await import('../ios/page-source-utils');
    const elements = parsePageSource(xml);
    const selector = assertion.iosSelector;
    if (!selector) return { assertion, passed: false, error: 'No iosSelector specified' };

    const found = findElementBySelector(elements, selector);
    const passed = found !== null && found.visible;
    return {
      assertion, passed,
      actual: found ? `type=${found.type}, visible=${found.visible}, label="${found.label || ''}"` : 'not found',
      error: passed ? undefined : assertion.message || `iOS 요소를 찾을 수 없거나 보이지 않음: ${selector.strategy}=${selector.value}`,
    };
  }

  /**
   * ios_element_not_exists: iosSelector로 지정된 요소가 존재하지 않는지 검증
   */
  private async checkIOSElementNotExists(
    assertion: Assertion, ctx: AssertionContext
  ): Promise<AssertionResult> {
    if (!ctx.iosController) return { assertion, passed: false, error: 'No iOS controller context' };

    const xml = await this.getIOSPageSource(ctx);
    if (!xml) return { assertion, passed: false, error: 'Failed to get iOS pageSource' };

    const { parsePageSource, findElementBySelector } = await import('../ios/page-source-utils');
    const elements = parsePageSource(xml);
    const selector = assertion.iosSelector;
    if (!selector) return { assertion, passed: false, error: 'No iosSelector specified' };

    const found = findElementBySelector(elements, selector);
    const passed = found === null;
    return {
      assertion, passed,
      actual: found ? `found: type=${found.type}, label="${found.label || ''}"` : 'not found (expected)',
      error: passed ? undefined : assertion.message || `iOS 요소가 여전히 존재함: ${selector.strategy}=${selector.value}`,
    };
  }

  /**
   * ios_text_contains: pageSource XML에 특정 텍스트가 포함되어 있는지 검증
   */
  private checkIOSTextContains(
    assertion: Assertion, ctx: AssertionContext, expected: string
  ): AssertionResult {
    // 동기 메서드 — 캐시된 pageSource 사용 (evaluateAll에서 순서 보장)
    if (!ctx.iosController) return { assertion, passed: false, error: 'No iOS controller context' };
    if (!this.iosPageSourceCache) return { assertion, passed: false, error: 'No cached iOS pageSource (call ios_element_visible first or use async variant)' };

    const xml = this.iosPageSourceCache.xml;
    const passed = xml.includes(expected);
    return {
      assertion, passed,
      actual: passed ? `텍스트 "${expected}" 포함 확인` : `텍스트 "${expected}" 미포함`,
      error: passed ? undefined : assertion.message || `iOS 화면에 "${expected}" 텍스트가 없습니다`,
    };
  }

  /**
   * ios_element_value_equals: iosSelector로 지정된 요소의 value 속성이 expected와 같은지 검증
   */
  private async checkIOSElementValueEquals(
    assertion: Assertion, ctx: AssertionContext, expected: string
  ): Promise<AssertionResult> {
    if (!ctx.iosController) return { assertion, passed: false, error: 'No iOS controller context' };

    const xml = await this.getIOSPageSource(ctx);
    if (!xml) return { assertion, passed: false, error: 'Failed to get iOS pageSource' };

    const { parsePageSource, findElementBySelector } = await import('../ios/page-source-utils');
    const elements = parsePageSource(xml);
    const selector = assertion.iosSelector;
    if (!selector) return { assertion, passed: false, error: 'No iosSelector specified' };

    const found = findElementBySelector(elements, selector);
    if (!found) {
      return {
        assertion, passed: false, actual: 'element not found',
        error: assertion.message || `iOS 요소를 찾을 수 없음: ${selector.strategy}=${selector.value}`,
      };
    }

    const actual = found.value || '';
    const passed = actual === expected;
    return {
      assertion, passed,
      actual: `value="${actual}"`,
      error: passed ? undefined : assertion.message || `iOS 요소 value="${actual}", expected="${expected}"`,
    };
  }

  /**
   * ios_text_absent: pageSource에 특정 텍스트(들)이 없어야 함
   * 오류/실패/네트워크 에러 등의 UI 텍스트를 탐지하는 데 사용
   *
   * iosAbsentTexts 배열이 있으면 모든 텍스트를 검사하고,
   * 없으면 expected 하나만 검사한다.
   */
  private async checkIOSTextAbsent(
    assertion: Assertion, ctx: AssertionContext, expected: string
  ): Promise<AssertionResult> {
    if (!ctx.iosController) return { assertion, passed: false, error: 'No iOS controller context' };

    const xml = await this.getIOSPageSource(ctx);
    if (!xml) return { assertion, passed: false, error: 'Failed to get iOS pageSource' };

    const textsToCheck = assertion.iosAbsentTexts?.length
      ? assertion.iosAbsentTexts
      : [expected];

    const found: string[] = [];
    for (const text of textsToCheck) {
      if (xml.includes(text)) {
        found.push(text);
      }
    }

    const passed = found.length === 0;
    return {
      assertion, passed,
      actual: passed
        ? `검사한 ${textsToCheck.length}개 텍스트 모두 미포함 확인`
        : `발견된 텍스트: [${found.join(', ')}]`,
      error: passed ? undefined : assertion.message || `iOS 화면에 금지 텍스트 발견: ${found.join(', ')}`,
    };
  }

  /**
   * ios_list_count: 특정 타입의 visible 요소 수가 최소 N개인지 검증
   * 검색 결과/리스트가 존재하는지 확인하는 데 사용
   */
  private async checkIOSListCount(
    assertion: Assertion, ctx: AssertionContext
  ): Promise<AssertionResult> {
    if (!ctx.iosController) return { assertion, passed: false, error: 'No iOS controller context' };

    const xml = await this.getIOSPageSource(ctx);
    if (!xml) return { assertion, passed: false, error: 'Failed to get iOS pageSource' };

    const { parsePageSource, findElementBySelector } = await import('../ios/page-source-utils');
    const elements = parsePageSource(xml);

    const elementType = assertion.iosListConfig?.elementType || 'Cell';
    const minCount = assertion.iosListConfig?.minCount ?? 1;

    // iosSelector가 있으면 셀렉터와 일치하는 요소 카운트
    // 없으면 elementType으로 visible 요소 카운트
    let count: number;
    if (assertion.iosSelector) {
      // 셀렉터 기반: 해당 셀렉터 조건에 부합하면서 visible인 요소 카운트
      const strategy = assertion.iosSelector.strategy;
      const value = assertion.iosSelector.value;
      count = elements.filter(el => {
        if (!el.visible) return false;
        switch (strategy) {
          case 'accessibility_id': return el.accessibilityId === value;
          case 'name': return el.name === value;
          case 'label': return el.label === value;
          default: return false;
        }
      }).length;
    } else {
      // 타입 기반: XCUIElementType{elementType}이고 visible인 요소 카운트
      count = elements.filter(el => el.type === elementType && el.visible).length;
    }

    const passed = count >= minCount;
    return {
      assertion, passed,
      actual: `${elementType} count=${count} (min=${minCount})`,
      error: passed ? undefined : assertion.message || `iOS 리스트 요소 ${count}개 < 최소 ${minCount}개 (type: ${elementType})`,
    };
  }

  /**
   * ios_no_alert: 시스템 알럿/권한 팝업이 없는지 검증
   * pageSource에서 Alert/Sheet 타입 요소를 탐지
   */
  private async checkIOSNoAlert(
    assertion: Assertion, ctx: AssertionContext
  ): Promise<AssertionResult> {
    if (!ctx.iosController) return { assertion, passed: false, error: 'No iOS controller context' };

    const xml = await this.getIOSPageSource(ctx);
    if (!xml) return { assertion, passed: false, error: 'Failed to get iOS pageSource' };

    // iOS 시스템 알럿 탐지: XCUIElementTypeAlert, XCUIElementTypeSheet
    const alertPattern = /XCUIElementType(Alert|Sheet)[^>]*visible="true"[^>]*>/g;
    const alerts: string[] = [];
    let match;

    while ((match = alertPattern.exec(xml)) !== null) {
      const fullMatch = match[0];
      const labelMatch = fullMatch.match(/label="([^"]*)"/);
      const nameMatch = fullMatch.match(/name="([^"]*)"/);
      alerts.push(labelMatch?.[1] || nameMatch?.[1] || match[1]);
    }

    const passed = alerts.length === 0;
    return {
      assertion, passed,
      actual: passed ? '시스템 알럿 없음' : `알럿 발견: [${alerts.join(', ')}]`,
      error: passed ? undefined : assertion.message || `예상치 못한 시스템 알럿/팝업 발견: ${alerts.join(', ')}`,
    };
  }

  /**
   * ios_screen_changed: 이전 pageSource와 현재가 달라야 함
   * 화면 전환이 정상적으로 발생했는지 확인
   *
   * 시맨틱 비교: parsePageSource + diffUITrees를 사용하여
   * 타임스탬프 등 무의미한 XML 변경을 무시하고 실제 UI 변화만 감지
   */
  private async checkIOSScreenChanged(
    assertion: Assertion, ctx: AssertionContext
  ): Promise<AssertionResult> {
    if (!ctx.iosController) return { assertion, passed: false, error: 'No iOS controller context' };

    const currentXml = await this.getIOSPageSource(ctx);
    if (!currentXml) return { assertion, passed: false, error: 'Failed to get current iOS pageSource' };

    const previousXml = assertion.previousPageSource;
    if (!previousXml) {
      // 이전 소스가 없으면 화면 전환 확인 불가 → pass (첫 스텝)
      return { assertion, passed: true, actual: '이전 pageSource 없음 (첫 스텝)' };
    }

    // 시맨틱 비교: parsePageSource → diffUITrees
    const { parsePageSource, diffUITrees } = await import('../ios/page-source-utils');
    const before = parsePageSource(previousXml);
    const after = parsePageSource(currentXml);
    const diff = diffUITrees(before, after);

    const significantChange = diff.added.length > 0 || diff.removed.length > 0 || diff.changed.length > 0;
    return {
      assertion,
      passed: significantChange,
      actual: significantChange
        ? `변경: +${diff.added.length} 추가, -${diff.removed.length} 제거, ~${diff.changed.length} 변경`
        : '화면 변화 없음',
      error: significantChange ? undefined : assertion.message || 'iOS 화면이 변경되지 않았습니다 (이전 상태와 동일)',
    };
  }

  // ─── Network Assertions (프록시/네트워크 로그 기반) ──────

  /** 네트워크 로그에서 URL 패턴으로 로그 필터링 */
  private filterNetworkLogs(
    ctx: AssertionContext,
    config: NonNullable<Assertion['networkConfig']>
  ): NetworkLogEntry[] {
    if (!ctx.networkLogs || ctx.networkLogs.length === 0) return [];

    const windowMs = config.windowMs ?? 30000;
    const cutoff = Date.now() - windowMs;

    return ctx.networkLogs.filter(log => {
      if (log.timestamp < cutoff) return false;
      // URL 매칭
      if (config.urlIsRegex) {
        if (!new RegExp(config.urlPattern, 'i').test(log.url)) return false;
      } else {
        if (!log.url.includes(config.urlPattern)) return false;
      }
      // method 필터
      if (config.method && log.method && log.method.toUpperCase() !== config.method.toUpperCase()) return false;
      return true;
    });
  }

  /**
   * network_request_sent: 특정 URL 패턴의 요청이 발생했는지 검증
   * "요청이 안 나감" vs "나가는데 빈 값" 분류에 핵심
   */
  private checkNetworkRequestSent(
    assertion: Assertion, ctx: AssertionContext
  ): AssertionResult {
    const config = assertion.networkConfig;
    if (!config) return { assertion, passed: false, error: 'No networkConfig specified' };

    if (!ctx.networkLogs || ctx.networkLogs.length === 0) {
      return {
        assertion, passed: false,
        actual: '네트워크 로그 없음 (프록시 미연결?)',
        error: assertion.message || '네트워크 로그가 수집되지 않았습니다. mitmproxy/프록시 연결을 확인하세요.',
      };
    }

    const matching = this.filterNetworkLogs(ctx, config);
    const passed = matching.length > 0;

    return {
      assertion, passed,
      actual: passed
        ? `${config.urlPattern} 요청 ${matching.length}건 발견`
        : `${config.urlPattern} 요청 0건 (최근 ${config.windowMs ?? 30000}ms 내)`,
      error: passed ? undefined : assertion.message || `네트워크 요청이 발생하지 않음: ${config.urlPattern}`,
    };
  }

  /**
   * network_response_status: 특정 URL 패턴 요청의 응답 상태 코드 검증
   */
  private checkNetworkResponseStatus(
    assertion: Assertion, ctx: AssertionContext
  ): AssertionResult {
    const config = assertion.networkConfig;
    if (!config) return { assertion, passed: false, error: 'No networkConfig specified' };

    if (!ctx.networkLogs || ctx.networkLogs.length === 0) {
      return { assertion, passed: false, error: '네트워크 로그가 수집되지 않았습니다.' };
    }

    const matching = this.filterNetworkLogs(ctx, config);
    if (matching.length === 0) {
      return {
        assertion, passed: false,
        actual: `${config.urlPattern} 요청 0건`,
        error: assertion.message || `네트워크 요청이 발생하지 않음: ${config.urlPattern}`,
      };
    }

    const expectedStatus = config.expectedStatus ?? 200;
    // 마지막(가장 최근) 매칭 로그를 기준으로 판정
    const latest = matching[matching.length - 1];
    const passed = latest.status === expectedStatus;

    return {
      assertion, passed,
      actual: `status=${latest.status}, url=${latest.url.substring(0, 100)}`,
      error: passed ? undefined : assertion.message || `네트워크 응답 ${latest.status}, 기대값 ${expectedStatus}: ${config.urlPattern}`,
    };
  }

  /**
   * network_response_json: 응답 JSON body에서 JSONPath 조건 검증
   * 이미지 검색 결과 items.length > 0 같은 도메인 로직 검증에 핵심
   */
  private checkNetworkResponseJson(
    assertion: Assertion, ctx: AssertionContext
  ): AssertionResult {
    const config = assertion.networkConfig;
    if (!config) return { assertion, passed: false, error: 'No networkConfig specified' };
    if (!config.jsonPath) return { assertion, passed: false, error: 'No jsonPath specified in networkConfig' };

    if (!ctx.networkLogs || ctx.networkLogs.length === 0) {
      return { assertion, passed: false, error: '네트워크 로그가 수집되지 않았습니다.' };
    }

    // responseBody가 있는 로그만 필터
    const matching = this.filterNetworkLogs(ctx, config).filter(log => log.responseBody);
    if (matching.length === 0) {
      return {
        assertion, passed: false,
        actual: `${config.urlPattern} 응답 body가 있는 로그 0건`,
        error: assertion.message || `응답 body를 캡처한 네트워크 로그 없음: ${config.urlPattern}. 프록시에서 body 캡처를 활성화하세요.`,
      };
    }

    const latest = matching[matching.length - 1];
    let body: any;
    try {
      body = JSON.parse(latest.responseBody!);
    } catch {
      return {
        assertion, passed: false,
        actual: `JSON 파싱 실패: ${latest.responseBody?.substring(0, 100)}`,
        error: assertion.message || '응답 body가 유효한 JSON이 아닙니다.',
      };
    }

    // JSONPath 해석
    const actualValue = this.resolveJsonPathForNetwork(body, config.jsonPath);
    const op = config.jsonOp ?? '>';
    const expectedValue = config.jsonValue;

    // 연산자별 비교
    let passed: boolean;
    switch (op) {
      case 'exists':
        passed = actualValue !== undefined && actualValue !== null;
        break;
      case 'not_empty':
        passed = actualValue !== undefined && actualValue !== null && actualValue !== '' &&
          !(Array.isArray(actualValue) && actualValue.length === 0);
        break;
      case '==':
        passed = String(actualValue) === String(expectedValue);
        break;
      case '!=':
        passed = String(actualValue) !== String(expectedValue);
        break;
      case '>':
        passed = Number(actualValue) > Number(expectedValue);
        break;
      case '>=':
        passed = Number(actualValue) >= Number(expectedValue);
        break;
      case '<':
        passed = Number(actualValue) < Number(expectedValue);
        break;
      case '<=':
        passed = Number(actualValue) <= Number(expectedValue);
        break;
      default:
        passed = false;
    }

    return {
      assertion, passed,
      actual: `${config.jsonPath} = ${JSON.stringify(actualValue)?.substring(0, 200)} (${op} ${expectedValue})`,
      error: passed ? undefined : assertion.message || `JSON 조건 불충족: ${config.jsonPath} ${op} ${expectedValue}, 실제값: ${JSON.stringify(actualValue)?.substring(0, 100)}`,
    };
  }

  /**
   * network_image_loads: 이미지 URL들이 정상 로드(200)되는지 샘플링 검증
   * 이미지 검색 결과의 썸네일이 실제로 보이는지 확인
   */
  private checkNetworkImageLoads(
    assertion: Assertion, ctx: AssertionContext
  ): AssertionResult {
    const config = assertion.networkConfig;
    if (!config) return { assertion, passed: false, error: 'No networkConfig specified' };

    if (!ctx.networkLogs || ctx.networkLogs.length === 0) {
      return { assertion, passed: false, error: '네트워크 로그가 수집되지 않았습니다.' };
    }

    const sampleCount = config.sampleCount ?? 3;

    // 방법 1: imageUrlJsonPath가 있으면 API 응답에서 이미지 URL 추출 후 해당 URL 로드 확인
    if (config.imageUrlJsonPath) {
      const apiLogs = this.filterNetworkLogs(ctx, config).filter(log => log.responseBody);
      if (apiLogs.length === 0) {
        return {
          assertion, passed: false,
          actual: 'API 응답 로그 0건',
          error: assertion.message || `이미지 URL 추출을 위한 API 응답이 없음: ${config.urlPattern}`,
        };
      }

      const latestApi = apiLogs[apiLogs.length - 1];
      let body: any;
      try { body = JSON.parse(latestApi.responseBody!); } catch {
        return { assertion, passed: false, error: 'API 응답 JSON 파싱 실패' };
      }

      // JSONPath에서 이미지 URL 배열 추출
      const imageUrls = this.extractImageUrls(body, config.imageUrlJsonPath);
      if (imageUrls.length === 0) {
        return {
          assertion, passed: false,
          actual: `이미지 URL 0개 추출됨 (path: ${config.imageUrlJsonPath})`,
          error: assertion.message || '응답에서 이미지 URL을 추출할 수 없습니다.',
        };
      }

      // 샘플링: 처음 N개 URL이 네트워크 로그에 200으로 기록되어 있는지 확인
      const sampled = imageUrls.slice(0, sampleCount);
      const results = sampled.map(url => {
        const imgLog = ctx.networkLogs!.find(
          log => log.url.includes(url.substring(url.lastIndexOf('/') + 1)) && log.status === 200
        );
        return { url: url.substring(0, 80), loaded: !!imgLog };
      });

      const loadedCount = results.filter(r => r.loaded).length;
      const passed = loadedCount >= Math.min(sampleCount, sampled.length);

      return {
        assertion, passed,
        actual: `이미지 로드 ${loadedCount}/${sampled.length}개 성공`,
        error: passed ? undefined : assertion.message || `이미지 로드 실패: ${results.filter(r => !r.loaded).map(r => r.url).join(', ')}`,
      };
    }

    // 방법 2: 이미지 URL 패턴으로 직접 네트워크 로그에서 이미지 로드 확인
    const windowMs = config.windowMs ?? 30000;
    const cutoff = Date.now() - windowMs;
    const imagePatterns = /\.(jpg|jpeg|png|gif|webp|svg|avif|ico)(\?|$)/i;
    const imageLogs = ctx.networkLogs.filter(
      log => log.timestamp >= cutoff && imagePatterns.test(log.url)
    );

    const successLogs = imageLogs.filter(log => log.status === 200);
    const failedLogs = imageLogs.filter(log => log.status !== 200 && log.status > 0);

    const passed = successLogs.length >= sampleCount;
    return {
      assertion, passed,
      actual: `이미지 로드: 성공 ${successLogs.length}건, 실패 ${failedLogs.length}건 (최근 ${windowMs}ms)`,
      error: passed ? undefined : assertion.message || `이미지 로드 부족: ${successLogs.length}건 < 최소 ${sampleCount}건`,
    };
  }

  /**
   * network_no_errors: 네트워크 에러(4xx/5xx/timeout)가 없는지 검증
   */
  private checkNetworkNoErrors(
    assertion: Assertion, ctx: AssertionContext
  ): AssertionResult {
    const config = assertion.networkConfig;
    if (!config) return { assertion, passed: false, error: 'No networkConfig specified' };

    if (!ctx.networkLogs || ctx.networkLogs.length === 0) {
      // 로그가 없으면 에러도 없음 → pass (프록시 미연결 시)
      return { assertion, passed: true, actual: '네트워크 로그 없음 (검증 스킵)' };
    }

    const matching = this.filterNetworkLogs(ctx, config);
    const allowedStatus = new Set(config.allowedErrorStatus || []);

    const errors = matching.filter(log => {
      if (allowedStatus.has(log.status)) return false;
      // 4xx/5xx 또는 상태 0(연결 실패) 또는 에러 메시지
      return log.status >= 400 || log.status === 0 || !!log.error;
    });

    const passed = errors.length === 0;
    const errorSummary = errors.slice(0, 5).map(
      e => `${e.status} ${e.method || 'GET'} ${e.url.substring(0, 60)}${e.error ? ` (${e.error})` : ''}`
    );

    return {
      assertion, passed,
      actual: passed
        ? `${config.urlPattern} 관련 에러 0건 (검사 ${matching.length}건)`
        : `에러 ${errors.length}건 발견: ${errorSummary.join('; ')}`,
      error: passed ? undefined : assertion.message || `네트워크 에러 발견: ${errorSummary.join('; ')}`,
    };
  }

  // ─── Network JSON 유틸 ─────────────────────────────────

  /** 간단한 JSON path 해석 (네트워크 assertion용) */
  private resolveJsonPathForNetwork(obj: any, path: string): any {
    if (!obj || !path) return undefined;
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

  /**
   * JSONPath에서 이미지 URL 배열 추출
   * "$.items[*].thumbnailUrl" 같은 와일드카드 지원
   */
  private extractImageUrls(body: any, jsonPath: string): string[] {
    // [*] 와일드카드 처리
    if (jsonPath.includes('[*]')) {
      const [arrayPath, ...restParts] = jsonPath.split('[*]');
      const array = this.resolveJsonPathForNetwork(body, arrayPath);
      if (!Array.isArray(array)) return [];

      const restPath = restParts.join('[*]').replace(/^\./, '');
      if (!restPath) {
        // 배열 자체가 문자열 URL 배열인 경우
        return array.filter(item => typeof item === 'string');
      }

      return array
        .map(item => this.resolveJsonPathForNetwork(item, restPath))
        .filter((v): v is string => typeof v === 'string' && v.length > 0);
    }

    // 와일드카드 없으면 직접 해석
    const result = this.resolveJsonPathForNetwork(body, jsonPath);
    if (typeof result === 'string') return [result];
    if (Array.isArray(result)) return result.filter((v): v is string => typeof v === 'string');
    return [];
  }
}
