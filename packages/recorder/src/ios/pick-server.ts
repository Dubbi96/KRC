import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'http';
import { parsePageSource, generateSelector, searchElements, type IOSUIElement, type IOSSelector } from './page-source-utils';

/**
 * iOS Pick 전용 서버
 * 디바이스 스크린샷을 브라우저에 실시간 표시하고,
 * 클릭한 위치의 요소를 분석하여 셀렉터를 생성.
 * mirror-server.ts와 독립적으로 동작 (녹화 불필요).
 */
export class IOSPickServer {
  private server: Server | null = null;
  private viewportSize: { width: number; height: number } = { width: 390, height: 844 };
  private dashboardPort: number | null = null;
  private scenarioId: string | null = null;
  private lastPickResult: { selector: IOSSelector; element: IOSUIElement } | null = null;
  private mode: 'element' | 'image-match' = 'element';
  private stepIdx: number | null = null;
  private batchPlanId: string | null = null;
  private batchPlan: { planId: string; scenarioId: string; steps: Array<{ stepIdx: number; type: string; description: string; pickable?: boolean; currentSelector?: { strategy: string; value: string }; webSelector?: string; value?: string }> } | null = null;

  constructor(
    private controller: any, // IOSController
  ) {}

  async start(port: number = 8788, dashboardPort?: number, scenarioId?: string, mode?: string, stepIdx?: number, batchPlanId?: string): Promise<{ url: string; port: number }> {
    this.dashboardPort = dashboardPort || null;
    this.scenarioId = scenarioId || null;
    this.mode = (mode === 'image-match') ? 'image-match' : 'element';
    this.stepIdx = stepIdx ?? null;
    this.batchPlanId = batchPlanId || null;

    // Batch plan fetch (from dashboard)
    if (this.batchPlanId && this.dashboardPort) {
      try {
        const resp = await fetch(`http://localhost:${this.dashboardPort}/api/ios/batch-pick-plan/${this.batchPlanId}`);
        if (resp.ok) {
          this.batchPlan = await resp.json() as typeof this.batchPlan;
          console.log(`[Pick] Batch plan loaded: ${this.batchPlan!.steps.length} steps`);
        } else {
          console.warn(`[Pick] Failed to load batch plan: ${resp.status}`);
        }
      } catch (err: any) {
        console.warn(`[Pick] Failed to fetch batch plan: ${err.message}`);
      }
    }

    // 뷰포트 크기 캐싱
    try {
      this.viewportSize = await this.controller.getWindowSize();
    } catch {
      console.warn('[Pick] Failed to get window size, using default 390x844');
    }

    this.server = createServer((req, res) => {
      try {
        const url = req.url?.split('?')[0] || '';
        if (req.method === 'GET' && (url === '/' || url === '')) {
          if (this.batchPlan) {
            this.serveBatchHTML(res);
          } else if (this.mode === 'image-match') {
            this.serveImageMatchHTML(res);
          } else {
            this.serveHTML(res);
          }
        } else if (req.method === 'GET' && url === '/batch-plan') {
          res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
          res.end(JSON.stringify(this.batchPlan || { steps: [] }));
        } else if (req.method === 'POST' && url === '/batch-apply') {
          this.handleBatchApply(req, res);
        } else if (req.method === 'POST' && url === '/pick-region') {
          this.handlePickRegion(req, res);
        } else if (req.method === 'GET' && url === '/screenshot') {
          this.handleScreenshot(res);
        } else if (req.method === 'GET' && url === '/viewport') {
          res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
          res.end(JSON.stringify(this.viewportSize));
        } else if (req.method === 'POST' && url === '/pick') {
          this.handlePick(req, res);
        } else if (req.method === 'POST' && url === '/apply') {
          this.handleApply(req, res);
        } else if (req.method === 'POST' && url === '/search') {
          this.handleSearch(req, res);
        } else if (req.method === 'POST' && url === '/apply-coordinates') {
          this.handleApplyCoordinates(req, res);
        } else if (req.method === 'OPTIONS') {
          res.writeHead(200, {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type',
          });
          res.end();
        } else {
          res.writeHead(404);
          res.end('Not Found');
        }
      } catch (error: any) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: error.message }));
      }
    });

    return new Promise((resolve, reject) => {
      this.server!.listen(port, () => {
        const url = `http://localhost:${port}`;
        console.log(`[Pick] Server started at ${url}`);
        console.log(`[Pick] Viewport: ${this.viewportSize.width}x${this.viewportSize.height}`);
        if (this.dashboardPort) {
          console.log(`[Pick] Dashboard integration: http://localhost:${this.dashboardPort}`);
        }
        if (this.scenarioId) {
          console.log(`[Pick] Scenario ID: ${this.scenarioId}`);
        }
        resolve({ url, port });
      });
      this.server!.on('error', reject);
    });
  }

  async stop(): Promise<void> {
    if (this.server) {
      return new Promise((resolve) => {
        if (typeof (this.server as any).closeAllConnections === 'function') {
          (this.server as any).closeAllConnections();
        }
        this.server!.close(() => {
          this.server = null;
          console.log('[Pick] Server stopped');
          resolve();
        });
        setTimeout(() => {
          if (this.server) {
            this.server = null;
            console.log('[Pick] Server force-stopped');
            resolve();
          }
        }, 2000);
      });
    }
  }

  private async handleScreenshot(res: ServerResponse): Promise<void> {
    try {
      const base64 = await this.controller.screenshot();
      res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify({ image: base64, timestamp: Date.now() }));
    } catch (error: any) {
      res.writeHead(500, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify({ error: error.message }));
    }
  }

  /**
   * 좌표를 받아서 pageSource에서 해당 위치의 요소를 찾고 셀렉터 생성
   */
  private async handlePick(req: IncomingMessage, res: ServerResponse): Promise<void> {
    try {
      const body = await this.readBody(req);
      const { x, y } = JSON.parse(body);

      // pageSource 가져오기
      const xml = await this.controller.getPageSource();
      if (!xml) {
        res.writeHead(500, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({ error: 'Failed to get page source' }));
        return;
      }

      // XML → 요소 파싱
      const elements = parsePageSource(xml);

      // 좌표에 해당하는 요소 찾기 (가장 작은 bounds 우선 = 가장 구체적인 요소)
      const matching = elements
        .filter(el => {
          const b = el.bounds;
          return x >= b.x && x <= b.x + b.width && y >= b.y && y <= b.y + b.height;
        })
        .sort((a, b) => {
          const areaA = a.bounds.width * a.bounds.height;
          const areaB = b.bounds.width * b.bounds.height;
          return areaA - areaB; // 작은 면적 우선
        });

      if (matching.length === 0) {
        res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({ found: false, x, y }));
        return;
      }

      const bestMatch = matching[0];
      const selector = generateSelector(bestMatch);

      // 결과 저장 (apply 시 사용)
      this.lastPickResult = { selector, element: bestMatch };

      // 터미널에 출력
      console.log(`[Pick] Element at (${x}, ${y}): ${bestMatch.type} → ${selector.strategy}="${selector.value}"`);

      // 후보 목록 (최대 5개)
      const candidates = matching.slice(0, 5).map(el => ({
        type: el.type,
        selector: generateSelector(el),
        label: el.label,
        name: el.name,
        accessibilityId: el.accessibilityId,
        bounds: el.bounds,
      }));

      res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify({
        found: true,
        selector,
        element: {
          type: bestMatch.type,
          label: bestMatch.label,
          name: bestMatch.name,
          value: bestMatch.value,
          accessibilityId: bestMatch.accessibilityId,
          bounds: bestMatch.bounds,
        },
        candidates,
      }));
    } catch (error: any) {
      res.writeHead(500, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify({ error: error.message }));
    }
  }

  /**
   * 선택된 셀렉터를 대시보드에 전송
   */
  private async handleApply(req: IncomingMessage, res: ServerResponse): Promise<void> {
    try {
      const body = await this.readBody(req);
      const data = JSON.parse(body);
      const selector = data.selector as IOSSelector;
      const element = data.element;

      if (!selector || !selector.strategy || !selector.value) {
        res.writeHead(400, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({ error: 'selector is required' }));
        return;
      }

      console.log(`[Pick] Applying selector: ${selector.strategy}="${selector.value}"`);

      // 대시보드에 전송
      if (this.dashboardPort) {
        try {
          const dashboardUrl = `http://localhost:${this.dashboardPort}/api/ios/pick-result`;
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
            console.log(`[Pick] Result sent to dashboard successfully`);
          } else {
            console.warn(`[Pick] Dashboard responded with ${resp.status}`);
          }
        } catch (err: any) {
          console.warn(`[Pick] Failed to send to dashboard: ${err.message}`);
        }
      }

      res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify({ ok: true, selector }));
    } catch (error: any) {
      res.writeHead(500, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify({ error: error.message }));
    }
  }

  /**
   * 두 좌표로 영역을 잡아 스크린샷을 crop하고 대시보드에 전송
   * body: { x1, y1, x2, y2 }
   */
  private async handlePickRegion(req: IncomingMessage, res: ServerResponse): Promise<void> {
    try {
      const body = await this.readBody(req);
      const { x1, y1, x2, y2 } = JSON.parse(body);

      // 좌표 정규화 (좌상단, 우하단)
      const left = Math.min(x1, x2);
      const top = Math.min(y1, y2);
      const right = Math.max(x1, x2);
      const bottom = Math.max(y1, y2);
      const w = right - left;
      const h = bottom - top;

      if (w < 5 || h < 5) {
        res.writeHead(400, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({ error: '영역이 너무 작습니다 (최소 5x5)' }));
        return;
      }

      // 스크린샷 촬영 및 crop
      const base64 = await this.controller.screenshot();
      const { PNG } = require('pngjs');
      const full = PNG.sync.read(Buffer.from(base64, 'base64'));

      // bounds 체크
      const cx = Math.max(0, Math.min(left, full.width));
      const cy = Math.max(0, Math.min(top, full.height));
      const cw = Math.min(w, full.width - cx);
      const ch = Math.min(h, full.height - cy);

      const cropped = new PNG({ width: cw, height: ch });
      PNG.bitblt(full, cropped, cx, cy, cw, ch, 0, 0);
      const croppedBase64 = PNG.sync.write(cropped).toString('base64');

      const clip = { x: cx, y: cy, width: cw, height: ch };

      console.log(`[Pick] Image region: (${cx}, ${cy}) ${cw}x${ch}`);

      // 대시보드에 전송
      if (this.dashboardPort) {
        try {
          const dashboardUrl = `http://localhost:${this.dashboardPort}/api/ios/image-match-pick-result`;
          const resp = await fetch(dashboardUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              scenarioId: this.scenarioId,
              stepIdx: this.stepIdx,
              templateBase64: croppedBase64,
              clip,
            }),
          });
          if (resp.ok) {
            console.log(`[Pick] Image match result sent to dashboard`);
          }
        } catch (err: any) {
          console.warn(`[Pick] Failed to send to dashboard: ${err.message}`);
        }
      }

      res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify({
        ok: true,
        templateBase64: croppedBase64,
        clip,
      }));
    } catch (error: any) {
      res.writeHead(500, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify({ error: error.message }));
    }
  }

  /**
   * 텍스트로 요소 검색 (label/name/value/accessibilityId 부분 일치)
   */
  private async handleSearch(req: IncomingMessage, res: ServerResponse): Promise<void> {
    try {
      const body = await this.readBody(req);
      const { query } = JSON.parse(body);

      if (!query || query.trim().length === 0) {
        res.writeHead(400, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({ error: 'query is required' }));
        return;
      }

      const xml = await this.controller.getPageSource();
      if (!xml) {
        res.writeHead(500, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({ error: 'Failed to get page source' }));
        return;
      }

      const elements = parsePageSource(xml);
      const results = searchElements(elements, query);

      console.log(`[Pick] Search "${query}": ${results.length} results found`);

      const mapped = results.map(el => ({
        type: el.type,
        label: el.label,
        name: el.name,
        value: el.value,
        accessibilityId: el.accessibilityId,
        bounds: el.bounds,
        visible: el.visible,
        selector: generateSelector(el),
      }));

      res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify({ results: mapped, total: elements.length }));
    } catch (error: any) {
      res.writeHead(500, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify({ error: error.message }));
    }
  }

  /**
   * 좌표만 대시보드에 전송 (셀렉터 없이)
   */
  private async handleApplyCoordinates(req: IncomingMessage, res: ServerResponse): Promise<void> {
    try {
      const body = await this.readBody(req);
      const { x, y } = JSON.parse(body);

      console.log(`[Pick] Applying coordinates only: (${x}, ${y})`);

      if (this.dashboardPort) {
        try {
          const dashboardUrl = `http://localhost:${this.dashboardPort}/api/ios/pick-result`;
          const resp = await fetch(dashboardUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              scenarioId: this.scenarioId,
              coordinatesOnly: true,
              coordinates: { x, y },
            }),
          });
          if (resp.ok) {
            console.log(`[Pick] Coordinates sent to dashboard successfully`);
          } else {
            console.warn(`[Pick] Dashboard responded with ${resp.status}`);
          }
        } catch (err: any) {
          console.warn(`[Pick] Failed to send to dashboard: ${err.message}`);
        }
      }

      res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify({ ok: true, coordinates: { x, y } }));
    } catch (error: any) {
      res.writeHead(500, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify({ error: error.message }));
    }
  }

  /**
   * Batch apply: 모든 pick 결과를 dashboard에 일괄 전송
   */
  private async handleBatchApply(req: IncomingMessage, res: ServerResponse): Promise<void> {
    try {
      const body = await this.readBody(req);
      const { results } = JSON.parse(body);

      if (!Array.isArray(results) || results.length === 0) {
        res.writeHead(400, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({ error: 'results[] is required' }));
        return;
      }

      console.log(`[Pick] Batch apply: ${results.length} picks`);

      if (this.dashboardPort) {
        try {
          const dashboardUrl = `http://localhost:${this.dashboardPort}/api/ios/batch-pick-result`;
          const resp = await fetch(dashboardUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              planId: this.batchPlanId,
              scenarioId: this.scenarioId,
              results,
            }),
          });
          if (resp.ok) {
            console.log(`[Pick] Batch results sent to dashboard successfully`);
          } else {
            console.warn(`[Pick] Dashboard responded with ${resp.status}`);
          }
        } catch (err: any) {
          console.warn(`[Pick] Failed to send batch results to dashboard: ${err.message}`);
        }
      }

      res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify({ ok: true, count: results.length }));
    } catch (error: any) {
      res.writeHead(500, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify({ error: error.message }));
    }
  }

  private readBody(req: IncomingMessage): Promise<string> {
    return new Promise((resolve, reject) => {
      let data = '';
      req.on('data', (chunk: Buffer) => { data += chunk.toString(); });
      req.on('end', () => resolve(data));
      req.on('error', reject);
    });
  }

  private serveHTML(res: ServerResponse): void {
    const vw = this.viewportSize.width;
    const vh = this.viewportSize.height;

    const html = `<!DOCTYPE html>
<html lang="ko"><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Katab iOS Pick (Element)</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{background:#1a1a2e;color:#e0e0e0;font-family:-apple-system,system-ui,sans-serif;display:flex;flex-direction:column;align-items:center;min-height:100vh;padding:16px}
h1{font-size:18px;margin-bottom:12px;color:#a0d2db}
.container{display:flex;gap:20px;align-items:flex-start}
.mirror-wrap{position:relative;cursor:crosshair;border:2px solid #333;border-radius:12px;overflow:hidden;background:#000}
canvas{display:block}
.controls{display:flex;flex-direction:column;gap:12px;min-width:280px;max-width:320px}
.status{font-size:12px;color:#888;padding:8px;background:#2a2a3e;border-radius:6px;line-height:1.6}
.status .label{color:#666}
.status .val{color:#a0d2db}
.tap-indicator{position:absolute;width:30px;height:30px;border:2px solid #4ade80;border-radius:50%;pointer-events:none;transform:translate(-50%,-50%);animation:tapAnim .5s ease-out forwards}
@keyframes tapAnim{0%{opacity:1;transform:translate(-50%,-50%) scale(0.5)}100%{opacity:0;transform:translate(-50%,-50%) scale(1.5)}}
.highlight-overlay{position:absolute;border:2px solid #4ade80;background:rgba(74,222,128,0.15);pointer-events:none;transition:all .2s ease;display:none;z-index:5}
.highlight-overlay.active{display:block}
.highlight-label{position:absolute;bottom:-20px;left:0;font-size:10px;color:#4ade80;white-space:nowrap;background:rgba(26,26,46,0.9);padding:1px 4px;border-radius:3px}
.pick-result{padding:12px;background:#2a2a3e;border-radius:6px;font-size:12px;line-height:1.6;display:none}
.pick-result.active{display:block}
.pick-result .el-type{color:#f59e0b;font-weight:bold;font-size:14px}
.pick-result .sel-strategy{color:#818cf8}
.pick-result .sel-value{color:#4ade80;word-break:break-all}
.pick-result .el-attr{color:#888}
.pick-result .el-attr span{color:#e0e0e0}
.candidates{margin-top:8px;border-top:1px solid #444;padding-top:8px}
.candidates .cand{padding:4px 6px;margin:2px 0;background:#1a1a2e;border-radius:4px;cursor:pointer;font-size:11px;display:flex;justify-content:space-between;align-items:center}
.candidates .cand:hover{background:#333}
.candidates .cand.selected{border:1px solid #4ade80}
.btn{padding:8px 16px;border:none;border-radius:6px;cursor:pointer;font-size:14px;font-weight:500}
.btn-apply{background:#4ade80;color:#1a1a2e;width:100%}
.btn-apply:hover{background:#22c55e}
.btn-apply:disabled{background:#444;color:#888;cursor:not-allowed}
.event-log{max-height:200px;overflow-y:auto;font-size:11px;font-family:monospace;padding:8px;background:#2a2a3e;border-radius:6px;line-height:1.5}
.event-log div{padding:2px 0;border-bottom:1px solid #333}
.hint{font-size:11px;color:#666;text-align:center;padding:4px}
.search-box{display:flex;gap:6px}
.search-box input{flex:1;padding:8px 10px;background:#2a2a3e;border:1px solid #444;border-radius:6px;color:#e0e0e0;font-size:13px;outline:none}
.search-box input:focus{border-color:#818cf8}
.search-box button{padding:8px 14px;background:#818cf8;color:#fff;border:none;border-radius:6px;cursor:pointer;font-size:13px;white-space:nowrap}
.search-box button:hover{background:#6366f1}
.search-results{max-height:250px;overflow-y:auto;font-size:12px}
.search-results .sr-item{padding:8px;margin:4px 0;background:#1a1a2e;border:1px solid #333;border-radius:6px;cursor:pointer;line-height:1.5}
.search-results .sr-item:hover{border-color:#818cf8;background:#2a2a3e}
.search-results .sr-item.selected{border-color:#4ade80}
.sr-type{color:#f59e0b;font-weight:bold}
.sr-text{color:#e0e0e0}
.sr-sel{color:#818cf8;font-size:11px}
.sr-bounds{color:#666;font-size:10px}
.sr-empty{color:#666;text-align:center;padding:12px}
.btn-coord{background:#f59e0b;color:#1a1a2e;width:100%;margin-top:4px}
.btn-coord:hover{background:#d97706}
.btn-coord:disabled{background:#444;color:#888;cursor:not-allowed}
.tab-bar{display:flex;gap:2px;margin-bottom:8px}
.tab-bar button{flex:1;padding:6px;background:#2a2a3e;border:1px solid #444;border-radius:6px 6px 0 0;color:#888;cursor:pointer;font-size:12px;border-bottom:none}
.tab-bar button.active{background:#1a1a2e;color:#a0d2db;border-color:#a0d2db}
.tab-content{display:none}
.tab-content.active{display:block}
</style>
</head><body>
<h1>Katab iOS Pick</h1>
<div class="container">
  <div class="mirror-wrap" id="mirrorWrap">
    <canvas id="canvas"></canvas>
    <div class="highlight-overlay" id="highlightOverlay"><span class="highlight-label" id="highlightLabel"></span></div>
  </div>
  <div class="controls">
    <div class="status" id="status">
      <div><span class="label">Viewport:</span> <span class="val">${vw}x${vh}</span></div>
      <div><span class="label">Status:</span> <span class="val" id="connStatus">Connecting...</span></div>
      <div><span class="label">Clicked:</span> <span class="val" id="lastCoord">-</span></div>
    </div>
    <div class="tab-bar">
      <button class="active" onclick="switchTab('pick')">Click Pick</button>
      <button onclick="switchTab('search')">Text Search</button>
    </div>
    <div class="tab-content active" id="tab-pick">
      <div class="hint">Click on the device screen to pick an element.</div>
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
      <button class="btn btn-coord" id="applyCoordBtn" disabled>Apply Coordinates Only</button>
    </div>
    <div class="tab-content" id="tab-search">
      <div class="hint">Search elements by text (label, name, accessibilityId).</div>
      <div class="search-box">
        <input type="text" id="searchInput" placeholder="e.g. My, Login, ..." />
        <button id="searchBtn">Search</button>
      </div>
      <div class="search-results" id="searchResults"></div>
      <button class="btn btn-apply" id="searchApplyBtn" disabled style="margin-top:8px">Apply Selected</button>
    </div>
    <div class="event-log" id="eventLog"></div>
  </div>
</div>
<script>
// Tab switching (global scope)
function switchTab(tab) {
  document.querySelectorAll('.tab-bar button').forEach(function(b, i) {
    b.classList.toggle('active', (tab === 'pick' && i === 0) || (tab === 'search' && i === 1));
  });
  document.getElementById('tab-pick').classList.toggle('active', tab === 'pick');
  document.getElementById('tab-search').classList.toggle('active', tab === 'search');
}

(function() {
  var canvas = document.getElementById('canvas');
  var ctx = canvas.getContext('2d');
  var wrap = document.getElementById('mirrorWrap');
  var connStatus = document.getElementById('connStatus');
  var lastCoord = document.getElementById('lastCoord');
  var pickResult = document.getElementById('pickResult');
  var elType = document.getElementById('elType');
  var selStrategy = document.getElementById('selStrategy');
  var selValue = document.getElementById('selValue');
  var elAttrs = document.getElementById('elAttrs');
  var candidatesEl = document.getElementById('candidates');
  var applyBtn = document.getElementById('applyBtn');
  var applyCoordBtn = document.getElementById('applyCoordBtn');
  var searchInput = document.getElementById('searchInput');
  var searchBtn = document.getElementById('searchBtn');
  var searchResults = document.getElementById('searchResults');
  var searchApplyBtn = document.getElementById('searchApplyBtn');
  var eventLog = document.getElementById('eventLog');

  var VIEWPORT_W = ${vw};
  var VIEWPORT_H = ${vh};
  var MAX_DISPLAY_HEIGHT = window.innerHeight - 100;
  var DISPLAY_RATIO = VIEWPORT_W / VIEWPORT_H;
  var DISPLAY_H = Math.min(MAX_DISPLAY_HEIGHT, 700);
  var DISPLAY_W = Math.round(DISPLAY_H * DISPLAY_RATIO);

  canvas.width = DISPLAY_W;
  canvas.height = DISPLAY_H;
  var highlightOverlay = document.getElementById('highlightOverlay');
  var highlightLabel = document.getElementById('highlightLabel');
  var polling = false;
  var pickBusy = false;
  var currentSelector = null;
  var currentElement = null;
  var lastDevCoord = null; // {x, y} - last clicked device coordinates
  var searchSelectedSelector = null;
  var searchSelectedElement = null;

  // 디바이스 좌표 → 캔버스 좌표 변환
  function toCanvas(devX, devY) {
    return {
      x: Math.round((devX / VIEWPORT_W) * DISPLAY_W),
      y: Math.round((devY / VIEWPORT_H) * DISPLAY_H)
    };
  }

  // 요소 bounds 하이라이트 표시
  function showHighlight(bounds, label) {
    if (!bounds || !highlightOverlay) return;
    var topLeft = toCanvas(bounds.x, bounds.y);
    var size = toCanvas(bounds.x + bounds.width, bounds.y + bounds.height);
    highlightOverlay.style.left = topLeft.x + 'px';
    highlightOverlay.style.top = topLeft.y + 'px';
    highlightOverlay.style.width = (size.x - topLeft.x) + 'px';
    highlightOverlay.style.height = (size.y - topLeft.y) + 'px';
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
      x: Math.round((canvasX / DISPLAY_W) * VIEWPORT_W),
      y: Math.round((canvasY / DISPLAY_H) * VIEWPORT_H)
    };
  }

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

    // Highlight selected candidate
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

    lastDevCoord = { x: dev.x, y: dev.y };
    lastCoord.textContent = '(' + dev.x + ', ' + dev.y + ')';
    applyCoordBtn.disabled = false;

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
        elType.textContent = data.element.type;

        // Attributes
        var attrs = [];
        if (data.element.accessibilityId) attrs.push('accessibilityId: <span>' + data.element.accessibilityId + '</span>');
        if (data.element.name) attrs.push('name: <span>' + data.element.name + '</span>');
        if (data.element.label) attrs.push('label: <span>' + data.element.label + '</span>');
        if (data.element.value) attrs.push('value: <span>' + data.element.value + '</span>');
        elAttrs.innerHTML = attrs.join('<br>');

        // 요소 bounds 하이라이트 표시
        showHighlight(data.element.bounds, data.element.type + ' (' + data.selector.strategy + ')');

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
            div.innerHTML = '<span>' + c.type + '</span><span style="color:#818cf8">' + c.selector.strategy + '="' + c.selector.value + '"</span>';
            div.onclick = function() {
              selectCandidate(c.selector, { type: c.type, label: c.label, name: c.name, accessibilityId: c.accessibilityId, bounds: c.bounds });
              showHighlight(c.bounds, c.type + ' (' + c.selector.strategy + ')');
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
        applyBtn.style.background = '#22c55e';
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
  // Apply coordinates only button
  applyCoordBtn.addEventListener('click', async function() {
    if (!lastDevCoord) return;
    applyCoordBtn.disabled = true;
    applyCoordBtn.textContent = 'Sending...';
    try {
      var res = await fetch('/apply-coordinates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ x: lastDevCoord.x, y: lastDevCoord.y })
      });
      var data = await res.json();
      if (data.ok) {
        applyCoordBtn.textContent = 'Coordinates Applied!';
        applyCoordBtn.style.background = '#22c55e';
        logEvent('coordinates applied: (' + lastDevCoord.x + ', ' + lastDevCoord.y + ')');
        setTimeout(function() {
          applyCoordBtn.textContent = 'Apply Coordinates Only';
          applyCoordBtn.style.background = '';
          applyCoordBtn.disabled = false;
        }, 2000);
      }
    } catch (err) {
      applyCoordBtn.textContent = 'Failed';
      applyCoordBtn.style.background = '#ef4444';
      logEvent('ERROR: ' + err.message);
      setTimeout(function() {
        applyCoordBtn.textContent = 'Apply Coordinates Only';
        applyCoordBtn.style.background = '';
        applyCoordBtn.disabled = false;
      }, 3000);
    }
  });

  // Search functionality
  async function doSearch() {
    var query = searchInput.value.trim();
    if (!query) return;
    searchBtn.disabled = true;
    searchBtn.textContent = '...';
    searchResults.innerHTML = '<div class="sr-empty">Searching...</div>';
    searchSelectedSelector = null;
    searchSelectedElement = null;
    searchApplyBtn.disabled = true;

    try {
      var res = await fetch('/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: query })
      });
      var data = await res.json();

      if (data.results && data.results.length > 0) {
        searchResults.innerHTML = '';
        data.results.forEach(function(r, i) {
          var div = document.createElement('div');
          div.className = 'sr-item';
          var textParts = [];
          if (r.label) textParts.push('label="' + r.label + '"');
          if (r.name && r.name !== r.label) textParts.push('name="' + r.name + '"');
          if (r.accessibilityId) textParts.push('aid="' + r.accessibilityId + '"');
          if (r.value) textParts.push('value="' + r.value + '"');
          div.innerHTML =
            '<div><span class="sr-type">' + r.type + '</span> <span class="sr-text">' + textParts.join(', ') + '</span></div>' +
            '<div><span class="sr-sel">' + r.selector.strategy + '="' + r.selector.value + '"</span></div>' +
            '<div class="sr-bounds">bounds: (' + r.bounds.x + ', ' + r.bounds.y + ') ' + r.bounds.width + 'x' + r.bounds.height + (r.visible ? '' : ' [hidden]') + '</div>';
          div.onclick = function() {
            searchResults.querySelectorAll('.sr-item').forEach(function(el) { el.classList.remove('selected'); });
            div.classList.add('selected');
            searchSelectedSelector = r.selector;
            searchSelectedElement = r;
            searchApplyBtn.disabled = false;
            // Show bounds highlight on canvas
            showHighlight(r.bounds, r.type + ' (' + r.selector.strategy + ')');
          };
          searchResults.appendChild(div);
        });
        logEvent('search "' + query + '": ' + data.results.length + ' / ' + data.total + ' elements');
      } else {
        searchResults.innerHTML = '<div class="sr-empty">No elements found for "' + query + '" (searched ' + (data.total || 0) + ' elements)</div>';
        logEvent('search "' + query + '": 0 results');
      }
    } catch (err) {
      searchResults.innerHTML = '<div class="sr-empty">Error: ' + err.message + '</div>';
      logEvent('search ERROR: ' + err.message);
    } finally {
      searchBtn.disabled = false;
      searchBtn.textContent = 'Search';
    }
  }

  searchBtn.addEventListener('click', doSearch);
  searchInput.addEventListener('keydown', function(e) {
    if (e.key === 'Enter') doSearch();
  });

  // Search apply button
  searchApplyBtn.addEventListener('click', async function() {
    if (!searchSelectedSelector) return;
    searchApplyBtn.disabled = true;
    searchApplyBtn.textContent = 'Sending...';
    try {
      var res = await fetch('/apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ selector: searchSelectedSelector, element: searchSelectedElement })
      });
      var data = await res.json();
      if (data.ok) {
        searchApplyBtn.textContent = 'Applied!';
        searchApplyBtn.style.background = '#22c55e';
        logEvent('search applied: ' + searchSelectedSelector.strategy + '="' + searchSelectedSelector.value + '"');
        setTimeout(function() {
          searchApplyBtn.textContent = 'Apply Selected';
          searchApplyBtn.style.background = '';
          searchApplyBtn.disabled = false;
        }, 2000);
      }
    } catch (err) {
      searchApplyBtn.textContent = 'Failed';
      searchApplyBtn.style.background = '#ef4444';
      logEvent('ERROR: ' + err.message);
      setTimeout(function() {
        searchApplyBtn.textContent = 'Apply Selected';
        searchApplyBtn.style.background = '';
        searchApplyBtn.disabled = false;
      }, 3000);
    }
  });
})();
</script>
</body></html>`;

    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(html);
  }

  /** Batch Pick 모드 HTML — step 큐 UI + 일괄 적용 */
  private serveBatchHTML(res: ServerResponse): void {
    const vw = this.viewportSize.width;
    const vh = this.viewportSize.height;

    const html = `<!DOCTYPE html>
<html lang="ko"><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Katab iOS Batch Pick</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{background:#1a1a2e;color:#e0e0e0;font-family:-apple-system,system-ui,sans-serif;display:flex;flex-direction:column;align-items:center;min-height:100vh;padding:16px}
h1{font-size:18px;margin-bottom:12px;color:#38bdf8}
.container{display:flex;gap:20px;align-items:flex-start}
.mirror-wrap{position:relative;cursor:crosshair;border:2px solid #333;border-radius:12px;overflow:hidden;background:#000}
canvas{display:block}
.right-panel{display:flex;flex-direction:column;gap:12px;min-width:340px;max-width:380px}
.status{font-size:12px;color:#888;padding:8px;background:#2a2a3e;border-radius:6px;line-height:1.6}
.status .label{color:#666}
.status .val{color:#38bdf8}
.queue-header{display:flex;justify-content:space-between;align-items:center;padding:8px 12px;background:#2a2a3e;border-radius:6px 6px 0 0;font-size:13px;font-weight:600;color:#38bdf8}
.queue-list{max-height:300px;overflow-y:auto;background:#2a2a3e;border-radius:0 0 6px 6px;padding:4px}
.queue-item{padding:6px 10px;margin:2px 0;border-radius:4px;font-size:12px;cursor:pointer;display:flex;align-items:center;gap:6px;line-height:1.3;border:1px solid transparent}
.queue-item:hover{background:#333}
.queue-item.active{border-color:#38bdf8;background:#1e3a5f}
.queue-item.done{opacity:0.7}
.queue-item.ctx{opacity:0.5;cursor:default;font-size:11px}
.queue-item.ctx:hover{background:transparent}
.queue-item .q-idx{color:#666;font-size:10px;min-width:24px;text-align:right}
.queue-item.pickable .q-idx{color:#38bdf8;font-weight:bold}
.queue-item .q-type{font-size:10px;padding:1px 5px;border-radius:3px;background:#333;color:#888;white-space:nowrap}
.queue-item.pickable .q-type{background:#1e3a5f;color:#38bdf8}
.queue-item .q-desc{flex:1;color:#999;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:11px}
.queue-item.pickable .q-desc{color:#ccc}
.queue-item .q-sel{color:#666;font-size:10px;max-width:100px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.queue-item .q-status{font-size:14px;min-width:18px;text-align:center}
.highlight-overlay{position:absolute;border:2px solid #38bdf8;background:rgba(56,189,248,0.15);pointer-events:none;transition:all .2s ease;display:none;z-index:5}
.highlight-overlay.active{display:block}
.highlight-label{position:absolute;bottom:-20px;left:0;font-size:10px;color:#38bdf8;white-space:nowrap;background:rgba(26,26,46,0.9);padding:1px 4px;border-radius:3px}
.pick-result{padding:12px;background:#2a2a3e;border-radius:6px;font-size:12px;line-height:1.6;display:none}
.pick-result.active{display:block}
.pick-result .el-type{color:#f59e0b;font-weight:bold;font-size:14px}
.pick-result .sel-strategy{color:#818cf8}
.pick-result .sel-value{color:#4ade80;word-break:break-all}
.pick-result .el-attr{color:#888}
.pick-result .el-attr span{color:#e0e0e0}
.candidates{margin-top:8px;border-top:1px solid #444;padding-top:8px}
.candidates .cand{padding:4px 6px;margin:2px 0;background:#1a1a2e;border-radius:4px;cursor:pointer;font-size:11px;display:flex;justify-content:space-between;align-items:center}
.candidates .cand:hover{background:#333}
.candidates .cand.selected{border:1px solid #4ade80}
.btn{padding:8px 16px;border:none;border-radius:6px;cursor:pointer;font-size:14px;font-weight:500}
.btn-queue{background:#38bdf8;color:#1a1a2e;flex:1}
.btn-queue:hover{background:#0ea5e9}
.btn-queue:disabled{background:#444;color:#888;cursor:not-allowed}
.btn-skip{background:transparent;border:1px solid #666;color:#888;flex:1}
.btn-skip:hover{border-color:#38bdf8;color:#38bdf8}
.btn-apply-all{background:#4ade80;color:#1a1a2e;width:100%;font-size:15px;padding:10px}
.btn-apply-all:hover{background:#22c55e}
.btn-apply-all:disabled{background:#444;color:#888;cursor:not-allowed}
.action-row{display:flex;gap:8px}
.tap-indicator{position:absolute;width:30px;height:30px;border:2px solid #38bdf8;border-radius:50%;pointer-events:none;transform:translate(-50%,-50%);animation:tapAnim .5s ease-out forwards}
@keyframes tapAnim{0%{opacity:1;transform:translate(-50%,-50%) scale(0.5)}100%{opacity:0;transform:translate(-50%,-50%) scale(1.5)}}
.event-log{max-height:150px;overflow-y:auto;font-size:11px;font-family:monospace;padding:8px;background:#2a2a3e;border-radius:6px;line-height:1.5}
.event-log div{padding:2px 0;border-bottom:1px solid #333}
</style>
</head><body>
<h1>Katab iOS Batch Pick</h1>
<div class="container">
  <div class="mirror-wrap" id="mirrorWrap">
    <canvas id="canvas"></canvas>
    <div class="highlight-overlay" id="highlightOverlay"><span class="highlight-label" id="highlightLabel"></span></div>
  </div>
  <div class="right-panel">
    <div class="status">
      <div><span class="label">Viewport:</span> <span class="val">${vw}x${vh}</span></div>
      <div><span class="label">Status:</span> <span class="val" id="connStatus">Connecting...</span></div>
      <div><span class="label">Clicked:</span> <span class="val" id="lastCoord">-</span></div>
    </div>
    <div>
      <div class="queue-header"><span>Step Queue</span><span id="queueProgress">0/0 picked</span></div>
      <div class="queue-list" id="queueList"></div>
    </div>
    <div class="pick-result" id="pickResult">
      <div class="el-type" id="elType"></div>
      <div style="margin-top:4px">
        <span class="sel-strategy" id="selStrategy"></span>
        <span class="sel-value" id="selValue"></span>
      </div>
      <div class="el-attr" id="elAttrs"></div>
      <div class="candidates" id="candidates"></div>
      <div class="action-row" style="margin-top:8px">
        <button class="btn btn-queue" id="queueBtn" disabled>Queue for Step</button>
        <button class="btn btn-skip" id="skipBtn">Skip</button>
      </div>
    </div>
    <button class="btn btn-apply-all" id="applyAllBtn" disabled>Apply All (0 picks)</button>
    <div class="event-log" id="eventLog"></div>
  </div>
</div>
<script>
(function() {
  var canvas = document.getElementById('canvas');
  var ctx = canvas.getContext('2d');
  var wrap = document.getElementById('mirrorWrap');
  var connStatus = document.getElementById('connStatus');
  var lastCoord = document.getElementById('lastCoord');
  var queueList = document.getElementById('queueList');
  var queueProgress = document.getElementById('queueProgress');
  var pickResult = document.getElementById('pickResult');
  var elType = document.getElementById('elType');
  var selStrategy = document.getElementById('selStrategy');
  var selValue = document.getElementById('selValue');
  var elAttrs = document.getElementById('elAttrs');
  var candidatesEl = document.getElementById('candidates');
  var queueBtn = document.getElementById('queueBtn');
  var skipBtn = document.getElementById('skipBtn');
  var applyAllBtn = document.getElementById('applyAllBtn');
  var highlightOverlay = document.getElementById('highlightOverlay');
  var highlightLabel = document.getElementById('highlightLabel');
  var eventLog = document.getElementById('eventLog');

  var VIEWPORT_W = ${vw};
  var VIEWPORT_H = ${vh};
  var MAX_DISPLAY_HEIGHT = window.innerHeight - 100;
  var DISPLAY_RATIO = VIEWPORT_W / VIEWPORT_H;
  var DISPLAY_H = Math.min(MAX_DISPLAY_HEIGHT, 700);
  var DISPLAY_W = Math.round(DISPLAY_H * DISPLAY_RATIO);

  canvas.width = DISPLAY_W;
  canvas.height = DISPLAY_H;

  var polling = false;
  var pickBusy = false;
  var steps = [];
  var batchResults = []; // sparse array indexed by queue position
  var currentQueueIdx = 0;
  var currentSelector = null;
  var currentElement = null;

  function toCanvas(devX, devY) {
    return { x: Math.round((devX / VIEWPORT_W) * DISPLAY_W), y: Math.round((devY / VIEWPORT_H) * DISPLAY_H) };
  }
  function toDevice(cx, cy) {
    return { x: Math.round((cx / DISPLAY_W) * VIEWPORT_W), y: Math.round((cy / DISPLAY_H) * VIEWPORT_H) };
  }
  function showHighlight(bounds, label) {
    if (!bounds) return;
    var tl = toCanvas(bounds.x, bounds.y);
    var br = toCanvas(bounds.x + bounds.width, bounds.y + bounds.height);
    highlightOverlay.style.left = tl.x + 'px';
    highlightOverlay.style.top = tl.y + 'px';
    highlightOverlay.style.width = (br.x - tl.x) + 'px';
    highlightOverlay.style.height = (br.y - tl.y) + 'px';
    highlightOverlay.classList.add('active');
    if (highlightLabel) highlightLabel.textContent = label || '';
  }
  function hideHighlight() { highlightOverlay.classList.remove('active'); }
  function showTap(cx, cy) {
    var dot = document.createElement('div');
    dot.className = 'tap-indicator';
    dot.style.left = cx + 'px'; dot.style.top = cy + 'px';
    wrap.appendChild(dot);
    setTimeout(function() { dot.remove(); }, 500);
  }
  function logEvent(msg) {
    var div = document.createElement('div');
    div.textContent = new Date().toLocaleTimeString() + ' ' + msg;
    eventLog.prepend(div);
    if (eventLog.children.length > 50) eventLog.lastChild.remove();
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
        img.onload = function() { ctx.drawImage(img, 0, 0, DISPLAY_W, DISPLAY_H); };
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

  // Load batch plan
  async function loadPlan() {
    try {
      var res = await fetch('/batch-plan');
      var plan = await res.json();
      steps = plan.steps || [];
      batchResults = new Array(steps.length);
      // find first pickable step
      currentQueueIdx = -1;
      for (var k = 0; k < steps.length; k++) {
        if (steps[k].pickable) { currentQueueIdx = k; break; }
      }
      renderQueue();
      var pickableCount = steps.filter(function(s) { return s.pickable; }).length;
      logEvent('Batch plan loaded: ' + steps.length + ' steps (' + pickableCount + ' pickable)');
    } catch (e) {
      logEvent('ERROR: Failed to load plan: ' + e.message);
    }
  }

  function escHtml(str) { var d = document.createElement('div'); d.textContent = str; return d.innerHTML; }

  function renderQueue() {
    queueList.innerHTML = '';
    var picked = 0;
    var pickableTotal = 0;
    for (var i = 0; i < steps.length; i++) {
      var s = steps[i];
      var isPickable = !!s.pickable;
      if (isPickable) pickableTotal++;
      var item = document.createElement('div');
      item.className = 'queue-item';
      if (isPickable) item.classList.add('pickable');
      else item.classList.add('ctx');
      if (isPickable && i === currentQueueIdx) item.classList.add('active');
      if (isPickable && batchResults[i]) { item.classList.add('done'); picked++; }

      var statusIcon = '';
      if (isPickable) {
        statusIcon = batchResults[i] ? '\\u2713' : (i === currentQueueIdx ? '\\u2190' : '');
      }

      var descText = s.description ? escHtml(s.description).substring(0, 50) : '';
      var selText = '';
      if (s.currentSelector) selText = s.currentSelector.strategy + '="' + s.currentSelector.value + '"';
      else if (s.value) selText = escHtml(s.value);

      item.innerHTML = '<span class="q-idx">#' + s.stepIdx + '</span>' +
        '<span class="q-type">' + escHtml(s.type) + '</span>' +
        '<span class="q-desc">' + (descText || selText || '') + '</span>' +
        (isPickable && selText && descText ? '<span class="q-sel" title="' + escHtml(selText) + '">' + escHtml(selText).substring(0, 20) + '</span>' : '') +
        '<span class="q-status">' + statusIcon + '</span>';

      item.dataset.idx = String(i);
      if (isPickable) {
        item.onclick = function() {
          currentQueueIdx = parseInt(this.dataset.idx);
          renderQueue();
          updateQueueBtn();
        };
      }
      queueList.appendChild(item);
    }
    queueProgress.textContent = picked + '/' + pickableTotal + ' picked';
    applyAllBtn.textContent = 'Apply All (' + picked + ' picks)';
    applyAllBtn.disabled = picked === 0;
    // Auto-scroll to active item
    var activeEl = queueList.querySelector('.active');
    if (activeEl) activeEl.scrollIntoView({ block: 'nearest' });
  }

  function updateQueueBtn() {
    var s = currentQueueIdx >= 0 && currentQueueIdx < steps.length ? steps[currentQueueIdx] : null;
    if (currentSelector && s && s.pickable) {
      queueBtn.disabled = false;
      queueBtn.textContent = 'Queue for Step #' + s.stepIdx;
    } else {
      queueBtn.disabled = true;
      queueBtn.textContent = 'Queue for Step';
    }
  }

  function goToNextUnpicked() {
    for (var i = currentQueueIdx + 1; i < steps.length; i++) {
      if (steps[i].pickable && !batchResults[i]) { currentQueueIdx = i; renderQueue(); updateQueueBtn(); return; }
    }
    // wrap around
    for (var j = 0; j < currentQueueIdx; j++) {
      if (steps[j].pickable && !batchResults[j]) { currentQueueIdx = j; renderQueue(); updateQueueBtn(); return; }
    }
    renderQueue();
    updateQueueBtn();
  }

  function selectCandidate(selector, element) {
    currentSelector = selector;
    currentElement = element;
    selStrategy.textContent = selector.strategy + ' = ';
    selValue.textContent = '"' + selector.value + '"';
    updateQueueBtn();
    var items = candidatesEl.querySelectorAll('.cand');
    items.forEach(function(item) { item.classList.toggle('selected', item.dataset.value === selector.value); });
  }

  // Click → pick element
  canvas.addEventListener('click', async function(e) {
    if (pickBusy) return;
    pickBusy = true;
    var rect = canvas.getBoundingClientRect();
    var cx = e.clientX - rect.left;
    var cy = e.clientY - rect.top;
    var dev = toDevice(cx, cy);
    lastCoord.textContent = '(' + dev.x + ', ' + dev.y + ')';
    showTap(cx, cy);
    logEvent('pick (' + dev.x + ', ' + dev.y + ')');
    try {
      var res = await fetch('/pick', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ x: dev.x, y: dev.y }) });
      var data = await res.json();
      if (data.found) {
        pickResult.classList.add('active');
        elType.textContent = data.element.type;
        var attrs = [];
        if (data.element.accessibilityId) attrs.push('accessibilityId: <span>' + data.element.accessibilityId + '</span>');
        if (data.element.name) attrs.push('name: <span>' + data.element.name + '</span>');
        if (data.element.label) attrs.push('label: <span>' + data.element.label + '</span>');
        if (data.element.value) attrs.push('value: <span>' + data.element.value + '</span>');
        elAttrs.innerHTML = attrs.join('<br>');
        showHighlight(data.element.bounds, data.element.type + ' (' + data.selector.strategy + ')');
        selectCandidate(data.selector, data.element);
        if (data.candidates && data.candidates.length > 1) {
          candidatesEl.innerHTML = '<div style="color:#888;font-size:10px;margin-bottom:4px">Other candidates:</div>';
          data.candidates.forEach(function(c) {
            var div = document.createElement('div');
            div.className = 'cand';
            if (c.selector.value === data.selector.value) div.classList.add('selected');
            div.dataset.value = c.selector.value;
            div.innerHTML = '<span>' + c.type + '</span><span style="color:#818cf8">' + c.selector.strategy + '="' + c.selector.value + '"</span>';
            div.onclick = function() {
              selectCandidate(c.selector, { type: c.type, label: c.label, name: c.name, accessibilityId: c.accessibilityId, bounds: c.bounds });
              showHighlight(c.bounds, c.type + ' (' + c.selector.strategy + ')');
            };
            candidatesEl.appendChild(div);
          });
        } else { candidatesEl.innerHTML = ''; }
        logEvent('found: ' + data.selector.strategy + '="' + data.selector.value + '"');
      } else {
        logEvent('no element at (' + dev.x + ', ' + dev.y + ')');
        pickResult.classList.remove('active');
        currentSelector = null; currentElement = null;
        hideHighlight();
        updateQueueBtn();
      }
    } catch (err) { logEvent('ERROR: ' + err.message); }
    finally { pickBusy = false; }
  });

  // Queue button: save result and move to next
  queueBtn.addEventListener('click', function() {
    if (!currentSelector || currentQueueIdx < 0 || currentQueueIdx >= steps.length) return;
    var s = steps[currentQueueIdx];
    if (!s.pickable) return;
    batchResults[currentQueueIdx] = {
      stepIdx: s.stepIdx,
      selector: currentSelector,
      element: currentElement,
      coordinates: currentElement && currentElement.bounds ? {
        x: Math.round(currentElement.bounds.x + currentElement.bounds.width / 2),
        y: Math.round(currentElement.bounds.y + currentElement.bounds.height / 2)
      } : undefined
    };
    logEvent('Queued #' + s.stepIdx + ': ' + currentSelector.strategy + '="' + currentSelector.value + '"');
    pickResult.classList.remove('active');
    currentSelector = null; currentElement = null;
    hideHighlight();
    goToNextUnpicked();
  });

  // Skip button
  skipBtn.addEventListener('click', function() {
    if (currentQueueIdx < 0 || currentQueueIdx >= steps.length) return;
    logEvent('Skipped step #' + steps[currentQueueIdx].stepIdx);
    goToNextUnpicked();
  });

  // Apply All button
  applyAllBtn.addEventListener('click', async function() {
    var results = batchResults.filter(Boolean);
    if (results.length === 0) return;
    applyAllBtn.disabled = true;
    applyAllBtn.textContent = 'Sending...';
    try {
      var res = await fetch('/batch-apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ results: results })
      });
      var data = await res.json();
      if (data.ok) {
        applyAllBtn.textContent = 'Applied ' + results.length + ' picks!';
        applyAllBtn.style.background = '#22c55e';
        logEvent('Batch applied: ' + results.length + ' picks sent to dashboard');
      } else {
        throw new Error(data.error || 'Apply failed');
      }
    } catch (err) {
      applyAllBtn.textContent = 'Failed: ' + err.message;
      applyAllBtn.style.background = '#ef4444';
      logEvent('ERROR: ' + err.message);
      setTimeout(function() {
        applyAllBtn.style.background = '';
        renderQueue();
      }, 3000);
    }
  });

  loadPlan();
})();
</script>
</body></html>`;

    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(html);
  }

  /** Image Match Pick 모드 전용 HTML — 두 점 클릭으로 영역 선택 + 캡처 */
  private serveImageMatchHTML(res: ServerResponse): void {
    const vw = this.viewportSize.width;
    const vh = this.viewportSize.height;

    const html = `<!DOCTYPE html>
<html lang="ko"><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Katab iOS Image Match Pick</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{background:#1a1a2e;color:#e0e0e0;font-family:-apple-system,system-ui,sans-serif;display:flex;flex-direction:column;align-items:center;min-height:100vh;padding:16px}
h1{font-size:18px;margin-bottom:12px;color:#e879f9}
.container{display:flex;gap:20px;align-items:flex-start}
.mirror-wrap{position:relative;cursor:crosshair;border:2px solid #333;border-radius:12px;overflow:hidden;background:#000}
canvas{display:block}
.controls{display:flex;flex-direction:column;gap:12px;min-width:300px;max-width:340px}
.status{font-size:12px;color:#888;padding:8px;background:#2a2a3e;border-radius:6px;line-height:1.6}
.status .label{color:#666}
.status .val{color:#e879f9}
.guide{background:#2a2a3e;border:1px solid #e879f9;border-radius:8px;padding:12px;font-size:13px;line-height:1.6}
.guide .step{display:flex;gap:8px;align-items:flex-start;margin-bottom:6px}
.guide .step-num{background:#e879f9;color:#1a1a2e;width:22px;height:22px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-weight:bold;font-size:12px;flex-shrink:0}
.guide .step-num.done{background:#4ade80}
.guide .step-num.active{animation:pulse 1.5s infinite}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:0.5}}
.preview{margin-top:8px;border:1px solid #444;border-radius:6px;overflow:hidden;display:none}
.preview img{max-width:100%;display:block}
.preview .preview-info{padding:6px 8px;font-size:11px;color:#888;background:#2a2a3e}
.region-rect{position:absolute;border:2px dashed #e879f9;background:rgba(232,121,249,0.1);pointer-events:none}
.pick-dot{position:absolute;width:12px;height:12px;background:#e879f9;border:2px solid #fff;border-radius:50%;pointer-events:none;transform:translate(-50%,-50%);z-index:10}
.btn{padding:10px 16px;border:none;border-radius:6px;cursor:pointer;font-size:14px;font-weight:500;width:100%}
.btn-apply{background:#e879f9;color:#1a1a2e}
.btn-apply:hover{background:#d946ef}
.btn-apply:disabled{background:#444;color:#888;cursor:not-allowed}
.btn-reset{background:transparent;border:1px solid #666;color:#888;margin-top:4px}
.btn-reset:hover{border-color:#e879f9;color:#e879f9}
.event-log{max-height:150px;overflow-y:auto;font-size:11px;font-family:monospace;padding:8px;background:#2a2a3e;border-radius:6px;line-height:1.5}
.event-log div{padding:2px 0;border-bottom:1px solid #333}
</style>
</head><body>
<h1>Katab iOS Image Match Pick</h1>
<div class="container">
  <div class="mirror-wrap" id="mirrorWrap">
    <canvas id="canvas"></canvas>
  </div>
  <div class="controls">
    <div class="status" id="status">
      <div><span class="label">Viewport:</span> <span class="val">${vw}x${vh}</span></div>
      <div><span class="label">Status:</span> <span class="val" id="connStatus">Connecting...</span></div>
    </div>
    <div class="guide">
      <div style="font-weight:bold;margin-bottom:8px;color:#e879f9">Image Match 영역 선택</div>
      <div class="step"><span class="step-num active" id="s1">1</span><span>좌상단 점을 클릭하세요</span></div>
      <div class="step"><span class="step-num" id="s2">2</span><span>우하단 점을 클릭하세요</span></div>
      <div class="step"><span class="step-num" id="s3">3</span><span>"적용" 버튼을 누르세요</span></div>
    </div>
    <div class="preview" id="preview">
      <img id="previewImg">
      <div class="preview-info" id="previewInfo"></div>
    </div>
    <button class="btn btn-apply" id="applyBtn" disabled>적용 (Apply to Dashboard)</button>
    <button class="btn btn-reset" id="resetBtn">초기화 (Reset)</button>
    <div class="event-log" id="eventLog"></div>
  </div>
</div>
<script>
(function() {
  var canvas = document.getElementById('canvas');
  var ctx = canvas.getContext('2d');
  var wrap = document.getElementById('mirrorWrap');
  var connStatus = document.getElementById('connStatus');
  var applyBtn = document.getElementById('applyBtn');
  var resetBtn = document.getElementById('resetBtn');
  var eventLog = document.getElementById('eventLog');
  var previewDiv = document.getElementById('preview');
  var previewImg = document.getElementById('previewImg');
  var previewInfo = document.getElementById('previewInfo');
  var s1 = document.getElementById('s1');
  var s2 = document.getElementById('s2');
  var s3 = document.getElementById('s3');

  var VIEWPORT_W = ${vw};
  var VIEWPORT_H = ${vh};
  var MAX_DISPLAY_HEIGHT = window.innerHeight - 100;
  var DISPLAY_H = Math.min(MAX_DISPLAY_HEIGHT, 700);
  var DISPLAY_W = Math.round(DISPLAY_H * (VIEWPORT_W / VIEWPORT_H));

  canvas.width = DISPLAY_W;
  canvas.height = DISPLAY_H;

  var polling = false;
  var point1 = null;  // {canvasX, canvasY, devX, devY}
  var point2 = null;
  var regionData = null; // {templateBase64, clip}
  var dot1El = null;
  var dot2El = null;
  var rectEl = null;

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

  function toDevice(cx, cy) {
    return { x: Math.round((cx / DISPLAY_W) * VIEWPORT_W), y: Math.round((cy / DISPLAY_H) * VIEWPORT_H) };
  }

  function logEvent(msg) {
    var div = document.createElement('div');
    div.textContent = new Date().toLocaleTimeString() + ' ' + msg;
    eventLog.prepend(div);
    if (eventLog.children.length > 30) eventLog.lastChild.remove();
  }

  function addDot(cx, cy, id) {
    var existing = document.getElementById(id);
    if (existing) existing.remove();
    var dot = document.createElement('div');
    dot.className = 'pick-dot';
    dot.id = id;
    dot.style.left = cx + 'px';
    dot.style.top = cy + 'px';
    wrap.appendChild(dot);
    return dot;
  }

  function showRect() {
    if (rectEl) rectEl.remove();
    if (!point1 || !point2) return;
    var left = Math.min(point1.canvasX, point2.canvasX);
    var top = Math.min(point1.canvasY, point2.canvasY);
    var w = Math.abs(point2.canvasX - point1.canvasX);
    var h = Math.abs(point2.canvasY - point1.canvasY);
    var rect = document.createElement('div');
    rect.className = 'region-rect';
    rect.style.left = left + 'px';
    rect.style.top = top + 'px';
    rect.style.width = w + 'px';
    rect.style.height = h + 'px';
    wrap.appendChild(rect);
    rectEl = rect;
  }

  function resetPick() {
    point1 = null; point2 = null; regionData = null;
    if (dot1El) { dot1El.remove(); dot1El = null; }
    if (dot2El) { dot2El.remove(); dot2El = null; }
    if (rectEl) { rectEl.remove(); rectEl = null; }
    previewDiv.style.display = 'none';
    applyBtn.disabled = true;
    s1.className = 'step-num active'; s2.className = 'step-num'; s3.className = 'step-num';
    logEvent('reset');
  }

  resetBtn.addEventListener('click', resetPick);

  canvas.addEventListener('click', async function(e) {
    var rect = canvas.getBoundingClientRect();
    var cx = e.clientX - rect.left;
    var cy = e.clientY - rect.top;
    var dev = toDevice(cx, cy);

    if (!point1) {
      // 1번 점
      point1 = { canvasX: cx, canvasY: cy, devX: dev.x, devY: dev.y };
      dot1El = addDot(cx, cy, 'dot1');
      s1.className = 'step-num done'; s2.className = 'step-num active';
      logEvent('Point 1: (' + dev.x + ', ' + dev.y + ')');
    } else if (!point2) {
      // 2번 점
      point2 = { canvasX: cx, canvasY: cy, devX: dev.x, devY: dev.y };
      dot2El = addDot(cx, cy, 'dot2');
      showRect();
      s2.className = 'step-num done'; s3.className = 'step-num active';
      logEvent('Point 2: (' + dev.x + ', ' + dev.y + ')');

      // 서버에 영역 전송 → crop된 이미지 수신
      try {
        var res = await fetch('/pick-region', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ x1: point1.devX, y1: point1.devY, x2: point2.devX, y2: point2.devY })
        });
        var data = await res.json();
        if (data.ok) {
          regionData = data;
          previewImg.src = 'data:image/png;base64,' + data.templateBase64;
          previewInfo.textContent = 'Clip: (' + data.clip.x + ', ' + data.clip.y + ') ' + data.clip.width + 'x' + data.clip.height;
          previewDiv.style.display = 'block';
          applyBtn.disabled = false;
          logEvent('Region captured: ' + data.clip.width + 'x' + data.clip.height);
        } else {
          logEvent('ERROR: ' + (data.error || 'Unknown'));
          resetPick();
        }
      } catch(err) {
        logEvent('ERROR: ' + err.message);
        resetPick();
      }
    }
  });

  applyBtn.addEventListener('click', async function() {
    if (!regionData) return;
    applyBtn.disabled = true;
    applyBtn.textContent = 'Sending...';

    try {
      // pick-region already sent to dashboard, just confirm
      applyBtn.textContent = 'Applied!';
      applyBtn.style.background = '#4ade80';
      s3.className = 'step-num done';
      logEvent('applied to dashboard');
      setTimeout(function() {
        applyBtn.textContent = 'Applied!';
        applyBtn.style.background = '#4ade80';
      }, 2000);
    } catch(err) {
      applyBtn.textContent = 'Failed';
      applyBtn.style.background = '#ef4444';
      logEvent('ERROR: ' + err.message);
    }
  });
})();
</script>
</body></html>`;

    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(html);
  }
}
