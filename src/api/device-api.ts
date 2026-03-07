/**
 * Device API routes for the Local Runner.
 *
 * Device lifecycle:
 *   GET  /devices                — list all detected devices (physical scan)
 *   POST /devices/rescan         — force rescan
 *   GET  /devices/connected      — list registered/connected devices (available pool)
 *   POST /devices/:id/connect    — register device → tunnel (iOS) → available
 *   POST /devices/:id/disconnect — remove device from available pool
 *   GET  /devices/:id/thumbnail  — native screenshot (no Appium session needed)
 *   GET  /devices/:id/active-session — check if device is borrowed / has active session
 *
 * Session lifecycle (called by Cloud on borrow/return):
 *   GET  /sessions               — list active sessions
 *   POST /sessions               — create mirror session (borrow)
 *   GET  /sessions/:id           — session info
 *   DELETE /sessions/:id         — close session (return)
 *   POST /sessions/:id/action    — send user action
 *   POST /sessions/:id/record/start  — start recording
 *   POST /sessions/:id/record/stop   — stop & get events
 *
 * WebSocket:
 *   /sessions/:id/stream — real-time screenshot frames
 */

import { Router } from 'express';
import { SessionManager } from '../device/session-manager';
import { captureDeviceThumbnail } from '../device/device-thumbnail';
import { WebRTCSession } from '../device/webrtc-session';

