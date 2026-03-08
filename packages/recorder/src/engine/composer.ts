/**
 * 시나리오 합성기
 *
 * includes[] 를 재귀적으로 해석하여 이벤트 목록을 플래튼한다.
 * 예: COMMON-SIGNUP-WEB-ENTRY 시나리오를 WEB-SIGNUP-NAVER-A14 에 include로 연결
 */

import type { RecordingScenario, RecordingEvent } from '../types';
import { FileStorage } from '../storage/file-storage';

export class ScenarioComposer {
  private resolvedIds = new Set<string>();  // 순환 참조 방지

  constructor(private storage: FileStorage) {}

  /**
   * includes를 재귀 해석하여 최종 이벤트 배열 반환
   * 순서: include된 시나리오 이벤트 → 본 시나리오 이벤트
   * 정규화 패스를 적용하여 "click 후 관측된 navigate"를 "wait_for + assert"로 변환
   */
  async compose(scenario: RecordingScenario): Promise<RecordingEvent[]> {
    this.resolvedIds.clear();
    const events = await this.resolveRecursive(scenario);
    return this.normalizeNavigations(events);
  }

  private async resolveRecursive(scenario: RecordingScenario): Promise<RecordingEvent[]> {
    // 순환 참조 방지
    if (this.resolvedIds.has(scenario.id)) {
      console.warn(`Circular include detected: ${scenario.id} (${scenario.name})`);
      return [];
    }
    this.resolvedIds.add(scenario.id);

    const events: RecordingEvent[] = [];

    // 먼저 includes 해석
    if (scenario.includes && scenario.includes.length > 0) {
      for (const ref of scenario.includes) {
        const included = await this.storage.loadScenario(ref.scenarioId);
        if (!included) {
          console.warn(`Included scenario not found: ${ref.scenarioId} (alias: ${ref.aliasId || 'none'})`);
          continue;
        }

        // 재귀적으로 include된 시나리오도 해석
        const includedEvents = await this.resolveRecursive(included);

        // include된 이벤트에 출처 태그 추가
        for (const ev of includedEvents) {
          events.push({
            ...ev,
            meta: {
              ...(ev.meta || {}),
              includedFrom: ref.aliasId || ref.scenarioId,
            }
          });
        }
      }
    }

    // 본 시나리오 이벤트 추가
    events.push(...scenario.events);

    return events;
  }

