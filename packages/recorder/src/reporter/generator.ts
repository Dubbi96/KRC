import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';
import type { TestResult, EventResult, AssertionResult } from '../types';

export class ReportGenerator {
  generateHTML(result: TestResult, outputDir: string): string {
    const reportPath = join(outputDir, 'report.html');
    if (!existsSync(outputDir)) mkdirSync(outputDir, { recursive: true });
    writeFileSync(reportPath, this.buildHTML(result), 'utf-8');
    return reportPath;
  }

  generateJSON(result: TestResult, outputDir: string): string {
    const reportPath = join(outputDir, 'result.json');
    if (!existsSync(outputDir)) mkdirSync(outputDir, { recursive: true });
    writeFileSync(reportPath, JSON.stringify(result, null, 2), 'utf-8');
    return reportPath;
  }

  private buildHTML(result: TestResult): string {
    const statusColor = result.status === 'passed' ? '#10b981' : '#ef4444';
    const statusIcon = result.status === 'passed' ? '\u2713' : '\u2717';
    const passed = result.events.filter(e => e.status === 'passed').length;
    const failed = result.events.filter(e => e.status === 'failed').length;
    const skipped = result.events.filter(e => e.status === 'skipped').length;

    const rows = result.events.map((ev, i) => this.buildEventRow(ev, i)).join('');

    // 어설션 요약
    const as = result.assertionsSummary;
    const assertionSummaryHtml = as ? `
      <div class="summary-item"><div class="label">Assertions</div>
        <div class="value" style="font-size:20px">${as.passed}/${as.total} passed</div>
      </div>` : '';

    // TC ID / 데이터셋
    const tcMeta = [
      result.tcId ? `TC: ${this.esc(result.tcId)}` : '',
      result.testDataSetName ? `Dataset: ${this.esc(result.testDataSetName)}` : '',
    ].filter(Boolean).join(' | ');

    // 변수 테이블
    const varsHtml = result.variables && Object.keys(result.variables).length > 0
      ? this.buildVariablesSection(result.variables)
      : '';

    return `<!DOCTYPE html>
<html lang="ko"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Test Report - ${this.esc(result.scenarioName)}</title>
<style>
*{box-sizing:border-box}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;margin:0;padding:20px;background:#f9fafb;color:#111827}
.container{max-width:1400px;margin:0 auto;background:#fff;border-radius:12px;box-shadow:0 1px 3px rgba(0,0,0,.1);overflow:hidden}
.header{padding:28px 32px;background:linear-gradient(135deg,#667eea,#764ba2);color:#fff}
.header h1{margin:0 0 6px;font-size:26px;font-weight:700}
.header .meta{font-size:14px;opacity:.9;line-height:1.6}
.header .tc-badge{display:inline-block;background:rgba(255,255,255,.2);padding:3px 10px;border-radius:20px;font-size:13px;margin-top:6px}
.summary{padding:24px 32px;display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:16px;border-bottom:1px solid #e5e7eb}
.summary-item{text-align:center}
.summary-item .label{font-size:11px;color:#6b7280;text-transform:uppercase;letter-spacing:.5px;margin-bottom:4px}
.summary-item .value{font-size:32px;font-weight:bold;color:#111827}
.content{padding:24px 32px}
.section-title{font-size:18px;font-weight:700;margin:28px 0 12px;color:#374151;border-bottom:2px solid #e5e7eb;padding-bottom:8px}
.section-title:first-child{margin-top:0}
table{width:100%;border-collapse:collapse;margin-top:8px;font-size:14px}
th{background:#f9fafb;padding:10px 12px;text-align:left;font-weight:600;color:#374151;border-bottom:2px solid #e5e7eb}
td{padding:10px 12px;border-bottom:1px solid #f3f4f6;vertical-align:top}
tr:hover{background:#fafbfc}
.status-badge{display:inline-block;padding:2px 10px;border-radius:12px;font-size:12px;font-weight:600}
.status-passed{background:#d1fae5;color:#065f46}
.status-failed{background:#fee2e2;color:#991b1b}
.status-skipped{background:#e5e7eb;color:#6b7280}
.step-detail{font-size:12px;color:#6b7280;margin-top:4px}
.error-inline{color:#dc2626;font-size:12px;margin-top:4px}
.assertion-list{list-style:none;padding:0;margin:4px 0 0}
.assertion-list li{font-size:12px;padding:3px 0;border-bottom:1px dotted #e5e7eb}
.assertion-list li:last-child{border:none}
.assert-pass{color:#065f46}
.assert-fail{color:#991b1b}
.api-detail{background:#f3f4f6;border-radius:6px;padding:10px;margin-top:6px;font-size:12px;font-family:'SF Mono',Monaco,monospace}
.api-detail .api-label{font-weight:600;color:#374151}
.var-table{background:#fffbeb;border:1px solid #fde68a;border-radius:8px;padding:16px;margin-top:12px}
.var-table h3{margin:0 0 8px;font-size:14px;color:#92400e}
.var-table table{margin:0}
.var-table td,.var-table th{padding:6px 12px;font-size:13px}
.var-table th{background:#fef3c7}
.captured-vars{font-size:12px;color:#7c3aed;margin-top:4px}
.screenshot-img{max-width:100%;margin-top:8px;border:1px solid #e5e7eb;border-radius:6px;cursor:pointer;transition:transform .2s}
.screenshot-img:hover{transform:scale(1.02)}
.screenshot-error{border:2px solid #ef4444;border-radius:8px;margin-top:8px;overflow:hidden}
.screenshot-error img{max-width:100%;display:block}
.screenshot-error .screenshot-label{background:#ef4444;color:#fff;padding:4px 12px;font-size:11px;font-weight:600}
.screenshot-timeout{border:2px solid #f59e0b;border-radius:8px;margin-top:8px;overflow:hidden}
.screenshot-timeout img{max-width:100%;display:block}
.screenshot-timeout .screenshot-label{background:#f59e0b;color:#fff;padding:4px 12px;font-size:11px;font-weight:600}
.img-match-compare{margin-top:10px;border:1px solid #e5e7eb;border-radius:8px;overflow:hidden}
.img-match-compare .img-match-header{background:#f3e8ff;padding:8px 12px;font-size:13px;font-weight:600;color:#7c3aed;display:flex;align-items:center;justify-content:space-between}
.img-match-compare .img-match-grid{display:grid;grid-template-columns:1fr 1fr 1fr;gap:2px;background:#e5e7eb;padding:2px}
.img-match-compare .img-match-cell{background:#fff;text-align:center;padding:4px}
.img-match-compare .img-match-cell img{max-width:100%;max-height:200px;display:block;margin:0 auto}
.img-match-compare .img-match-cell .img-label{font-size:10px;color:#6b7280;margin-bottom:2px;font-weight:600}
.img-match-badge{display:inline-block;padding:2px 8px;border-radius:10px;font-size:11px;font-weight:600}
.img-match-pass{background:#d1fae5;color:#065f46}
.img-match-fail{background:#fee2e2;color:#991b1b}
.error-detail{background:#fef2f2;border:1px solid #fecaca;border-radius:6px;padding:10px 14px;margin-top:6px;font-size:12px;white-space:pre-wrap;font-family:'SF Mono',Monaco,monospace;color:#991b1b;line-height:1.6}
.error-section{margin-top:28px;padding:20px;background:#fef2f2;border-left:4px solid #ef4444;border-radius:0 8px 8px 0}
.error-section h3{margin:0 0 10px;color:#dc2626;font-size:16px}
.error-section pre{margin:0;padding:14px;background:#fff;border-radius:6px;overflow-x:auto;font-size:12px;color:#991b1b;line-height:1.5}
.footer{padding:16px 32px;background:#f9fafb;border-top:1px solid #e5e7eb;font-size:12px;color:#9ca3af;text-align:center}
</style></head><body><div class="container">
<div class="header">
  <h1>${this.esc(result.scenarioName)}</h1>
  <div class="meta">
    Platform: ${result.platform.toUpperCase()} | ID: ${result.scenarioId}<br>
    ${new Date(result.startedAt).toLocaleString()} ~ ${new Date(result.completedAt).toLocaleString()}
  </div>
  ${tcMeta ? `<div class="tc-badge">${this.esc(tcMeta)}</div>` : ''}
</div>

<div class="summary">
  <div class="summary-item"><div class="label">Status</div>
    <div class="value" style="color:${statusColor}">${statusIcon} ${result.status.toUpperCase()}</div></div>
  <div class="summary-item"><div class="label">Duration</div>
    <div class="value">${(result.duration / 1000).toFixed(2)}s</div></div>
  <div class="summary-item"><div class="label">Steps</div>
    <div class="value">${result.events.length}</div></div>
  <div class="summary-item"><div class="label">Passed</div>
    <div class="value" style="color:#10b981">${passed}</div></div>
  <div class="summary-item"><div class="label">Failed</div>
    <div class="value" style="color:#ef4444">${failed}</div></div>
  ${skipped > 0 ? `<div class="summary-item"><div class="label">Skipped</div>
    <div class="value" style="color:#6b7280">${skipped}</div></div>` : ''}
  ${assertionSummaryHtml}
</div>

<div class="content">
  <h2 class="section-title">Step Details</h2>
  <table>
    <thead><tr>
      <th style="width:50px">#</th>
      <th style="width:80px">Step</th>
      <th style="width:120px">Type</th>
      <th style="width:100px">Status</th>
      <th style="width:80px">Duration</th>
      <th>Description / Details</th>
    </tr></thead>
    <tbody>${rows}</tbody>
  </table>

  ${varsHtml}

  ${result.error ? `<div class="error-section">
    <h3>Global Error</h3>
    <pre>${this.esc(result.error)}</pre>
    ${result.stackTrace ? `<pre style="margin-top:10px;color:#6b7280">${this.esc(result.stackTrace)}</pre>` : ''}
  </div>` : ''}
</div>

<div class="footer">
  Generated by Katab &mdash; Recording-based QA Test Platform
</div>
</div></body></html>`;
  }

