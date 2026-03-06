/**
 * Web Recording Session
 *
 * Uses Playwright to launch a browser, inject Katab_Stack's event-capture scripts,
 * and stream screenshots via the AnySession interface.
 *
 * The RECORDING_SCRIPT and SPA_NAVIGATION_SCRIPT are ported directly from
 * Katab_Stack/packages/recorder/src/web/recorder.ts for full feature parity:
 *   - Rich element metadata (role, label, testId, boundingBox, visibility)
 *   - PreferredLocators for self-healing replay
 *   - Multiple selector candidates
 *   - SPA navigation detection (pushState/replaceState/popstate/hashchange)
 *   - Select/change events
 *   - PageContext (scroll, viewport, readyState, title)
 */

import { EventEmitter } from 'events';

export type WebSessionStatus = 'creating' | 'active' | 'recording' | 'closing' | 'closed' | 'error';

export interface WebRecordingOptions {
  url: string;
  headless?: boolean;
  viewport?: { width: number; height: number };
  deviceType?: string;
  fps?: number;
}

export interface WebRecordedEvent {
  type: string;
  timestamp: number;
  selector?: string;
  value?: string;
  url?: string;
  key?: string;
  meta?: Record<string, any>;
  dialogConfig?: any;
}

/**
 * Full Katab_Stack recording script — captures click, fill, select events
 * with rich element metadata, preferredLocators, and multiple selector candidates.
 */
