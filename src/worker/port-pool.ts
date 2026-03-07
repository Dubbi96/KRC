/**
 * Port Pool for parallel Appium sessions.
 *
 * Each mobile device session needs unique ports to avoid conflicts:
 * - wdaLocalPort (iOS): WDA USB forwarding port
 * - systemPort (Android): UiAutomator2 internal port
 * - mjpegServerPort: MJPEG visual stream port
 * - chromedriverPort (Android): Chrome automation port
 */

export interface SessionPorts {
  wdaLocalPort: number;
  systemPort: number;
  mjpegServerPort: number;
  chromedriverPort: number;
  derivedDataPath: string;
}

class PortRange {
  private allocated = new Set<number>();

  constructor(
    private basePort: number,
    private maxPorts: number = 100,
  ) {}

  allocate(): number {
    for (let offset = 0; offset < this.maxPorts; offset++) {
      const port = this.basePort + offset;
      if (!this.allocated.has(port)) {
        this.allocated.add(port);
        return port;
      }
    }
    throw new Error(`No ports available in range ${this.basePort}-${this.basePort + this.maxPorts - 1}`);
  }

  release(port: number): void {
    this.allocated.delete(port);
  }
}

export class PortPool {
  private wdaPorts = new PortRange(8100, 100);       // 8100-8199
  private systemPorts = new PortRange(8200, 100);     // 8200-8299
  private mjpegPorts = new PortRange(8300, 100);      // 8300-8399
  private chromedriverPorts = new PortRange(8400, 100); // 8400-8499
  private devicePorts = new Map<string, SessionPorts>();

  /**
   * Allocate a set of ports for a device session.
   * Ports are keyed by deviceId to allow release on disconnect.
   */
  allocate(deviceId: string): SessionPorts {
    // If already allocated, return existing
    const existing = this.devicePorts.get(deviceId);
    if (existing) return existing;

    const ports: SessionPorts = {
      wdaLocalPort: this.wdaPorts.allocate(),
      systemPort: this.systemPorts.allocate(),
      mjpegServerPort: this.mjpegPorts.allocate(),
      chromedriverPort: this.chromedriverPorts.allocate(),
      derivedDataPath: `/tmp/katab-wda-${deviceId.replace(/[^a-zA-Z0-9]/g, '_')}`,
    };

    this.devicePorts.set(deviceId, ports);
    return ports;
  }

  /**
   * Release all ports allocated for a device.
   */
  release(deviceId: string): void {
    const ports = this.devicePorts.get(deviceId);
    if (!ports) return;

    this.wdaPorts.release(ports.wdaLocalPort);
    this.systemPorts.release(ports.systemPort);
    this.mjpegPorts.release(ports.mjpegServerPort);
    this.chromedriverPorts.release(ports.chromedriverPort);
    this.devicePorts.delete(deviceId);
  }

  /**
   * Get allocated ports for a device (if any).
   */
  get(deviceId: string): SessionPorts | undefined {
    return this.devicePorts.get(deviceId);
  }
}

/** Singleton port pool shared across KRC */
export const portPool = new PortPool();