  /** 개별 이벤트 행 생성 */
  private buildEventRow(ev: EventResult, i: number): string {
    const statusClass = ev.status === 'passed' ? 'status-passed'
      : ev.status === 'failed' ? 'status-failed' : 'status-skipped';
    const statusIcon = ev.status === 'passed' ? '\u2713'
      : ev.status === 'failed' ? '\u2717' : '\u2014';

    const stepNo = ev.stepNo ?? (i + 1);

    // 설명
    const descHtml = ev.description
      ? `<div style="font-weight:500">${this.esc(ev.description)}</div>`
      : '';

    // 에러 — 여러 줄 에러 메시지는 pre-wrap으로 표시
    const errorHtml = ev.error
      ? (ev.error.includes('\n')
        ? `<div class="error-detail">${this.esc(ev.error)}</div>`
        : `<div class="error-inline">\u2717 ${this.esc(ev.error)}</div>`)
      : '';

    // 어설션 결과
    const assertHtml = ev.assertionResults && ev.assertionResults.length > 0
      ? this.buildAssertionList(ev.assertionResults)
      : '';

    // API 응답
    const apiHtml = ev.apiResponse
      ? `<div class="api-detail">
          <span class="api-label">HTTP ${ev.apiResponse.status}</span>
          &nbsp;(${ev.apiResponse.duration}ms)
          <pre style="margin:6px 0 0;max-height:200px;overflow:auto">${this.esc(
            typeof ev.apiResponse.body === 'string'
              ? ev.apiResponse.body.substring(0, 1000)
              : JSON.stringify(ev.apiResponse.body, null, 2).substring(0, 1000)
          )}</pre>
        </div>`
      : '';

    // 선택자 해결 전략
    const resolvedHtml = ev.resolvedBy && !ev.resolvedBy.startsWith('primary:')
      ? `<div class="step-detail" style="color:#7c3aed">&#x1f504; Fallback: ${this.esc(ev.resolvedBy)}</div>`
      : '';

    // 캡처된 변수
    const capturedHtml = ev.capturedVariables && Object.keys(ev.capturedVariables).length > 0
      ? `<div class="captured-vars">\ud83d\udccc Captured: ${Object.entries(ev.capturedVariables)
          .map(([k, v]) => `<b>${this.esc(k)}</b>=${this.esc(String(v).substring(0, 100))}`)
          .join(', ')}</div>`
      : '';

    // image_match 비교 결과 이미지
    const imgMatchHtml = ev.imageMatchData
      ? this.buildImageMatchCompare(ev.imageMatchData)
      : '';

    // OCR 결과
    const ocrHtml = ev.ocrResult
      ? this.buildOcrResult(ev.ocrResult)
      : '';

    // 스크린샷 — 에러/타임아웃 스크린샷 구분 표시
    // 스크린샷 경로를 상대 경로로 변환 (screenshots/step_001.png)
    const ssRelPath = ev.screenshot
      ? (ev.screenshot.includes('/screenshots/') ? 'screenshots/' + ev.screenshot.split('/screenshots/').pop() : ev.screenshot)
      : '';
    const isTimeout = ev.screenshot && ssRelPath.includes('_timeout');
    const isError = ev.screenshot && ev.status === 'failed' && !isTimeout;
    let ssHtml = '';
    if (ev.screenshot) {
      if (isTimeout) {
        ssHtml = `<div class="screenshot-timeout">
            <div class="screenshot-label">\u23F1 타임아웃 시점 스크린샷</div>
            <img src="${this.esc(ssRelPath)}" alt="Step ${stepNo} timeout screenshot">
          </div>`;
      } else if (isError) {
        ssHtml = `<div class="screenshot-error">
            <div class="screenshot-label">\u26A0 실패 시점 스크린샷</div>
            <img src="${this.esc(ssRelPath)}" alt="Step ${stepNo} error screenshot">
          </div>`;
      } else {
        ssHtml = `<img class="screenshot-img" src="${this.esc(ssRelPath)}" alt="Step ${stepNo} screenshot">`;
      }
    } else if (ev.artifacts?.screenshotBase64) {
      // 파일 경로가 없지만 base64 스크린샷이 artifacts에 있는 경우 (iOS/Android 모바일)
      const b64Src = `data:image/png;base64,${ev.artifacts.screenshotBase64}`;
      if (ev.status === 'failed') {
        ssHtml = `<div class="screenshot-error">
            <div class="screenshot-label">\u26A0 실패 시점 스크린샷</div>
            <img src="${b64Src}" alt="Step ${stepNo} error screenshot">
          </div>`;
      } else {
        ssHtml = `<img class="screenshot-img" src="${b64Src}" alt="Step ${stepNo} screenshot">`;
      }
    }

    return `<tr>
      <td>${stepNo}</td>
      <td style="font-size:12px;color:#6b7280">${ev.stepNo ? `Step ${ev.stepNo}` : `#${i + 1}`}</td>
      <td><code style="background:#f3f4f6;padding:2px 6px;border-radius:4px;font-size:13px">${this.esc(ev.eventType)}</code></td>
      <td><span class="status-badge ${statusClass}">${statusIcon} ${ev.status.toUpperCase()}</span></td>
      <td>${(ev.duration / 1000).toFixed(2)}s</td>
      <td>
        ${descHtml}
        ${errorHtml}
        ${resolvedHtml}
        ${assertHtml}
        ${apiHtml}
        ${capturedHtml}
        ${imgMatchHtml}
        ${ocrHtml}
        ${ssHtml}
      </td>
    </tr>`;
  }

  /** 어설션 결과 목록 */
  private buildAssertionList(results: AssertionResult[]): string {
    const items = results.map(r => {
      const cls = r.passed ? 'assert-pass' : 'assert-fail';
      const icon = r.passed ? '\u2713' : '\u2717';
      const detail = r.actual ? ` (actual: ${this.esc(r.actual)})` : '';
      const errMsg = !r.passed && r.error ? ` \u2014 ${this.esc(r.error)}` : '';
      return `<li class="${cls}">${icon} <b>${this.esc(r.assertion.type)}</b>: expected "${this.esc(r.assertion.expected)}"${detail}${errMsg}</li>`;
    }).join('');
    return `<ul class="assertion-list">${items}</ul>`;
  }

  /** 최종 변수 상태 섹션 */
  private buildVariablesSection(variables: Record<string, string>): string {
    const entries = Object.entries(variables);
    if (entries.length === 0) return '';
    const rows = entries.map(([k, v]) =>
      `<tr><td><code>${this.esc(k)}</code></td><td>${this.esc(String(v).substring(0, 200))}</td></tr>`
    ).join('');
    return `
      <div class="var-table">
        <h3>\ud83d\udcca Variables (Final State)</h3>
        <table>
          <thead><tr><th>Name</th><th>Value</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>`;
  }

  /** image_match 비교 결과 이미지 3개 표시 */
  private buildImageMatchCompare(data: NonNullable<EventResult['imageMatchData']>): string {
    const badgeCls = data.matched ? 'img-match-pass' : 'img-match-fail';
    const badgeText = data.matched
      ? `\u2713 MATCH (diff ${data.diffPercent}%)`
      : `\u2717 MISMATCH (diff ${data.diffPercent}%)`;
    const clipInfo = data.clip
      ? ` | Clip: (${data.clip.x}, ${data.clip.y}) ${data.clip.width}\u00D7${data.clip.height}`
      : '';

    const templateImg = `<div class="img-match-cell"><div class="img-label">Template</div><img src="data:image/png;base64,${data.templateBase64}" alt="template"></div>`;
    const shotImg = `<div class="img-match-cell"><div class="img-label">Screenshot</div><img src="data:image/png;base64,${data.screenshotBase64}" alt="screenshot"></div>`;
    const diffImg = data.diffBase64
      ? `<div class="img-match-cell"><div class="img-label">Diff</div><img src="data:image/png;base64,${data.diffBase64}" alt="diff"></div>`
      : `<div class="img-match-cell"><div class="img-label">Diff</div><div style="padding:20px;color:#999;font-size:12px">N/A</div></div>`;

    return `<div class="img-match-compare">
      <div class="img-match-header">
        <span>\uD83D\uDDBC Image Match</span>
        <span class="img-match-badge ${badgeCls}">${badgeText}</span>
      </div>
      <div style="padding:4px 12px;font-size:11px;color:#6b7280">${clipInfo}</div>
      <div class="img-match-grid">${templateImg}${shotImg}${diffImg}</div>
    </div>`;
  }

  /** OCR 결과 표시 */
  private buildOcrResult(data: NonNullable<EventResult['ocrResult']>): string {
    const confPercent = (data.confidence * 100).toFixed(1);
    const confColor = data.confidence >= 0.7 ? '#16a34a' : data.confidence >= 0.4 ? '#eab308' : '#ef4444';
    const engineLabel = data.engine || 'unknown';
    const retryInfo = data.retryCount ? ` | Retries: ${data.retryCount}` : '';

    return `<div class="captured-vars" style="border-left:3px solid #14b8a6;padding:6px 10px;margin:4px 0;background:#f0fdfa">
      <div style="font-size:11px;font-weight:600;color:#14b8a6;margin-bottom:4px">\uD83D\uDD0D OCR Extract</div>
      <div style="font-size:12px">
        <span style="color:#6b7280">Raw:</span> <code>${this.esc(data.rawText.substring(0, 100))}</code><br>
        <span style="color:#6b7280">Result:</span> <code><b>${this.esc(data.processedText.substring(0, 100))}</b></code><br>
        <span style="color:#6b7280">Confidence:</span> <span style="color:${confColor};font-weight:600">${confPercent}%</span>
        <span style="color:#9ca3af;margin-left:8px">Engine: ${this.esc(engineLabel)}${retryInfo}</span>
      </div>
    </div>`;
  }

  private esc(text: string): string {
    return text.replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[m] || m));
  }
}
