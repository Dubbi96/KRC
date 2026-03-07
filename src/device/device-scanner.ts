/**
 * Device Scanner
 *
 * Detects connected iOS/Android devices and reports them.
 * Supports both physical devices and simulators/emulators.
 * Reuses patterns from Katab_Stack/packages/device-manager.
 */

import { execFileSync, execSync } from 'child_process';

export type DevicePlatform = 'ios' | 'android';

export interface DetectedDevice {
  id: string;            // UDID (iOS) or serial (Android)
  platform: DevicePlatform;
  name: string;
  model: string;
  version: string;       // OS version
  status: 'connected' | 'unauthorized' | 'offline';
  isSimulator?: boolean; // true for iOS Simulator / Android Emulator
}

/** Validate UDID/serial: only allow alphanumeric, dots, hyphens, underscores, colons */
const SAFE_DEVICE_ID = /^[a-zA-Z0-9._:/-]+$/;

function isValidDeviceId(id: string): boolean {
  return SAFE_DEVICE_ID.test(id) && id.length <= 128;
}

/**
 * Scan for all connected iOS + Android devices (physical + simulators/emulators).
 */
export function scanDevices(): DetectedDevice[] {
  const devices: DetectedDevice[] = [];
  devices.push(...scanIOSDevices());
  devices.push(...scanIOSSimulators());
  devices.push(...scanAndroidDevices());
  devices.push(...scanAndroidEmulators());
  return devices;
}

// ─── iOS ──────────────────────────────────────────

