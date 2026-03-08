import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

/**
 * iOS 디바이스 연결 및 제어
 * libimobiledevice 사용
 */

export interface IOSDevice {
  udid: string;
  name: string;
  version: string;
  model: string;
  status: 'connected' | 'disconnected';
}

/**
 * ioreg를 사용하여 USB 연결된 iOS 디바이스 정보 조회 (가장 정확)
 */
async function listIOSDevicesViaIOReg(): Promise<IOSDevice[]> {
  try {
    const { stdout } = await execAsync('ioreg -p IOUSB -l -w 0');
    const devices: IOSDevice[] = [];
    
    // iPhone, iPad, iPod 찾기
    const lines = stdout.split('\n');
    let currentDevice: Partial<IOSDevice> | null = null;
    let inIOSDevice = false;
    
    for (const line of lines) {
      // iOS 디바이스 시작
      if (line.match(/iPhone|iPad|iPod/) && line.includes('IOUSBHostDevice')) {
        inIOSDevice = true;
        const deviceTypeMatch = line.match(/(iPhone|iPad|iPod)/);
        currentDevice = {
          name: deviceTypeMatch ? deviceTypeMatch[1] : 'iOS Device',
          status: 'connected' as const,
        };
      }
      
      if (inIOSDevice && currentDevice) {
        // Serial Number 추출
        const serialMatch = line.match(/"kUSBSerialNumberString" = "(.+)"/);
        if (serialMatch) {
          currentDevice.udid = serialMatch[1].trim();
        }
        
        // Product Name 추출
        const productMatch = line.match(/"USB Product Name" = "(.+)"/);
        if (productMatch) {
          currentDevice.name = productMatch[1].trim();
        }
        
        // Version 추출 (bcdDevice)
        const versionMatch = line.match(/"bcdDevice" = (\d+)/);
        if (versionMatch) {
          const bcd = parseInt(versionMatch[1], 16);
          const major = (bcd >> 8) & 0xFF;
          const minor = (bcd >> 4) & 0x0F;
          const patch = bcd & 0x0F;
          currentDevice.version = `${major}.${minor}${patch > 0 ? '.' + patch : ''}`;
        }
        
        // 디바이스 섹션 종료 (다음 디바이스 또는 끝)
        if (line.match(/^}$/) && currentDevice.udid) {
          devices.push({
            udid: currentDevice.udid,
            name: currentDevice.name || 'iOS Device',
            version: currentDevice.version || 'Unknown',
            model: currentDevice.name || 'iOS Device',
            status: 'connected',
          });
          currentDevice = null;
          inIOSDevice = false;
        }
      }
    }
    
    // 마지막 디바이스 저장
    if (currentDevice && currentDevice.udid) {
      devices.push({
        udid: currentDevice.udid,
        name: currentDevice.name || 'iOS Device',
        version: currentDevice.version || 'Unknown',
        model: currentDevice.name || 'iOS Device',
        status: 'connected',
      });
    }
    
    return devices;
  } catch (error: any) {
    console.error('Failed to list iOS devices via ioreg:', error.message);
    return [];
  }
}

/**
 * system_profiler를 사용하여 USB 연결된 iOS 디바이스 기본 정보 조회 (fallback)
 */
async function listIOSDevicesViaSystemProfiler(): Promise<IOSDevice[]> {
  try {
    const { stdout } = await execAsync('system_profiler SPUSBDataType');
    const devices: IOSDevice[] = [];
    
    // iPhone, iPad, iPod 섹션 찾기
    const devicePattern = /(iPhone|iPad|iPod):\s*\n((?:\s+[^\n]+\n)*)/g;
    let match;
    
    while ((match = devicePattern.exec(stdout)) !== null) {
      const deviceType = match[1];
      const deviceInfo = match[2];
      
      // Serial Number 추출
      const serialMatch = deviceInfo.match(/Serial Number:\s*(.+)/);
      const versionMatch = deviceInfo.match(/Version:\s*(.+)/);
      
      if (serialMatch && serialMatch[1]) {
        const udid = serialMatch[1].trim();
        const version = versionMatch && versionMatch[1] ? versionMatch[1].trim() : 'Unknown';
        
        devices.push({
          udid: udid,
          name: deviceType,
          version: version,
          model: deviceType,
          status: 'connected',
        });
      }
    }
    
    return devices;
  } catch (error: any) {
    console.error('Failed to list iOS devices via system_profiler:', error.message);
    return [];
  }
}

/**
 * 연결된 iOS 디바이스 목록 조회
 * 여러 방법을 순차적으로 시도하여 가장 정확한 결과 반환
 */
