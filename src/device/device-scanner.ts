/**
 * Device Scanner
 *
 * Detects connected iOS/Android devices and reports them.
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
}

/** Validate UDID/serial: only allow alphanumeric, dots, hyphens, underscores, colons */
const SAFE_DEVICE_ID = /^[a-zA-Z0-9._:/-]+$/;

function isValidDeviceId(id: string): boolean {
  return SAFE_DEVICE_ID.test(id) && id.length <= 128;
}

/**
 * Scan for all connected iOS + Android physical devices.
 */
export function scanDevices(): DetectedDevice[] {
  const devices: DetectedDevice[] = [];
  devices.push(...scanIOSDevices());
  devices.push(...scanAndroidDevices());
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
