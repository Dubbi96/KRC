/**
 * iOS / Android Page Source XML parsing + element-at-coordinates lookup.
 *
 * Ported from Katab_Stack recorder utilities so that the MirrorSession
 * can enrich recorded events with semantic element metadata
 * (accessibilityId, label, resourceId, etc.) instead of raw coordinates.
 */

// ─── iOS Types ────────────────────────────────────────────

export interface IOSUIElement {
  type: string;
  label?: string;
  name?: string;
  value?: string;
  accessibilityId?: string;
  enabled: boolean;
  visible: boolean;
  bounds: { x: number; y: number; width: number; height: number };
}

// ─── Android Types ────────────────────────────────────────

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
  bounds: { x: number; y: number; width: number; height: number };
}

// ─── Unified enrichment result ────────────────────────────

export interface ElementMeta {
  type: string;
  label?: string;
  name?: string;
  accessibilityId?: string;
  resourceId?: string;
  contentDesc?: string;
  textContent?: string;
  value?: string;
  enabled?: boolean;
  visible?: boolean;
  clickable?: boolean;
  boundingBox?: { x: number; y: number; width: number; height: number };
  selector?: { strategy: string; value: string };
}

// ─── XML entity decoder ──────────────────────────────────

function decodeXmlEntities(s: string): string {
  return s
    .replace(/&#(\d+);/g, (_m, code) => String.fromCharCode(parseInt(code, 10)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_m, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

// ─── iOS Page Source Parser ──────────────────────────────

export function parseIOSPageSource(xml: string): IOSUIElement[] {
  if (!xml || typeof xml !== 'string') return [];

  const elements: IOSUIElement[] = [];
  const elementPattern = /XCUIElementType(\w+)([^>]*)>/g;
  const boundsPatterns = [
    /bounds="\{\{([0-9.]+),\s*([0-9.]+)\},\s*\{([0-9.]+),\s*([0-9.]+)\}\}"/,
    /bounds="\{([0-9.]+),\s*([0-9.]+),\s*([0-9.]+),\s*([0-9.]+)\}"/,
    /bounds="\{?([0-9.]+),\s*([0-9.]+)\}?,\s*\{?([0-9.]+),\s*([0-9.]+)\}?"/,
  ];

  let match;
  while ((match = elementPattern.exec(xml)) !== null) {
    const type = match[1];
    const attrs = match[2];

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

// ─── Android Page Source Parser ──────────────────────────

export function parseAndroidPageSource(xml: string): AndroidUIElement[] {
  if (!xml || typeof xml !== 'string') return [];

  const elements: AndroidUIElement[] = [];
  const nodePattern = /<node\s([^>]+)\/?>/g;
  const boundsPattern = /bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/;

  let match;
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

// ─── Find element at coordinates ─────────────────────────

export function findIOSElementAtCoordinates(elements: IOSUIElement[], x: number, y: number): IOSUIElement | null {
  const matching = elements.filter(el => {
    const { bounds } = el;
    return x >= bounds.x && x <= bounds.x + bounds.width
      && y >= bounds.y && y <= bounds.y + bounds.height;
  });

  if (matching.length === 0) return null;

  // Prefer visible elements
  const visible = matching.filter(el => el.visible);
  const candidates = visible.length > 0 ? visible : matching;

  // Prefer elements with identifiers
  const withId = candidates.filter(el => el.accessibilityId || el.name || el.label);
  const finalCandidates = withId.length > 0 ? withId : candidates;

  // Smallest area = most specific element
  return finalCandidates.reduce((smallest, current) => {
    const smallestArea = smallest.bounds.width * smallest.bounds.height;
    const currentArea = current.bounds.width * current.bounds.height;
    return currentArea < smallestArea ? current : smallest;
  });
}

export function findAndroidElementAtCoordinates(elements: AndroidUIElement[], x: number, y: number): AndroidUIElement | null {
  const matching = elements.filter(el => {
    const { bounds } = el;
    return x >= bounds.x && x <= bounds.x + bounds.width
      && y >= bounds.y && y <= bounds.y + bounds.height;
  });

  if (matching.length === 0) return null;

  const clickable = matching.filter(el => el.clickable);
  const candidates = clickable.length > 0 ? clickable : matching;

  const withId = candidates.filter(el => el.resourceId || el.contentDesc || el.text);
  const finalCandidates = withId.length > 0 ? withId : candidates;

  return finalCandidates.reduce((smallest, current) => {
    const smallestArea = smallest.bounds.width * smallest.bounds.height;
    const currentArea = current.bounds.width * current.bounds.height;
    return currentArea < smallestArea ? current : smallest;
  });
}

// ─── Selector generators ─────────────────────────────────

export function generateIOSSelector(el: IOSUIElement): { strategy: string; value: string } {
  if (el.accessibilityId) return { strategy: 'accessibility_id', value: el.accessibilityId };
  if (el.name) return { strategy: 'name', value: el.name };
  if (el.label) return { strategy: 'label', value: el.label };
  return { strategy: 'xpath', value: `//XCUIElementType${el.type}` };
}

export function generateAndroidSelector(el: AndroidUIElement): { strategy: string; value: string } {
  if (el.resourceId) return { strategy: 'resource_id', value: el.resourceId };
  if (el.contentDesc) return { strategy: 'content_desc', value: el.contentDesc };
  if (el.text) return { strategy: 'text', value: el.text };
  return { strategy: 'xpath', value: `//${el.type}` };
}

// ─── Unified: parse + find + build meta ──────────────────

export function enrichFromPageSource(
  platform: 'ios' | 'android',
  pageSourceXml: string,
  x: number,
  y: number,
): ElementMeta | null {
  if (platform === 'ios') {
    const elements = parseIOSPageSource(pageSourceXml);
    const el = findIOSElementAtCoordinates(elements, x, y);
    if (!el) return null;
    const selector = generateIOSSelector(el);
    return {
      type: el.type,
      label: el.label,
      name: el.name,
      accessibilityId: el.accessibilityId,
      value: el.value,
      enabled: el.enabled,
      visible: el.visible,
      boundingBox: el.bounds,
      selector,
    };
  } else {
    const elements = parseAndroidPageSource(pageSourceXml);
    const el = findAndroidElementAtCoordinates(elements, x, y);
    if (!el) return null;
    const selector = generateAndroidSelector(el);
    return {
      type: el.shortType,
      resourceId: el.resourceId,
      contentDesc: el.contentDesc,
      textContent: el.text,
      enabled: el.enabled,
      clickable: el.clickable,
      boundingBox: el.bounds,
      selector,
    };
  }
}