const RECORDING_SCRIPT = `
(function() {
  if (window.__katabRecording) return;
  window.__katabRecording = true;

  function getSelector(el) {
    if (!el || !el.getAttribute) return '';
    var testId = el.getAttribute('data-testid');
    if (testId) return '[data-testid="' + testId + '"]';
    if (el.id) {
      if (/[.:\\\\[\\\\]()>+~,\\\\s]/.test(el.id)) return '[id="' + el.id + '"]';
      return '#' + el.id;
    }
    var name = el.getAttribute('name');
    if (name) return '[name="' + name + '"]';
    var placeholder = el.getAttribute('placeholder');
    if (placeholder) return '[placeholder="' + placeholder + '"]';
    var tag = el.tagName.toLowerCase();
    if (el.className && typeof el.className === 'string') {
      var cls = el.className.trim().split(/\\s+/).filter(Boolean).slice(0, 3).join('.');
      if (cls) return tag + '.' + cls;
    }
    return tag;
  }

  function makeUnique(sel, el) {
    try {
      var matches = document.querySelectorAll(sel);
      if (matches.length === 1) return sel;
      var parent = el.parentElement;
      if (parent) {
        var siblings = Array.from(parent.children).filter(function(c) { return c.tagName === el.tagName; });
        var idx = siblings.indexOf(el);
        if (idx >= 0) {
          var refined = sel + ':nth-of-type(' + (idx + 1) + ')';
          try { if (document.querySelectorAll(refined).length === 1) return refined; } catch(e2) {}
        }
      }
    } catch (e) {}
    return null;
  }

  function getUniqueSelector(el) {
    var sel = getSelector(el);
    var unique = makeUnique(sel, el);
    return unique || sel;
  }

  function getAllSelectors(el) {
    if (!el || !el.getAttribute) return [];
    var tag = el.tagName ? el.tagName.toLowerCase() : '';
    var results = [];
    var candidates = [];
    var testId = el.getAttribute('data-testid');
    if (testId) candidates.push('[data-testid="' + testId + '"]');
    if (el.id) {
      if (/[.:\\\\[\\\\]()>+~,\\\\s]/.test(el.id)) candidates.push('[id="' + el.id + '"]');
      else candidates.push('#' + el.id);
    }
    var name = el.getAttribute('name');
    if (name) candidates.push('[name="' + name + '"]');
    var placeholder = el.getAttribute('placeholder');
    if (placeholder) candidates.push('[placeholder="' + placeholder + '"]');
    var ariaLabel = el.getAttribute('aria-label');
    if (ariaLabel) candidates.push('[aria-label="' + ariaLabel + '"]');
    if (el.className && typeof el.className === 'string') {
      var cls = el.className.trim().split(/\\s+/).filter(Boolean).slice(0, 3).join('.');
      if (cls) candidates.push(tag + '.' + cls);
    }
    var type = el.getAttribute('type');
    if (type && (tag === 'input' || tag === 'button')) candidates.push(tag + '[type="' + type + '"]');
    var role = el.getAttribute('role');
    if (role) candidates.push('[role="' + role + '"]');
    for (var i = 0; i < candidates.length && results.length < 10; i++) {
      var unique = makeUnique(candidates[i], el);
      if (unique && results.indexOf(unique) === -1) results.push(unique);
    }
    return results;
  }

  function getElementMetadata(el) {
    if (!el) return {};
    var meta = {};
    var tag = el.tagName ? el.tagName.toLowerCase() : '';
    meta.type = tag;
    var text = (el.textContent || '').trim();
    if (text) meta.textContent = text.length <= 200 ? text : text.substring(0, 200);
    try {
      var innerText = (el.innerText || '').trim();
      if (innerText && innerText !== text) meta.innerText = innerText.length <= 200 ? innerText : innerText.substring(0, 200);
    } catch(e) {}
    var ariaLabel = el.getAttribute('aria-label');
    if (ariaLabel) meta.label = ariaLabel;
    if (!meta.label) {
      var labelledBy = el.getAttribute('aria-labelledby');
      if (labelledBy) {
        try {
          var ids = labelledBy.split(/\\s+/);
          var parts = [];
          for (var li = 0; li < ids.length; li++) {
            var refEl = document.getElementById(ids[li]);
            if (refEl) { var rt = (refEl.textContent || '').trim(); if (rt) parts.push(rt); }
          }
          if (parts.length > 0) meta.label = parts.join(' ');
        } catch(e) {}
      }
    }
    if (tag === 'input' || tag === 'select' || tag === 'textarea') {
      if (!meta.label && el.id) {
        try { var labelEl = document.querySelector('label[for="' + CSS.escape(el.id) + '"]'); if (labelEl) meta.label = (labelEl.textContent || '').trim(); } catch(e) {}
      }
      if (!meta.label) { try { var parentLabel = el.closest('label'); if (parentLabel) meta.label = (parentLabel.textContent || '').trim(); } catch(e) {} }
    }
    var role = el.getAttribute('role');
    if (role) { meta.role = role; } else {
      var implicitRoles = { 'a': 'link', 'button': 'button', 'select': 'combobox', 'textarea': 'textbox', 'img': 'img', 'nav': 'navigation', 'h1': 'heading', 'h2': 'heading', 'h3': 'heading' };
      if (tag === 'input') {
        var inputType = (el.getAttribute('type') || 'text').toLowerCase();
        var inputRoles = { 'button': 'button', 'checkbox': 'checkbox', 'radio': 'radio', 'submit': 'button', 'text': 'textbox', 'email': 'textbox', 'password': 'textbox', 'tel': 'textbox', 'url': 'textbox', 'search': 'searchbox' };
        if (inputRoles[inputType]) meta.role = inputRoles[inputType];
      } else if (implicitRoles[tag]) meta.role = implicitRoles[tag];
    }
    var nameAttr = el.getAttribute('name');
    if (nameAttr) meta.name = nameAttr;
    var testId = el.getAttribute('data-testid');
    if (testId) meta.testId = testId;
    var title = el.getAttribute('title');
    if (title) meta.title = title;
    var placeholderAttr = el.getAttribute('placeholder');
    if (placeholderAttr) meta.placeholder = placeholderAttr;
    try { var rect = el.getBoundingClientRect(); meta.boundingBox = { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) }; } catch(e) {}
    try { var cStyle = window.getComputedStyle(el); meta.isVisible = (cStyle.display !== 'none' && cStyle.visibility !== 'hidden' && parseFloat(cStyle.opacity) > 0); } catch(e) {}
    meta.isEnabled = !el.disabled && !el.hasAttribute('aria-disabled');
    var rawText = (el.textContent || '').trim().replace(/\\s+/g, ' ');
    if (rawText) meta.textNormalized = rawText.length <= 200 ? rawText : rawText.substring(0, 200);
    return meta;
  }

  function buildPreferredLocators(el) {
    if (!el || !el.getAttribute) return [];
    var locators = [];
    var tag = el.tagName ? el.tagName.toLowerCase() : '';
    var testId = el.getAttribute('data-testid');
    if (testId) locators.push({ kind: 'testid', value: testId });
    var role = el.getAttribute('role');
    if (!role) {
      var implicitRoles = { 'a': 'link', 'button': 'button', 'select': 'combobox', 'textarea': 'textbox' };
      if (tag === 'input') {
        var inputType = (el.getAttribute('type') || 'text').toLowerCase();
        var inputRoles = { 'button': 'button', 'checkbox': 'checkbox', 'radio': 'radio', 'submit': 'button', 'text': 'textbox', 'email': 'textbox', 'password': 'textbox' };
        role = inputRoles[inputType] || null;
      } else role = implicitRoles[tag] || null;
    }
    if (role) {
      var accessibleName = el.getAttribute('aria-label') || '';
      if (!accessibleName) { var visibleText = (el.innerText || el.textContent || '').trim(); if (visibleText && visibleText.length <= 80) accessibleName = visibleText; }
      locators.push({ kind: 'role', value: role, role: role, name: accessibleName || undefined });
    }
    if (tag === 'input' || tag === 'select' || tag === 'textarea') {
      var labelText = '';
      if (el.id) { try { var lbl = document.querySelector('label[for="' + CSS.escape(el.id) + '"]'); if (lbl) labelText = (lbl.textContent || '').trim(); } catch(e) {} }
      if (!labelText) { try { var pLabel = el.closest('label'); if (pLabel) labelText = (pLabel.textContent || '').trim(); } catch(e) {} }
      if (labelText) locators.push({ kind: 'label', value: labelText });
    }
    var ph = el.getAttribute('placeholder');
    if (ph) locators.push({ kind: 'placeholder', value: ph });
    var titleAttr = el.getAttribute('title');
    if (titleAttr) locators.push({ kind: 'title', value: titleAttr });
    var visibleText = (el.innerText || el.textContent || '').trim();
    if (visibleText && visibleText.length <= 60) locators.push({ kind: 'text', value: visibleText });
    var cssSel = getUniqueSelector(el);
    if (cssSel) locators.push({ kind: 'css', value: cssSel });
    return locators;
  }

  function getPageContext() {
    return { scrollX: Math.round(window.scrollX), scrollY: Math.round(window.scrollY), viewportWidth: window.innerWidth, viewportHeight: window.innerHeight, readyState: document.readyState, title: document.title };
  }

  // Click
  document.addEventListener('click', function(e) {
    var target = e.target;
    if (!target) return;
    var selector = getUniqueSelector(target);
    if (typeof window.__katabRecordEvent === 'function') {
      window.__katabRecordEvent(JSON.stringify({
        type: 'click', selector: selector,
        meta: { source: 'user_interaction', element: getElementMetadata(target), selectors: getAllSelectors(target), preferredLocators: buildPreferredLocators(target), pageContext: getPageContext() }
      }));
    }
  }, true);

  // Fill (input with debounce)
  var inputTimer = null;
  var lastInputTarget = null;
  document.addEventListener('input', function(e) {
    var target = e.target;
    if (!target || !('value' in target)) return;
    var inputType = (target.getAttribute && target.getAttribute('type') || '').toLowerCase();
    if (inputType === 'checkbox' || inputType === 'radio') return;
    lastInputTarget = target;
    clearTimeout(inputTimer);
    inputTimer = setTimeout(function() {
      if (lastInputTarget && 'value' in lastInputTarget) {
        var selector = getUniqueSelector(lastInputTarget);
        if (typeof window.__katabRecordEvent === 'function') {
          window.__katabRecordEvent(JSON.stringify({
            type: 'fill', selector: selector, value: lastInputTarget.value,
            meta: { source: 'user_interaction', element: getElementMetadata(lastInputTarget), selectors: getAllSelectors(lastInputTarget), preferredLocators: buildPreferredLocators(lastInputTarget), pageContext: getPageContext() }
          }));
        }
      }
    }, 500);
  }, true);

  // Select (dropdown change)
  document.addEventListener('change', function(e) {
    var target = e.target;
    if (!target || target.tagName !== 'SELECT') return;
    var selector = getUniqueSelector(target);
    if (typeof window.__katabRecordEvent === 'function') {
      window.__katabRecordEvent(JSON.stringify({
        type: 'select', selector: selector, value: target.value,
        meta: { source: 'user_interaction', element: getElementMetadata(target), selectors: getAllSelectors(target), preferredLocators: buildPreferredLocators(target), pageContext: getPageContext() }
      }));
    }
  }, true);

  // Keyboard shortcuts
  document.addEventListener('keydown', function(e) {
    if (['Enter','Escape','Tab'].includes(e.key) || (e.ctrlKey || e.metaKey)) {
      if (typeof window.__katabRecordEvent === 'function') {
        window.__katabRecordEvent(JSON.stringify({
          type: 'keyboard', meta: { key: e.key, ctrl: e.ctrlKey, meta: e.metaKey, shift: e.shiftKey, source: 'user_interaction', pageContext: getPageContext() }
        }));
      }
    }
  }, true);
})();
`;