export function createDeviceRouter(sessionManager: SessionManager): Router {
  const router = Router();

  // ─── Device Discovery ─────────────────────────────

  // List ALL physically detected devices (connected + unregistered)
  router.get('/devices', (_req, res) => {
    const detected = sessionManager.getDetectedDevices();
    const connectedIds = new Set(
      sessionManager.getConnectedDevices().map((d) => d.id),
    );

    // Annotate each device with registration status + active session info
    const result = detected.map((d) => {
      const activeSession = sessionManager.getSessionByDeviceId(d.id);
      const sessionInfo = activeSession ? activeSession.getInfo() : null;
      return {
        ...d,
        registered: connectedIds.has(d.id),
        borrowed: !!sessionInfo,
        activeSession: sessionInfo ? {
          id: sessionInfo.id,
          status: sessionInfo.status,
          recording: sessionInfo.recording,
          createdAt: sessionInfo.createdAt,
        } : null,
      };
    });

    res.json(result);
  });

  // Force hardware rescan
  router.post('/devices/rescan', (_req, res) => {
    const devices = sessionManager.rescanDevices();
    res.json(devices);
  });

  // List only connected/registered devices (the available pool)
  router.get('/devices/connected', (_req, res) => {
    res.json(sessionManager.getConnectedDevices());
  });

  // ─── Device Registration ──────────────────────────

  // Connect/register a device (makes it available for borrowing)
  router.post('/devices/:id/connect', async (req, res) => {
    try {
      const device = await sessionManager.connectDevice(req.params.id);
      res.json({ ok: true, device });
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  // Disconnect a device (removes from available pool)
  router.post('/devices/:id/disconnect', (req, res) => {
    try {
      sessionManager.disconnectDevice(req.params.id);
      res.json({ ok: true });
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  // ─── Device Monitoring (No Appium session needed) ──

  /**
   * Take a native screenshot of a device for thumbnail display.
   * Uses idevicescreenshot (iOS) or adb screencap (Android).
   * Does NOT create or require an Appium session — device stays available.
   */
  router.get('/devices/:id/thumbnail', (req, res) => {
    const deviceId = req.params.id;

    // Find the device to know its platform
    const detected = sessionManager.getDetectedDevices();
    const device = detected.find((d) => d.id === deviceId);
    if (!device) {
      return res.status(404).json({ error: 'Device not found' });
    }

    // If there's an active session on this device, prefer session screenshot
    // (higher quality, already has Appium running)
    const activeSession = sessionManager.getSessionByDeviceId(deviceId);
    if (activeSession) {
      const info = activeSession.getInfo();
      return res.json({
        ok: true,
        source: 'session',
        sessionId: info.id,
        status: info.status,
        capturedAt: new Date().toISOString(),
        message: 'Device has active session — use WebSocket /sessions/:id/stream for live frames',
      });
    }

    // No active session — use native screenshot tool
    const result = captureDeviceThumbnail(deviceId, device.platform);
    if (result.ok) {
      res.json(result);
    } else {
      res.status(503).json(result);
    }
  });

  /**
   * Check if a device has an active session (e.g., borrowed by Cloud).
   * Returns session info if active, null if device is idle.
   * Used by Runner dashboard to show device status and provide kill option.
   */
  router.get('/devices/:id/active-session', (req, res) => {
    const session = sessionManager.getSessionByDeviceId(req.params.id);
    if (!session) {
      return res.json({ active: false, session: null });
    }
    res.json({ active: true, session: session.getInfo() });
  });

  // ─── Sessions (Borrow/Return — called by Cloud) ───

  // List active sessions
  router.get('/sessions', (_req, res) => {
    res.json(sessionManager.listSessions());
  });

  // Create mirror/web session (borrow device)
  router.post('/sessions', async (req, res) => {
    try {
      const { platform, deviceId, bundleId, appPackage, appActivity, url, fps } = req.body;
      if (!platform) return res.status(400).json({ error: 'platform is required' });
      if (platform === 'web' && !url) return res.status(400).json({ error: 'url is required for web sessions' });

      const session = await sessionManager.createSession({
        platform,
        deviceId,
        bundleId,
        appPackage,
        appActivity,
        url,
        fps: fps || 2,
      });

      res.json(session.getInfo());
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  // Get session info
  router.get('/sessions/:id', (req, res) => {
    const session = sessionManager.getSession(req.params.id);
    if (!session) return res.status(404).json({ error: 'Session not found' });
    res.json(session.getInfo());
  });

  // Close session (return device)
  router.delete('/sessions/:id', async (req, res) => {
    try {
      await sessionManager.closeSession(req.params.id);
      res.json({ ok: true });
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  // Send user action
  router.post('/sessions/:id/action', async (req, res) => {
    try {
      await sessionManager.handleAction(req.params.id, req.body);
      res.json({ ok: true });
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  // Start recording
  router.post('/sessions/:id/record/start', (req, res) => {
    try {
      sessionManager.startRecording(req.params.id);
      res.json({ ok: true, recording: true });
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  // Stop recording & return events
  router.post('/sessions/:id/record/stop', (req, res) => {
    try {
      const events = sessionManager.stopRecording(req.params.id);
      res.json({ ok: true, events, count: events.length });
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  // Screenshot (single frame, for polling fallback)
  router.get('/sessions/:id/screenshot', async (req, res) => {
    const session = sessionManager.getSession(req.params.id);
    if (!session) return res.status(404).json({ error: 'Session not found' });
    const info = session.getInfo();
    if (info.status !== 'active' && info.status !== 'recording') {
      return res.status(400).json({ error: `Session is ${info.status}` });
    }
    res.json({ sessionId: info.id, status: info.status, message: 'Use WebSocket /sessions/:id/stream for real-time frames' });
  });

  return router;
}

/**
 * Attach WebSocket upgrade handler for session streaming.
 * Call this with the HTTP server instance.
 *
 * Supports two transport modes:
 *   1. WebSocket relay (legacy) — frames sent as JSON { type: 'frame', data: '<base64>' }
 *   2. WebRTC DataChannel (P2P) — frames sent directly via RTCDataChannel
 *      WebSocket is used only for signaling (SDP offer/answer, ICE candidates)
 *
 * The client negotiates WebRTC by sending { type: 'webrtc_request' }.
 * If WebRTC is unavailable (wrtc not installed), falls back to WebSocket.
 */
export function attachWebSocketStreaming(server: any, sessionManager: SessionManager) {
  let WebSocket: any;
  try {
    WebSocket = require('ws');
  } catch {
    console.log('[device-api] ws package not installed, WebSocket streaming disabled. Install with: npm install ws');
    return;
  }

  const wss = new WebSocket.Server({ noServer: true });

  /** Parse ICE server config from environment */
  const customIceServers = parseIceServersFromEnv();

  server.on('upgrade', (request: any, socket: any, head: any) => {
    const url = new URL(request.url, `http://${request.headers.host}`);
    const match = url.pathname.match(/^\/sessions\/([^/]+)\/stream$/);
    if (!match) {
      socket.destroy();
      return;
    }

    const sessionId = match[1];
    const session = sessionManager.getSession(sessionId);
    if (!session) {
      socket.destroy();
      return;
    }

    wss.handleUpgrade(request, socket, head, (ws: any) => {
      console.log(`[ws] Client connected to session ${sessionId}`);

      // Track WebRTC session for this client
      let webrtcSession: WebRTCSession | null = null;
      /** Whether frames are being sent via WebRTC DataChannel */
      let webrtcActive = false;

      // Send session info immediately
      ws.send(JSON.stringify({ type: 'info', data: session.getInfo() }));

      // Notify client whether WebRTC is available
      ws.send(JSON.stringify({
        type: 'webrtc_available',
        data: {
          available: WebRTCSession.isAvailable(),
          iceServers: customIceServers.length > 0
            ? customIceServers
            : [
                { urls: 'stun:stun.l.google.com:19302' },
                { urls: 'stun:stun1.l.google.com:19302' },
              ],
        },
      }));

      // Forward frames (only via WebSocket if WebRTC is not active)
      const onFrame = (base64: string) => {
        // If WebRTC DataChannel is active, send via DataChannel
        if (webrtcActive && webrtcSession) {
          // Apply backpressure: skip frame if buffer is getting full (>256KB)
          if (webrtcSession.getBufferedAmount() > 256 * 1024) {
            return; // Drop frame — client will get the next one
          }
          const sent = webrtcSession.sendFrame(base64);
          if (sent) return; // Frame sent via WebRTC, skip WebSocket
          // DataChannel send failed — fall through to WebSocket
        }

        // Fallback: send via WebSocket
        if (ws.readyState === 1) {
          ws.send(JSON.stringify({ type: 'frame', data: base64 }));
        }
      };

      const onStatus = (status: string) => {
        if (ws.readyState === 1) {
          ws.send(JSON.stringify({ type: 'status', data: status }));
        }
      };

      const onError = (error: string) => {
        if (ws.readyState === 1) {
          ws.send(JSON.stringify({ type: 'error', data: error }));
        }
      };

      session.on('frame', onFrame);
      session.on('status', onStatus);
      session.on('error', onError);

      // Forward page list updates
      const onPages = (pageList: any[]) => {
        if (ws.readyState === 1) {
          ws.send(JSON.stringify({ type: 'pages', data: pageList }));
        }
      };
      session.on('pages', onPages);

      // Receive messages from client
      ws.on('message', async (data: any) => {
        try {
          const msg = JSON.parse(data.toString());

          switch (msg.type) {
            // ── Legacy actions ──────────────────────────────
            case 'action':
              await session.handleAction(msg.data);
              break;

            case 'record_start':
              session.startRecording();
              break;

            case 'record_stop': {
              const events = session.stopRecording();
              ws.send(JSON.stringify({ type: 'recorded_events', data: events }));
              break;
            }

            case 'switch_page':
              if (typeof (session as any).switchPage === 'function') {
                (session as any).switchPage(msg.data?.pageId);
              }
              break;

            // ── WebRTC signaling ────────────────────────────
            case 'webrtc_request': {
              // Client requests WebRTC upgrade
              if (!WebRTCSession.isAvailable()) {
                ws.send(JSON.stringify({
                  type: 'webrtc_error',
                  data: 'WebRTC not available on this runner (wrtc package not installed)',
                }));
                break;
              }

              try {
                // Clean up any existing WebRTC session
                if (webrtcSession) {
                  webrtcSession.close();
                }

                webrtcSession = new WebRTCSession(sessionId, {
                  iceServers: customIceServers.length > 0 ? customIceServers : undefined,
                });

                // Forward ICE candidates to client via WebSocket signaling
                webrtcSession.on('ice_candidate', (candidate: any) => {
                  if (ws.readyState === 1) {
                    ws.send(JSON.stringify({ type: 'ice_candidate', data: candidate }));
                  }
                });

                // Track DataChannel state for frame routing
                webrtcSession.on('datachannel_open', () => {
                  webrtcActive = true;
                  console.log(`[ws] WebRTC DataChannel active for session ${sessionId} — frames will use P2P`);
                  if (ws.readyState === 1) {
                    ws.send(JSON.stringify({ type: 'webrtc_active', data: true }));
                  }
                });

                webrtcSession.on('datachannel_close', () => {
                  webrtcActive = false;
                  console.log(`[ws] WebRTC DataChannel closed for session ${sessionId} — falling back to WebSocket`);
                  if (ws.readyState === 1) {
                    ws.send(JSON.stringify({ type: 'webrtc_active', data: false }));
                  }
                });

                // Handle control messages from browser via DataChannel
                webrtcSession.on('control_message', async (controlMsg: any) => {
                  try {
                    if (controlMsg.type === 'action') {
                      await session.handleAction(controlMsg.data);
                    } else if (controlMsg.type === 'record_start') {
                      session.startRecording();
                    } else if (controlMsg.type === 'record_stop') {
                      const events = session.stopRecording();
                      // Send recorded events back via WebSocket (too large for DataChannel)
                      if (ws.readyState === 1) {
                        ws.send(JSON.stringify({ type: 'recorded_events', data: events }));
                      }
                    }
                  } catch (err: any) {
                    if (ws.readyState === 1) {
                      ws.send(JSON.stringify({ type: 'error', data: err.message }));
                    }
                  }
                });

                webrtcSession.on('state', (state: string) => {
                  if (ws.readyState === 1) {
                    ws.send(JSON.stringify({ type: 'webrtc_state', data: state }));
                  }
                });

                // Create offer and send to client
                const offer = await webrtcSession.createOffer();
                ws.send(JSON.stringify({ type: 'sdp_offer', data: offer }));

              } catch (err: any) {
                console.error(`[ws] WebRTC offer creation failed: ${err.message}`);
                ws.send(JSON.stringify({
                  type: 'webrtc_error',
                  data: `Failed to create WebRTC offer: ${err.message}`,
                }));
              }
              break;
            }

            case 'sdp_answer': {
              // Client sends SDP answer
              if (!webrtcSession) {
                ws.send(JSON.stringify({
                  type: 'webrtc_error',
                  data: 'No WebRTC session active. Send webrtc_request first.',
                }));
                break;
              }
              try {
                await webrtcSession.handleAnswer(msg.data);
              } catch (err: any) {
                ws.send(JSON.stringify({
                  type: 'webrtc_error',
                  data: `Failed to handle SDP answer: ${err.message}`,
                }));
              }
              break;
            }

            case 'ice_candidate': {
              // Client sends ICE candidate
              if (!webrtcSession) break;
              try {
                await webrtcSession.addIceCandidate(msg.data);
              } catch (err: any) {
                console.warn(`[ws] Failed to add ICE candidate: ${err.message}`);
              }
              break;
            }

            default:
              // Unknown message type — ignore
              break;
          }
        } catch (err: any) {
          if (ws.readyState === 1) {
            ws.send(JSON.stringify({ type: 'error', data: err.message }));
          }
        }
      });

      ws.on('close', () => {
        console.log(`[ws] Client disconnected from session ${sessionId}`);
        session.off('frame', onFrame);
        session.off('status', onStatus);
        session.off('error', onError);
        session.off('pages', onPages);

        // Clean up WebRTC session
        if (webrtcSession) {
          webrtcSession.close();
          webrtcSession = null;
          webrtcActive = false;
        }
      });
    });
  });

  console.log('[device-api] WebSocket streaming enabled');
  if (WebRTCSession.isAvailable()) {
    console.log('[device-api] WebRTC DataChannel transport available');
  } else {
    console.log('[device-api] WebRTC not available (wrtc package not installed) — WebSocket-only mode');
  }
}

/**
 * Parse ICE server configuration from environment variables.
 *
 * Supports:
 *   WEBRTC_ICE_SERVERS — JSON array of ICE server objects
 *   TURN_SERVER_URL    — single TURN server URL
 *   TURN_USERNAME      — TURN username
 *   TURN_CREDENTIAL    — TURN credential
 */
function parseIceServersFromEnv(): { urls: string | string[]; username?: string; credential?: string }[] {
  const servers: { urls: string | string[]; username?: string; credential?: string }[] = [];

  // JSON array from env
  if (process.env.WEBRTC_ICE_SERVERS) {
    try {
      const parsed = JSON.parse(process.env.WEBRTC_ICE_SERVERS);
      if (Array.isArray(parsed)) {
        servers.push(...parsed);
      }
    } catch (err: any) {
      console.warn(`[webrtc] Failed to parse WEBRTC_ICE_SERVERS: ${err.message}`);
    }
  }

  // Single TURN server from env
  if (process.env.TURN_SERVER_URL) {
    servers.push({
      urls: process.env.TURN_SERVER_URL,
      username: process.env.TURN_USERNAME,
      credential: process.env.TURN_CREDENTIAL,
    });
  }

  return servers;
}
