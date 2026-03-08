import type { RecordingScenario, TestDataProfile } from '../types';
export interface SaveOptions {
    /** true이면 pretty print 없이 compact JSON으로 저장 (녹화 중 I/O 최적화) */
    compact?: boolean;
}
export declare class FileStorage {
    private outputDir;
    private testDataDir;
    constructor(outputDir?: string);
    /**
     * 시나리오를 JSON 파일로 저장한다.
     *
     * - atomic write: 임시 파일에 먼저 쓰고 rename하여 crash 시 파일 손상 방지
     * - compact 옵션: 녹화 중에는 pretty print를 생략하여 CPU/I/O 절감
     *   (stop 시 최종 저장은 pretty print로)
     */
    saveScenario(scenario: RecordingScenario, options?: SaveOptions): Promise<void>;
    loadScenario(scenarioId: string): Promise<RecordingScenario | null>;
    listScenarios(): Promise<RecordingScenario[]>;
    deleteScenario(scenarioId: string): Promise<boolean>;
    private ensureTestDataDir;
    saveTestData(profile: TestDataProfile): Promise<void>;
    loadTestData(profileId: string): Promise<TestDataProfile | null>;
    listTestData(): Promise<TestDataProfile[]>;
    deleteTestData(profileId: string): Promise<boolean>;
}
