/**
 * 웹 탐색기
 *
 * Playwright를 사용하여 웹 페이지를 수동/자동으로 탐색하고,
 * 그래프 형태로 페이지 연결 구조를 수집한다.
 *
 * - 수동 모드: 사용자가 클릭할 때마다 노드/엣지 추가
 * - 자동 크롤링: 링크를 자동으로 따라가며 그래프 구축
 * - 도메인 경계 검사, 팝업 처리, 인증 프로필 지원
 */
import type { ExplorationGraph, PageNode, ExplorationSession, ExplorationStatus } from '../types';
import { GraphStorage } from '../storage/graph-storage';
import { AuthStore } from '../dashboard/auth-store';
import { type ActionCandidate } from './action-extractor';
import { type DfsCrawlLimits } from './explorer-config';
export interface LinkInfo {
    url: string;
    text: string;
    selector: string;
}
export interface ExplorerCallbacks {
    onNodeAdded?: (node: PageNode, graph: ExplorationGraph) => void;
    onEdgeAdded?: (edge: {
        source: string;
        target: string;
        linkUrl: string;
    }, graph: ExplorationGraph) => void;
    onPageVisited?: (url: string, title: string) => void;
    onStatusChanged?: (status: ExplorationStatus) => void;
    onError?: (error: string) => void;
    onCrawlProgress?: (visited: number, queued: number, total: number) => void;
    /** DFS 크롤링 진행 상태 콜백 */
    onDfsCrawlProgress?: (stats: {
        visitedStates: number;
        currentDepth: number;
        actionsExecuted: number;
        stackSize: number;
        elapsedMs: number;
    }) => void;
    /** DFS 크롤링에서 액션 실행 시 콜백 */
    onActionExecuted?: (action: ActionCandidate, fromStateKey: string, toStateKey: string | null) => void;
}
export declare class WebExplorer {
    private graphStorage;
    private authStore;
    private browser;
    private context;
    private page;
    private session;
    private callbacks;
    private crawlAbortController;
    private navigationHistory;
    constructor(graphStorage: GraphStorage, authStore: AuthStore);
    startSession(graphId: string, callbacks?: ExplorerCallbacks, headless?: boolean, options?: {
        startUrl?: string;
        authProfileId?: string;
    }): Promise<ExplorationSession>;
    stopSession(): Promise<void>;
    private cleanup;
    getSession(): ExplorationSession | null;
    /**
     * 사용자가 지정한 URL로 이동 (수동 탐색)
     */
    navigateTo(url: string): Promise<PageNode | null>;
    /**
     * 현재 페이지의 링크 목록 추출
     */
    extractLinks(): Promise<LinkInfo[]>;
    /**
     * 현재 그래프에서 아직 방문하지 않은 링크를 자동으로 따라가며 탐색
     */
    startCrawl(options?: {
        maxDepth?: number;
        maxNodes?: number;
    }): Promise<void>;
    /**
     * 크롤링 일시 중지
     */
    pauseCrawl(): void;
    /**
     * DFS 기반 동적 크롤링을 시작한다.
     *
     * 기존 BFS 크롤링(startCrawl)이 a[href] 링크만 따라가는 반면,
     * DFS 크롤링은 버튼, 탭, 메뉴 등 클릭 가능한 모든 액션을 실행하여
     * SPA 내부의 숨겨진 상태까지 "구석구석" 탐색한다.
     *
     * 핵심 설계 (Crawljax 참고):
     * 1. State = URL + DOM fingerprint → 같은 URL이라도 DOM이 다르면 다른 상태
     * 2. Action = 클릭 가능 요소 (링크, 버튼, 탭, 메뉴)
     * 3. DFS 스택으로 깊게 들어가되, 폭발 방지 파라미터로 제한
     * 4. 위험 액션(logout, delete, 결제 등) 자동 차단
     *
     * @param options DFS 크롤링 설정 (미지정 시 기본값 또는 graph.config.dfs 사용)
     */
    startDfsCrawl(options?: Partial<DfsCrawlLimits>): Promise<void>;
    private handlePopup;
    private handleNavigation;
    goBack(): Promise<PageNode | null>;
    captureCurrentPage(): Promise<PageNode | null>;
    /**
     * 페이지 스크린샷을 썸네일로 캡처하여 저장
     */
    private captureScreenshot;
    /**
     * 패턴 그룹핑 여부에 따라 방문 키 결정
     * ON이면 패턴 기반, OFF이면 normalizedUrl 기반
     */
    private getVisitedKey;
    /**
     * 페이지 콘텐츠가 실제로 렌더링될 때까지 대기
     *
     * CSR(React, Vue 등)은 domcontentloaded 후에도 실제 콘텐츠 렌더링이
     * 한참 뒤에 완료된다. 이 메서드는 networkidle을 짧은 타임아웃으로 시도하여
     * 동적 콘텐츠 로드 완료를 기다린 후, document.title을 다시 캡처한다.
     */
    private waitForPageReady;
    private delay;
}
