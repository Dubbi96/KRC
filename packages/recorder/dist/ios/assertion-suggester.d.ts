/**
 * iOS Assertion 추천 엔진
 *
 * UI 트리 diff를 분석하여 assertion 후보를 생성한다.
 * 녹화 중 tap 전/후 스냅샷 비교 결과를 입력으로 받는다.
 */
import type { Assertion } from '../types';
import type { IOSUIElement, UITreeDiff } from './page-source-utils';
export interface AssertionSuggestion {
    assertion: Assertion;
    confidence: 'high' | 'medium' | 'low';
    reason: string;
}
/**
 * UI 트리 diff로부터 assertion 추천을 생성
 *
 * @param diff - diffUITrees()의 결과
 * @param tappedElement - tap된 요소 메타데이터 (있는 경우)
 * @returns 추천 배열 (confidence 내림차순 정렬)
 */
export declare function suggestAssertionsFromDiff(diff: UITreeDiff, tappedElement?: Partial<IOSUIElement>): AssertionSuggestion[];
