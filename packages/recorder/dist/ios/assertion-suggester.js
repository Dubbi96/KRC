"use strict";
/**
 * iOS Assertion 추천 엔진
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
/** 무시할 컨테이너 타입 (레이아웃 노이즈) */
const LAYOUT_ONLY_TYPES = new Set(['Other', 'Group', 'ScrollView', 'Window', 'Application']);
/** 의미 있는 텍스트 요소 타입 */
const TEXT_TYPES = new Set(['StaticText', 'TextField', 'SecureTextField', 'TextArea', 'Button']);
// ─── 추천 엔진 ───────────────────────────────────────────
/**
 * UI 트리 diff로부터 assertion 추천을 생성
 *
 * @param diff - diffUITrees()의 결과
 * @param tappedElement - tap된 요소 메타데이터 (있는 경우)
 * @returns 추천 배열 (confidence 내림차순 정렬)
 */
function suggestAssertionsFromDiff(diff, tappedElement) {
    const totalChanges = diff.added.length + diff.removed.length + diff.changed.length;
    // 변화 없음 → 추천 없음
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
                    type: 'ios_element_visible',
                    target: selectorToTarget(selector),
                    expected: '',
                    message: `화면 전환 후 '${representative.label || representative.name || representative.type}' 표시 확인`,
                    optional: true,
                    iosSelector: selector,
                },
                confidence: 'low',
                reason: `화면 전환 감지 (${totalChanges}개 요소 변경), 대표 요소 추천`,
            });
        }
        return suggestions;
    }
    // ── Added 요소 처리 ──
    for (const el of diff.added) {
        if (LAYOUT_ONLY_TYPES.has(el.type))
            continue;
        if (!el.visible)
            continue;
        const selector = (0, page_source_utils_1.generateSelector)(el);
        const hasStableSelector = el.accessibilityId || el.name;
        const isTextElement = TEXT_TYPES.has(el.type);
        if (hasStableSelector) {
            // 안정적 셀렉터 + 새 요소 → high confidence
            suggestions.push({
                assertion: {
                    type: 'ios_element_visible',
                    target: selectorToTarget(selector),
                    expected: '',
                    message: `tap 후 '${el.accessibilityId || el.name}' 요소 표시 확인`,
                    optional: true,
                    iosSelector: selector,
                },
                confidence: 'high',
                reason: `tap 이후 새 UI 요소 등장 (${el.type}, id: ${el.accessibilityId || el.name})`,
            });
        }
        else if (isTextElement && el.label) {
            // 텍스트 요소 (label 기반) → medium confidence
            suggestions.push({
                assertion: {
                    type: 'ios_text_contains',
                    target: '',
                    expected: el.label,
                    message: `tap 후 '${el.label}' 텍스트 표시 확인`,
                    optional: true,
                },
                confidence: 'medium',
                reason: `tap 이후 새 텍스트 등장: "${el.label}"`,
            });
        }
    }
    // ── Removed 요소 처리 ──
    for (const el of diff.removed) {
        if (LAYOUT_ONLY_TYPES.has(el.type))
            continue;
        // tap 대상 요소가 사라졌는지 확인
        const isTappedElement = tappedElement && matchesElement(el, tappedElement);
        const selector = (0, page_source_utils_1.generateSelector)(el);
        const hasStableSelector = el.accessibilityId || el.name;
        if (hasStableSelector || isTappedElement) {
            suggestions.push({
                assertion: {
                    type: 'ios_element_not_exists',
                    target: selectorToTarget(selector),
                    expected: '',
                    message: isTappedElement
                        ? `클릭 대상 '${el.label || el.name || el.type}' 사라짐 확인`
                        : `tap 후 '${el.accessibilityId || el.name}' 사라짐 확인`,
                    optional: true,
                    iosSelector: selector,
                },
                confidence: isTappedElement ? 'high' : 'medium',
                reason: isTappedElement
                    ? '클릭 대상 요소가 화면에서 사라짐'
                    : `tap 이후 요소 사라짐 (${el.type}, id: ${el.accessibilityId || el.name})`,
            });
        }
    }
    // ── Changed 요소 처리 ──
    for (const change of diff.changed) {
        const { after, changes } = change;
        if (LAYOUT_ONLY_TYPES.has(after.type))
            continue;
        const selector = (0, page_source_utils_1.generateSelector)(after);
        const hasValueChange = changes.some(c => c.startsWith('value:'));
        const hasVisibleChange = changes.some(c => c.startsWith('visible:'));
        if (hasValueChange && after.value) {
            suggestions.push({
                assertion: {
                    type: 'ios_element_value_equals',
                    target: selectorToTarget(selector),
                    expected: after.value,
                    message: `'${after.label || after.name || after.type}' 값 변경 확인`,
                    optional: true,
                    iosSelector: selector,
                },
                confidence: (after.accessibilityId || after.name) ? 'medium' : 'low',
                reason: `요소 value 변경: ${changes.filter(c => c.startsWith('value:')).join(', ')}`,
            });
        }
        if (hasVisibleChange && after.visible) {
            suggestions.push({
                assertion: {
                    type: 'ios_element_visible',
                    target: selectorToTarget(selector),
                    expected: '',
                    message: `'${after.label || after.name || after.type}' 표시 상태 변경 확인`,
                    optional: true,
                    iosSelector: selector,
                },
                confidence: (after.accessibilityId || after.name) ? 'medium' : 'low',
                reason: `요소 visible 상태 변경: ${changes.filter(c => c.startsWith('visible:')).join(', ')}`,
            });
        }
    }
    // confidence 순 정렬: high > medium > low
    const order = { high: 0, medium: 1, low: 2 };
    suggestions.sort((a, b) => order[a.confidence] - order[b.confidence]);
    return suggestions;
}
// ─── Helpers ─────────────────────────────────────────────
/** IOSSelector를 target 문자열로 변환 */
function selectorToTarget(selector) {
    switch (selector.strategy) {
        case 'accessibility_id': return `~${selector.value}`;
        case 'name': return `name=${selector.value}`;
        case 'label': return `label=${selector.value}`;
        default: return selector.value;
    }
}
/** 화면 전환 시 대표 요소 선택 (가장 큰 텍스트 요소 중 식별자 있는 것) */
function findRepresentativeElement(added) {
    const meaningful = added.filter(el => !LAYOUT_ONLY_TYPES.has(el.type) && el.visible && (el.label || el.name || el.accessibilityId));
    if (meaningful.length === 0)
        return null;
    // 식별자 있는 것 우선, 그중 가장 큰 영역
    const withId = meaningful.filter(el => el.accessibilityId || el.name);
    const candidates = withId.length > 0 ? withId : meaningful;
    return candidates.reduce((best, el) => {
        const bestArea = best.bounds.width * best.bounds.height;
        const elArea = el.bounds.width * el.bounds.height;
        return elArea > bestArea ? el : best;
    });
}
/** 두 요소가 같은 요소인지 간단히 확인 */
function matchesElement(el, target) {
    if (target.accessibilityId && el.accessibilityId === target.accessibilityId)
        return true;
    if (target.name && el.name === target.name)
        return true;
    if (target.label && el.label === target.label && target.type && el.type === target.type)
        return true;
    return false;
}
//# sourceMappingURL=assertion-suggester.js.map