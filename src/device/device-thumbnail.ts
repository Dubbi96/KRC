/**
 * Device Thumbnail — Native screenshots WITHOUT Appium sessions.
 *
 * Takes one-shot screenshots using platform-native tools:
 *   iOS:     pymobiledevice3 (preferred) → idevicescreenshot (fallback)
 *   Android: adb exec-out screencap -p
 *
 * These are lightweight, non-blocking, and don't consume the device
 * (no Appium session created). Used by Runner dashboard for monitoring.
 *
 * Note: iOS screenshots require the CoreDevice tunnel to be running
 * (sudo pymobiledevice3 remote start-tunnel).
 */

import { execSync, execFileSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

const SAFE_DEVICE_ID = /^[a-zA-Z0-9._:/-]+$/;

const THUMBNAIL_DIR = path.join(os.tmpdir(), 'katab-thumbnails');

// Ensure dir exists
if (!fs.existsSync(THUMBNAIL_DIR)) {
  fs.mkdirSync(THUMBNAIL_DIR, { recursive: true });
}

export interface ThumbnailResult {
  ok: boolean;
  /** Base64-encoded PNG (or TIFF for iOS fallback) */
  base64?: string;
  mimeType?: string;
  /** When this screenshot was taken */
  capturedAt?: string;
  /** Which tool captured the screenshot */
  source?: string;
  error?: string;
}

/**
 * Capture a screenshot from a device using native CLI tools.
 * Does NOT require an Appium session.
 */
export function captureDeviceThumbnail(
  deviceId: string,
  platform: 'ios' | 'android',
): ThumbnailResult {
  if (platform === 'ios') {
    return captureIOSThumbnail(deviceId);
  } else if (platform === 'android') {
    return captureAndroidThumbnail(deviceId);
  }
  return { ok: false, error: `Unsupported platform: ${platform}` };
}

// ─── iOS ──────────────────────────────────────────

function captureIOSThumbnail(udid: string): ThumbnailResult {
  if (!SAFE_DEVICE_ID.test(udid)) {
    return { ok: false, error: 'Invalid device ID' };
  }

  const pngFile = path.join(THUMBNAIL_DIR, `${udid}.png`);

  // Strategy 1: pymobiledevice3 dvt screenshot (iOS 17+, uses CoreDevice tunnel)
  try {
    execFileSync('pymobiledevice3', ['developer', 'dvt', 'screenshot', pngFile, '--udid', udid], {
      timeout: 15_000,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    if (fs.existsSync(pngFile) && fs.statSync(pngFile).size > 0) {
      const buf = fs.readFileSync(pngFile);
      fs.unlinkSync(pngFile);
      return {
        ok: true,
        base64: buf.toString('base64'),
        mimeType: 'image/png',
        source: 'pymobiledevice3',
        capturedAt: new Date().toISOString(),
      };
    }
  } catch {}

  // Strategy 2: idevicescreenshot (libimobiledevice — needs developer disk mounted)
  const tiffFile = path.join(THUMBNAIL_DIR, `${udid}.tiff`);
  try {
    execFileSync('idevicescreenshot', ['-u', udid, tiffFile], {
      timeout: 10_000,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    if (fs.existsSync(tiffFile) && fs.statSync(tiffFile).size > 0) {
      const buf = fs.readFileSync(tiffFile);
      fs.unlinkSync(tiffFile);
      return {
        ok: true,
        base64: buf.toString('base64'),
        mimeType: 'image/tiff',
        source: 'idevicescreenshot',
        capturedAt: new Date().toISOString(),
      };
    }
  } catch {}

  return {
    ok: false,
    error: 'iOS screenshot failed. Ensure CoreDevice tunnel is running (sudo pymobiledevice3 remote start-tunnel).',
  };
}

// ─── Android ──────────────────────────────────────

function captureAndroidThumbnail(serial: string): ThumbnailResult {
  if (!SAFE_DEVICE_ID.test(serial)) {
    return { ok: false, error: 'Invalid device serial' };
  }

  try {
    // adb screencap outputs PNG to stdout
    const buf = execFileSync('adb', ['-s', serial, 'exec-out', 'screencap', '-p'], {
      timeout: 10_000,
      maxBuffer: 20 * 1024 * 1024, // 20MB — high-res screens
    });
    if (buf.length > 0) {
      return {
        ok: true,
        base64: buf.toString('base64'),
        mimeType: 'image/png',
        source: 'adb',
        capturedAt: new Date().toISOString(),
      };
    }
  } catch {}

  return {
    ok: false,
    error: 'Failed to capture Android screenshot. Ensure adb is available and device is authorized.',
  };
}

/**
 * Capture a screenshot from an active Appium session (if one exists).
 * This piggybacks on an existing session — used when Cloud has borrowed the device.
 */
export async function captureSessionScreenshot(
  appiumSessionId: string,
  appiumPort: number = 4723,
): Promise<ThumbnailResult> {
  try {
    const res = await fetch(
      `http://localhost:${appiumPort}/session/${appiumSessionId}/screenshot`,
      { signal: AbortSignal.timeout(10_000) },
    );
    if (!res.ok) return { ok: false, error: `Appium returned ${res.status}` };
    const data: any = await res.json();
    if (data?.value) {
      return {
        ok: true,
        base64: data.value,
        mimeType: 'image/png',
        source: 'appium-session',
        capturedAt: new Date().toISOString(),
      };
    }
    return { ok: false, error: 'No screenshot data from Appium' };
  } catch (err: any) {
    return { ok: false, error: err.message };
  }
}
