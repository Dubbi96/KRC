"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AndroidPickServer = void 0;
const http_1 = require("http");
const page_source_utils_1 = require("./page-source-utils");
/**
 * Android Pick 전용 서버
 * 디바이스 스크린샷을 브라우저에 실시간 표시하고,
 * 클릭한 위치의 요소를 분석하여 셀렉터를 생성.
 * iOS pick-server.ts와 동일한 인터페이스 제공.
 */
class AndroidPickServer {
    controller;
    server = null;
    screenSize = { width: 1080, height: 1920 };
    dashboardPort = null;
    scenarioId = null;
    lastPickResult = null;
    constructor(controller) {
        this.controller = controller;
    }
    async start(port = 8789, dashboardPort, scenarioId) {
        this.dashboardPort = dashboardPort || null;
        this.scenarioId = scenarioId || null;
        // 화면 크기 캐싱
        try {
            this.screenSize = await this.controller.getScreenSize();
        }
        catch {
            console.warn('[AndroidPick] Failed to get screen size, using default 1080x1920');
        }
        this.server = (0, http_1.createServer)((req, res) => {
            try {
                const url = req.url?.split('?')[0] || '';
                if (req.method === 'GET' && (url === '/' || url === '')) {
                    this.serveHTML(res);
                }
                else if (req.method === 'GET' && url === '/screenshot') {
                    this.handleScreenshot(res);
                }
                else if (req.method === 'GET' && url === '/viewport') {
                    res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
                    res.end(JSON.stringify(this.screenSize));
                }
                else if (req.method === 'POST' && url === '/pick') {
                    this.handlePick(req, res);
                }
                else if (req.method === 'POST' && url === '/apply') {
                    this.handleApply(req, res);
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
                console.log(`[AndroidPick] Server started at ${url}`);
                console.log(`[AndroidPick] Screen: ${this.screenSize.width}x${this.screenSize.height}`);
                if (this.dashboardPort) {
                    console.log(`[AndroidPick] Dashboard integration: http://localhost:${this.dashboardPort}`);
                }
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
                    console.log('[AndroidPick] Server stopped');
                    resolve();
                });
                setTimeout(() => {
                    if (this.server) {
                        this.server = null;
                        console.log('[AndroidPick] Server force-stopped');
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
    /**
     * 좌표를 받아서 UIAutomator dump에서 해당 위치의 요소를 찾고 셀렉터 생성
     */
    async handlePick(req, res) {
        try {
            const body = await this.readBody(req);
            const { x, y } = JSON.parse(body);
            // pageSource (UIAutomator dump) 가져오기
            const xml = await this.controller.getPageSource();
            if (!xml) {
                res.writeHead(500, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
                res.end(JSON.stringify({ error: 'Failed to get page source (UIAutomator dump)' }));
                return;
            }
            // XML → 요소 파싱
            const elements = (0, page_source_utils_1.parsePageSource)(xml);
            // 좌표에 해당하는 요소 찾기 (가장 작은 bounds + 클릭 가능 우선)
            const matching = elements
                .filter(el => {
                const b = el.bounds;
                return x >= b.x && x <= b.x + b.width && y >= b.y && y <= b.y + b.height;
            })
                .sort((a, b) => {
                // 클릭 가능한 요소 우선, 그 다음 작은 영역 우선
                if (a.clickable !== b.clickable)
                    return a.clickable ? -1 : 1;
                const areaA = a.bounds.width * a.bounds.height;
                const areaB = b.bounds.width * b.bounds.height;
                return areaA - areaB;
            });
            if (matching.length === 0) {
                res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
                res.end(JSON.stringify({ found: false, x, y }));
                return;
            }
            const bestMatch = matching[0];
            const selector = (0, page_source_utils_1.generateSelector)(bestMatch);
            // 결과 저장 (apply 시 사용)
            this.lastPickResult = { selector, element: bestMatch };
            // 터미널에 출력
            console.log(`[AndroidPick] Element at (${x}, ${y}): ${bestMatch.shortType} → ${selector.strategy}="${selector.value}"`);
            // 후보 목록 (최대 5개)
            const candidates = matching.slice(0, 5).map(el => ({
                type: el.type,
                shortType: el.shortType,
                selector: (0, page_source_utils_1.generateSelector)(el),
                resourceId: el.resourceId,
                contentDesc: el.contentDesc,
                text: el.text,
                bounds: el.bounds,
                clickable: el.clickable,
            }));
            res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
            res.end(JSON.stringify({
                found: true,
                selector,
                element: {
                    type: bestMatch.type,
                    shortType: bestMatch.shortType,
                    resourceId: bestMatch.resourceId,
                    contentDesc: bestMatch.contentDesc,
                    text: bestMatch.text,
                    bounds: bestMatch.bounds,
                    clickable: bestMatch.clickable,
                },
                candidates,
            }));
        }
        catch (error) {
            res.writeHead(500, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
            res.end(JSON.stringify({ error: error.message }));
        }
    }
    /**
     * 선택된 셀렉터를 대시보드에 전송
     */
    async handleApply(req, res) {
        try {
            const body = await this.readBody(req);
            const data = JSON.parse(body);
            const selector = data.selector;
            const element = data.element;
            if (!selector || !selector.strategy || !selector.value) {
                res.writeHead(400, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
                res.end(JSON.stringify({ error: 'selector is required' }));
                return;
            }
            console.log(`[AndroidPick] Applying selector: ${selector.strategy}="${selector.value}"`);
            // 대시보드에 전송
            if (this.dashboardPort) {
                try {
                    const dashboardUrl = `http://localhost:${this.dashboardPort}/api/android/pick-result`;
                    const resp = await fetch(dashboardUrl, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            scenarioId: this.scenarioId,
                            selector,
                            element,
                        }),
                    });
                    if (resp.ok) {
                        console.log(`[AndroidPick] Result sent to dashboard successfully`);
                    }
                    else {
                        console.warn(`[AndroidPick] Dashboard responded with ${resp.status}`);
                    }
                }
                catch (err) {
                    console.warn(`[AndroidPick] Failed to send to dashboard: ${err.message}`);
                }
            }
            res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
            res.end(JSON.stringify({ ok: true, selector }));
        }
        catch (error) {
            res.writeHead(500, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
            res.end(JSON.stringify({ error: error.message }));
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
<title>Katab Android Pick</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{background:#1a1a2e;color:#e0e0e0;font-family:-apple-system,system-ui,sans-serif;display:flex;flex-direction:column;align-items:center;min-height:100vh;padding:16px}
h1{font-size:18px;margin-bottom:12px;color:#81c784}
.container{display:flex;gap:20px;align-items:flex-start}
.mirror-wrap{position:relative;cursor:crosshair;border:2px solid #333;border-radius:12px;overflow:hidden;background:#000}
canvas{display:block}
.controls{display:flex;flex-direction:column;gap:12px;min-width:300px;max-width:340px}
.status{font-size:12px;color:#888;padding:8px;background:#2a2a3e;border-radius:6px;line-height:1.6}
.status .label{color:#666}
.status .val{color:#81c784}
.tap-indicator{position:absolute;width:30px;height:30px;border:2px solid #81c784;border-radius:50%;pointer-events:none;transform:translate(-50%,-50%);animation:tapAnim .5s ease-out forwards}
@keyframes tapAnim{0%{opacity:1;transform:translate(-50%,-50%) scale(0.5)}100%{opacity:0;transform:translate(-50%,-50%) scale(1.5)}}
.highlight-overlay{position:absolute;border:2px solid #81c784;background:rgba(129,199,132,0.15);pointer-events:none;transition:all .2s ease;display:none;z-index:5}
.highlight-overlay.active{display:block}
.highlight-label{position:absolute;bottom:-20px;left:0;font-size:10px;color:#81c784;white-space:nowrap;background:rgba(26,26,46,0.9);padding:1px 4px;border-radius:3px}
.pick-result{padding:12px;background:#2a2a3e;border-radius:6px;font-size:12px;line-height:1.6;display:none}
.pick-result.active{display:block}
.pick-result .el-type{color:#f59e0b;font-weight:bold;font-size:14px}
.pick-result .sel-strategy{color:#818cf8}
.pick-result .sel-value{color:#81c784;word-break:break-all}
.pick-result .el-attr{color:#888}
.pick-result .el-attr span{color:#e0e0e0}
.candidates{margin-top:8px;border-top:1px solid #444;padding-top:8px}
.candidates .cand{padding:4px 6px;margin:2px 0;background:#1a1a2e;border-radius:4px;cursor:pointer;font-size:11px;display:flex;justify-content:space-between;align-items:center}
.candidates .cand:hover{background:#333}
.candidates .cand.selected{border:1px solid #81c784}
.btn{padding:8px 16px;border:none;border-radius:6px;cursor:pointer;font-size:14px;font-weight:500}
.btn-apply{background:#81c784;color:#1a1a2e;width:100%}
.btn-apply:hover{background:#66bb6a}
.btn-apply:disabled{background:#444;color:#888;cursor:not-allowed}
.event-log{max-height:200px;overflow-y:auto;font-size:11px;font-family:monospace;padding:8px;background:#2a2a3e;border-radius:6px;line-height:1.5}
.event-log div{padding:2px 0;border-bottom:1px solid #333}
.hint{font-size:11px;color:#666;text-align:center;padding:4px}
</style>
</head><body>
<h1>Katab Android Pick</h1>
<div class="container">
  <div class="mirror-wrap" id="mirrorWrap">
    <canvas id="canvas"></canvas>
    <div class="highlight-overlay" id="highlightOverlay"><span class="highlight-label" id="highlightLabel"></span></div>
  </div>
  <div class="controls">
    <div class="status" id="status">
      <div><span class="label">Screen:</span> <span class="val">${sw}x${sh}</span></div>
      <div><span class="label">Status:</span> <span class="val" id="connStatus">Connecting...</span></div>
    </div>
    <div class="hint">Click on the device screen to pick an element</div>
    <div class="pick-result" id="pickResult">
      <div class="el-type" id="elType"></div>
      <div style="margin-top:4px">
        <span class="sel-strategy" id="selStrategy"></span>
        <span class="sel-value" id="selValue"></span>
      </div>
      <div class="el-attr" id="elAttrs"></div>
      <div class="candidates" id="candidates"></div>
      <button class="btn btn-apply" id="applyBtn" disabled style="margin-top:8px">Apply to Dashboard</button>
    </div>
    <div class="event-log" id="eventLog"></div>
  </div>
</div>
<script>
(function() {
  var canvas = document.getElementById('canvas');
  var ctx = canvas.getContext('2d');
  var wrap = document.getElementById('mirrorWrap');
  var connStatus = document.getElementById('connStatus');
  var pickResult = document.getElementById('pickResult');
  var elType = document.getElementById('elType');
  var selStrategy = document.getElementById('selStrategy');
  var selValue = document.getElementById('selValue');
  var elAttrs = document.getElementById('elAttrs');
  var candidatesEl = document.getElementById('candidates');
  var applyBtn = document.getElementById('applyBtn');
  var eventLog = document.getElementById('eventLog');
  var highlightOverlay = document.getElementById('highlightOverlay');
  var highlightLabel = document.getElementById('highlightLabel');

  var SCREEN_W = ${sw};
  var SCREEN_H = ${sh};
  var MAX_DISPLAY_HEIGHT = window.innerHeight - 100;
  var DISPLAY_RATIO = SCREEN_W / SCREEN_H;
  var DISPLAY_H = Math.min(MAX_DISPLAY_HEIGHT, 700);
  var DISPLAY_W = Math.round(DISPLAY_H * DISPLAY_RATIO);

  canvas.width = DISPLAY_W;
  canvas.height = DISPLAY_H;
  var polling = false;
  var pickBusy = false;
  var currentSelector = null;
  var currentElement = null;

  function toDevice(canvasX, canvasY) {
    return {
      x: Math.round((canvasX / DISPLAY_W) * SCREEN_W),
      y: Math.round((canvasY / DISPLAY_H) * SCREEN_H)
    };
  }

  function toCanvas(devX, devY) {
    return {
      x: Math.round((devX / SCREEN_W) * DISPLAY_W),
      y: Math.round((devY / SCREEN_H) * DISPLAY_H)
    };
  }

  function showHighlight(bounds, label) {
    if (!bounds || !highlightOverlay) return;
    var topLeft = toCanvas(bounds.x, bounds.y);
    var botRight = toCanvas(bounds.x + bounds.width, bounds.y + bounds.height);
    highlightOverlay.style.left = topLeft.x + 'px';
    highlightOverlay.style.top = topLeft.y + 'px';
    highlightOverlay.style.width = (botRight.x - topLeft.x) + 'px';
    highlightOverlay.style.height = (botRight.y - topLeft.y) + 'px';
    highlightOverlay.classList.add('active');
    if (highlightLabel) highlightLabel.textContent = label || '';
  }

  function hideHighlight() {
    if (highlightOverlay) highlightOverlay.classList.remove('active');
  }

  // Screenshot polling
  async function fetchScreenshot() {
    if (polling) return;
    polling = true;
    try {
      var res = await fetch('/screenshot');
      if (!res.ok) throw new Error('Screenshot failed');
      var data = await res.json();
      if (data.image) {
        var img = new Image();
        img.onload = function() {
          ctx.drawImage(img, 0, 0, DISPLAY_W, DISPLAY_H);
        };
        img.src = 'data:image/png;base64,' + data.image;
        connStatus.textContent = 'Connected';
        connStatus.style.color = '#81c784';
      }
    } catch (e) {
      connStatus.textContent = 'Error: ' + e.message;
      connStatus.style.color = '#ef4444';
    }
    polling = false;
  }
  setInterval(fetchScreenshot, 500);
  fetchScreenshot();

  function showTap(canvasX, canvasY) {
    var dot = document.createElement('div');
    dot.className = 'tap-indicator';
    dot.style.left = canvasX + 'px';
    dot.style.top = canvasY + 'px';
    wrap.appendChild(dot);
    setTimeout(function() { dot.remove(); }, 500);
  }

  function logEvent(msg) {
    var div = document.createElement('div');
    div.textContent = new Date().toLocaleTimeString() + ' ' + msg;
    eventLog.prepend(div);
    if (eventLog.children.length > 50) eventLog.lastChild.remove();
  }

  function selectCandidate(selector, element) {
    currentSelector = selector;
    currentElement = element;
    selStrategy.textContent = selector.strategy + ' = ';
    selValue.textContent = '"' + selector.value + '"';
    applyBtn.disabled = false;

    var items = candidatesEl.querySelectorAll('.cand');
    items.forEach(function(item) {
      item.classList.toggle('selected', item.dataset.value === selector.value);
    });
  }

  // Click → pick element
  canvas.addEventListener('click', async function(e) {
    if (pickBusy) return;
    pickBusy = true;

    var rect = canvas.getBoundingClientRect();
    var canvasX = e.clientX - rect.left;
    var canvasY = e.clientY - rect.top;
    var dev = toDevice(canvasX, canvasY);

    showTap(canvasX, canvasY);
    logEvent('pick (' + dev.x + ', ' + dev.y + ')');

    try {
      var res = await fetch('/pick', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ x: dev.x, y: dev.y })
      });
      var data = await res.json();

      if (data.found) {
        pickResult.classList.add('active');
        elType.textContent = data.element.shortType || data.element.type;

        // Attributes
        var attrs = [];
        if (data.element.resourceId) attrs.push('resource-id: <span>' + data.element.resourceId + '</span>');
        if (data.element.contentDesc) attrs.push('content-desc: <span>' + data.element.contentDesc + '</span>');
        if (data.element.text) attrs.push('text: <span>' + data.element.text + '</span>');
        attrs.push('clickable: <span>' + (data.element.clickable ? 'true' : 'false') + '</span>');
        elAttrs.innerHTML = attrs.join('<br>');

        // 요소 bounds 하이라이트
        showHighlight(data.element.bounds, data.element.shortType + ' (' + data.selector.strategy + ')');

        // Select best match
        selectCandidate(data.selector, data.element);

        // Candidates
        if (data.candidates && data.candidates.length > 1) {
          candidatesEl.innerHTML = '<div style="color:#888;font-size:10px;margin-bottom:4px">Other candidates:</div>';
          data.candidates.forEach(function(c) {
            var div = document.createElement('div');
            div.className = 'cand';
            if (c.selector.value === data.selector.value) div.classList.add('selected');
            div.dataset.value = c.selector.value;
            div.innerHTML = '<span>' + (c.shortType || c.type) + '</span><span style="color:#818cf8">' + c.selector.strategy + '="' + c.selector.value + '"</span>';
            div.onclick = function() {
              selectCandidate(c.selector, { type: c.type, shortType: c.shortType, resourceId: c.resourceId, contentDesc: c.contentDesc, text: c.text, bounds: c.bounds, clickable: c.clickable });
              showHighlight(c.bounds, (c.shortType || c.type) + ' (' + c.selector.strategy + ')');
            };
            candidatesEl.appendChild(div);
          });
        } else {
          candidatesEl.innerHTML = '';
        }

        logEvent('found: ' + data.selector.strategy + '="' + data.selector.value + '"');
      } else {
        logEvent('no element at (' + dev.x + ', ' + dev.y + ')');
        pickResult.classList.remove('active');
        currentSelector = null;
        currentElement = null;
        applyBtn.disabled = true;
        hideHighlight();
      }
    } catch (err) {
      logEvent('ERROR: ' + err.message);
    } finally {
      pickBusy = false;
    }
  });

  // Apply button → send to dashboard
  applyBtn.addEventListener('click', async function() {
    if (!currentSelector) return;
    applyBtn.disabled = true;
    applyBtn.textContent = 'Sending...';

    try {
      var res = await fetch('/apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ selector: currentSelector, element: currentElement })
      });
      var data = await res.json();
      if (data.ok) {
        applyBtn.textContent = 'Applied!';
        applyBtn.style.background = '#66bb6a';
        logEvent('applied: ' + currentSelector.strategy + '="' + currentSelector.value + '"');
        setTimeout(function() {
          applyBtn.textContent = 'Apply to Dashboard';
          applyBtn.style.background = '';
          applyBtn.disabled = false;
        }, 2000);
      } else {
        throw new Error(data.error || 'Apply failed');
      }
    } catch (err) {
      applyBtn.textContent = 'Failed: ' + err.message;
      applyBtn.style.background = '#ef4444';
      logEvent('ERROR: ' + err.message);
      setTimeout(function() {
        applyBtn.textContent = 'Apply to Dashboard';
        applyBtn.style.background = '';
        applyBtn.disabled = false;
      }, 3000);
    }
  });
})();
</script>
</body></html>`;
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(html);
    }
}
exports.AndroidPickServer = AndroidPickServer;
//# sourceMappingURL=pick-server.js.map