/**
 * SPA navigation detection — captures pushState, replaceState, popstate, hashchange.
 */
const SPA_NAVIGATION_SCRIPT = `
(function() {
  if (window.__katabSpaNav) return;
  window.__katabSpaNav = true;
  var lastUrl = location.href;
  function checkUrlChange(source) {
    var currentUrl = location.href;
    if (currentUrl !== lastUrl) {
      lastUrl = currentUrl;
      if (window.__katabRecordEvent) {
        window.__katabRecordEvent(JSON.stringify({
          type: 'navigate', url: currentUrl,
          meta: { source: source, pageContext: { scrollX: Math.round(window.scrollX), scrollY: Math.round(window.scrollY), viewportWidth: window.innerWidth, viewportHeight: window.innerHeight, readyState: document.readyState, title: document.title } }
        }));
      }
    }
  }
  var origPushState = history.pushState;
  history.pushState = function() { origPushState.apply(this, arguments); checkUrlChange('spa_pushState'); };
  var origReplaceState = history.replaceState;
  history.replaceState = function() { origReplaceState.apply(this, arguments); checkUrlChange('spa_replaceState'); };
  window.addEventListener('popstate', function() { checkUrlChange('spa_popstate'); });
  window.addEventListener('hashchange', function() { checkUrlChange('spa_hashchange'); });
})();
`;

