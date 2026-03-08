"use strict";
/**
 * 시나리오 폴더 저장소
 *
 * ScenarioFolder 데이터를 JSON 파일로 저장/로드/관리한다.
 * 폴더 계층 구조로 시나리오를 정리하기 위한 저장소.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.FolderStorage = void 0;
const fs_1 = require("fs");
const promises_1 = require("fs/promises");
const path_1 = require("path");
class FolderStorage {
    folderDir;
    constructor(baseDir = './scenarios') {
        this.folderDir = (0, path_1.join)(baseDir, '..', 'folders');
        if (!(0, fs_1.existsSync)(this.folderDir)) {
            (0, fs_1.mkdirSync)(this.folderDir, { recursive: true });
        }
    }
    async save(folder) {
        folder.updatedAt = Date.now();
        const filePath = (0, path_1.join)(this.folderDir, `${folder.id}.json`);
        await (0, promises_1.writeFile)(filePath, JSON.stringify(folder, null, 2), 'utf-8');
    }
    async load(id) {
        const filePath = (0, path_1.join)(this.folderDir, `${id}.json`);
        try {
            const data = await (0, promises_1.readFile)(filePath, 'utf-8');
            return JSON.parse(data);
        }
        catch {
            return null;
        }
    }
    async list() {
        if (!(0, fs_1.existsSync)(this.folderDir))
            return [];
        const files = (await (0, promises_1.readdir)(this.folderDir)).filter(f => f.endsWith('.json'));
        const results = await Promise.allSettled(files.map(async (file) => {
            const data = await (0, promises_1.readFile)((0, path_1.join)(this.folderDir, file), 'utf-8');
            return JSON.parse(data);
        }));
        const folders = results
            .filter((r) => r.status === 'fulfilled')
            .map(r => r.value);
        return folders.sort((a, b) => a.createdAt - b.createdAt);
    }
    async delete(id) {
        const filePath = (0, path_1.join)(this.folderDir, `${id}.json`);
        try {
            await (0, promises_1.unlink)(filePath);
            return true;
        }
        catch {
            return false;
        }
    }
    /** 시나리오 삭제 시 모든 폴더에서 해당 ID 제거 */
    async removeScenarioFromAll(scenarioId) {
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
exports.FolderStorage = FolderStorage;
//# sourceMappingURL=folder-storage.js.map