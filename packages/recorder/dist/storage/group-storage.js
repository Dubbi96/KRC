"use strict";
/**
 * 시나리오 그룹 저장소
 *
 * ScenarioGroup 데이터를 JSON 파일로 저장/로드/관리한다.
 * Batch/Chain 프리셋을 영속적으로 관리하기 위한 저장소.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.GroupStorage = void 0;
const fs_1 = require("fs");
const promises_1 = require("fs/promises");
const path_1 = require("path");
class GroupStorage {
    groupDir;
    constructor(baseDir = './scenarios') {
        this.groupDir = (0, path_1.join)(baseDir, '..', 'groups');
        if (!(0, fs_1.existsSync)(this.groupDir)) {
            (0, fs_1.mkdirSync)(this.groupDir, { recursive: true });
        }
    }
    async save(group) {
        group.updatedAt = Date.now();
        const filePath = (0, path_1.join)(this.groupDir, `${group.id}.json`);
        await (0, promises_1.writeFile)(filePath, JSON.stringify(group, null, 2), 'utf-8');
    }
    async load(id) {
        const filePath = (0, path_1.join)(this.groupDir, `${id}.json`);
        try {
            const data = await (0, promises_1.readFile)(filePath, 'utf-8');
            return JSON.parse(data);
        }
        catch {
            return null;
        }
    }
    async list() {
        if (!(0, fs_1.existsSync)(this.groupDir))
            return [];
        const files = (await (0, promises_1.readdir)(this.groupDir)).filter(f => f.endsWith('.json'));
        const results = await Promise.allSettled(files.map(async (file) => {
            const data = await (0, promises_1.readFile)((0, path_1.join)(this.groupDir, file), 'utf-8');
            return JSON.parse(data);
        }));
        const groups = results
            .filter((r) => r.status === 'fulfilled')
            .map(r => r.value);
        return groups.sort((a, b) => b.updatedAt - a.updatedAt);
    }
    async delete(id) {
        const filePath = (0, path_1.join)(this.groupDir, `${id}.json`);
        try {
            await (0, promises_1.unlink)(filePath);
            return true;
        }
        catch {
            return false;
        }
    }
}
exports.GroupStorage = GroupStorage;
//# sourceMappingURL=group-storage.js.map