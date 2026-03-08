"use strict";
/**
 * Action Extractor 모듈
 *
 * 페이지에서 클릭 가능한 액션 후보를 추출하고,
 * 위험도 판정 + 스코어링을 수행한다.
 *
 * Crawljax의 "이벤트 기반 동적 크롤링" 개념을 차용:
 * - a[href] 뿐 아니라 button, role=button, tab, menuitem 등 추출
 * - 위험 키워드(logout, delete, 결제 등)를 blacklist로 필터링
 * - 스코어 기반 정렬로 메뉴/네비게이션 우선 탐색
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.extractActions = extractActions;
exports.detectRisk = detectRisk;
exports.filterSafeActions = filterSafeActions;
const explorer_config_1 = require("./explorer-config");
// ─── 메인 추출 함수 ──────────────────────────────────────
/**
 * 페이지에서 클릭 가능한 액션 후보를 추출한다.
 *
 * 1. a[href], button, [role=button], [role=tab], [role=menuitem] 등에서 후보 수집
 * 2. visibility/size 필터링
 * 3. 위험도 판정 (blacklist 기반)
 * 4. 스코어링 (role, 텍스트 품질, 위치 기반)
 * 5. 스코어 내림차순 정렬
 */
async function extractActions(page) {
    const rawCandidates = await page.evaluate(`(() => {
    var results = [];
    var seen = new Set();

    function getStableSelector(el) {
      if (el.id) return '#' + CSS.escape(el.id);
      var testId = el.getAttribute('data-testid');
      if (testId) return '[data-testid="' + testId + '"]';
      var role = el.getAttribute('role');
      var name = el.getAttribute('aria-label') || el.textContent?.trim().substring(0, 30) || '';
      if (role && name) return '[role="' + role + '"][aria-label="' + name.replace(/"/g, '\\\\"') + '"]';
      var tag = el.tagName.toLowerCase();
      var classes = Array.from(el.classList).slice(0, 3).join('.');
      if (classes) return tag + '.' + classes;
      return tag;
    }

    function isVisible(el) {
      var rect = el.getBoundingClientRect();
      if (rect.width < ${explorer_config_1.MIN_ELEMENT_SIZE} || rect.height < ${explorer_config_1.MIN_ELEMENT_SIZE}) return false;
      var style = window.getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden') return false;
      if (parseFloat(style.opacity) < 0.1) return false;
      return true;
    }

    function processElement(el, index) {
      if (!isVisible(el)) return;
      if (el.disabled || el.getAttribute('aria-disabled') === 'true') return;

      var tag = el.tagName.toLowerCase();
      var href = el.getAttribute('href') || '';
      var role = el.getAttribute('role') || '';
      var ariaLabel = el.getAttribute('aria-label') || '';
      var text = (el.textContent || '').trim().substring(0, 100);
      var selector = getStableSelector(el);

      // 중복 제거 (selector + text 조합)
      var dedupeKey = selector + '::' + text.substring(0, 30);
      if (seen.has(dedupeKey)) return;
      seen.add(dedupeKey);

      var rect = el.getBoundingClientRect();

      var type = 'click';
      if (tag === 'a' && href && !href.startsWith('#') && !href.startsWith('javascript:')
          && !href.startsWith('mailto:') && !href.startsWith('tel:')) {
        type = 'navigate';
      }

      var absoluteHref = '';
      if (type === 'navigate') {
        try { absoluteHref = new URL(href, window.location.href).href; } catch(e) { return; }
      }

      results.push({
        actionId: 'act_' + index,
        type: type,
        selector: selector,
        role: role || undefined,
        text: text || undefined,
        accessibleName: ariaLabel || undefined,
        bbox: { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) },
        riskLevel: 'unknown',
        score: 0,
        href: absoluteHref || undefined,
      });
    }

    // 대상 셀렉터 (우선순위 순으로 수집)
    var selectors = [
      'a[href]',
      'button:not([disabled])',
      '[role="button"]',
      '[role="tab"]',
      '[role="menuitem"]',
      '[role="link"]',
      'input[type="submit"]:not([disabled])',
      'input[type="button"]:not([disabled])',
    ];

    var idx = 0;
    for (var s = 0; s < selectors.length; s++) {
      var elements = document.querySelectorAll(selectors[s]);
      for (var i = 0; i < elements.length; i++) {
        processElement(elements[i], idx++);
      }
    }

    return results;
  })()`);
    // 위험도 판정 + 스코어링 (Node.js 사이드)
    return rawCandidates
        .map(candidate => {
        candidate.riskLevel = detectRisk(candidate);
        candidate.score = scoreAction(candidate);
        return candidate;
    })
        .sort((a, b) => b.score - a.score);
}
// ─── 위험도 판정 ─────────────────────────────────────────
/**
 * 액션 후보의 위험도를 판정한다.
 *
 * - unsafe: blacklist 키워드/패턴 매칭 → 자동 실행 금지
 * - safe: 일반 네비게이션/UI 요소
 * - unknown: 판단 불가
 */
