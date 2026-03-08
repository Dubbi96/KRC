/**
 * iOS Page Source XML 파싱 및 UI 트리 diff 유틸리티
 *
 * Appium pageSource(XML)를 파싱하여 요소 배열로 변환하고,
 * 두 스냅샷 간 차이를 감지하여 assertion 추천의 기반 데이터를 생성한다.
 */

// ─── Types ────────────────────────────────────────────────

export interface IOSUIElement {
  type: string;                  // e.g. "Button", "StaticText", "Cell"
  label?: string;
  name?: string;
  value?: string;
  accessibilityId?: string;
  enabled: boolean;
  visible: boolean;
  bounds: { x: number; y: number; width: number; height: number };
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
    changes: string[];         // e.g. ["value: '' -> 'Hello'"]
  }>;
}

// ─── XML Entity Decoder ─────────────────────────────────

/** XML 속성값의 문자 엔티티를 디코딩 (&#10; → \n, &amp; → &, 등) */
function decodeXmlEntities(s: string): string {
  return s
    .replace(/&#(\d+);/g, (_m, code) => String.fromCharCode(parseInt(code, 10)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_m, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');   // &amp; 은 마지막에 처리
}

// ─── Page Source Parser ───────────────────────────────────

/**
 * Appium pageSource XML을 파싱하여 IOSUIElement 배열로 변환
 * actions.ts의 findElementAtCoordinates와 동일한 regex 패턴 사용
 */
export function parsePageSource(xml: string): IOSUIElement[] {
  if (!xml || typeof xml !== 'string') return [];

  const elements: IOSUIElement[] = [];

  // XCUIElementType 요소와 속성 추출 (self-closing 또는 opening tag)
  const elementPattern = /XCUIElementType(\w+)([^>]*)>/g;
  let match;

  // bounds 파싱 패턴 (actions.ts의 findElementAtCoordinates와 동일한 다중 패턴)
  const boundsPatterns = [
    // 형식 1: bounds="{{100, 200}, {50, 30}}"
    /bounds="\{\{([0-9.]+),\s*([0-9.]+)\},\s*\{([0-9.]+),\s*([0-9.]+)\}\}"/,
    // 형식 2: bounds="{100, 200, 50, 30}"
    /bounds="\{([0-9.]+),\s*([0-9.]+),\s*([0-9.]+),\s*([0-9.]+)\}"/,
    // 형식 3 (유연한 매칭): bounds="{100, 200}, {50, 30}" 등
    /bounds="\{?([0-9.]+),\s*([0-9.]+)\}?,\s*\{?([0-9.]+),\s*([0-9.]+)\}?"/,
  ];

  while ((match = elementPattern.exec(xml)) !== null) {
    const type = match[1];
    const attrs = match[2];

    // 여러 bounds 형식 시도
    let boundsMatch: RegExpMatchArray | null = null;
    for (const pattern of boundsPatterns) {
      boundsMatch = attrs.match(pattern);
      if (boundsMatch) break;
    }

    let x: number, y: number, width: number, height: number;

    if (boundsMatch) {
      x = parseFloat(boundsMatch[1]);
      y = parseFloat(boundsMatch[2]);
      width = parseFloat(boundsMatch[3]);
      height = parseFloat(boundsMatch[4]);
    } else {
      // 형식 4 (개별 속성): x="100" y="200" width="50" height="30"
      // 일부 WDA 버전/기기에서 bounds 대신 개별 속성으로 좌표를 제공
      const xM = attrs.match(/\bx="([0-9.]+)"/);
      const yM = attrs.match(/\by="([0-9.]+)"/);
      const wM = attrs.match(/\bwidth="([0-9.]+)"/);
      const hM = attrs.match(/\bheight="([0-9.]+)"/);
      if (xM && yM && wM && hM) {
        x = parseFloat(xM[1]);
        y = parseFloat(yM[1]);
        width = parseFloat(wM[1]);
        height = parseFloat(hM[1]);
      } else {
        continue;
      }
    }

    // 크기가 0인 요소 스킵 (보이지 않는 컨테이너)
    if (width === 0 && height === 0) continue;

    const labelMatch = attrs.match(/label="([^"]*)"/);
    const valueMatch = attrs.match(/value="([^"]*)"/);
    const nameMatch = attrs.match(/name="([^"]*)"/);
    const accessibilityIdMatch = attrs.match(/accessibilityId="([^"]*)"/);
    const enabledMatch = attrs.match(/enabled="([^"]*)"/);
    const visibleMatch = attrs.match(/visible="([^"]*)"/);

    elements.push({
      type,
      label: labelMatch?.[1] ? decodeXmlEntities(labelMatch[1]) : undefined,
      name: nameMatch?.[1] ? decodeXmlEntities(nameMatch[1]) : undefined,
      value: valueMatch?.[1] ? decodeXmlEntities(valueMatch[1]) : undefined,
      accessibilityId: accessibilityIdMatch?.[1] ? decodeXmlEntities(accessibilityIdMatch[1]) : undefined,
      enabled: enabledMatch?.[1] !== 'false',
      visible: visibleMatch?.[1] !== 'false',
      bounds: { x, y, width, height },
    });
  }

  return elements;
}

// ─── Selector Generator ──────────────────────────────────

