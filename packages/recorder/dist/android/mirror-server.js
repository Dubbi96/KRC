"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AndroidMirrorServer = void 0;
const http_1 = require("http");
/**
 * Android 미러링 서버
 * ADB 스크린샷을 브라우저에 실시간 표시하고,
 * 클릭/스와이프/타이핑을 캡처하여 recorder에 전달
 */
class AndroidMirrorServer {
    recorder;
    controller;
    server = null;
    screenSize = { width: 1080, height: 1920 };
    actionInProgress = false;
    constructor(recorder, controller) {
        this.recorder = recorder;
        this.controller = controller;
    }
    async start(port = 8787) {
        try {
            this.screenSize = await this.controller.getScreenSize();
        }
        catch {
            console.warn('[Mirror] Failed to get screen size, using default 1080x1920');
        }
        this.server = (0, http_1.createServer)((req, res) => {
            try {
                if (req.method === 'GET' && (req.url === '/' || req.url === '')) {
                    this.serveHTML(res);
                }
                else if (req.method === 'GET' && req.url === '/screenshot') {
                    this.handleScreenshot(res);
                }
                else if (req.method === 'POST' && req.url === '/action') {
                    this.handleAction(req, res);
                }
                else if (req.method === 'GET' && req.url === '/viewport') {
                    res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
                    res.end(JSON.stringify(this.screenSize));
                }
                else if (req.method === 'OPTIONS') {
                    res.writeHead(200, {
                        'Access-Control-Allow-Origin': '*',
                        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
                        'Access-Control-Allow-Headers': 'Content-Type',
                    });
                    res.end();
                }
                else {
                    res.writeHead(404);
                    res.end('Not Found');
                }
            }
            catch (error) {
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: error.message }));
            }
        });
        return new Promise((resolve, reject) => {
            this.server.listen(port, () => {
                const url = `http://localhost:${port}`;
                console.log(`[Mirror] Server started at ${url}`);
                console.log(`[Mirror] Screen: ${this.screenSize.width}x${this.screenSize.height}`);
                resolve({ url, port });
            });
            this.server.on('error', reject);
        });
    }
    async stop() {
        if (this.server) {
            return new Promise((resolve) => {
                if (typeof this.server.closeAllConnections === 'function') {
                    this.server.closeAllConnections();
                }
                this.server.close(() => {
                    this.server = null;
                    console.log('[Mirror] Server stopped');
                    resolve();
                });
                setTimeout(() => {
                    if (this.server) {
                        this.server = null;
                        console.log('[Mirror] Server force-stopped');
                        resolve();
                    }
                }, 2000);
            });
        }
    }
    async handleScreenshot(res) {
        try {
            const base64 = await this.controller.screenshot();
            res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
            res.end(JSON.stringify({ image: base64, timestamp: Date.now() }));
        }
        catch (error) {
            res.writeHead(500, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
            res.end(JSON.stringify({ error: error.message }));
        }
    }
    async handleAction(req, res) {
        const body = await this.readBody(req);
        const data = JSON.parse(body);
        if (this.actionInProgress) {
            res.writeHead(429, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
            res.end(JSON.stringify({ error: 'Previous action still in progress', skipped: true }));
            return;
        }
        this.actionInProgress = true;
        try {
            switch (data.action) {
                case 'tap':
                    await this.recorder.tap(data.x, data.y);
                    this.recorder.enrichLastEventWithElement(data.x, data.y).catch(() => { });
                    break;
                case 'swipe':
                    await this.recorder.swipe({ x: data.fromX, y: data.fromY }, { x: data.toX, y: data.toY }, data.duration || 300);
                    break;
                case 'type':
                    await this.recorder.type(data.text);
                    break;
                case 'back':
                    await this.controller.back();
                    this.recorder.recordEvent({ type: 'back', timestamp: Date.now(), meta: { source: 'programmatic' } });
                    break;
                case 'home':
                    await this.controller.home();
                    this.recorder.recordEvent({ type: 'home', timestamp: Date.now(), meta: { source: 'programmatic' } });
                    break;
                default:
                    res.writeHead(400, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
                    res.end(JSON.stringify({ error: `Unknown action: ${data.action}` }));
                    return;
            }
            res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
            res.end(JSON.stringify({ ok: true }));
        }
        catch (error) {
            res.writeHead(500, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
            res.end(JSON.stringify({ error: error.message }));
        }
        finally {
            this.actionInProgress = false;
        }
    }
    readBody(req) {
        return new Promise((resolve, reject) => {
            let data = '';
            req.on('data', (chunk) => { data += chunk.toString(); });
            req.on('end', () => resolve(data));
            req.on('error', reject);
        });
    }
    serveHTML(res) {
        const sw = this.screenSize.width;
        const sh = this.screenSize.height;
        const html = `<!DOCTYPE html>
<html lang="ko"><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Katab Android Mirror</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{background:#1a1a2e;color:#e0e0e0;font-family:-apple-system,system-ui,sans-serif;display:flex;flex-direction:column;align-items:center;min-height:100vh;padding:16px}
h1{font-size:18px;margin-bottom:12px;color:#77dd77}
.container{display:flex;gap:20px;align-items:flex-start}
.mirror-wrap{position:relative;cursor:crosshair;border:2px solid #333;border-radius:12px;overflow:hidden;background:#000}
canvas{display:block}
.controls{display:flex;flex-direction:column;gap:12px;min-width:240px}
.input-group{display:flex;gap:8px}
.input-group input{flex:1;padding:8px 12px;border:1px solid #444;border-radius:6px;background:#2a2a3e;color:#e0e0e0;font-size:14px}
.input-group button{padding:8px 16px;border:none;border-radius:6px;background:#4a90d9;color:#fff;cursor:pointer;font-size:14px}
.input-group button:hover{background:#5aa0e9}
.nav-buttons{display:flex;gap:8px}
.nav-buttons button{flex:1;padding:10px;border:none;border-radius:6px;background:#3a3a4e;color:#e0e0e0;cursor:pointer;font-size:14px}
.nav-buttons button:hover{background:#4a4a5e}
.status{font-size:12px;color:#888;padding:8px;background:#2a2a3e;border-radius:6px;line-height:1.6}
.status .label{color:#666}
.status .val{color:#77dd77}
.tap-indicator{position:absolute;width:30px;height:30px;border:2px solid #ff6b6b;border-radius:50%;pointer-events:none;transform:translate(-50%,-50%);animation:tapAnim .5s ease-out forwards}
@keyframes tapAnim{0%{opacity:1;transform:translate(-50%,-50%) scale(0.5)}100%{opacity:0;transform:translate(-50%,-50%) scale(1.5)}}
.event-log{max-height:300px;overflow-y:auto;font-size:11px;font-family:monospace;padding:8px;background:#2a2a3e;border-radius:6px;line-height:1.5}
.event-log div{padding:2px 0;border-bottom:1px solid #333}
</style>
</head><body>
<h1>Katab Android Mirror</h1>
<div class="container">
  <div class="mirror-wrap" id="mirrorWrap">
    <canvas id="canvas"></canvas>
  </div>
  <div class="controls">
    <div class="nav-buttons">
      <button id="backBtn">\u25C0 Back</button>
      <button id="homeBtn">\u25CF Home</button>
    </div>
    <div class="input-group">
      <input id="textInput" type="text" placeholder="Type text and press Enter">
      <button id="sendBtn">Send</button>
    </div>
    <div class="status" id="status">
      <div><span class="label">Screen:</span> <span class="val">${sw}x${sh}</span></div>
      <div><span class="label">Status:</span> <span class="val" id="connStatus">Connecting...</span></div>
      <div><span class="label">Events:</span> <span class="val" id="eventCount">0</span></div>
      <div><span class="label">Last:</span> <span class="val" id="lastAction">-</span></div>
    </div>
    <div class="event-log" id="eventLog"></div>
  </div>
</div>
<script>
(function() {
  const canvas = document.getElementById('canvas');
  const ctx = canvas.getContext('2d');
  const wrap = document.getElementById('mirrorWrap');
  const textInput = document.getElementById('textInput');
  const sendBtn = document.getElementById('sendBtn');
  const backBtn = document.getElementById('backBtn');
  const homeBtn = document.getElementById('homeBtn');
  const connStatus = document.getElementById('connStatus');
  const eventCount = document.getElementById('eventCount');
  const lastAction = document.getElementById('lastAction');
  const eventLog = document.getElementById('eventLog');

  const SCREEN_W = ${sw};
  const SCREEN_H = ${sh};
  const MAX_DISPLAY_HEIGHT = window.innerHeight - 100;
  const DISPLAY_RATIO = SCREEN_W / SCREEN_H;
  const DISPLAY_H = Math.min(MAX_DISPLAY_HEIGHT, 700);
  const DISPLAY_W = Math.round(DISPLAY_H * DISPLAY_RATIO);

  canvas.width = DISPLAY_W;
  canvas.height = DISPLAY_H;
  let events = 0;
  let polling = false;
  let actionBusy = false;

  async function fetchScreenshot() {
    if (polling) return;
    polling = true;
    try {
      const res = await fetch('/screenshot');
      if (!res.ok) throw new Error('Screenshot failed');
      const data = await res.json();
      if (data.image) {
        const img = new Image();
        img.onload = function() {
          ctx.drawImage(img, 0, 0, DISPLAY_W, DISPLAY_H);
        };
        img.src = 'data:image/png;base64,' + data.image;
        connStatus.textContent = 'Connected';
        connStatus.style.color = '#4ade80';
      }
    } catch (e) {
      connStatus.textContent = 'Error: ' + e.message;
      connStatus.style.color = '#ef4444';
    }
    polling = false;
  }
  setInterval(fetchScreenshot, 500);
  fetchScreenshot();

  function toDevice(canvasX, canvasY) {
    return {
      x: Math.round((canvasX / DISPLAY_W) * SCREEN_W),
      y: Math.round((canvasY / DISPLAY_H) * SCREEN_H)
    };
  }

  function showTap(canvasX, canvasY) {
    const dot = document.createElement('div');
    dot.className = 'tap-indicator';
    dot.style.left = canvasX + 'px';
    dot.style.top = canvasY + 'px';
    wrap.appendChild(dot);
    setTimeout(function() { dot.remove(); }, 500);
  }

  function logEvent(msg) {
    const div = document.createElement('div');
    div.textContent = new Date().toLocaleTimeString() + ' ' + msg;
    eventLog.prepend(div);
    if (eventLog.children.length > 50) eventLog.lastChild.remove();
    events++;
    eventCount.textContent = events;
    lastAction.textContent = msg;
  }

  async function sendAction(body) {
    if (actionBusy) {
      logEvent('\\u23F3 skipped (busy): ' + body.action);
      return;
    }
    actionBusy = true;
    try {
      const res = await fetch('/action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      const data = await res.json();
      if (!data.ok && data.error) {
        logEvent('ERROR: ' + data.error);
      }
    } catch (e) {
      logEvent('ERROR: ' + e.message);
    } finally {
      actionBusy = false;
    }
  }

  let mouseDown = null;
  canvas.addEventListener('mousedown', function(e) {
    const rect = canvas.getBoundingClientRect();
    mouseDown = { x: e.clientX - rect.left, y: e.clientY - rect.top, time: Date.now() };
  });

  canvas.addEventListener('mouseup', function(e) {
    if (!mouseDown) return;
    const rect = canvas.getBoundingClientRect();
    const upX = e.clientX - rect.left;
    const upY = e.clientY - rect.top;
    const dx = upX - mouseDown.x;
    const dy = upY - mouseDown.y;
    const dist = Math.sqrt(dx * dx + dy * dy);

    if (dist < 10) {
      const dev = toDevice(upX, upY);
      showTap(upX, upY);
      logEvent('tap (' + dev.x + ', ' + dev.y + ')');
      sendAction({ action: 'tap', x: dev.x, y: dev.y });
    } else {
      const from = toDevice(mouseDown.x, mouseDown.y);
      const to = toDevice(upX, upY);
      const duration = Math.max(Date.now() - mouseDown.time, 200);
      logEvent('swipe (' + from.x + ',' + from.y + ') -> (' + to.x + ',' + to.y + ')');
      sendAction({ action: 'swipe', fromX: from.x, fromY: from.y, toX: to.x, toY: to.y, duration: duration });
    }
    mouseDown = null;
  });

  backBtn.addEventListener('click', function() {
    logEvent('back');
    sendAction({ action: 'back' });
  });

  homeBtn.addEventListener('click', function() {
    logEvent('home');
    sendAction({ action: 'home' });
  });

  function sendText() {
    const text = textInput.value;
    if (!text) return;
    logEvent('type: "' + text + '"');
    sendAction({ action: 'type', text: text });
    textInput.value = '';
  }
  sendBtn.addEventListener('click', sendText);
  textInput.addEventListener('keydown', function(e) {
    if (e.key === 'Enter') sendText();
  });
})();
</script>
</body></html>`;
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(html);
    }
}
exports.AndroidMirrorServer = AndroidMirrorServer;
//# sourceMappingURL=mirror-server.js.map