export async function listIOSDevices(): Promise<IOSDevice[]> {
  try {
    // 방법 1: idevice_id 사용 (libimobiledevice - 가장 정확한 정보)
    try {
      await execAsync('which idevice_id');
      
      // idevice_id -l 명령어로 UDID 목록 조회
      const { stdout: udids } = await execAsync('idevice_id -l');
      
      if (!udids.trim()) {
        // UDID가 없으면 ioreg로 fallback
        return await listIOSDevicesViaIOReg();
      }
      
      const devices: IOSDevice[] = [];
      
      for (const udid of udids.trim().split('\n').filter(Boolean)) {
        try {
          // ideviceinfo로 디바이스 정보 조회
          const { stdout: deviceName } = await execAsync(`ideviceinfo -u ${udid} -k DeviceName`);
          const { stdout: productVersion } = await execAsync(`ideviceinfo -u ${udid} -k ProductVersion`);
          const { stdout: productType } = await execAsync(`ideviceinfo -u ${udid} -k ProductType`);
          
          devices.push({
            udid: udid.trim(),
            name: deviceName.trim(),
            version: productVersion.trim(),
            model: productType.trim(),
            status: 'connected',
          });
        } catch {
          // 정보 조회 실패 시 기본 정보만
          devices.push({
            udid: udid.trim(),
            name: 'Unknown',
            version: 'Unknown',
            model: 'Unknown',
            status: 'connected',
          });
        }
      }
      
      return devices;
    } catch {
      // idevice_id가 없으면 ioreg로 fallback (가장 정확한 USB 연결 확인)
      const ioregDevices = await listIOSDevicesViaIOReg();
      if (ioregDevices.length > 0) {
        return ioregDevices;
      }
      
      // ioreg도 실패하면 system_profiler로 fallback
      console.warn('idevice_id not found. Using ioreg/system_profiler as fallback. Install libimobiledevice for better support: brew install libimobiledevice');
      return await listIOSDevicesViaSystemProfiler();
    }
  } catch (error: any) {
    // 최종 fallback: ioreg -> system_profiler 순서로 시도
    console.error('Failed to list iOS devices:', error.message);
    
    try {
      const ioregDevices = await listIOSDevicesViaIOReg();
      if (ioregDevices.length > 0) {
        return ioregDevices;
      }
    } catch {
      // ioreg 실패 시 system_profiler 시도
    }
    
    return await listIOSDevicesViaSystemProfiler();
  }
}

/**
 * ideviceinstaller stdout에서 Bundle ID를 파싱
 */
function parseBundleIds(stdout: string): string[] {
  const bundleIds: string[] = [];
  for (const line of stdout.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('Total') || trimmed.startsWith('CFBundle') || trimmed.startsWith('-')) continue;
    const match = trimmed.match(/^([a-zA-Z][a-zA-Z0-9\-_.]*(?:\.[a-zA-Z][a-zA-Z0-9\-_.]*)+)/);
    if (match) bundleIds.push(match[1]);
  }
  return bundleIds;
}

/**
 * 연결된 iOS 디바이스의 설치된 앱 Bundle ID 목록 조회 (사용자 앱만)
 * ideviceinstaller 사용 (libimobiledevice 필요)
 * 여러 CLI 형식을 순차 시도하여 호환성 확보
 */
export async function listIOSBundleIds(udid: string): Promise<string[]> {
  // ideviceinstaller 존재 여부 확인
  try {
    await execAsync('which ideviceinstaller');
  } catch {
    throw new Error('ideviceinstaller가 설치되어 있지 않습니다. brew install ideviceinstaller 로 설치하세요.');
  }

  const strategies = [
    { cmd: `ideviceinstaller -u ${udid} -l -o list_user`, label: '-l -o list_user' },
    { cmd: `ideviceinstaller -u ${udid} -l`, label: '-l' },
    { cmd: `ideviceinstaller -u ${udid} list --all`, label: 'list --all' },
  ];

  const errors: string[] = [];

  for (const { cmd, label } of strategies) {
    try {
      const { stdout, stderr } = await execAsync(cmd, { timeout: 30000 });
      const bundleIds = parseBundleIds(stdout);
      if (bundleIds.length > 0) return bundleIds.sort();
      // stdout 파싱 결과가 0개이고 stderr에 에러가 있으면 기록
      if (stderr?.trim()) {
        errors.push(`[${label}] stderr: ${stderr.trim()}`);
      } else {
        errors.push(`[${label}] 파싱 결과 0개 (stdout ${stdout.length}bytes)`);
      }
    } catch (e: any) {
      const msg = e?.killed ? `타임아웃 (30초)` : (e?.message || String(e));
      errors.push(`[${label}] ${msg}`);
    }
  }

  // 모든 전략 실패 시 에러를 throw하여 호출자가 원인을 알 수 있게 함
  throw new Error(`번들 조회 실패 (${strategies.length}가지 방식 모두 실패):\n${errors.join('\n')}`);
}

/**
 * 현재 포그라운드 앱의 Bundle ID 조회 (Appium 세션 필요 없이)
 * idevice 도구 기반
 */
