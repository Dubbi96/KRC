/**
 * 프로세스 저장소
 *
 * Process 데이터를 JSON 파일로 저장/로드/관리한다.
 */

import { existsSync, mkdirSync } from 'fs';
import { readFile, writeFile, readdir, unlink } from 'fs/promises';
import { join } from 'path';
import type { Process } from '../types';

export class ProcessStorage {
  private processDir: string;

  constructor(baseDir: string = './scenarios') {
    this.processDir = join(baseDir, '..', 'processes');
    if (!existsSync(this.processDir)) {
      mkdirSync(this.processDir, { recursive: true });
    }
  }

  async save(process: Process): Promise<void> {
    process.updatedAt = Date.now();
    const filePath = join(this.processDir, `${process.id}.json`);
    await writeFile(filePath, JSON.stringify(process, null, 2), 'utf-8');
  }

  async load(id: string): Promise<Process | null> {
    const filePath = join(this.processDir, `${id}.json`);
    try {
      const data = await readFile(filePath, 'utf-8');
      return JSON.parse(data);
    } catch {
      return null;
    }
  }

  async list(): Promise<Process[]> {
    if (!existsSync(this.processDir)) return [];
    const files = (await readdir(this.processDir)).filter(f => f.endsWith('.json'));
    const results = await Promise.allSettled(
      files.map(async (file) => {
        const data = await readFile(join(this.processDir, file), 'utf-8');
        return JSON.parse(data) as Process;
      })
    );
    const processes = results
      .filter((r): r is PromiseFulfilledResult<Process> => r.status === 'fulfilled')
      .map(r => r.value);
    return processes.sort((a, b) => b.updatedAt - a.updatedAt);
  }

  async listByGraphId(graphId: string): Promise<Process[]> {
    const all = await this.list();
    return all.filter(p => p.graphId === graphId);
  }

  async delete(id: string): Promise<boolean> {
    const filePath = join(this.processDir, `${id}.json`);
    try {
      await unlink(filePath);
      return true;
    } catch {
      return false;
    }
  }

  async deleteByGraphId(graphId: string): Promise<number> {
    const processes = await this.listByGraphId(graphId);
    let count = 0;
    for (const p of processes) {
      if (await this.delete(p.id)) count++;
    }
    return count;
  }
}
