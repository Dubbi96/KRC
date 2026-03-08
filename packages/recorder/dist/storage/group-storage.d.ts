/**
 * 시나리오 그룹 저장소
 *
 * ScenarioGroup 데이터를 JSON 파일로 저장/로드/관리한다.
 * Batch/Chain 프리셋을 영속적으로 관리하기 위한 저장소.
 */
import type { ScenarioGroup } from '../types';
export declare class GroupStorage {
    private groupDir;
    constructor(baseDir?: string);
    save(group: ScenarioGroup): Promise<void>;
    load(id: string): Promise<ScenarioGroup | null>;
    list(): Promise<ScenarioGroup[]>;
    delete(id: string): Promise<boolean>;
}
