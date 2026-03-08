/**
 * 프로세스 변환기
 *
 * 탐색 그래프에서 선택한 노드 경로를 Process 엔티티로 추출한다.
 * 각 노드 간 전환 조건을 자유 텍스트로 정의할 수 있다.
 */
import type { ExplorationGraph, Process } from '../types';
import { ProcessStorage } from '../storage/process-storage';
export declare class ProcessConverter {
    private processStorage;
    constructor(processStorage: ProcessStorage);
    /**
     * 선택한 노드 ID 경로를 Process로 변환
     */
    createProcess(graph: ExplorationGraph, nodeIds: string[], name: string): Process;
    /**
     * 프로세스를 저장
     */
    saveProcess(process: Process): Promise<void>;
    /**
     * 그래프에서 두 노드 사이의 최단 경로 찾기 (BFS)
     */
    findShortestPath(graph: ExplorationGraph, startNodeId: string, endNodeId: string): string[] | null;
    /**
     * 모든 가능한 경로 찾기 (DFS, 깊이 제한)
     */
    findAllPaths(graph: ExplorationGraph, startNodeId: string, endNodeId: string, maxDepth?: number): string[][];
}
