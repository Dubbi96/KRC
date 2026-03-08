import { existsSync, mkdirSync } from 'fs';
import { readFile, writeFile, readdir, unlink, rename } from 'fs/promises';
import { join } from 'path';
import type { RecordingScenario, TestDataProfile } from '../types';

export interface SaveOptions {
  /** true이면 pretty print 없이 compact JSON으로 저장 (녹화 중 I/O 최적화) */
  compact?: boolean;
}

export class FileStorage {
  private testDataDir: string;

  constructor(private outputDir: string = './scenarios') {
    if (!existsSync(outputDir)) {
      mkdirSync(outputDir, { recursive: true });
    }
    this.testDataDir = join(outputDir, '..', 'testdata');
  }

  // ─── Scenario CRUD ─────────────────────────────────────

  /**
   * 시나리오를 JSON 파일로 저장한다.
   *
   * - atomic write: 임시 파일에 먼저 쓰고 rename하여 crash 시 파일 손상 방지
   * - compact 옵션: 녹화 중에는 pretty print를 생략하여 CPU/I/O 절감
   *   (stop 시 최종 저장은 pretty print로)
   */
  async saveScenario(scenario: RecordingScenario, options?: SaveOptions): Promise<void> {
    const filePath = join(this.outputDir, `${scenario.id}.json`);
    const json = options?.compact
      ? JSON.stringify(scenario)
      : JSON.stringify(scenario, null, 2);

    // Atomic write: tmp 파일에 쓰고 rename
    const tmpPath = filePath + '.tmp';
    await writeFile(tmpPath, json, 'utf-8');
    await rename(tmpPath, filePath);
  }

  async loadScenario(scenarioId: string): Promise<RecordingScenario | null> {
    const filePath = join(this.outputDir, `${scenarioId}.json`);
    try {
      const data = await readFile(filePath, 'utf-8');
      return JSON.parse(data) as RecordingScenario;
    } catch {
      return null;
    }
  }

  async listScenarios(): Promise<RecordingScenario[]> {
    if (!existsSync(this.outputDir)) return [];
    const files = (await readdir(this.outputDir)).filter(f => f.endsWith('.json'));
    const results = await Promise.allSettled(
      files.map(async (file) => {
        const data = await readFile(join(this.outputDir, file), 'utf-8');
        return JSON.parse(data) as RecordingScenario;
      })
    );
    const scenarios = results
      .filter((r): r is PromiseFulfilledResult<RecordingScenario> => r.status === 'fulfilled')
      .map(r => r.value);
    return scenarios.sort((a, b) => b.startedAt - a.startedAt);
  }

  async deleteScenario(scenarioId: string): Promise<boolean> {
    const filePath = join(this.outputDir, `${scenarioId}.json`);
    try {
      await unlink(filePath);
      return true;
    } catch {
      return false;
    }
  }

  // ─── Test Data Profile CRUD ────────────────────────────

  private ensureTestDataDir(): void {
    if (!existsSync(this.testDataDir)) mkdirSync(this.testDataDir, { recursive: true });
  }

  async saveTestData(profile: TestDataProfile): Promise<void> {
    this.ensureTestDataDir();
    const filePath = join(this.testDataDir, `${profile.id}.json`);
    await writeFile(filePath, JSON.stringify(profile, null, 2), 'utf-8');
  }

  async loadTestData(profileId: string): Promise<TestDataProfile | null> {
    const filePath = join(this.testDataDir, `${profileId}.json`);
    try {
      const data = await readFile(filePath, 'utf-8');
      return JSON.parse(data) as TestDataProfile;
    } catch {
      return null;
    }
  }

  async listTestData(): Promise<TestDataProfile[]> {
    this.ensureTestDataDir();
    if (!existsSync(this.testDataDir)) return [];
    const files = (await readdir(this.testDataDir)).filter(f => f.endsWith('.json'));
    const results = await Promise.allSettled(
      files.map(async (file) => {
        const data = await readFile(join(this.testDataDir, file), 'utf-8');
        return JSON.parse(data) as TestDataProfile;
      })
    );
    return results
      .filter((r): r is PromiseFulfilledResult<TestDataProfile> => r.status === 'fulfilled')
      .map(r => r.value);
  }

  async deleteTestData(profileId: string): Promise<boolean> {
    const filePath = join(this.testDataDir, `${profileId}.json`);
    try {
      await unlink(filePath);
      return true;
    } catch {
      return false;
    }
  }
}
