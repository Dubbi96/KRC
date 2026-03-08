/**
 * Signal Collector
 *
 * TestResult의 EventResult.resolvedBy 문자열을 파싱하여
 * 표준화된 Fallback 신호(TestRunSignals)를 수집한다.
 *
 * 기존 replayer 코드를 수정하지 않고, 결과에서 역으로 파싱.
 */

import type { TestResult, EventResult } from '../types';
import type { FallbackRecord, TestRunSignals } from './types';

/**
 * TestResult에서 fallback 신호를 수집한다.
 */
export function collectSignals(
  testResult: TestResult,
  platform?: 'web' | 'ios' | 'android',
): TestRunSignals {
  const resolvedPlatform = platform || testResult.platform || 'web';
  const records: FallbackRecord[] = [];
  const infraFailures: string[] = [];

  for (const event of testResult.events) {
    const record = analyzeEventResult(event, resolvedPlatform);
    if (record) {
      records.push(record);
    }

    // 인프라 실패 감지
    if (event.status === 'failed' && event.error) {
      if (isInfraError(event.error)) {
        infraFailures.push(event.error);
      }
    }
  }

  // 전체 테스트가 인프라 문제로 실패한 경우
  if (testResult.error && isInfraError(testResult.error)) {
    infraFailures.push(testResult.error);
  }

  const fallbackRecords = records.filter(r =>
    r.usedCoordinateFallback || r.usedForceClick || isFallbackResolution(r.resolvedBy, resolvedPlatform),
  );

  const fallbacksByType: Record<string, number> = {};
  for (const r of fallbackRecords) {
    const type = categorizeFallback(r.resolvedBy, resolvedPlatform);
    fallbacksByType[type] = (fallbacksByType[type] || 0) + 1;
  }

  // optional assertion 통계 수집
  let optionalAssertTotal = 0;
  let optionalAssertPassed = 0;
  for (const event of testResult.events) {
    if (event.assertionResults) {
      for (const ar of event.assertionResults) {
        if (ar.assertion.optional) {
          optionalAssertTotal++;
          if (ar.passed) optionalAssertPassed++;
        }
      }
    }
  }

  return {
    fallbackCount: fallbackRecords.length,
    coordinateFallbackCount: records.filter(r => r.usedCoordinateFallback).length,
    forceClickCount: records.filter(r => r.usedForceClick).length,
    fallbacksByType,
    infraFailures,
    fallbackRecords,
    optionalAssertTotal,
    optionalAssertPassed,
  };
}

/**
 * 개별 EventResult에서 FallbackRecord를 추출한다.
 */
function analyzeEventResult(
  event: EventResult,
  platform: 'web' | 'ios' | 'android',
): FallbackRecord | null {
  if (!event.resolvedBy) return null;

  const resolvedBy = event.resolvedBy;

  return {
    stepIndex: event.eventIndex,
    eventType: event.eventType,
    resolvedBy,
    usedCoordinateFallback: isCoordinateFallback(resolvedBy),
    usedForceClick: isForceClick(resolvedBy),
    platform,
  };
}

// ─── 패턴 매칭 함수들 ────────────────────────────────

/**
 * coordinate fallback 사용 여부
 */
function isCoordinateFallback(resolvedBy: string): boolean {
  return resolvedBy.includes('coordinate-fallback')
    || resolvedBy.includes('coordinate_fallback');
}

/**
 * force click 사용 여부
 */
function isForceClick(resolvedBy: string): boolean {
  return resolvedBy.includes('(force)');
}

/**
 * primary가 아닌 fallback 해결인지 판별
 *
 * Web에서 Playwright의 preferred(role), preferred(text), preferred(testId) 등
 * 신뢰도 높은 로케이터 전략과 semantic:testId, semantic:role, semantic:label,
 * css-fallback 등 구조 기반 전략은 fallback으로 간주하지 않는다.
 * 텍스트 콘텐츠 기반(semantic:text, text-scoped 등)이나 미식별 전략만 fallback 처리.
 */
function isFallbackResolution(resolvedBy: string, platform: string): boolean {
  if (platform === 'web') {
    // 1순위: primary, css → 확정 non-fallback
    if (resolvedBy.startsWith('primary:')) return false;
    if (resolvedBy.startsWith('css:')) return false;

    // preferred(...) 전략: Playwright getByRole/getByText/getByTestId 등 → 신뢰도 높음
    if (resolvedBy.startsWith('preferred(')) return false;

    // semantic 중 구조 기반 → 신뢰도 높음
    if (resolvedBy.startsWith('semantic:testId')) return false;
    if (resolvedBy.startsWith('semantic:role')) return false;
    if (resolvedBy.startsWith('semantic:label')) return false;

    // css-fallback: 대체 CSS 셀렉터 → 구조 기반이므로 비교적 안정
    if (resolvedBy.startsWith('css-fallback:')) return false;

    // 나머지 (semantic:text, semantic:placeholder, semantic:title, text-scoped 등) → fallback
    return true;
  }

  if (platform === 'ios') {
    // iOS: ios_selector:... 가 primary, coordinate_fallback이 fallback
    return resolvedBy.includes('coordinate_fallback')
      || resolvedBy.includes('meta_element');
  }

  if (platform === 'android') {
    // Android: android_selector:... 가 primary, coordinate_fallback이 fallback
    return resolvedBy.includes('coordinate_fallback')
      || resolvedBy.includes('meta_element');
  }

  return false;
}

/**
 * fallback을 카테고리로 분류
 */
function categorizeFallback(resolvedBy: string, platform: string): string {
  if (isCoordinateFallback(resolvedBy)) return 'coordinate-fallback';
  if (isForceClick(resolvedBy)) return 'force-click';

  if (platform === 'web') {
    if (resolvedBy.startsWith('css-fallback:')) return 'css-fallback';
    if (resolvedBy.startsWith('semantic:testId')) return 'semantic-testId';
    if (resolvedBy.startsWith('semantic:role')) return 'semantic-role';
    if (resolvedBy.startsWith('semantic:label')) return 'semantic-label';
    if (resolvedBy.startsWith('semantic:placeholder')) return 'semantic-placeholder';
    if (resolvedBy.startsWith('semantic:title')) return 'semantic-title';
    if (resolvedBy.startsWith('semantic:text')) return 'semantic-text';
    if (resolvedBy.startsWith('text-scoped:')) return 'text-scoped';
    return 'web-other';
  }

  if (platform === 'ios') {
    if (resolvedBy.includes('meta_element')) return 'ios-meta-element';
    return 'ios-other';
  }

  if (platform === 'android') {
    if (resolvedBy.includes('meta_element')) return 'android-meta-element';
    return 'android-other';
  }

  return 'unknown';
}

/**
 * 인프라 에러 여부 판별
 */
function isInfraError(errorMessage: string): boolean {
  const infraPatterns = [
    'ECONNREFUSED',
    'ECONNRESET',
    'ETIMEDOUT',
    'browser has been closed',
    'Browser closed',
    'Target closed',
    'context was destroyed',
    'session not created',
    'appium',
    'Appium',
    'device not found',
    'Device not found',
    'WDA',
    'WebDriverAgent',
    'adb',
    'ADB',
    'No such device',
    'socket hang up',
    'net::ERR_',
    'Navigation failed',
  ];

  const lowerMsg = errorMessage.toLowerCase();
  return infraPatterns.some(p => lowerMsg.includes(p.toLowerCase()));
}
