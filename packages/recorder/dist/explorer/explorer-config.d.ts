/**
 * Explorer DFS/BFS 설정
 *
 * 탐색 한계(폭발 방지), 위험 액션 블랙리스트,
 * 액션 추출 대상 셀렉터 등을 정의한다.
 */
export interface DfsCrawlLimits {
    /** DFS 최대 깊이 (기본: 8) */
    maxDepth: number;
    /** 최대 상태(노드) 수 (기본: 300) */
    maxStates: number;
    /** 상태별 최대 액션 실행 수 (기본: 20) */
    maxActionsPerState: number;
    /** 동일 URL에서 허용되는 최대 상태 수 — SPA 탭 폭발 방지 (기본: 10) */
    maxSameUrlStates: number;
    /** 전체 탐색 시간 제한 ms (기본: 10분) */
    timeBudgetMs: number;
    /** 액션 실행 후 대기 ms (기본: 500) */
    actionDelayMs: number;
    /** unknown 위험도 액션도 실행 여부 (기본: false) */
    executeUnknownRisk: boolean;
}
export declare const DEFAULT_DFS_LIMITS: DfsCrawlLimits;
/** 텍스트/접근성 이름 기반 위험 키워드 (소문자로 매칭) */
export declare const UNSAFE_TEXT_KEYWORDS: string[];
/** href 기반 위험 패턴 */
export declare const UNSAFE_HREF_PATTERNS: string[];
/** CSS 셀렉터 기반 위험 패턴 */
export declare const UNSAFE_SELECTOR_PATTERNS: string[];
/**
 * 클릭 가능 요소 추출 셀렉터 (우선순위 내림차순)
 * 1. 명시적 네비게이션 링크
 * 2. 버튼 요소
 * 3. 탭/메뉴 항목
 * 4. submit/button 타입 input
 */
export declare const CLICKABLE_SELECTORS: string[];
/** 무시할 href 프로토콜 */
export declare const IGNORED_PROTOCOLS: string[];
/** 최소 요소 크기 (px) — 이보다 작은 요소는 제외 */
export declare const MIN_ELEMENT_SIZE = 4;