export async function getCurrentIOSBundleId(udid: string): Promise<string | null> {
  try {
    // SpringBoard의 현재 앱 조회 (idevice 도구 사용)
    const { stdout } = await execAsync(
      `ideviceinfo -u ${udid} -q com.apple.springboard.cursorcontrol 2>/dev/null || true`,
      { timeout: 5000 }
    );
    // 이 방법이 안되면 null 반환 (Appium 세션 없이는 한계가 있음)
    if (stdout.trim()) {
      const match = stdout.match(/SBApplicationBundleIdentifier:\s*(.+)/);
      if (match) return match[1].trim();
    }
  } catch { /* ignore */ }
  return null;
}

/**
 * iOS 디바이스 연결 확인
 */
export async function isIOSDeviceConnected(udid: string): Promise<boolean> {
  try {
    const { stdout } = await execAsync(`idevice_id -l`, { timeout: 5000 });
    return stdout.includes(udid);
  } catch {
    return false;
  }
}

/**
 * iOS 디바이스가 USB 연결될 때까지 대기 (폴링)
 * 새 디바이스를 연결했을 때 인식까지 대기하는 용도
 * @returns 연결 성공 여부
 */
export async function waitForIOSDevice(
  udid: string,
  timeoutMs: number = 30000,
  pollIntervalMs: number = 2000,
): Promise<boolean> {
  const start = Date.now();
  let lastMethod = '';

  while (Date.now() - start < timeoutMs) {
    // 1차: idevice_id (libimobiledevice)
    try {
      const { stdout } = await execAsync(`idevice_id -l`, { timeout: 5000 });
      if (stdout.includes(udid)) {
        if (lastMethod !== 'idevice_id') console.log(`[iOS] 디바이스 감지됨 (idevice_id): ${udid}`);
        return true;
      }
    } catch { /* not found yet */ }

    // 2차: ioreg USB 확인 (libimobiledevice 없어도 동작)
    try {
      const { stdout } = await execAsync('ioreg -p IOUSB -l -w 0', { timeout: 5000 });
      if (stdout.includes(udid) || stdout.includes(udid.replace(/-/g, ''))) {
        if (lastMethod !== 'ioreg') console.log(`[iOS] 디바이스 USB 감지됨 (ioreg): ${udid}`);
        // USB는 보이지만 idevice_id에서 안 잡히면 lockdown 서비스 미준비 상태
        // 추가 대기 후 재확인
        await new Promise(r => setTimeout(r, 2000));
        try {
          const { stdout: recheck } = await execAsync(`idevice_id -l`, { timeout: 5000 });
          if (recheck.includes(udid)) return true;
        } catch {
          lastMethod = 'ioreg';
          console.log(`[iOS] USB 연결 확인, lockdown 서비스 대기 중...`);
        }
      }
    } catch { /* ioreg failed */ }

    await new Promise(r => setTimeout(r, pollIntervalMs));
  }

  return false;
}

/**
 * iOS 디바이스의 lockdown 서비스가 응답하는지 확인
 * 디바이스를 처음 연결하거나 "이 컴퓨터를 신뢰하시겠습니까?" 팝업을 수락해야 할 때
 * lockdown이 응답하지 않으면 Appium 세션 생성이 불가능
 */
export async function isDeviceLockdownReady(udid: string): Promise<boolean> {
  try {
    const { stdout } = await execAsync(`ideviceinfo -u ${udid} -k DeviceName`, { timeout: 5000 });
    return stdout.trim().length > 0;
  } catch {
    return false;
  }
}

/**
 * 디바이스 lockdown 서비스가 준비될 때까지 대기
 * "이 컴퓨터를 신뢰하시겠습니까?" 팝업 수락 대기용
 */
export async function waitForDeviceTrust(
  udid: string,
  timeoutMs: number = 60000,
  pollIntervalMs: number = 3000,
): Promise<boolean> {
  const start = Date.now();
  let logged = false;

  while (Date.now() - start < timeoutMs) {
    const ready = await isDeviceLockdownReady(udid);
    if (ready) {
      console.log(`[iOS] 디바이스 신뢰 확인 완료: ${udid}`);
      return true;
    }

    if (!logged) {
      console.log(`[iOS] 디바이스 lockdown 대기 중 — "이 컴퓨터를 신뢰하시겠습니까?" 팝업을 수락해주세요`);
      logged = true;
    }

    await new Promise(r => setTimeout(r, pollIntervalMs));
  }

  return false;
}

/**
 * iOS 디바이스 화면 캡처
 */
export async function captureIOSScreen(udid: string, outputPath: string): Promise<void> {
  await execAsync(`idevicescreenshot -u ${udid} ${outputPath}`);
}

/**
 * iOS 디바이스 로그 수집
 */
export async function getIOSLogs(udid: string, outputPath: string): Promise<void> {
  await execAsync(`idevicesyslog -u ${udid} > ${outputPath}`);
}