export class WebRecordingSession extends EventEmitter {
  readonly id: string;
  status: WebSessionStatus = 'creating';
  createdAt: string;

  private browser: any = null;
  private context: any = null;
  private page: any = null;
  private screenshotTimer: NodeJS.Timeout | null = null;
  private recording = false;
  private recordedEvents: WebRecordedEvent[] = [];
  private options: WebRecordingOptions;

  // Multi-page/popup tracking
  private pages = new Map<string, any>();      // pageId → Playwright Page
  private activePageId: string = 'main';
  private popupCounter = 0;

  constructor(id: string, options: WebRecordingOptions) {
    super();
    this.id = id;
    this.options = options;
    this.createdAt = new Date().toISOString();
  }

  async start(): Promise<void> {
    this.status = 'creating';
    this.emit('status', this.status);

    try {
      let chromium: any;
      try {
        const pw = require('playwright');
        chromium = pw.chromium;
      } catch {
        throw new Error(
          'Playwright is not installed. Run:\n  npm install playwright\n  npx playwright install chromium',
        );
      }

      this.browser = await chromium.launch({
        headless: this.options.headless !== false,
      });

      this.context = await this.browser.newContext({
        viewport: this.options.viewport || { width: 1280, height: 720 },
      });

      this.page = await this.context.newPage();

      // Register main page
      this.pages.set('main', this.page);
      this.activePageId = 'main';

      // Expose event callback before navigation
      await this.page.exposeFunction('__katabRecordEvent', (eventJson: string) => {
        this.handleRecordEvent(eventJson, 'main');
      });

      // Inject full Katab_Stack recording scripts into every frame
      await this.context.addInitScript({ content: RECORDING_SCRIPT });
      await this.context.addInitScript({ content: SPA_NAVIGATION_SCRIPT });

      // Navigate to URL
      if (this.options.url) {
        await this.page.goto(this.options.url, { waitUntil: 'domcontentloaded' });
      }

      // Set up page-level listeners for main page
      this.setupPageListeners(this.page, 'main');

      // Listen for popup/new-tab windows on the browser context
      this.context.on('page', async (popup: any) => {
        this.popupCounter++;
        const pageId = `popup_${this.popupCounter}`;

        this.pages.set(pageId, popup);

        // Expose recording callback on the popup page
        try {
          await popup.exposeFunction('__katabRecordEvent', (eventJson: string) => {
            this.handleRecordEvent(eventJson, pageId);
          });
        } catch {}

        // Wait for popup to load enough to get title/url
        try { await popup.waitForLoadState('domcontentloaded', { timeout: 5000 }); } catch {}

        this.setupPageListeners(popup, pageId);

        // Auto-switch to the new popup
        this.activePageId = pageId;

        if (this.recording) {
          this.recordedEvents.push({
            type: 'popup_opened',
            timestamp: Date.now(),
            url: popup.url(),
            meta: { pageId, openerPageId: 'main' },
          });
        }

        // Emit updated page list to dashboard
        this.emitPageList();

        // When popup closes, clean up
        popup.on('close', () => {
          if (this.recording) {
            this.recordedEvents.push({
              type: 'popup_closed',
              timestamp: Date.now(),
              meta: { pageId },
            });
          }
          this.pages.delete(pageId);
          // If the active page was closed, switch back to main
          if (this.activePageId === pageId) {
            // Find last open page or fall back to main
            const openIds = [...this.pages.keys()];
            this.activePageId = openIds[openIds.length - 1] || 'main';
          }
          this.emitPageList();
        });
      });

      this.status = 'active';
      this.emit('status', this.status);

      // Emit initial page list
      this.emitPageList();

      // Start screenshot streaming
      this.startScreenshotPolling();
    } catch (err: any) {
      this.status = 'error';
      this.emit('status', this.status);
      this.emit('error', err.message);
      throw err;
    }
  }

