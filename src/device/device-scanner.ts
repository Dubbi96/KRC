/**
 * Device Scanner
 *
 * Detects connected iOS/Android devices and reports them.
 * Supports both physical devices and simulators/emulators.
 * Reuses patterns from Katab_Stack/packages/device-manager.
 */

import { execFileSync, execSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

export type DevicePlatform = 'ios' | 'android';

export interface DetectedDevice {
  id: string;            // UDID (iOS) or serial (Android)
  platform: DevicePlatform;
  name: string;
  model: string;
  version: string;       // OS version
  status: 'connected' | 'unauthorized' | 'offline';
  isSimulator?: boolean; // true for iOS Simulator / Android Emulator
  /** iOS transport: 'wired' (USB) | 'localNetwork' (Wi-Fi) | undefined */
  transportType?: string;
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

  // Build set of UDIDs reachable via xctrace (online devices only)
  const onlineUdids = new Set<string>();
  try {
    const xctOutput = execFileSync('xcrun', ['xctrace', 'list', 'devices'], {
      encoding: 'utf-8',
      timeout: 10000,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    // Parse: "iPhone (26.3.1) (00008101-...)" — only lines before "== Devices Offline =="
    let inOffline = false;
    for (const line of xctOutput.split('\n')) {
      if (line.includes('Devices Offline') || line.includes('Simulators')) { inOffline = true; continue; }
      if (line.startsWith('== Devices ==')) { inOffline = false; continue; }
      if (inOffline) continue;
      const m = line.match(/\(([A-Fa-f0-9-]{20,})\)\s*$/);
      if (m) onlineUdids.add(m[1]);
    }
  } catch {}

  // Strategy 1: xcrun devicectl (CoreDevice — best for modern macOS/iOS 17+)
  try {
    const tmpFile = path.join(os.tmpdir(), `katab-devicectl-${process.pid}.json`);
    execFileSync('xcrun', ['devicectl', 'list', 'devices', '--json-output', tmpFile], {
      encoding: 'utf-8',
      timeout: 10000,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const raw = fs.readFileSync(tmpFile, 'utf-8');
    fs.unlinkSync(tmpFile);
    const data = JSON.parse(raw);

    for (const d of data.result?.devices || []) {
      const hw = d.hardwareProperties || {};
      const dp = d.deviceProperties || {};
      const cp = d.connectionProperties || {};

      // Skip non-iOS (watchOS, tvOS, etc.) and virtual devices
      if (hw.platform !== 'iOS') continue;
      if (hw.reality !== 'physical') continue;

      // Use hardware UDID (the one Appium/xctrace uses)
      const udid = hw.udid || d.identifier;
      if (!udid || !isValidDeviceId(udid)) continue;

      // Cross-check: device must be in xctrace online list to be usable.
      // Wi-Fi-only paired devices (not in xctrace) are not usable for Appium.
      const isOnline = onlineUdids.has(udid);
      if (!isOnline) continue;

      // Check transport type — Wi-Fi-only devices can't be used by Appium
      // without an active CoreDevice tunnel.
      const transport = cp.transportType as string | undefined; // 'wired' | 'localNetwork'
      const tunnelState = cp.tunnelState as string | undefined; // 'connected' | 'disconnected'
      if (transport === 'localNetwork' && tunnelState !== 'connected') {
        console.log(`[scanner] Skipping Wi-Fi-only device ${dp.name || udid} — USB cable required for Appium. (transport=${transport}, tunnel=${tunnelState})`);
        continue;
      }

      devices.push({
        id: udid,
        platform: 'ios',
        name: dp.name || hw.marketingName || 'iOS Device',
        model: hw.marketingName || hw.productType || 'Unknown',
        version: dp.osVersionNumber || 'Unknown',
        status: 'connected',
        transportType: transport,
      });
    }
    if (devices.length > 0) return devices;
  } catch {}

  // Strategy 2: idevice_id (libimobiledevice) — fallback for older macOS
  try {
    const output = execFileSync('idevice_id', ['-l'], {
      encoding: 'utf-8',
      timeout: 5000,
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
    if (output) {
      for (const udid of output.split('\n').filter(Boolean)) {
        if (!isValidDeviceId(udid)) continue;
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

  // Strategy 3: system_profiler (macOS USB fallback)
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

      // Map ADB state: 'device' → 'connected' (matches DetectedDevice interface)
      const statusMap: Record<string, DetectedDevice['status']> = {
        device: 'connected',
        unauthorized: 'unauthorized',
        offline: 'offline',
      };

      devices.push({
        id: serial,
        platform: 'android',
        name: deviceMatch?.[1] || modelMatch?.[1] || serial,
        model: modelMatch?.[1] || 'Unknown',
        version,
        status: statusMap[state] || 'offline',
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

      // Map ADB state: 'device' → 'connected' (matches DetectedDevice interface)
      const statusMap: Record<string, DetectedDevice['status']> = {
        device: 'connected',
        unauthorized: 'unauthorized',
        offline: 'offline',
      };

      const name = avdName || deviceMatch?.[1] || modelMatch?.[1] || serial;
      devices.push({
        id: serial,
        platform: 'android',
        name: `${name} (Emulator)`,
        model: modelMatch?.[1] || avdName || 'Emulator',
        version,
        status: statusMap[state] || 'offline',
        isSimulator: true,
      });
    }
  } catch {}

  return devices;
}
