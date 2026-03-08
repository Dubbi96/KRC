/**
 * 탐색 그래프 저장소
 *
 * ExplorationGraph 데이터를 JSON 파일로 저장/로드/관리한다.
 */
import type { Process } from '../types';
import type { ExplorationGraph, PageNode, PageEdge, GraphRoot } from '../types';
export declare class GraphStorage {
    private graphDir;
    constructor(baseDir?: string);
    getGraphDir(): string;
    getScreenshotDir(graphId: string): string;
    getScreenshotPath(graphId: string, nodeId: string): string;
    save(graph: ExplorationGraph): Promise<void>;
    load(id: string): Promise<ExplorationGraph | null>;
    list(): Promise<ExplorationGraph[]>;
    /** 경량 목록: 노드/엣지 전체 데이터 없이 요약만 반환 */
    listSummaries(): Promise<Array<{
        id: string;
        name: string;
        rootUrl: string;
        status: string;
        nodeCount: number;
        edgeCount: number;
        createdAt: number;
        updatedAt: number;
        deviceType?: string;
        rootCount: number;
    }>>;
    delete(id: string): Promise<boolean>;
    createGraph(name: string, rootUrl: string, allowedDomains: string[], config?: ExplorationGraph['config']): Promise<ExplorationGraph>;
    addRoot(graph: ExplorationGraph, root: Omit<GraphRoot, 'id' | 'addedAt'>): GraphRoot;
    removeRoot(graph: ExplorationGraph, rootId: string): boolean;
    addNode(graph: ExplorationGraph, node: Omit<PageNode, 'id'>): PageNode;
    addEdge(graph: ExplorationGraph, edge: Omit<PageEdge, 'id'>): PageEdge;
    findNodeByUrl(graph: ExplorationGraph, url: string): PageNode | undefined;
    findNodeByPattern(graph: ExplorationGraph, url: string): PageNode | undefined;
    /** stateKey로 노드 검색 (DFS 탐색용) */
    findNodeByStateKey(graph: ExplorationGraph, stateKey: string): PageNode | undefined;
    /**
     * 특정 URL(State 정규화 기준)의 상태 노드 수를 반환 (SPA 폭발 방지용)
     *
     * CRITICAL: normalizeUrlForState()와 동일한 정규화 규칙을 사용해야 한다.
     * graphStorage.normalizeUrl()은 fragment/trailing slash만 처리하지만,
     * normalizeUrlForState()는 tracking 파라미터 제거 + 쿼리 정렬까지 수행하므로,
     * DFS에서 전달하는 normalizedUrl과 비교 시 반드시 같은 함수를 써야 한다.
     */
    countNodesForNormalizedUrl(graph: ExplorationGraph, normalizedUrl: string): number;
    normalizeUrl(url: string, ignoreFragments?: boolean): string;
    /**
     * URL에서 패턴을 추출한다.
     * - 숫자 세그먼트(/123/) → :id
     * - UUID 패턴 → :id
     * - 긴 hex 문자열(8+자) → :id
     * - 쿼리 파라미터 전부 제거
     */
    extractUrlPattern(url: string): string;
    /**
     * 그래프에서 노드를 삭제하고 관련 엣지, 프로세스 참조, 스크린샷을 정리한다.
     * @returns 삭제 결과 요약
     */
    deleteNode(graph: ExplorationGraph, nodeId: string, processes: Process[], saveProcess: (p: Process) => Promise<void>): Promise<{
        edgesRemoved: number;
        processesUpdated: string[];
    }>;
    isAllowedDomain(url: string, allowedDomains: string[]): boolean;
}