  private startScreenshotPolling() {
    const fps = this.options.fps || 2;
    const intervalMs = Math.max(200, Math.floor(1000 / fps));

    this.screenshotTimer = setInterval(async () => {
      if (this.status !== 'active' && this.status !== 'recording') return;
      const targetPage = this.getActivePage();
      if (!targetPage) return;
      try {
        const buffer = await targetPage.screenshot({ type: 'jpeg', quality: 60 });
        const base64 = buffer.toString('base64');
        this.emit('frame', base64);
      } catch {
        // page might be navigating or closed
      }
    }, intervalMs);
  }

  /** Get the currently active page (popup or main). */
  private getActivePage(): any {
    const page = this.pages.get(this.activePageId);
    if (page && !page.isClosed()) return page;
    // Fallback to main if active page was closed
    const main = this.pages.get('main');
    if (main && !main.isClosed()) {
      this.activePageId = 'main';
      return main;
    }
    return null;
  }

  /** Handle recording event from any page, tagging with pageId. */
  private handleRecordEvent(eventJson: string, pageId: string) {
    try {
      const event: WebRecordedEvent = JSON.parse(eventJson);
      event.timestamp = Date.now();
      if (!event.meta) event.meta = {};
      event.meta.pageId = pageId;
      if (this.recording) {
        this.recordedEvents.push(event);
      }
      this.emit('event', event);
    } catch {}
  }

  /** Set up load and dialog listeners for a page. */
  private setupPageListeners(page: any, pageId: string) {
    page.on('load', () => {
      if (this.recording) {
        this.recordedEvents.push({
          type: 'navigate',
          timestamp: Date.now(),
          url: page.url(),
          meta: { source: 'page_load', pageId },
        });
      }
      // Update page list (title may have changed)
      this.emitPageList();
    });

    page.on('dialog', async (dialog: any) => {
      const dialogType = dialog.type();
      const message = dialog.message();
      const defaultValue = dialog.defaultValue?.() || '';

      if (this.recording) {
        this.recordedEvents.push({
          type: 'dialog',
          timestamp: Date.now(),
          dialogConfig: { dialogType, message, defaultValue: defaultValue || undefined, action: 'accept' },
          meta: { pageId },
        });
      }

      try {
        if (dialogType === 'prompt') await dialog.accept(defaultValue || '');
        else await dialog.accept();
      } catch {}
    });
  }

  /** Emit the current page list to the dashboard. */
  private async emitPageList() {
    const list: { id: string; title: string; url: string; isPopup: boolean }[] = [];
    for (const [id, page] of this.pages) {
      if (page.isClosed()) continue;
      let title = '';
      let url = '';
      try { url = page.url() || ''; } catch {}
      try { title = await page.title(); } catch {}
      list.push({ id, title, url, isPopup: id !== 'main' });
    }
    this.emit('pages', list);
  }

