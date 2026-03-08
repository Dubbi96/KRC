/**
 * 시나리오 그룹 저장소
 *
 * ScenarioGroup 데이터를 JSON 파일로 저장/로드/관리한다.
 * Batch/Chain 프리셋을 영속적으로 관리하기 위한 저장소.
 */

import { existsSync, mkdirSync } from 'fs';
import { readFile, writeFile, readdir, unlink } from 'fs/promises';
import { join } from 'path';
import type { ScenarioGroup } from '../types';

export class GroupStorage {
  private groupDir: string;

  constructor(baseDir: string = './scenarios') {
    this.groupDir = join(baseDir, '..', 'groups');
    if (!existsSync(this.groupDir)) {
      mkdirSync(this.groupDir, { recursive: true });
    }
  }

  async save(group: ScenarioGroup): Promise<void> {
    group.updatedAt = Date.now();
    const filePath = join(this.groupDir, `${group.id}.json`);
    await writeFile(filePath, JSON.stringify(group, null, 2), 'utf-8');
  }

  async load(id: string): Promise<ScenarioGroup | null> {
    const filePath = join(this.groupDir, `${id}.json`);
    try {
      const data = await readFile(filePath, 'utf-8');
      return JSON.parse(data);
    } catch {
      return null;
    }
  }

  async list(): Promise<ScenarioGroup[]> {
    if (!existsSync(this.groupDir)) return [];
    const files = (await readdir(this.groupDir)).filter(f => f.endsWith('.json'));
    const results = await Promise.allSettled(
      files.map(async (file) => {
        const data = await readFile(join(this.groupDir, file), 'utf-8');
        return JSON.parse(data) as ScenarioGroup;
      })
    );
    const groups = results
      .filter((r): r is PromiseFulfilledResult<ScenarioGroup> => r.status === 'fulfilled')
      .map(r => r.value);
    return groups.sort((a, b) => b.updatedAt - a.updatedAt);
  }

  async delete(id: string): Promise<boolean> {
    const filePath = join(this.groupDir, `${id}.json`);
    try {
      await unlink(filePath);
      return true;
    } catch {
      return false;
    }
  }
}
