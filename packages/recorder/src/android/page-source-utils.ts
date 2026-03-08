/**
 * Android UIAutomator XML 파싱 및 UI 트리 diff 유틸리티
 *
 * `adb shell uiautomator dump` 결과를 파싱하여 요소 배열로 변환하고,
 * 두 스냅샷 간 차이를 감지하여 assertion 추천의 기반 데이터를 생성한다.
 */

// ─── Types ────────────────────────────────────────────────

export interface AndroidUIElement {
  type: string;                  // e.g. "android.widget.Button", "android.widget.TextView"
  shortType: string;             // e.g. "Button", "TextView"
  resourceId?: string;           // e.g. "com.example:id/btn_login"
  contentDesc?: string;          // 접근성 설명 (content-desc)
  text?: string;                 // 표시 텍스트
  packageName?: string;          // e.g. "com.example.app"
  enabled: boolean;
  clickable: boolean;
  focusable: boolean;
  scrollable: boolean;
  bounds: { x: number; y: number; width: number; height: number };
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
    changes: string[];         // e.g. ["text: '로그인' -> '로그아웃'"]
  }>;
}

// ─── Page Source Parser ───────────────────────────────────

/**
 * UIAutomator dump XML을 파싱하여 AndroidUIElement 배열로 변환
 */
export function parsePageSource(xml: string): AndroidUIElement[] {
  if (!xml || typeof xml !== 'string') return [];

  const elements: AndroidUIElement[] = [];

  // UIAutomator XML 노드 추출: <node ... />
  const nodePattern = /<node\s([^>]+)\/?>/g;
  let match;

  // bounds 파싱 패턴: bounds="[x1,y1][x2,y2]"
  const boundsPattern = /bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/;

  while ((match = nodePattern.exec(xml)) !== null) {
    const attrs = match[1];

    const boundsMatch = attrs.match(boundsPattern);
    if (!boundsMatch) continue;

    const x1 = parseInt(boundsMatch[1], 10);
    const y1 = parseInt(boundsMatch[2], 10);
    const x2 = parseInt(boundsMatch[3], 10);
    const y2 = parseInt(boundsMatch[4], 10);
    const width = x2 - x1;
    const height = y2 - y1;

    // 크기가 0인 요소 스킵
    if (width === 0 && height === 0) continue;

    const classMatch = attrs.match(/class="([^"]*)"/);
    const resourceIdMatch = attrs.match(/resource-id="([^"]*)"/);
    const contentDescMatch = attrs.match(/content-desc="([^"]*)"/);
    const textMatch = attrs.match(/text="([^"]*)"/);
    const packageMatch = attrs.match(/package="([^"]*)"/);
    const enabledMatch = attrs.match(/enabled="([^"]*)"/);
    const clickableMatch = attrs.match(/clickable="([^"]*)"/);
    const focusableMatch = attrs.match(/focusable="([^"]*)"/);
    const scrollableMatch = attrs.match(/scrollable="([^"]*)"/);

    const fullType = classMatch?.[1] || '';
    const shortType = fullType.split('.').pop() || fullType;

    elements.push({
      type: fullType,
      shortType,
      resourceId: resourceIdMatch?.[1] || undefined,
      contentDesc: contentDescMatch?.[1] || undefined,
      text: textMatch?.[1] || undefined,
      packageName: packageMatch?.[1] || undefined,
      enabled: enabledMatch?.[1] !== 'false',
      clickable: clickableMatch?.[1] === 'true',
      focusable: focusableMatch?.[1] === 'true',
      scrollable: scrollableMatch?.[1] === 'true',
      bounds: { x: x1, y: y1, width, height },
    });
  }

  return elements;
}

// ─── Selector Generator ──────────────────────────────────

/**
 * AndroidUIElement에 대해 가장 안정적인 셀렉터를 생성
 * 우선순위: resource-id > content-desc > text > xpath
 */
export function generateSelector(el: AndroidUIElement): AndroidSelector {
  if (el.resourceId) {
    return { strategy: 'resource_id', value: el.resourceId };
  }
  if (el.contentDesc) {
    return { strategy: 'content_desc', value: el.contentDesc };
  }
  if (el.text) {
    return { strategy: 'text', value: el.text };
  }
  // fallback: class 기반 xpath
  return {
    strategy: 'xpath',
    value: `//${el.type}`,
  };
}

// ─── Element Key (매칭 용) ────────────────────────────────

/** 요소 매칭을 위한 고유 키 생성 */
function elementKey(el: AndroidUIElement): string {
  // resource-id가 있으면 가장 안정적인 키
  if (el.resourceId) return `rid:${el.resourceId}`;
  // type + content-desc 조합
  if (el.contentDesc) return `${el.shortType}:desc:${el.contentDesc}`;
  // type + text 조합
  if (el.text) return `${el.shortType}:text:${el.text}`;
  // type + bounds (위치 기반, 마지막 수단)
  return `${el.shortType}:bounds:${el.bounds.x},${el.bounds.y}`;
}

// ─── UI Tree Diff ─────────────────────────────────────────