/**
 * IOSUIElement에 대해 가장 안정적인 셀렉터를 생성
 * 우선순위: accessibilityId > name > label > xpath
 */
export function generateSelector(el: IOSUIElement): IOSSelector {
  if (el.accessibilityId) {
    return { strategy: 'accessibility_id', value: el.accessibilityId };
  }
  if (el.name) {
    return { strategy: 'name', value: el.name };
  }
  if (el.label) {
    return { strategy: 'label', value: el.label };
  }
  // fallback: type 기반 xpath
  return {
    strategy: 'xpath',
    value: `//XCUIElementType${el.type}`,
  };
}

// ─── Element Key (매칭 용) ────────────────────────────────

/** 요소 매칭을 위한 고유 키 생성 */
function elementKey(el: IOSUIElement): string {
  // accessibilityId가 있으면 가장 안정적인 키
  if (el.accessibilityId) return `aid:${el.accessibilityId}`;
  // type + name 조합
  if (el.name) return `${el.type}:name:${el.name}`;
  // type + label 조합
  if (el.label) return `${el.type}:label:${el.label}`;
  // type + bounds (위치 기반, 마지막 수단)
  return `${el.type}:bounds:${Math.round(el.bounds.x)},${Math.round(el.bounds.y)}`;
}

// ─── UI Tree Diff ─────────────────────────────────────────

/**
 * 두 UI 트리 스냅샷 간의 차이를 감지
 *
 * 매칭 전략:
 * 1. accessibilityId 기반 정확 매칭
 * 2. type + name 기반 매칭
 * 3. type + label 기반 매칭
 * 4. 매칭 안 되면 added/removed로 분류
 */
export function diffUITrees(
  before: IOSUIElement[],
  after: IOSUIElement[]
): UITreeDiff {
  const beforeMap = new Map<string, IOSUIElement>();
  const afterMap = new Map<string, IOSUIElement>();

  // 키별로 분류 (동일 키 중복 시 마지막 것 사용)
  for (const el of before) {
    beforeMap.set(elementKey(el), el);
  }
  for (const el of after) {
    afterMap.set(elementKey(el), el);
  }

  const added: IOSUIElement[] = [];
  const removed: IOSUIElement[] = [];
  const changed: UITreeDiff['changed'] = [];
  const matchedBeforeKeys = new Set<string>();

  // after 순회: before에 있으면 changed 후보, 없으면 added
  for (const [key, afterEl] of afterMap) {
    const beforeEl = beforeMap.get(key);
    if (beforeEl) {
      matchedBeforeKeys.add(key);
      // 속성 변화 감지
      const changes: string[] = [];
      if (beforeEl.value !== afterEl.value) {
        changes.push(`value: '${beforeEl.value || ''}' -> '${afterEl.value || ''}'`);
      }
      if (beforeEl.label !== afterEl.label) {
        changes.push(`label: '${beforeEl.label || ''}' -> '${afterEl.label || ''}'`);
      }
      if (beforeEl.visible !== afterEl.visible) {
        changes.push(`visible: ${beforeEl.visible} -> ${afterEl.visible}`);
      }
      if (beforeEl.enabled !== afterEl.enabled) {
        changes.push(`enabled: ${beforeEl.enabled} -> ${afterEl.enabled}`);
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

// ─── Text Search ─────────────────────────────────────────

/**
 * 파싱된 요소 배열에서 텍스트(label/name/value/accessibilityId)로 검색
 * 대소문자 무시, 부분 일치 지원
 */
export function searchElements(
  elements: IOSUIElement[],
  query: string,
): IOSUIElement[] {
  if (!query || query.trim().length === 0) return [];
  const q = query.toLowerCase().trim();
  return elements.filter(el => {
    if (el.label && el.label.toLowerCase().includes(q)) return true;
    if (el.name && el.name.toLowerCase().includes(q)) return true;
    if (el.value && el.value.toLowerCase().includes(q)) return true;
    if (el.accessibilityId && el.accessibilityId.toLowerCase().includes(q)) return true;
    return false;
  });
}

// ─── Utility: 요소 검색 ──────────────────────────────────

/**
 * 파싱된 요소 배열에서 셀렉터로 요소 찾기
 * AssertionEngine iOS 평가에서 사용
 */
export function findElementBySelector(
  elements: IOSUIElement[],
  selector: IOSSelector
): IOSUIElement | null {
  switch (selector.strategy) {
    case 'accessibility_id':
      return elements.find(el => el.accessibilityId === selector.value) || null;
    case 'name':
      return elements.find(el => el.name === selector.value) || null;
    case 'label':
      return elements.find(el => el.label === selector.value) || null;
    case 'xpath': {
      // 간단한 xpath 매칭: //XCUIElementType{Type}[@attr='value']
      const typeMatch = selector.value.match(/XCUIElementType(\w+)/);
      if (!typeMatch) return null;
      const targetType = typeMatch[1];
      const attrMatch = selector.value.match(/@(\w+)='([^']*)'/);
      const candidates = elements.filter(el => el.type === targetType);
      if (!attrMatch) return candidates[0] || null;
      const [, attr, val] = attrMatch;
      return candidates.find(el => (el as any)[attr] === val) || null;
    }
    default:
      return null;
  }
}
