/**
 * iOS Page Source XML 파싱 및 UI 트리 diff 유틸리티
 *
 * Appium pageSource(XML)를 파싱하여 요소 배열로 변환하고,
 * 두 스냅샷 간 차이를 감지하여 assertion 추천의 기반 데이터를 생성한다.
 */
export interface IOSUIElement {
    type: string;
    label?: string;
    name?: string;
    value?: string;
    accessibilityId?: string;
    enabled: boolean;
    visible: boolean;
    bounds: {
        x: number;
        y: number;
        width: number;
        height: number;
    };
}
export interface IOSSelector {
    strategy: 'accessibility_id' | 'name' | 'label' | 'xpath';
    value: string;
}
export interface UITreeDiff {
    added: IOSUIElement[];
    removed: IOSUIElement[];
    changed: Array<{
        before: IOSUIElement;
        after: IOSUIElement;
        changes: string[];
    }>;
}
/**
 * Appium pageSource XML을 파싱하여 IOSUIElement 배열로 변환
 * actions.ts의 findElementAtCoordinates와 동일한 regex 패턴 사용
 */
export declare function parsePageSource(xml: string): IOSUIElement[];
/**
 * IOSUIElement에 대해 가장 안정적인 셀렉터를 생성
 * 우선순위: accessibilityId > name > label > xpath
 */
export declare function generateSelector(el: IOSUIElement): IOSSelector;
/**
 * 두 UI 트리 스냅샷 간의 차이를 감지
 *
 * 매칭 전략:
 * 1. accessibilityId 기반 정확 매칭
 * 2. type + name 기반 매칭
 * 3. type + label 기반 매칭
 * 4. 매칭 안 되면 added/removed로 분류
 */
export declare function diffUITrees(before: IOSUIElement[], after: IOSUIElement[]): UITreeDiff;
/**
 * 파싱된 요소 배열에서 텍스트(label/name/value/accessibilityId)로 검색
 * 대소문자 무시, 부분 일치 지원
 */
export declare function searchElements(elements: IOSUIElement[], query: string): IOSUIElement[];
/**
 * 파싱된 요소 배열에서 셀렉터로 요소 찾기
 * AssertionEngine iOS 평가에서 사용
 */
export declare function findElementBySelector(elements: IOSUIElement[], selector: IOSSelector): IOSUIElement | null;
