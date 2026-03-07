/**
 * WebRTC Session
 *
 * Manages a WebRTC peer connection for direct P2P frame streaming
 * between the KRC (Node agent) and the browser dashboard.
 *
 * Architecture:
 *   - KRC creates an RTCPeerConnection (via `wrtc` npm package)
 *   - Opens a "frames" DataChannel for sending screenshot data (binary)
 *   - Opens a "control" DataChannel for receiving user actions (JSON)
 *   - SDP offer/answer and ICE candidates are exchanged via WebSocket signaling
 *   - Once the DataChannel is open, frames bypass the cloud relay entirely
 *
 * Fallback:
 *   If WebRTC negotiation fails or the DataChannel closes, the mirror session
 *   falls back to the existing WebSocket-based frame relay.
 */

import { EventEmitter } from 'events';

// wrtc is an optional dependency — gracefully degrade if not installed
let wrtc: any;
try {
  wrtc = require('wrtc');
} catch {
  // wrtc not available — WebRTC features will be disabled
}

/** Default ICE servers for NAT traversal */
const DEFAULT_ICE_SERVERS: RTCIceServerConfig[] = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
];

interface RTCIceServerConfig {
  urls: string | string[];
  username?: string;
  credential?: string;
}

export interface WebRTCSessionOptions {
  /** Custom ICE servers (STUN/TURN). Falls back to Google STUN if not provided. */
  iceServers?: RTCIceServerConfig[];
  /** Maximum size per DataChannel message (bytes). Default 64KB. */
  maxMessageSize?: number;
}

export type WebRTCState = 'new' | 'connecting' | 'connected' | 'disconnected' | 'failed' | 'closed';

/**
 * Events emitted:
 *   'state'           — WebRTC connection state changed
 *   'ice_candidate'   — Local ICE candidate generated (send to remote via signaling)
 *   'control_message' — User action received via control DataChannel
 *   'error'           — Non-fatal error
 *   'datachannel_open'  — Frames DataChannel is open and ready
 *   'datachannel_close' — Frames DataChannel closed (trigger fallback)
 */
export class WebRTCSession extends EventEmitter {
  readonly id: string;
  state: WebRTCState = 'new';

  private pc: any | null = null;  // RTCPeerConnection
  private framesChannel: any | null = null;   // DataChannel for sending frames
  private controlChannel: any | null = null;  // DataChannel for receiving actions
  private iceServers: RTCIceServerConfig[];
  private maxMessageSize: number;
  private iceCandidateBuffer: any[] = [];
  private remoteDescriptionSet = false;

  constructor(id: string, options?: WebRTCSessionOptions) {
    super();
    this.id = id;
    this.iceServers = options?.iceServers || DEFAULT_ICE_SERVERS;
    this.maxMessageSize = options?.maxMessageSize || 64 * 1024; // 64KB
  }

  /** Check if wrtc package is available */
  static isAvailable(): boolean {
    return !!wrtc;
  }

  /** Get the ICE server configuration (for sending to clients) */
  getIceServers(): RTCIceServerConfig[] {
    return this.iceServers;
  }

