"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.listAndroidDevices = listAndroidDevices;
exports.listAndroidPackages = listAndroidPackages;
exports.getCurrentAndroidPackage = getCurrentAndroidPackage;
exports.isAndroidDeviceConnected = isAndroidDeviceConnected;
exports.captureAndroidScreen = captureAndroidScreen;
exports.getAndroidLogs = getAndroidLogs;
const child_process_1 = require("child_process");
const util_1 = require("util");
const execAsync = (0, util_1.promisify)(child_process_1.exec);
/**
 * 연결된 Android 디바이스 목록 조회
 */
async function listAndroidDevices() {
    try {
        // adb 명령어가 있는지 확인
        try {
            await execAsync('which adb');
        }
        catch {
            // 명령어가 없으면 조용히 빈 배열 반환
            return [];
        }
        const { stdout } = await execAsync('adb devices -l');
        const lines = stdout.split('\n').filter((line) => line.trim() && !line.startsWith('List'));
        const devices = [];
        for (const line of lines) {
            const parts = line.trim().split(/\s+/);
            if (parts.length < 2)
                continue;
            const id = parts[0];
            const status = parts[1];
            if (status === 'device') {
                try {
                    // 디바이스 정보 조회
                    const { stdout: model } = await execAsync(`adb -s ${id} shell getprop ro.product.model`);
                    const { stdout: version } = await execAsync(`adb -s ${id} shell getprop ro.build.version.release`);
                    const { stdout: sdk } = await execAsync(`adb -s ${id} shell getprop ro.build.version.sdk`);
                    devices.push({
                        id: id.trim(),
                        model: model.trim(),
                        version: version.trim(),
                        sdk: sdk.trim(),
                        status: 'device',
                    });
                }
                catch {
                    devices.push({
                        id: id.trim(),
                        model: 'Unknown',
                        version: 'Unknown',
                        sdk: 'Unknown',
                        status,
                    });
                }
            }
            else {
                devices.push({
                    id: id.trim(),
                    model: 'Unknown',
                    version: 'Unknown',
                    sdk: 'Unknown',
                    status,
                });
            }
        }
        return devices;
    }
    catch (error) {
        // 명령어가 없거나 실행 실패 시 조용히 빈 배열 반환 (에러 로깅 제거)
        if (error?.code !== 127) {
            // 명령어가 없는 경우(127)가 아닌 다른 에러만 로깅
            console.error('Failed to list Android devices:', error.message);
        }
        return [];
    }
}
/**
 * 연결된 Android 디바이스의 설치된 패키지 목록 조회 (3rd-party 앱만)
 */
async function listAndroidPackages(deviceId) {
    try {
        // -3: 3rd-party 앱만 (시스템 앱 제외)
        const { stdout } = await execAsync(`adb -s ${deviceId} shell pm list packages -3`, { timeout: 10000 });
        return stdout
            .split('\n')
            .map((line) => line.replace('package:', '').trim())
            .filter(Boolean)
            .sort();
    }
    catch {
        return [];
    }
}
/**
 * 현재 포그라운드 앱의 패키지 이름 조회
 */
async function getCurrentAndroidPackage(deviceId) {
    try {
        const { stdout } = await execAsync(`adb -s ${deviceId} shell dumpsys activity activities | grep -E 'mResumedActivity|mFocusedActivity'`, { timeout: 5000 });
        // "mResumedActivity: ActivityRecord{... com.example.app/.MainActivity ...}" 형태에서 패키지 추출
        const match = stdout.match(/([a-zA-Z][a-zA-Z0-9_]*(?:\.[a-zA-Z][a-zA-Z0-9_]*)+)\//);
        return match ? match[1] : null;
    }
    catch {
        return null;
    }
}
/**
 * Android 디바이스 연결 확인
 */
async function isAndroidDeviceConnected(deviceId) {
    try {
        const { stdout } = await execAsync(`adb -s ${deviceId} get-state`);
        return stdout.trim() === 'device';
    }
    catch {
        return false;
    }
}
/**
 * Android 디바이스 화면 캡처
 */
async function captureAndroidScreen(deviceId, outputPath) {
    await execAsync(`adb -s ${deviceId} shell screencap -p > ${outputPath}`);
}
/**
 * Android 디바이스 로그 수집
 */
async function getAndroidLogs(deviceId, outputPath) {
    await execAsync(`adb -s ${deviceId} logcat > ${outputPath}`);
}
//# sourceMappingURL=device.js.map