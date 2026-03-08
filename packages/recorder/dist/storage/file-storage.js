"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.FileStorage = void 0;
const fs_1 = require("fs");
const promises_1 = require("fs/promises");
const path_1 = require("path");
class FileStorage {
    outputDir;
    testDataDir;
    constructor(outputDir = './scenarios') {
        this.outputDir = outputDir;
        if (!(0, fs_1.existsSync)(outputDir)) {
            (0, fs_1.mkdirSync)(outputDir, { recursive: true });
        }
        this.testDataDir = (0, path_1.join)(outputDir, '..', 'testdata');
    }
    // ─── Scenario CRUD ─────────────────────────────────────
    /**
     * 시나리오를 JSON 파일로 저장한다.
     *
     * - atomic write: 임시 파일에 먼저 쓰고 rename하여 crash 시 파일 손상 방지
     * - compact 옵션: 녹화 중에는 pretty print를 생략하여 CPU/I/O 절감
     *   (stop 시 최종 저장은 pretty print로)
     */
    async saveScenario(scenario, options) {
        const filePath = (0, path_1.join)(this.outputDir, `${scenario.id}.json`);
        const json = options?.compact
            ? JSON.stringify(scenario)
            : JSON.stringify(scenario, null, 2);
        // Atomic write: tmp 파일에 쓰고 rename
        const tmpPath = filePath + '.tmp';
        await (0, promises_1.writeFile)(tmpPath, json, 'utf-8');
        await (0, promises_1.rename)(tmpPath, filePath);
    }
    async loadScenario(scenarioId) {
        const filePath = (0, path_1.join)(this.outputDir, `${scenarioId}.json`);
        try {
            const data = await (0, promises_1.readFile)(filePath, 'utf-8');
            return JSON.parse(data);
        }
        catch {
            return null;
        }
    }
    async listScenarios() {
        if (!(0, fs_1.existsSync)(this.outputDir))
            return [];
        const files = (await (0, promises_1.readdir)(this.outputDir)).filter(f => f.endsWith('.json'));
        const results = await Promise.allSettled(files.map(async (file) => {
            const data = await (0, promises_1.readFile)((0, path_1.join)(this.outputDir, file), 'utf-8');
            return JSON.parse(data);
        }));
        const scenarios = results
            .filter((r) => r.status === 'fulfilled')
            .map(r => r.value);
        return scenarios.sort((a, b) => b.startedAt - a.startedAt);
    }
    async deleteScenario(scenarioId) {
        const filePath = (0, path_1.join)(this.outputDir, `${scenarioId}.json`);
        try {
            await (0, promises_1.unlink)(filePath);
            return true;
        }
        catch {
            return false;
        }
    }
    // ─── Test Data Profile CRUD ────────────────────────────
    ensureTestDataDir() {
        if (!(0, fs_1.existsSync)(this.testDataDir))
            (0, fs_1.mkdirSync)(this.testDataDir, { recursive: true });
    }
    async saveTestData(profile) {
        this.ensureTestDataDir();
        const filePath = (0, path_1.join)(this.testDataDir, `${profile.id}.json`);
        await (0, promises_1.writeFile)(filePath, JSON.stringify(profile, null, 2), 'utf-8');
    }
    async loadTestData(profileId) {
        const filePath = (0, path_1.join)(this.testDataDir, `${profileId}.json`);
        try {
            const data = await (0, promises_1.readFile)(filePath, 'utf-8');
            return JSON.parse(data);
        }
        catch {
            return null;
        }
    }
    async listTestData() {
        this.ensureTestDataDir();
        if (!(0, fs_1.existsSync)(this.testDataDir))
            return [];
        const files = (await (0, promises_1.readdir)(this.testDataDir)).filter(f => f.endsWith('.json'));
        const results = await Promise.allSettled(files.map(async (file) => {
            const data = await (0, promises_1.readFile)((0, path_1.join)(this.testDataDir, file), 'utf-8');
            return JSON.parse(data);
        }));
        return results
            .filter((r) => r.status === 'fulfilled')
            .map(r => r.value);
    }
    async deleteTestData(profileId) {
        const filePath = (0, path_1.join)(this.testDataDir, `${profileId}.json`);
        try {
            await (0, promises_1.unlink)(filePath);
            return true;
        }
        catch {
            return false;
        }
    }
}
exports.FileStorage = FileStorage;
//# sourceMappingURL=file-storage.js.map