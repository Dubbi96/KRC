/**
 * SelfHealer — 결정론적 휴리스틱 기반 요소 복구 모듈
 *
 * 모든 locator 전략이 실패한 후, DOM에서 후보를 탐색하고
 * 점수화하여 가장 가까운 요소를 찾아내는 "자가 치유" 로직.
 *
 * LLM 없이 동작하며, 운영 비용/예측 가능성이 우수하다.
 *
 * 4가지 휴리스틱:
 * 1. role + name 유사도 (같은 role 요소 중 텍스트 유사도 최고)
 * 2. label-input 관계 재탐색 (label 텍스트로 연결된 input 찾기)
 * 3. 태그 + 텍스트 유사도 (같은 태그 중 텍스트 유사도 최고)
 * 4. boundingBox 근접도 (녹화 좌표 주변 clickable 요소)
 */
import type { Page, Locator } from 'playwright';
import type { RecordingEvent, PreferredLocator } from '../types';
import type { ResolverOptions } from './locator-resolver';
export interface SelfHealResult {
    locator: Locator;
    strategy: string;
    score: number;
    preferredLocator: PreferredLocator;
}
export declare class SelfHealer {
    /**
     * DOM에서 후보를 수집하고, 점수화하여 가장 적합한 요소를 찾는다.
     * @returns SelfHealResult 또는 null (복구 불가)
     */
    heal(page: Page, event: RecordingEvent, opts: ResolverOptions): Promise<SelfHealResult | null>;
    private healByRoleNameSimilarity;
    private healByLabelInput;
    private healByTagTextSimilarity;
    private healByBboxProximity;
}
