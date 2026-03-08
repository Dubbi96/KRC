"use strict";
/**
 * Android Assertion 추천 엔진
 *
 * UI 트리 diff를 분석하여 assertion 후보를 생성한다.
 * 녹화 중 tap 전/후 스냅샷 비교 결과를 입력으로 받는다.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.suggestAssertionsFromDiff = suggestAssertionsFromDiff;
const page_source_utils_1 = require("./page-source-utils");
// ─── 노이즈 필터링 상수 ──────────────────────────────────
/** 이 이상 요소가 변경되면 화면 전환으로 간주 */
const SCREEN_TRANSITION_THRESHOLD = 20;
/** 무시할 레이아웃 전용 타입 (shortType) */
const LAYOUT_ONLY_TYPES = new Set([
    'FrameLayout', 'LinearLayout', 'RelativeLayout', 'ConstraintLayout',
    'CoordinatorLayout', 'ViewGroup', 'View',
]);
/** 의미 있는 텍스트/인터랙티브 요소 타입 (shortType) */
const INTERACTIVE_TYPES = new Set([
    'Button', 'TextView', 'EditText', 'ImageButton', 'ImageView',
    'CheckBox', 'RadioButton', 'Switch', 'ToggleButton', 'Spinner',
]);
// ─── 추천 엔진 ───────────────────────────────────────────
/**
 * UI 트리 diff로부터 assertion 추천을 생성
 */
function suggestAssertionsFromDiff(diff, tappedElement) {
    const totalChanges = diff.added.length + diff.removed.length + diff.changed.length;
    if (totalChanges === 0)
        return [];
    const suggestions = [];
    // 화면 전환 감지: 너무 많은 변화 → 대표 요소 하나만 추천
    if (totalChanges > SCREEN_TRANSITION_THRESHOLD) {
        const representative = findRepresentativeElement(diff.added);
        if (representative) {
            const selector = (0, page_source_utils_1.generateSelector)(representative);
            suggestions.push({
                assertion: {
                    type: 'android_element_visible',
                    target: selectorToTarget(selector),
                    expected: '',
                    message: `화면 전환 후 '${representative.text || representative.contentDesc || representative.shortType}' 표시 확인`,
                    optional: true,
                    androidSelector: selector,
                },
                confidence: 'low',
                reason: `화면 전환 감지 (${totalChanges}개 요소 변경), 대표 요소 추천`,
            });
        }
        return suggestions;
    }
    // ── Added 요소 처리 ──
    for (const el of diff.added) {
        if (LAYOUT_ONLY_TYPES.has(el.shortType))
            continue;
        const selector = (0, page_source_utils_1.generateSelector)(el);
        const hasStableSelector = el.resourceId || el.contentDesc;
        const isInteractive = INTERACTIVE_TYPES.has(el.shortType);
        if (hasStableSelector) {
            suggestions.push({
                assertion: {
                    type: 'android_element_visible',
                    target: selectorToTarget(selector),
                    expected: '',
                    message: `tap 후 '${el.resourceId || el.contentDesc}' 요소 표시 확인`,
                    optional: true,
                    androidSelector: selector,
                },
                confidence: 'high',
                reason: `tap 이후 새 UI 요소 등장 (${el.shortType}, id: ${el.resourceId || el.contentDesc})`,
            });
        }
        else if (isInteractive && el.text) {
            suggestions.push({
                assertion: {
                    type: 'android_text_contains',
                    target: '',
                    expected: el.text,
                    message: `tap 후 '${el.text}' 텍스트 표시 확인`,
                    optional: true,
                },
                confidence: 'medium',
                reason: `tap 이후 새 텍스트 등장: "${el.text}"`,
            });
        }
    }
    // ── Removed 요소 처리 ──
    for (const el of diff.removed) {
        if (LAYOUT_ONLY_TYPES.has(el.shortType))
            continue;
        const isTappedElement = tappedElement && matchesElement(el, tappedElement);
        const selector = (0, page_source_utils_1.generateSelector)(el);
        const hasStableSelector = el.resourceId || el.contentDesc;
        if (hasStableSelector || isTappedElement) {
            suggestions.push({
                assertion: {
                    type: 'android_element_not_exists',
                    target: selectorToTarget(selector),
                    expected: '',
                    message: isTappedElement
                        ? `클릭 대상 '${el.text || el.contentDesc || el.shortType}' 사라짐 확인`
                        : `tap 후 '${el.resourceId || el.contentDesc}' 사라짐 확인`,
                    optional: true,
                    androidSelector: selector,
                },
                confidence: isTappedElement ? 'high' : 'medium',
                reason: isTappedElement
                    ? '클릭 대상 요소가 화면에서 사라짐'
                    : `tap 이후 요소 사라짐 (${el.shortType}, id: ${el.resourceId || el.contentDesc})`,
            });
        }
    }
    // ── Changed 요소 처리 ──
    for (const change of diff.changed) {
        const { after, changes } = change;
        if (LAYOUT_ONLY_TYPES.has(after.shortType))
            continue;
        const selector = (0, page_source_utils_1.generateSelector)(after);
        const hasTextChange = changes.some(c => c.startsWith('text:'));
        if (hasTextChange && after.text) {
            suggestions.push({
                assertion: {
                    type: 'android_element_text_equals',
                    target: selectorToTarget(selector),
                    expected: after.text,
                    message: `'${after.resourceId || after.contentDesc || after.shortType}' 텍스트 변경 확인`,
                    optional: true,
                    androidSelector: selector,
                },
                confidence: (after.resourceId || after.contentDesc) ? 'medium' : 'low',
                reason: `요소 text 변경: ${changes.filter(c => c.startsWith('text:')).join(', ')}`,
            });
        }
    }
    // confidence 순 정렬: high > medium > low
    const order = { high: 0, medium: 1, low: 2 };
    suggestions.sort((a, b) => order[a.confidence] - order[b.confidence]);
    return suggestions;
}
// ─── Helpers ─────────────────────────────────────────────
/** AndroidSelector를 target 문자열로 변환 */
function selectorToTarget(selector) {
    switch (selector.strategy) {
        case 'resource_id': return `id=${selector.value}`;
        case 'content_desc': return `desc=${selector.value}`;
        case 'text': return `text=${selector.value}`;
        default: return selector.value;
    }
}
/** 화면 전환 시 대표 요소 선택 */
function findRepresentativeElement(added) {
    const meaningful = added.filter(el => !LAYOUT_ONLY_TYPES.has(el.shortType) && (el.text || el.contentDesc || el.resourceId));
    if (meaningful.length === 0)
        return null;
    const withId = meaningful.filter(el => el.resourceId || el.contentDesc);
    const candidates = withId.length > 0 ? withId : meaningful;
    return candidates.reduce((best, el) => {
        const bestArea = best.bounds.width * best.bounds.height;
        const elArea = el.bounds.width * el.bounds.height;
        return elArea > bestArea ? el : best;
    });
}
/** 두 요소가 같은 요소인지 간단히 확인 */
function matchesElement(el, target) {
    if (target.resourceId && el.resourceId === target.resourceId)
        return true;
    if (target.contentDesc && el.contentDesc === target.contentDesc)
        return true;
    if (target.text && el.text === target.text && target.shortType && el.shortType === target.shortType)
        return true;
    return false;
}
//# sourceMappingURL=assertion-suggester.js.map