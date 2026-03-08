/**
 * 프로세스 저장소
 *
 * Process 데이터를 JSON 파일로 저장/로드/관리한다.
 */
import type { Process } from '../types';
export declare class ProcessStorage {
    private processDir;
    constructor(baseDir?: string);
    save(process: Process): Promise<void>;
    load(id: string): Promise<Process | null>;
    list(): Promise<Process[]>;
    listByGraphId(graphId: string): Promise<Process[]>;
    delete(id: string): Promise<boolean>;
    deleteByGraphId(graphId: string): Promise<number>;
}