  /**
   * Create an SDP offer.
   * KRC acts as the offerer — it creates the peer connection, data channels,
   * and generates an offer that the browser will answer.
   */
  async createOffer(): Promise<{ sdp: string; type: string }> {
    if (!wrtc) {
      throw new Error('wrtc package not installed. Run: npm install wrtc');
    }

    this.setState('connecting');

    // Create peer connection
    this.pc = new wrtc.RTCPeerConnection({
      iceServers: this.iceServers,
    });

    // Handle ICE candidates
    this.pc.onicecandidate = (event: any) => {
      if (event.candidate) {
        this.emit('ice_candidate', {
          candidate: event.candidate.candidate,
          sdpMid: event.candidate.sdpMid,
          sdpMLineIndex: event.candidate.sdpMLineIndex,
        });
      }
    };

    // Monitor connection state
    this.pc.onconnectionstatechange = () => {
      const state = this.pc?.connectionState;
      switch (state) {
        case 'connected':
          this.setState('connected');
          break;
        case 'disconnected':
          this.setState('disconnected');
          break;
        case 'failed':
          this.setState('failed');
          this.emit('datachannel_close');
          break;
        case 'closed':
          this.setState('closed');
          this.emit('datachannel_close');
          break;
      }
    };

    this.pc.oniceconnectionstatechange = () => {
      const iceState = this.pc?.iceConnectionState;
      console.log(`[webrtc:${this.id}] ICE connection state: ${iceState}`);
      if (iceState === 'failed') {
        this.setState('failed');
        this.emit('datachannel_close');
      }
    };

    // Create "frames" DataChannel (KRC → Browser, binary)
    this.framesChannel = this.pc.createDataChannel('frames', {
      ordered: false,       // frames can arrive out of order (latest wins)
      maxRetransmits: 0,    // unreliable — drop stale frames
    });

    this.framesChannel.binaryType = 'arraybuffer';

    this.framesChannel.onopen = () => {
      console.log(`[webrtc:${this.id}] Frames DataChannel opened`);
      this.emit('datachannel_open');
    };

    this.framesChannel.onclose = () => {
      console.log(`[webrtc:${this.id}] Frames DataChannel closed`);
      this.emit('datachannel_close');
    };

    this.framesChannel.onerror = (err: any) => {
      console.warn(`[webrtc:${this.id}] Frames DataChannel error:`, err?.error?.message || err);
      this.emit('error', `Frames DataChannel error: ${err?.error?.message || 'unknown'}`);
    };

    // Create "control" DataChannel (Browser → KRC, JSON)
    this.controlChannel = this.pc.createDataChannel('control', {
      ordered: true,        // actions must arrive in order
    });

    this.controlChannel.onopen = () => {
      console.log(`[webrtc:${this.id}] Control DataChannel opened`);
    };

    this.controlChannel.onclose = () => {
      console.log(`[webrtc:${this.id}] Control DataChannel closed`);
    };

    this.controlChannel.onmessage = (event: any) => {
      try {
        const msg = JSON.parse(event.data);
        this.emit('control_message', msg);
      } catch (err: any) {
        this.emit('error', `Invalid control message: ${err.message}`);
      }
    };

    // Create SDP offer
    const offer = await this.pc.createOffer();
    await this.pc.setLocalDescription(offer);

    return {
      sdp: this.pc.localDescription.sdp,
      type: this.pc.localDescription.type,
    };
  }

  /**
   * Handle the SDP answer from the browser.
   */
  async handleAnswer(answer: { sdp: string; type: string }): Promise<void> {
    if (!this.pc) {
      throw new Error('Peer connection not initialized. Call createOffer() first.');
    }

    await this.pc.setRemoteDescription(new wrtc.RTCSessionDescription(answer));
    this.remoteDescriptionSet = true;

    // Flush buffered ICE candidates
    for (const candidate of this.iceCandidateBuffer) {
      await this.pc.addIceCandidate(new wrtc.RTCIceCandidate(candidate));
    }
    this.iceCandidateBuffer = [];
  }

  /**
   * Add a remote ICE candidate from the browser.
   */
  async addIceCandidate(candidate: {
    candidate: string;
    sdpMid?: string | null;
    sdpMLineIndex?: number | null;
  }): Promise<void> {
    if (!this.pc) {
      throw new Error('Peer connection not initialized.');
    }

    // Buffer candidates until remote description is set
    if (!this.remoteDescriptionSet) {
      this.iceCandidateBuffer.push(candidate);
      return;
    }

    await this.pc.addIceCandidate(new wrtc.RTCIceCandidate(candidate));
  }