function scanIOSDevices(): DetectedDevice[] {
  const devices: DetectedDevice[] = [];

  // Strategy 1: idevice_id (libimobiledevice) — uses execFileSync (no shell)
  try {
    const output = execFileSync('idevice_id', ['-l'], {
      encoding: 'utf-8',
      timeout: 5000,
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
    if (output) {
      for (const udid of output.split('\n').filter(Boolean)) {
        if (!isValidDeviceId(udid)) continue; // skip invalid device IDs
        const info = getIOSDeviceInfo(udid);
        devices.push({
          id: udid,
          platform: 'ios',
          name: info.name || 'iOS Device',
          model: info.model || 'Unknown',
          version: info.version || 'Unknown',
          status: 'connected',
        });
      }
    }
    if (devices.length > 0) return devices;
  } catch {}

  // Strategy 2: system_profiler (macOS fallback) — no user input in command
  try {
    const output = execSync(
      'system_profiler SPUSBDataType 2>/dev/null | grep -A 10 "iPhone\\|iPad\\|iPod"',
      { encoding: 'utf-8', timeout: 10000 },
    );
    const blocks = output.split(/(?=iPhone|iPad|iPod)/);
    for (const block of blocks) {
      const nameMatch = block.match(/(iPhone|iPad|iPod)[^\n]*/);
      const serialMatch = block.match(/Serial Number:\s*([A-Fa-f0-9-]+)/);
      const versionMatch = block.match(/Version:\s*([\d.]+)/);
      if (serialMatch) {
        devices.push({
          id: serialMatch[1],
          platform: 'ios',
          name: nameMatch?.[0]?.trim() || 'iOS Device',
          model: nameMatch?.[0]?.trim() || 'Unknown',
          version: versionMatch?.[1] || 'Unknown',
          status: 'connected',
        });
      }
    }
  } catch {}

  return devices;
}

function getIOSDeviceInfo(udid: string): { name: string; model: string; version: string } {
  const info = { name: '', model: '', version: '' };
  if (!isValidDeviceId(udid)) return info;

  try {
    info.name = execFileSync('idevicename', ['-u', udid], {
      encoding: 'utf-8',
      timeout: 3000,
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
  } catch {}
  try {
    const raw = execFileSync('ideviceinfo', ['-u', udid, '-k', 'ProductType'], {
      encoding: 'utf-8',
      timeout: 3000,
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
    info.model = raw || 'Unknown';
  } catch {}
  try {
    info.version = execFileSync('ideviceinfo', ['-u', udid, '-k', 'ProductVersion'], {
      encoding: 'utf-8',
      timeout: 3000,
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
  } catch {}
  return info;
}

// ─── Android ──────────────────────────────────────

function scanAndroidDevices(): DetectedDevice[] {
  const devices: DetectedDevice[] = [];
  try {
    const output = execFileSync('adb', ['devices', '-l'], {
      encoding: 'utf-8',
      timeout: 5000,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const lines = output.split('\n').slice(1); // skip header
    for (const line of lines) {
      const match = line.match(/^(\S+)\s+(device|unauthorized|offline)\s*(.*)/);
      if (!match) continue;
      const [, serial, state, extra] = match;
      if (!isValidDeviceId(serial)) continue; // skip invalid serials

      // Skip emulator serials — handled by scanAndroidEmulators()
      if (/^emulator-\d+$/.test(serial)) continue;

      const modelMatch = extra.match(/model:(\S+)/);
      const deviceMatch = extra.match(/device:(\S+)/);

      let version = '';
      if (state === 'device') {
        try {
          version = execFileSync('adb', ['-s', serial, 'shell', 'getprop', 'ro.build.version.release'], {
            encoding: 'utf-8',
            timeout: 3000,
            stdio: ['pipe', 'pipe', 'pipe'],
          }).trim();
        } catch {}
      }

      devices.push({
        id: serial,
        platform: 'android',
        name: deviceMatch?.[1] || modelMatch?.[1] || serial,
        model: modelMatch?.[1] || 'Unknown',
        version,
        status: state as DetectedDevice['status'],
      });
    }
  } catch {}

  return devices;
}

// ─── iOS Simulators ──────────────────────────────

function scanIOSSimulators(): DetectedDevice[] {
  const devices: DetectedDevice[] = [];
  try {
    const output = execFileSync('xcrun', ['simctl', 'list', 'devices', 'available', '-j'], {
      encoding: 'utf-8',
      timeout: 10000,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const data = JSON.parse(output);
    const runtimes = data.devices || {};

    for (const [runtime, sims] of Object.entries(runtimes)) {
      // Extract OS version from runtime string like "com.apple.CoreSimulator.SimRuntime.iOS-18-0"
      const versionMatch = runtime.match(/iOS[- ](\d+[- ]\d+(?:[- ]\d+)?)/i);
      const version = versionMatch ? versionMatch[1].replace(/-/g, '.') : 'Unknown';

      for (const sim of sims as any[]) {
        if (!sim.udid || !sim.name) continue;

        // Only include booted simulators (running) — shutdown ones are not usable
        const isBooted = sim.state === 'Booted';
        if (!isBooted) continue;

        devices.push({
          id: sim.udid,
          platform: 'ios',
          name: `${sim.name} (Simulator)`,
          model: sim.name,
          version,
          status: 'connected',
          isSimulator: true,
        });
      }
    }
  } catch {}

  return devices;
}

// ─── Android Emulators ───────────────────────────

function scanAndroidEmulators(): DetectedDevice[] {
  const devices: DetectedDevice[] = [];
  try {
    const output = execFileSync('adb', ['devices', '-l'], {
      encoding: 'utf-8',
      timeout: 5000,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const lines = output.split('\n').slice(1); // skip header
    for (const line of lines) {
      const match = line.match(/^(emulator-\d+)\s+(device|unauthorized|offline)\s*(.*)/);
      if (!match) continue;
      const [, serial, state, extra] = match;

      const modelMatch = extra.match(/model:(\S+)/);
      const deviceMatch = extra.match(/device:(\S+)/);

      let version = '';
      let avdName = '';
      if (state === 'device') {
        try {
          version = execFileSync('adb', ['-s', serial, 'shell', 'getprop', 'ro.build.version.release'], {
            encoding: 'utf-8',
            timeout: 3000,
            stdio: ['pipe', 'pipe', 'pipe'],
          }).trim();
        } catch {}
        try {
          avdName = execFileSync('adb', ['-s', serial, 'emu', 'avd', 'name'], {
            encoding: 'utf-8',
            timeout: 3000,
            stdio: ['pipe', 'pipe', 'pipe'],
          }).trim().split('\n')[0];
        } catch {}
      }

      const name = avdName || deviceMatch?.[1] || modelMatch?.[1] || serial;
      devices.push({
        id: serial,
        platform: 'android',
        name: `${name} (Emulator)`,
        model: modelMatch?.[1] || avdName || 'Emulator',
        version,
        status: state as DetectedDevice['status'],
        isSimulator: true,
      });
    }
  } catch {}

  return devices;
}
