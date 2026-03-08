/**
 * 시나리오 폴더 저장소
 *
 * ScenarioFolder 데이터를 JSON 파일로 저장/로드/관리한다.
 * 폴더 계층 구조로 시나리오를 정리하기 위한 저장소.
 */

import { existsSync, mkdirSync } from 'fs';
import { readFile, writeFile, readdir, unlink } from 'fs/promises';
import { join } from 'path';
import type { ScenarioFolder } from '../types';

export class FolderStorage {
  private folderDir: string;

  constructor(baseDir: string = './scenarios') {
    this.folderDir = join(baseDir, '..', 'folders');
    if (!existsSync(this.folderDir)) {
      mkdirSync(this.folderDir, { recursive: true });
    }
  }

  async save(folder: ScenarioFolder): Promise<void> {
    folder.updatedAt = Date.now();
    const filePath = join(this.folderDir, `${folder.id}.json`);
    await writeFile(filePath, JSON.stringify(folder, null, 2), 'utf-8');
  }

  async load(id: string): Promise<ScenarioFolder | null> {
    const filePath = join(this.folderDir, `${id}.json`);
    try {
      const data = await readFile(filePath, 'utf-8');
      return JSON.parse(data);
    } catch {
      return null;
    }
  }

  async list(): Promise<ScenarioFolder[]> {
    if (!existsSync(this.folderDir)) return [];
    const files = (await readdir(this.folderDir)).filter(f => f.endsWith('.json'));
    const results = await Promise.allSettled(
      files.map(async (file) => {
        const data = await readFile(join(this.folderDir, file), 'utf-8');
        return JSON.parse(data) as ScenarioFolder;
      })
    );
    const folders = results
      .filter((r): r is PromiseFulfilledResult<ScenarioFolder> => r.status === 'fulfilled')
      .map(r => r.value);
    return folders.sort((a, b) => a.createdAt - b.createdAt);
  }

  async delete(id: string): Promise<boolean> {
    const filePath = join(this.folderDir, `${id}.json`);
    try {
      await unlink(filePath);
      return true;
    } catch {
      return false;
    }
  }

  /** 시나리오 삭제 시 모든 폴더에서 해당 ID 제거 */
  async removeScenarioFromAll(scenarioId: string): Promise<void> {
    const folders = await this.list();
    for (const folder of folders) {
      const idx = folder.scenarioIds.indexOf(scenarioId);
      if (idx !== -1) {
        folder.scenarioIds.splice(idx, 1);
        await this.save(folder);
      }
    }
  }
}
