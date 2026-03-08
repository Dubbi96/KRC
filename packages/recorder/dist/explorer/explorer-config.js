"use strict";
/**
 * Explorer DFS/BFS 설정
 *
 * 탐색 한계(폭발 방지), 위험 액션 블랙리스트,
 * 액션 추출 대상 셀렉터 등을 정의한다.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.MIN_ELEMENT_SIZE = exports.IGNORED_PROTOCOLS = exports.CLICKABLE_SELECTORS = exports.UNSAFE_SELECTOR_PATTERNS = exports.UNSAFE_HREF_PATTERNS = exports.UNSAFE_TEXT_KEYWORDS = exports.DEFAULT_DFS_LIMITS = void 0;
exports.DEFAULT_DFS_LIMITS = {
    maxDepth: 8,
    maxStates: 300,
    maxActionsPerState: 20,
    maxSameUrlStates: 10,
    timeBudgetMs: 10 * 60 * 1000,
    actionDelayMs: 500,
    executeUnknownRisk: false,
};
// ─── 위험 액션 블랙리스트 ──────────────────────────────────
/** 텍스트/접근성 이름 기반 위험 키워드 (소문자로 매칭) */
exports.UNSAFE_TEXT_KEYWORDS = [
    // 영문
    'logout', 'log out', 'sign out', 'signout',
    'delete', 'remove', 'destroy', 'erase',
    'cancel account', 'close account', 'deactivate',
    'unsubscribe',
    'pay', 'purchase', 'checkout', 'check out', 'buy now',
    'submit payment', 'place order', 'confirm order',
    'submit order', 'complete purchase',
    // 한글
    '로그아웃', '탈퇴', '회원탈퇴', '계정삭제',
    '삭제', '제거', '삭제하기',
    '결제', '주문', '구매', '구매하기',
    '결제하기', '주문하기', '주문완료',
    '취소', '해지',
];
/** href 기반 위험 패턴 */
exports.UNSAFE_HREF_PATTERNS = [
    '/logout', '/signout', '/sign-out', '/log-out',
    '/delete', '/remove', '/destroy',
    '/checkout', '/payment', '/purchase',
    '/unsubscribe', '/deactivate',
    '/withdraw', '/cancel-account',
];
/** CSS 셀렉터 기반 위험 패턴 */
exports.UNSAFE_SELECTOR_PATTERNS = [
    '.danger', '.btn-danger', '.btn-delete',
    '.delete', '.logout', '.remove',
    '[data-action="delete"]', '[data-action="logout"]',
];
// ─── 액션 추출 대상 셀렉터 (우선순위 순) ──────────────────
/**
 * 클릭 가능 요소 추출 셀렉터 (우선순위 내림차순)
 * 1. 명시적 네비게이션 링크
 * 2. 버튼 요소
 * 3. 탭/메뉴 항목
 * 4. submit/button 타입 input
 */
exports.CLICKABLE_SELECTORS = [
    'a[href]',
    'button',
    '[role="button"]',
    '[role="tab"]',
    '[role="menuitem"]',
    '[role="link"]',
    'input[type="submit"]',
    'input[type="button"]',
    'nav a',
    'nav button',
    '[data-testid]',
];
// ─── 제외 대상 ─────────────────────────────────────────────
/** 무시할 href 프로토콜 */
exports.IGNORED_PROTOCOLS = ['javascript:', 'mailto:', 'tel:', 'data:', 'blob:'];
/** 최소 요소 크기 (px) — 이보다 작은 요소는 제외 */
exports.MIN_ELEMENT_SIZE = 4;
//# sourceMappingURL=explorer-config.js.map