  /** Switch the active page (called from dashboard via switch_page message). */
  switchPage(pageId: string) {
    if (this.pages.has(pageId)) {
      const page = this.pages.get(pageId);
      if (page && !page.isClosed()) {
        this.activePageId = pageId;
        // Bring page to front so Playwright can interact with it
        page.bringToFront().catch(() => {});
      }
    }
  }

  async handleAction(action: any): Promise<void> {
    const page = this.getActivePage();
    if (!page) return;

    try {
      switch (action.type) {
        case 'click':
          if (action.selector) {
            await page.click(action.selector, { timeout: 5000 }).catch(() => {
              if (action.x !== undefined) return page.mouse.click(action.x, action.y);
            });
          } else if (action.x !== undefined) {
            await page.mouse.click(action.x, action.y);
          }
          break;

        case 'fill':
        case 'type':
          if (action.selector && (action.value !== undefined || action.text !== undefined)) {
            await page.fill(action.selector, action.value ?? action.text, { timeout: 5000 });
          } else if (action.text || action.value) {
            await page.keyboard.type(action.text || action.value);
          }
          break;

        case 'select':
          if (action.selector && action.value !== undefined) {
            await page.selectOption(action.selector, action.value, { timeout: 5000 });
          }
          break;

        case 'navigate':
          if (action.url) {
            await page.goto(action.url, { waitUntil: 'domcontentloaded' });
          }
          break;

        case 'keyboard':
          if (action.key) {
            await page.keyboard.press(action.key);
          }
          break;

        case 'scroll': {
          let dx = action.deltaX || 0;
          let dy = action.deltaY || 0;
          if (!dx && !dy && action.direction) {
            dy = action.direction === 'up' ? -300 : 300;
          }
          await page.mouse.wheel(dx, dy);
          break;
        }

        case 'back':
          await page.goBack();
          break;

        case 'forward':
          await page.goForward();
          break;

        case 'hover':
          if (action.selector) {
            await page.hover(action.selector, { timeout: 5000 });
          } else if (action.x !== undefined) {
            await page.mouse.move(action.x, action.y);
          }
          break;

        case 'refresh':
          await page.reload({ waitUntil: 'domcontentloaded' });
          break;

        case 'double_click':
        case 'dblclick':
          if (action.selector) {
            await page.dblclick(action.selector, { timeout: 5000 });
          } else if (action.x !== undefined) {
            await page.mouse.dblclick(action.x, action.y);
          }
          break;
      }
    } catch (err: any) {
      this.emit('error', `Action failed: ${err.message}`);
    }
  }

  startRecording() {
    this.recording = true;
    this.recordedEvents = [];
    if (this.page) {
      this.recordedEvents.push({
        type: 'navigate',
        timestamp: Date.now(),
        url: this.page.url(),
        meta: { source: 'recording_start' },
      });
    }
    if (this.status === 'active') {
      this.status = 'recording';
      this.emit('status', this.status);
    }
  }

  stopRecording(): WebRecordedEvent[] {
    this.recording = false;
    const events = [...this.recordedEvents];
    this.recordedEvents = [];
    if (this.status === 'recording') {
      this.status = 'active';
      this.emit('status', this.status);
    }
    return events;
  }

  async close(): Promise<void> {
    this.status = 'closing';
    this.emit('status', this.status);

    if (this.screenshotTimer) {
      clearInterval(this.screenshotTimer);
      this.screenshotTimer = null;
    }

    try {
      if (this.browser) {
        await this.browser.close();
        this.browser = null;
      }
    } catch {}

    this.status = 'closed';
    this.emit('status', this.status);
    this.removeAllListeners();
  }

  getInfo(): any {
    return {
      id: this.id,
      platform: 'web',
      deviceId: 'browser',
      status: this.status,
      recording: this.recording,
      screenSize: this.options.viewport || { width: 1280, height: 720 },
      createdAt: this.createdAt,
      fps: this.options.fps || 2,
      eventCount: this.recordedEvents.length,
      url: this.page?.url() || this.options.url,
    };
  }
}
