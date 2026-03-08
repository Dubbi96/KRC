/**
 * Cloud Tunnel Client
 *
 * Establishes a persistent WebSocket connection from KRC to KCD,
 * enabling KCD (cloud) to send commands to KRC (local/behind NAT).
 *
 * This is the reverse communication channel:
 *   - KRC connects TO KCD (outbound, always works behind NAT)
 *   - KCD sends commands through the tunnel (create session, close, actions)
 *   - KRC forwards session frames and events back through the tunnel
 *
 * Protocol:
 *   KRC → KCD:  { event: 'auth', data: { token } }
 *   KRC → KCD:  { event: 'response', data: { requestId, data?, error? } }
 *   KRC → KCD:  { event: 'frame', data: { sessionId, data: '<base64>' } }
 *   KRC → KCD:  { event: 'session-event', data: { sessionId, eventType, data } }
 *
 *   KCD → KRC:  { type: 'create-session', requestId, data: { platform, url, ... } }
 *   KCD → KRC:  { type: 'close-session', requestId, data: { sessionId } }
 *   KCD → KRC:  { type: 'action', data: { sessionId, action: {...} } }
 *   KCD → KRC:  { type: 'record-start', data: { sessionId } }
 *   KCD → KRC:  { type: 'record-stop', data: { sessionId } }
 */

import WebSocket from 'ws';
import { SessionManager, AnySession } from '../device/session-manager';

export class CloudTunnel {
  private ws: WebSocket | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private authenticated = false;
  private closing = false;
  /** KRC sessionId → cleanup function (remove event listeners) */
  private sessionCleanup = new Map<string, () => void>();

  constructor(
    private tunnelUrl: string,
    private token: string,
    private sessionManager: SessionManager,
  ) {}

  connect() {
    if (this.closing) return;

    try {
      this.ws = new WebSocket(this.tunnelUrl);
    } catch (err: any) {
      console.error(`[Tunnel] Failed to create WebSocket: ${err.message}`);
      this.scheduleReconnect();
      return;
    }

    this.ws.on('open', () => {
      console.log('[Tunnel] Connected to KCD, authenticating...');
      this.send({ event: 'auth', data: { token: this.token } });
    });

    this.ws.on('message', (raw: Buffer) => {
      try {
        const msg = JSON.parse(raw.toString());
        this.handleMessage(msg);
      } catch (err: any) {
        console.warn(`[Tunnel] Failed to parse message: ${err.message}`);
      }
    });

    this.ws.on('close', (code: number, reason: Buffer) => {
      const reasonStr = reason?.toString() || '';
      console.log(`[Tunnel] Disconnected (code=${code} reason=${reasonStr})`);
      this.authenticated = false;
      this.scheduleReconnect();
    });

    this.ws.on('error', (err: any) => {
      // Don't log ECONNREFUSED spam when KCD is down
      if (err.code !== 'ECONNREFUSED') {
        console.error(`[Tunnel] WebSocket error: ${err.message}`);
      }
    });
  }