  /**
   * 정규화 패스: "click/keyboard(Enter/submit) 직후 관측된 navigate"를
   * "wait_for(url_change) + assert(url_contains)"로 변환한다.
   *
   * 패턴:
   *   [click/keyboard(Enter)] → [navigate(source=page_load|spa_*, 1500ms 이내)]
   * 변환 후:
   *   [click/keyboard(Enter)] → [wait_for(url_change)] → [assert(url_contains)]
   *
   * 첫 번째 navigate(index=0)와 explicit_goto는 변환 대상에서 제외한다.
   */
  private normalizeNavigations(events: RecordingEvent[]): RecordingEvent[] {
    if (events.length === 0) return events;

    const result: RecordingEvent[] = [];
    const NAVIGATE_THRESHOLD_MS = 1500; // click 후 navigate까지 허용 시간

    // click, keyboard(Enter/submit) 등 네비게이션을 유발할 수 있는 액션인지 판별
    const isNavigationTrigger = (ev: RecordingEvent): boolean => {
      if (ev.type === 'click') return true;
      if (ev.type === 'keyboard') {
        const key = ev.keyboard?.key?.toLowerCase() || '';
        return key === 'enter' || key === 'submit';
      }
      return false;
    };

    // navigate가 "관측된 이동"인지 판별
    const isObservedNavigate = (ev: RecordingEvent): boolean => {
      if (ev.type !== 'navigate') return false;
      const source = ev.meta?.source;
      return source === 'page_load' ||
        (typeof source === 'string' && source.startsWith('spa_'));
    };

    for (let i = 0; i < events.length; i++) {
      const current = events[i];

      // 첫 번째 이벤트가 navigate이면 그대로 유지 (초기 이동)
      if (i === 0) {
        result.push(current);
        continue;
      }

      // 명시적 goto는 변환 대상이 아님
      if (current.type === 'navigate' && current.meta?.source === 'explicit_goto') {
        result.push(current);
        continue;
      }

      // 녹화 마커 이벤트는 그대로 유지
      if (current.type === 'navigate' && current.meta?.source &&
          (current.meta.source === 'recording_paused' ||
           current.meta.source === 'recording_unpaused' ||
           current.meta.source === 'recording_resumed')) {
        result.push(current);
        continue;
      }

      // 패턴 감지: 이전 이벤트가 navigation trigger이고, 현재가 관측된 navigate이며,
      //           시간 차이가 threshold 이내
      if (isObservedNavigate(current) && current.url) {
        // 이전 이벤트 중 navigation trigger를 탐색
        // (disabled, wait_for(auto-inserted), 마커 이벤트는 건너뜀)
        let prevIdx = result.length - 1;
        while (prevIdx >= 0 && (
          result[prevIdx].disabled ||
          result[prevIdx].type === 'wait_for' ||
          result[prevIdx].type === 'wait'
        )) prevIdx--;

        if (prevIdx >= 0) {
          const prev = result[prevIdx];
          const timeDiff = current.timestamp - prev.timestamp;

          if (isNavigationTrigger(prev) && timeDiff <= NAVIGATE_THRESHOLD_MS) {
            // navigate → wait_for(url_change) + assert(url_contains) 변환
            let urlPattern: string;
            let isExternalDomain = false;
            try {
              const urlObj = new URL(current.url);
              // 쿼리파라미터/해시 제외한 pathname으로 매칭 (동적 부분 제거)
              urlPattern = urlObj.pathname;

              // 외부 도메인(IdP 등) 판별: 이전 이벤트의 URL과 도메인 비교
              const prevUrl = prev.url || prev.meta?.pageUrl;
              if (prevUrl) {
                try {
                  const prevHost = new URL(prevUrl).hostname;
                  isExternalDomain = prevHost !== urlObj.hostname;
                } catch { /* 비교 불가 시 기본값 사용 */ }
              }
              // 알려진 외부 인증 도메인 패턴 감지
              const externalAuthDomains = ['nid.naver.com', 'accounts.google.com', 'kauth.kakao.com', 'appleid.apple.com'];
              if (externalAuthDomains.some(d => urlObj.hostname.includes(d))) {
                isExternalDomain = true;
              }
            } catch {
              urlPattern = current.url;
            }

            // 외부 도메인: 60초, 내부: 30초
            const waitTimeout = isExternalDomain ? 60000 : 30000;

            // wait_for(url_change) 이벤트 생성
            result.push({
              type: 'wait_for',
              timestamp: current.timestamp,
              waitForConfig: {
                waitType: 'url_change',
                urlPattern,
                timeout: waitTimeout,
                waitUntil: 'domcontentloaded',
              },
              meta: {
                ...(current.meta || {}),
                normalizedFrom: 'navigate',
                originalUrl: current.url,
                isExternalDomain,
              },
              description: current.description || `URL 변경 대기: ${urlPattern}`,
            });

            // assert(url_contains) 이벤트 생성
            const assertAssertions: Array<{ type: string; target?: string; expected: string; message?: string; optional?: boolean }> = [{
              type: 'url_contains',
              expected: urlPattern,
              message: `URL에 "${urlPattern}" 포함 확인`,
            }];

            // 외부 IdP 리턴 검증: 외부 도메인으로 갔다면 원래 도메인 복귀 확인
            if (isExternalDomain) {
              const prevUrl = prev.url || prev.meta?.pageUrl;
              if (prevUrl) {
                try {
                  const originalHost = new URL(prevUrl).hostname;
                  // 다음 이벤트가 원래 도메인으로 돌아오는 navigate인지 확인
                  const nextIdx = i + 1;
                  if (nextIdx < events.length && isObservedNavigate(events[nextIdx]) && events[nextIdx].url) {
                    try {
                      const returnHost = new URL(events[nextIdx].url!).hostname;
                      if (returnHost === originalHost) {
                        assertAssertions.push({
                          type: 'url_contains',
                          expected: originalHost,
                          message: `외부 인증 후 원래 도메인(${originalHost}) 복귀 확인`,
                          optional: true,
                        });
                      }
                    } catch { /* 무시 */ }
                  }
                } catch { /* 무시 */ }
              }
            }

            result.push({
              type: 'assert',
              timestamp: current.timestamp,
              assertions: assertAssertions as any[],
              meta: {
                ...(current.meta || {}),
                normalizedFrom: 'navigate',
              },
              description: `URL 검증: ${urlPattern}`,
            });

            continue; // 원래 navigate 이벤트는 건너뜀
          }
        }
      }

      // 리다이렉트 체인 처리: 연속 observed navigate는 마지막 것만 assert
      if (isObservedNavigate(current) && current.url) {
        // 다음 이벤트도 observed navigate인지 확인
        const nextIdx = i + 1;
        if (nextIdx < events.length && isObservedNavigate(events[nextIdx]) && events[nextIdx].url) {
          const timeDiff = events[nextIdx].timestamp - current.timestamp;
          if (timeDiff <= NAVIGATE_THRESHOLD_MS) {
            // 중간 navigate는 건너뛰기 (체인의 마지막에서 처리)
            continue;
          }
        }
      }

      // SPA hashchange 처리: hash 부분으로 url_contains assert 생성
      if (current.type === 'navigate' && current.url &&
          current.meta?.source === 'spa_hashchange') {
        try {
          const urlObj = new URL(current.url);
          if (urlObj.hash) {
            result.push({
              type: 'wait_for',
              timestamp: current.timestamp,
              waitForConfig: {
                waitType: 'url_change',
                urlPattern: urlObj.hash,
                timeout: 10000,
                waitUntil: 'domcontentloaded',
              },
              meta: {
                ...(current.meta || {}),
                normalizedFrom: 'hashchange',
              },
              description: `해시 변경 대기: ${urlObj.hash}`,
            });

            result.push({
              type: 'assert',
              timestamp: current.timestamp,
              assertions: [{
                type: 'url_contains',
                expected: urlObj.hash,
                message: `URL 해시 "${urlObj.hash}" 포함 확인`,
              }],
              meta: {
                ...(current.meta || {}),
                normalizedFrom: 'hashchange',
              },
              description: `해시 검증: ${urlObj.hash}`,
            });

            continue;
          }
        } catch { /* URL 파싱 실패 시 그대로 유지 */ }
      }

      // 그 외는 그대로 유지
      result.push(current);
    }

    return result;
  }

  /**
   * 시나리오 ID 또는 aliasId(tcId)로 검색
   */
  async findByAlias(aliasId: string): Promise<RecordingScenario | null> {
    const scenarios = await this.storage.listScenarios();
    return scenarios.find(s => s.tcId === aliasId || s.id === aliasId) || null;
  }
}
