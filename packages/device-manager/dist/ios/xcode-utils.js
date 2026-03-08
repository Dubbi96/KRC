"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.findXcodePath = findXcodePath;
exports.getXcodeInfo = getXcodeInfo;
exports.setXcodePath = setXcodePath;
exports.isXcodeInstalled = isXcodeInstalled;
exports.setDeveloperDirEnv = setDeveloperDirEnv;
exports.autoConfigureXcode = autoConfigureXcode;
const child_process_1 = require("child_process");
const util_1 = require("util");
const execAsync = (0, util_1.promisify)(child_process_1.exec);
/**
 * Xcode 경로 찾기
 */
async function findXcodePath() {
    try {
        // 1. xcode-select로 현재 경로 확인
        const { stdout: currentPath } = await execAsync('xcode-select -p');
        const path = currentPath.trim();
        // CommandLineTools가 아닌 실제 Xcode인지 확인
        if (path.includes('Xcode.app')) {
            return path;
        }
        // 2. 일반적인 Xcode 설치 경로 확인
        const commonPaths = [
            '/Applications/Xcode.app/Contents/Developer',
            '/Applications/Xcode-beta.app/Contents/Developer',
        ];
        for (const xcodePath of commonPaths) {
            try {
                await execAsync(`test -d "${xcodePath}"`);
                return xcodePath;
            }
            catch {
                // 경로가 없으면 다음 경로 시도
            }
        }
        // 3. mdfind로 Xcode.app 찾기
        try {
            const { stdout } = await execAsync('mdfind "kMDItemKind == Application && kMDItemDisplayName == Xcode"');
            const xcodeApps = stdout.trim().split('\n').filter(Boolean);
            for (const appPath of xcodeApps) {
                const devPath = `${appPath}/Contents/Developer`;
                try {
                    await execAsync(`test -d "${devPath}"`);
                    return devPath;
                }
                catch {
                    // 다음 경로 시도
                }
            }
        }
        catch {
            // mdfind 실패 시 무시
        }
        return null;
    }
    catch (error) {
        console.error('Failed to find Xcode path:', error);
        return null;
    }
}
/**
 * Xcode 정보 가져오기
 */
async function getXcodeInfo() {
    const xcodePath = await findXcodePath();
    if (!xcodePath) {
        return null;
    }
    try {
        // Xcode 버전 확인
        const { stdout: versionOutput } = await execAsync(`${xcodePath}/usr/bin/xcodebuild -version`);
        const versionMatch = versionOutput.match(/Xcode (\d+\.\d+(?:\.\d+)?)/);
        const buildMatch = versionOutput.match(/Build version (\w+)/);
        const version = versionMatch ? versionMatch[1] : 'Unknown';
        const buildVersion = buildMatch ? buildMatch[1] : 'Unknown';
        // 유효성 검증: xcodebuild가 실행되는지 확인
        let isValid = false;
        try {
            await execAsync(`${xcodePath}/usr/bin/xcodebuild -version`);
            isValid = true;
        }
        catch {
            isValid = false;
        }
        return {
            path: xcodePath,
            version,
            buildVersion,
            isValid,
        };
    }
    catch (error) {
        console.error('Failed to get Xcode info:', error);
        return {
            path: xcodePath,
            version: 'Unknown',
            buildVersion: 'Unknown',
            isValid: false,
        };
    }
}
/**
 * Xcode 경로 설정
 */
async function setXcodePath(path) {
    try {
        await execAsync(`sudo xcode-select --switch "${path}"`);
        return true;
    }
    catch (error) {
        console.error('Failed to set Xcode path:', error);
        return false;
    }
}
/**
 * Xcode가 설치되어 있는지 확인
 */
async function isXcodeInstalled() {
    const info = await getXcodeInfo();
    return info !== null && info.isValid;
}
/**
 * DEVELOPER_DIR 환경 변수 설정
 */
function setDeveloperDirEnv(xcodePath) {
    process.env.DEVELOPER_DIR = xcodePath;
}
/**
 * Xcode 경로 자동 설정 시도
 */
async function autoConfigureXcode() {
    const xcodePath = await findXcodePath();
    if (!xcodePath) {
        return null;
    }
    // 현재 경로가 Xcode가 아니면 설정 시도
    try {
        const { stdout: currentPath } = await execAsync('xcode-select -p');
        if (!currentPath.trim().includes('Xcode.app')) {
            // 사용자에게 sudo 권한이 필요할 수 있으므로 환경 변수로만 설정
            setDeveloperDirEnv(xcodePath);
            console.log(`Xcode 경로를 환경 변수로 설정: ${xcodePath}`);
        }
        else {
            setDeveloperDirEnv(xcodePath);
        }
    }
    catch {
        // xcode-select 실패 시 환경 변수로만 설정
        setDeveloperDirEnv(xcodePath);
    }
    return await getXcodeInfo();
}
//# sourceMappingURL=xcode-utils.js.map