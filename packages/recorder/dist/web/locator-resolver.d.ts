/**
 * LocatorResolver — 다중 후보 + 점수화 기반 요소 탐색 모듈
 *
 * 녹화 시 수집된 풍부한 locator 후보(preferredLocators, selectors, meta.element)를
 * 우선순위와 점수에 따라 평가하여 가장 안정적인 요소를 찾는다.
 *
 * self-heal 로직과 분리되어 있으며, resolve 실패 시 SelfHealer를 호출하는 구조.
 */
import type { Page, Locator } from 'playwright';
import type { RecordingEvent, PreferredLocator, HealedLocator } from '../types';
import { VariableContext } from '../engine/variables';
export interface ResolveResult {
    locator: Locator;
    resolvedBy: string;
    /** self-heal을 통해 찾은 경우, 시나리오에 반영할 healed locator 정보 */
    healedLocator?: HealedLocator;
    /** 기존 healedLocator로 성공한 경우, 해당 healed 정보 (successCount 누적용) */
    usedHealedLocator?: HealedLocator;
    /** 성공한 preferredLocator 정보 (통계/학습용) */
    usedPreferredLocator?: PreferredLocator;
}
export interface ResolverOptions {
    /** 스코프 컨테이너(within) 적용된 root */
    scopeRoot: Page | Locator;
    /** 스코프 설명 문자열 */
    scopeDescription: string;
    /** 전체 스텝 deadline (ms timestamp) */
    deadline: number;
    /** 변수 컨텍스트 */
    variables: VariableContext;
    /** matchText (사용자 지정 텍스트 매칭) */
    matchText?: string;
}
/** 텍스트 정규화 (유사도 비교용) */
export declare function normalizeText(text: string | undefined | null): string;
/** 두 텍스트의 유사도 점수 (0~1, 1=동일) — 간단한 토큰 겹침 기반 */
export declare function textSimilarity(a: string, b: string): number;
export declare class LocatorResolver {
    private selfHealer;
    /**
     * 다중 전략으로 요소를 탐색한다.
     *
     * 탐색 순서:
     * 0. healedLocators (이전 self-heal 성공 이력)
     * 1. preferredLocators (기록 시 생성된 권장 후보)
     * 2. primary CSS selector
     * 3. CSS fallback selectors
     * 4. text-scoped CSS
     * 5. tag+text direct match
     * 6. Playwright semantic locators (testId/role/label/placeholder/title/text)
     * 7. self-heal 시도 (실패 시)
     *
     * 모든 단계에서 deadline 초과 시 즉시 중단.
     */
    resolve(page: Page, event: RecordingEvent, opts: ResolverOptions): Promise<ResolveResult>;
    private tryPreferredLocator;
    /**
     * 다중 매칭 시 최적의 1개를 선택한다.
     * count==1 이면 즉시 반환, count>1 이면 bbox 거리 + 텍스트 유사도로 최적 1개를 고른다.
     * count>10 (너무 많은 매칭)이면 신뢰도가 낮아 null 반환하여 다음 전략으로 넘긴다.
     */
    private pickBestMatch;
    /**
     * 기록된 요소 속성(name, placeholder)과 실제 해석된 요소의 속성이 다른지 검사.
     * 다르면 true 반환 → 이 locator 결과를 거부하고 다음 후보로 넘긴다.
     */
    private checkAttributeMismatch;
    private trySemantic;
    private selectNearestByDistance;
    private buildDetailedError;
}
