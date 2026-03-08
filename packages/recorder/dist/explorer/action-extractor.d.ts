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
export type ActionRiskLevel = 'safe' | 'unsafe' | 'unknown';
export interface ActionCandidate {
    /** 고유 식별자 (stateKey 내에서 고유) */
    actionId: string;
    /** 액션 종류: click(버튼/탭) 또는 navigate(링크 이동) */
    type: 'click' | 'navigate';
    /** CSS 셀렉터 */
    selector: string;
    /** ARIA role */
    role?: string;
    /** 표시 텍스트 */
    text?: string;
    /** 접근성 이름 */
    accessibleName?: string;
    /** 요소 위치 및 크기 */
    bbox?: {
        x: number;
        y: number;
        width: number;
        height: number;
    };
    /** 위험도 */
    riskLevel: ActionRiskLevel;
    /** 스코어 (높을수록 우선 실행) */
    score: number;
    /** 링크 URL (navigate 타입인 경우) */
    href?: string;
}
/**
 * 페이지에서 클릭 가능한 액션 후보를 추출한다.
 *
 * 1. a[href], button, [role=button], [role=tab], [role=menuitem] 등에서 후보 수집
 * 2. visibility/size 필터링
 * 3. 위험도 판정 (blacklist 기반)
 * 4. 스코어링 (role, 텍스트 품질, 위치 기반)
 * 5. 스코어 내림차순 정렬
 */
export declare function extractActions(page: any): Promise<ActionCandidate[]>;
/**
 * 액션 후보의 위험도를 판정한다.
 *
 * - unsafe: blacklist 키워드/패턴 매칭 → 자동 실행 금지
 * - safe: 일반 네비게이션/UI 요소
 * - unknown: 판단 불가
 */
export declare function detectRisk(candidate: ActionCandidate): ActionRiskLevel;
/**
 * 안전한 액션만 필터링하여 반환한다.
 */
export declare function filterSafeActions(candidates: ActionCandidate[], executeUnknown?: boolean): ActionCandidate[];