  /**
   * Send a screenshot frame via the DataChannel.
   * Accepts a base64-encoded PNG string (from Appium) and sends it as binary.
   *
   * Returns true if the frame was sent, false if the channel is not ready.
   */
  sendFrame(base64Png: string): boolean {
    if (!this.framesChannel || this.framesChannel.readyState !== 'open') {
      return false;
    }

    try {
      // Convert base64 to binary buffer
      const buffer = Buffer.from(base64Png, 'base64');

      // Check if buffer exceeds SCTP max message size.
      // WebRTC DataChannel over SCTP has a practical limit (~256KB for most impls).
      // For large frames, we chunk them.
      if (buffer.byteLength <= this.maxMessageSize) {
        this.framesChannel.send(buffer);
      } else {
        this.sendChunkedFrame(buffer);
      }

      return true;
    } catch (err: any) {
      // Buffered amount too high or channel closing — skip frame
      this.emit('error', `Failed to send frame: ${err.message}`);
      return false;
    }
  }

  /**
   * Send a large frame in chunks with a simple framing protocol:
   *   Chunk header (4 bytes): [chunkIndex (uint16), totalChunks (uint16)]
   *   Chunk payload: raw bytes
   *
   * The browser reassembles chunks by collecting all parts and concatenating.
   */
  private sendChunkedFrame(buffer: Buffer): void {
    const chunkPayloadSize = this.maxMessageSize - 4; // 4 bytes for header
    const totalChunks = Math.ceil(buffer.byteLength / chunkPayloadSize);

    for (let i = 0; i < totalChunks; i++) {
      const start = i * chunkPayloadSize;
      const end = Math.min(start + chunkPayloadSize, buffer.byteLength);
      const payload = buffer.subarray(start, end);

      // Build chunk: [chunkIndex(u16), totalChunks(u16), ...payload]
      const chunk = Buffer.alloc(4 + payload.byteLength);
      chunk.writeUInt16BE(i, 0);
      chunk.writeUInt16BE(totalChunks, 2);
      payload.copy(chunk, 4);

      if (this.framesChannel?.readyState === 'open') {
        this.framesChannel.send(chunk);
      }
    }
  }

  /**
   * Check if the frames DataChannel is open and ready for sending.
   */
  isReady(): boolean {
    return (
      this.framesChannel?.readyState === 'open' &&
      this.state === 'connected'
    );
  }

  /**
   * Check if the DataChannel is open (may be ready before full connection state reports "connected").
   */
  isDataChannelOpen(): boolean {
    return this.framesChannel?.readyState === 'open';
  }

  /**
   * Get the current buffered amount on the frames DataChannel.
   * Useful for backpressure — skip frames if buffer is getting full.
   */
  getBufferedAmount(): number {
    return this.framesChannel?.bufferedAmount || 0;
  }

  /**
   * Close the WebRTC session and clean up resources.
   */
  close(): void {
    this.setState('closed');

    if (this.framesChannel) {
      try { this.framesChannel.close(); } catch {}
      this.framesChannel = null;
    }

    if (this.controlChannel) {
      try { this.controlChannel.close(); } catch {}
      this.controlChannel = null;
    }

    if (this.pc) {
      try { this.pc.close(); } catch {}
      this.pc = null;
    }

    this.iceCandidateBuffer = [];
    this.remoteDescriptionSet = false;
    this.removeAllListeners();
  }

  private setState(state: WebRTCState): void {
    if (this.state === state) return;
    this.state = state;
    this.emit('state', state);
    console.log(`[webrtc:${this.id}] State: ${state}`);
  }

  /**
   * Get debug info about the session.
   */
  getInfo() {
    return {
      id: this.id,
      state: this.state,
      framesChannelState: this.framesChannel?.readyState || 'none',
      controlChannelState: this.controlChannel?.readyState || 'none',
      bufferedAmount: this.getBufferedAmount(),
      iceConnectionState: this.pc?.iceConnectionState || 'none',
      connectionState: this.pc?.connectionState || 'none',
    };
  }
}