/**
 * 두 UI 트리 스냅샷 간의 차이를 감지
 *
 * 매칭 전략:
 * 1. resource-id 기반 정확 매칭
 * 2. type + content-desc 기반 매칭
 * 3. type + text 기반 매칭
 * 4. 매칭 안 되면 added/removed로 분류
 */
export function diffUITrees(
  before: AndroidUIElement[],
  after: AndroidUIElement[]
): AndroidUITreeDiff {
  const beforeMap = new Map<string, AndroidUIElement>();
  const afterMap = new Map<string, AndroidUIElement>();

  for (const el of before) {
    beforeMap.set(elementKey(el), el);
  }
  for (const el of after) {
    afterMap.set(elementKey(el), el);
  }

  const added: AndroidUIElement[] = [];
  const removed: AndroidUIElement[] = [];
  const changed: AndroidUITreeDiff['changed'] = [];
  const matchedBeforeKeys = new Set<string>();

  // after 순회: before에 있으면 changed 후보, 없으면 added
  for (const [key, afterEl] of afterMap) {
    const beforeEl = beforeMap.get(key);
    if (beforeEl) {
      matchedBeforeKeys.add(key);
      const changes: string[] = [];
      if (beforeEl.text !== afterEl.text) {
        changes.push(`text: '${beforeEl.text || ''}' -> '${afterEl.text || ''}'`);
      }
      if (beforeEl.contentDesc !== afterEl.contentDesc) {
        changes.push(`content-desc: '${beforeEl.contentDesc || ''}' -> '${afterEl.contentDesc || ''}'`);
      }
      if (beforeEl.enabled !== afterEl.enabled) {
        changes.push(`enabled: ${beforeEl.enabled} -> ${afterEl.enabled}`);
      }
      if (beforeEl.clickable !== afterEl.clickable) {
        changes.push(`clickable: ${beforeEl.clickable} -> ${afterEl.clickable}`);
      }
      if (changes.length > 0) {
        changed.push({ before: beforeEl, after: afterEl, changes });
      }
    } else {
      added.push(afterEl);
    }
  }

  // before 순회: 매칭 안 된 것은 removed
  for (const [key, beforeEl] of beforeMap) {
    if (!matchedBeforeKeys.has(key)) {
      removed.push(beforeEl);
    }
  }

  return { added, removed, changed };
}

// ─── 좌표로 요소 찾기 ───────────────────────────────────

/**
 * 파싱된 요소 배열에서 좌표에 해당하는 요소 찾기
 * 가장 작은 영역의 클릭 가능한 요소를 우선 반환
 */
export function findElementAtCoordinates(
  elements: AndroidUIElement[],
  x: number,
  y: number
): AndroidUIElement | null {
  // 좌표가 bounds 안에 있는 요소 필터링
  const matching = elements.filter(el => {
    const { bounds } = el;
    return x >= bounds.x && x <= bounds.x + bounds.width
      && y >= bounds.y && y <= bounds.y + bounds.height;
  });

  if (matching.length === 0) return null;

  // 클릭 가능한 요소 우선
  const clickable = matching.filter(el => el.clickable);
  const candidates = clickable.length > 0 ? clickable : matching;

  // 식별자가 있는 요소 우선
  const withId = candidates.filter(el => el.resourceId || el.contentDesc || el.text);
  const finalCandidates = withId.length > 0 ? withId : candidates;

  // 가장 작은 영역의 요소 선택 (더 정확)
  return finalCandidates.reduce((smallest, current) => {
    const smallestArea = smallest.bounds.width * smallest.bounds.height;
    const currentArea = current.bounds.width * current.bounds.height;
    return currentArea < smallestArea ? current : smallest;
  });
}

// ─── Utility: 셀렉터로 요소 찾기 ──────────────────────────

/**
 * 파싱된 요소 배열에서 셀렉터로 요소 찾기
 */
export function findElementBySelector(
  elements: AndroidUIElement[],
  selector: AndroidSelector
): AndroidUIElement | null {
  switch (selector.strategy) {
    case 'resource_id':
      return elements.find(el => el.resourceId === selector.value) || null;
    case 'content_desc':
      return elements.find(el => el.contentDesc === selector.value) || null;
    case 'text':
      return elements.find(el => el.text === selector.value) || null;
    case 'xpath': {
      // 간단한 xpath 매칭: //classname[@attr='value']
      const typeMatch = selector.value.match(/\/\/([^[\s]+)/);
      if (!typeMatch) return null;
      const targetType = typeMatch[1];
      const attrMatch = selector.value.match(/@(\w[\w-]*)='([^']*)'/);
      const candidates = elements.filter(el => el.type === targetType || el.shortType === targetType);
      if (!attrMatch) return candidates[0] || null;
      const [, attr, val] = attrMatch;
      const attrMap: Record<string, keyof AndroidUIElement> = {
        'resource-id': 'resourceId',
        'content-desc': 'contentDesc',
        'text': 'text',
      };
      const key = attrMap[attr] || attr;
      return candidates.find(el => (el as any)[key] === val) || null;
    }
    default:
      return null;
  }
}
