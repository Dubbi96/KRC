"use strict";
/**
 * 프로세스 저장소
 *
 * Process 데이터를 JSON 파일로 저장/로드/관리한다.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.ProcessStorage = void 0;
const fs_1 = require("fs");
const promises_1 = require("fs/promises");
const path_1 = require("path");
class ProcessStorage {
    processDir;
    constructor(baseDir = './scenarios') {
        this.processDir = (0, path_1.join)(baseDir, '..', 'processes');
        if (!(0, fs_1.existsSync)(this.processDir)) {
            (0, fs_1.mkdirSync)(this.processDir, { recursive: true });
        }
    }
    async save(process) {
        process.updatedAt = Date.now();
        const filePath = (0, path_1.join)(this.processDir, `${process.id}.json`);
        await (0, promises_1.writeFile)(filePath, JSON.stringify(process, null, 2), 'utf-8');
    }
    async load(id) {
        const filePath = (0, path_1.join)(this.processDir, `${id}.json`);
        try {
            const data = await (0, promises_1.readFile)(filePath, 'utf-8');
            return JSON.parse(data);
        }
        catch {
            return null;
        }
    }
    async list() {
        if (!(0, fs_1.existsSync)(this.processDir))
            return [];
        const files = (await (0, promises_1.readdir)(this.processDir)).filter(f => f.endsWith('.json'));
        const results = await Promise.allSettled(files.map(async (file) => {
            const data = await (0, promises_1.readFile)((0, path_1.join)(this.processDir, file), 'utf-8');
            return JSON.parse(data);
        }));
        const processes = results
            .filter((r) => r.status === 'fulfilled')
            .map(r => r.value);
        return processes.sort((a, b) => b.updatedAt - a.updatedAt);
    }
    async listByGraphId(graphId) {
        const all = await this.list();
        return all.filter(p => p.graphId === graphId);
    }
    async delete(id) {
        const filePath = (0, path_1.join)(this.processDir, `${id}.json`);
        try {
            await (0, promises_1.unlink)(filePath);
            return true;
        }
        catch {
            return false;
        }
    }
    async deleteByGraphId(graphId) {
        const processes = await this.listByGraphId(graphId);
        let count = 0;
        for (const p of processes) {
            if (await this.delete(p.id))
                count++;
        }
        return count;
    }
}
exports.ProcessStorage = ProcessStorage;
//# sourceMappingURL=process-storage.js.map