  private scheduleReconnect() {
    if (this.closing) return;
    if (this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      console.log('[Tunnel] Reconnecting...');
      this.connect();
    }, 5_000);
  }

  private handleMessage(msg: any) {
    // Auth response from KCD
    if (msg.type === 'auth_ok') {
      this.authenticated = true;
      console.log(`[Tunnel] Authenticated as runner ${msg.data?.runnerId}`);
      return;
    }
    if (msg.type === 'auth_error') {
      console.error(`[Tunnel] Auth failed: ${msg.data}`);
      return;
    }

    // Commands from KCD
    switch (msg.type) {
      case 'create-session':
        this.handleCreateSession(msg);
        break;
      case 'close-session':
        this.handleCloseSession(msg);
        break;
      case 'action':
        this.handleAction(msg);
        break;
      case 'record-start':
        this.handleRecordStart(msg);
        break;
      case 'record-stop':
        this.handleRecordStop(msg);
        break;
      case 'switch-page':
        this.handleSwitchPage(msg);
        break;
      default:
        // Ignore unknown types (could be new protocol extensions)
        break;
    }
  }

  private async handleCreateSession(msg: { requestId: string; data: any }) {
    try {
      const opts = msg.data;
      console.log(`[Tunnel] Creating ${opts.platform} session (requestId=${msg.requestId})`);

      const session = await this.sessionManager.createSession({
        platform: opts.platform,
        deviceId: opts.deviceId,
        bundleId: opts.bundleId,
        appPackage: opts.appPackage,
        appActivity: opts.appActivity,
        url: opts.url,
        fps: opts.fps || 2,
      });

      // Subscribe to session events and forward through tunnel
      this.attachSessionForwarding(session);

      // Send initial session info
      this.send({
        event: 'session-event',
        data: {
          sessionId: session.id,
          eventType: 'info',
          data: session.getInfo(),
        },
      });

      // Response with session details
      this.send({
        event: 'response',
        data: {
          requestId: msg.requestId,
          data: session.getInfo(),
        },
      });

      console.log(`[Tunnel] Session created: ${session.id} (${opts.platform})`);
    } catch (err: any) {
      console.error(`[Tunnel] Session creation failed: ${err.message}`);
      this.send({
        event: 'response',
        data: {
          requestId: msg.requestId,
          error: err.message,
        },
      });
    }
  }

  private async handleCloseSession(msg: { requestId: string; data: { sessionId: string } }) {
    try {
      const { sessionId } = msg.data;
      console.log(`[Tunnel] Closing session ${sessionId}`);

      // Remove event forwarding
      const cleanup = this.sessionCleanup.get(sessionId);
      if (cleanup) {
        cleanup();
        this.sessionCleanup.delete(sessionId);
      }

      await this.sessionManager.closeSession(sessionId);

      this.send({
        event: 'response',
        data: { requestId: msg.requestId, data: { ok: true } },
      });
    } catch (err: any) {
      this.send({
        event: 'response',
        data: { requestId: msg.requestId, error: err.message },
      });
    }
  }

  private async handleAction(msg: { data: { sessionId: string; action: any } }) {
    try {
      await this.sessionManager.handleAction(msg.data.sessionId, msg.data.action);
    } catch (err: any) {
      console.warn(`[Tunnel] Action failed for session ${msg.data.sessionId}: ${err.message}`);
    }
  }

  private handleRecordStart(msg: { data: { sessionId: string } }) {
    try {
      this.sessionManager.startRecording(msg.data.sessionId);
    } catch (err: any) {
      console.warn(`[Tunnel] Record start failed: ${err.message}`);
    }
  }

  private handleRecordStop(msg: { data: { sessionId: string } }) {
    try {
      const events = this.sessionManager.stopRecording(msg.data.sessionId);
      // Send recorded events back
      this.send({
        event: 'session-event',
        data: {
          sessionId: msg.data.sessionId,
          eventType: 'recorded_events',
          data: events,
        },
      });
    } catch (err: any) {
      console.warn(`[Tunnel] Record stop failed: ${err.message}`);
    }
  }

  private handleSwitchPage(msg: { data: { sessionId: string; pageId: string } }) {
    try {
      const session = this.sessionManager.getSession(msg.data.sessionId);
      if (session && typeof (session as any).switchPage === 'function') {
        (session as any).switchPage(msg.data.pageId);
      }
    } catch (err: any) {
      console.warn(`[Tunnel] Switch page failed: ${err.message}`);
    }
  }

  /**
   * Subscribe to all events on a session and forward through the tunnel.
   */
  private attachSessionForwarding(session: AnySession) {
    const sessionId = session.id;

    const onFrame = (base64: string) => {
      this.send({
        event: 'frame',
        data: { sessionId, data: base64 },
      });
    };

    const onStatus = (status: string) => {
      this.send({
        event: 'session-event',
        data: { sessionId, eventType: 'status', data: status },
      });
    };

    const onError = (error: string) => {
      this.send({
        event: 'session-event',
        data: { sessionId, eventType: 'error', data: error },
      });
    };

    const onPages = (pages: any[]) => {
      this.send({
        event: 'session-event',
        data: { sessionId, eventType: 'pages', data: pages },
      });
    };

    session.on('frame', onFrame);
    session.on('status', onStatus);
    session.on('error', onError);
    session.on('pages', onPages);

    this.sessionCleanup.set(sessionId, () => {
      session.off('frame', onFrame);
      session.off('status', onStatus);
      session.off('error', onError);
      session.off('pages', onPages);
    });
  }

  private send(msg: any) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }

  close() {
    this.closing = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    // Clean up all session forwardings
    for (const cleanup of this.sessionCleanup.values()) {
      cleanup();
    }
    this.sessionCleanup.clear();
    this.ws?.close();
    this.ws = null;
  }
}
