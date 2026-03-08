/**
 * 시나리오 폴더 저장소
 *
 * ScenarioFolder 데이터를 JSON 파일로 저장/로드/관리한다.
 * 폴더 계층 구조로 시나리오를 정리하기 위한 저장소.
 */
import type { ScenarioFolder } from '../types';
export declare class FolderStorage {
    private folderDir;
    constructor(baseDir?: string);
    save(folder: ScenarioFolder): Promise<void>;
    load(id: string): Promise<ScenarioFolder | null>;
    list(): Promise<ScenarioFolder[]>;
    delete(id: string): Promise<boolean>;
    /** 시나리오 삭제 시 모든 폴더에서 해당 ID 제거 */
    removeScenarioFromAll(scenarioId: string): Promise<void>;
}