function detectRisk(candidate) {
    const textLower = (candidate.text || '').toLowerCase();
    const nameLower = (candidate.accessibleName || '').toLowerCase();
    const selectorLower = (candidate.selector || '').toLowerCase();
    const hrefLower = (candidate.href || '').toLowerCase();
    // 텍스트/접근성 이름 기반 위험 키워드 매칭
    for (const keyword of explorer_config_1.UNSAFE_TEXT_KEYWORDS) {
        if (textLower.includes(keyword) || nameLower.includes(keyword)) {
            return 'unsafe';
        }
    }
    // href 기반 위험 패턴 매칭
    for (const pattern of explorer_config_1.UNSAFE_HREF_PATTERNS) {
        if (hrefLower.includes(pattern)) {
            return 'unsafe';
        }
    }
    // 셀렉터 기반 위험 패턴 매칭
    for (const pattern of explorer_config_1.UNSAFE_SELECTOR_PATTERNS) {
        if (selectorLower.includes(pattern.toLowerCase())) {
            return 'unsafe';
        }
    }
    // 무시할 프로토콜 체크
    for (const proto of explorer_config_1.IGNORED_PROTOCOLS) {
        if (hrefLower.startsWith(proto)) {
            return 'unsafe';
        }
    }
    // safe 판정: role이 명확하고 텍스트가 있는 경우
    if (candidate.role && (candidate.text || candidate.accessibleName)) {
        return 'safe';
    }
    // navigate 타입이고 텍스트가 있으면 safe
    if (candidate.type === 'navigate' && candidate.text) {
        return 'safe';
    }
    // 텍스트가 있는 button은 safe
    if (candidate.selector.includes('button') && candidate.text) {
        return 'safe';
    }
    return 'unknown';
}
// ─── 스코어링 ──────────────────────────────────────────────
/**
 * 액션 후보의 실행 우선순위 스코어를 계산한다.
 *
 * 높은 점수 = 먼저 실행
 * - role 기반 요소(tab, menuitem, link) 가산
 * - 의미 있는 텍스트 가산
 * - 네비게이션 영역(nav 안) 가산
 * - 화면 상단/좌측 가산 (메뉴 영역)
 * - unsafe면 0점 고정
 */
function scoreAction(candidate) {
    if (candidate.riskLevel === 'unsafe')
        return 0;
    let score = 50; // 기본 점수
    // role 기반 가산
    const role = candidate.role || '';
    if (role === 'tab')
        score += 30;
    else if (role === 'menuitem')
        score += 25;
    else if (role === 'link')
        score += 20;
    else if (role === 'button')
        score += 15;
    // navigate 타입 가산 (새 페이지 탐색 가능성)
    if (candidate.type === 'navigate')
        score += 10;
    // 의미 있는 텍스트 가산
    const text = candidate.text || candidate.accessibleName || '';
    if (text.length > 2 && text.length < 50)
        score += 15;
    else if (text.length >= 50)
        score += 5; // 너무 긴 텍스트는 낮은 가산
    // 네비게이션 셀렉터 패턴 가산
    const sel = candidate.selector || '';
    if (sel.startsWith('nav ') || sel.includes('nav-') || sel.includes('menu') || sel.includes('sidebar')) {
        score += 20;
    }
    // 화면 위치 기반 가산 (상단/좌측 메뉴 영역)
    if (candidate.bbox) {
        if (candidate.bbox.y < 200)
            score += 10; // 상단
        if (candidate.bbox.x < 300)
            score += 5; // 좌측
    }
    // unknown 위험도면 약간 감산
    if (candidate.riskLevel === 'unknown')
        score -= 10;
    return Math.max(score, 1);
}
/**
 * 안전한 액션만 필터링하여 반환한다.
 */
function filterSafeActions(candidates, executeUnknown = false) {
    return candidates.filter(c => {
        if (c.riskLevel === 'safe')
            return true;
        if (c.riskLevel === 'unknown' && executeUnknown)
            return true;
        return false;
    });
}
//# sourceMappingURL=action-extractor.js.map