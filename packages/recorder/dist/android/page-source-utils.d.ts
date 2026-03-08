/**
 * Android UIAutomator XML 파싱 및 UI 트리 diff 유틸리티
 *
 * `adb shell uiautomator dump` 결과를 파싱하여 요소 배열로 변환하고,
 * 두 스냅샷 간 차이를 감지하여 assertion 추천의 기반 데이터를 생성한다.
 */
export interface AndroidUIElement {
    type: string;
    shortType: string;
    resourceId?: string;
    contentDesc?: string;
    text?: string;
    packageName?: string;
    enabled: boolean;
    clickable: boolean;
    focusable: boolean;
    scrollable: boolean;
    bounds: {
        x: number;
        y: number;
        width: number;
        height: number;
    };
}
export interface AndroidSelector {
    strategy: 'resource_id' | 'content_desc' | 'text' | 'xpath';
    value: string;
}
export interface AndroidUITreeDiff {
    added: AndroidUIElement[];
    removed: AndroidUIElement[];
    changed: Array<{
        before: AndroidUIElement;
        after: AndroidUIElement;
        changes: string[];
    }>;
}
/**
 * UIAutomator dump XML을 파싱하여 AndroidUIElement 배열로 변환
 */
export declare function parsePageSource(xml: string): AndroidUIElement[];
/**
 * AndroidUIElement에 대해 가장 안정적인 셀렉터를 생성
 * 우선순위: resource-id > content-desc > text > xpath
 */
export declare function generateSelector(el: AndroidUIElement): AndroidSelector;
/**
 * 두 UI 트리 스냅샷 간의 차이를 감지
 *
 * 매칭 전략:
 * 1. resource-id 기반 정확 매칭
 * 2. type + content-desc 기반 매칭
 * 3. type + text 기반 매칭
 * 4. 매칭 안 되면 added/removed로 분류
 */
export declare function diffUITrees(before: AndroidUIElement[], after: AndroidUIElement[]): AndroidUITreeDiff;
/**
 * 파싱된 요소 배열에서 좌표에 해당하는 요소 찾기
 * 가장 작은 영역의 클릭 가능한 요소를 우선 반환
 */
export declare function findElementAtCoordinates(elements: AndroidUIElement[], x: number, y: number): AndroidUIElement | null;
/**
 * 파싱된 요소 배열에서 셀렉터로 요소 찾기
 */
export declare function findElementBySelector(elements: AndroidUIElement[], selector: AndroidSelector): AndroidUIElement | null;
