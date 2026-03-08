"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.WebRecorder = exports.SPA_NAVIGATION_SCRIPT = exports.RECORDING_SCRIPT = void 0;
const playwright_1 = require("playwright");
const crypto_1 = require("crypto");
const file_storage_1 = require("../storage/file-storage");
const auth_store_1 = require("../dashboard/auth-store");
const device_presets_1 = require("./device-presets");
const event_buffer_1 = require("./event-buffer");
const page_registry_1 = require("./page-registry");
exports.RECORDING_SCRIPT = `
(function() {
  function getSelector(el) {
    if (!el || !el.getAttribute) return '';
    var testId = el.getAttribute('data-testid');
    if (testId) return '[data-testid="' + testId + '"]';
    if (el.id) {
      if (/[.:\\[\\]()>+~,\\s]/.test(el.id)) return '[id="' + el.id + '"]';
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
    var results = [];
    var tag = el.tagName ? el.tagName.toLowerCase() : '';
    var candidates = [];

    var testId = el.getAttribute('data-testid');
    if (testId) candidates.push('[data-testid="' + testId + '"]');

    if (el.id) {
      if (/[.:\\[\\]()>+~,\\s]/.test(el.id)) candidates.push('[id="' + el.id + '"]');
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
      if (innerText && innerText !== text) {
        meta.innerText = innerText.length <= 200 ? innerText : innerText.substring(0, 200);
      }
    } catch(e) {}

    var ariaLabel = el.getAttribute('aria-label');
    if (ariaLabel) meta.label = ariaLabel;

    // aria-labelledby: 여러 id 참조에서 텍스트 합산
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
        try {
          var labelEl = document.querySelector('label[for="' + CSS.escape(el.id) + '"]');
          if (labelEl) meta.label = (labelEl.textContent || '').trim();
        } catch(e) {}
      }
      if (!meta.label) {
        try {
          var parentLabel = el.closest('label');
          if (parentLabel) meta.label = (parentLabel.textContent || '').trim();
        } catch(e) {}
      }
      // 인접 텍스트 탐색: label이 없는 input 주변의 텍스트 노드
      if (!meta.label) {
        try {
          var prev = el.previousElementSibling;
          if (prev) {
            var prevT = (prev.textContent || '').trim();
            if (prevT && prevT.length <= 50) meta.label = prevT;
          }
          if (!meta.label) {
            var par = el.parentElement;
            if (par) {
              var parT = (par.textContent || '').trim();
              // 부모 텍스트가 짧으면 (label 역할) 사용
              if (parT && parT.length <= 50 && parT !== (el.value || '')) meta.label = parT;
            }
          }
        } catch(e) {}
      }
    }

    var role = el.getAttribute('role');
    if (role) {
      meta.role = role;
    } else {
      var implicitRoles = {
        'a': 'link', 'button': 'button', 'select': 'combobox',
        'textarea': 'textbox', 'img': 'img', 'nav': 'navigation',
        'h1': 'heading', 'h2': 'heading', 'h3': 'heading',
        'h4': 'heading', 'h5': 'heading', 'h6': 'heading'
      };
      if (tag === 'input') {
        var inputType = (el.getAttribute('type') || 'text').toLowerCase();
        var inputRoles = {
          'button': 'button', 'checkbox': 'checkbox', 'radio': 'radio',
          'range': 'slider', 'search': 'searchbox', 'submit': 'button',
          'reset': 'button', 'text': 'textbox', 'email': 'textbox',
          'password': 'textbox', 'tel': 'textbox', 'url': 'textbox'
        };
        if (inputRoles[inputType]) meta.role = inputRoles[inputType];
      } else if (implicitRoles[tag]) {
        meta.role = implicitRoles[tag];
      }
    }

    var nameAttr = el.getAttribute('name');
    if (nameAttr) meta.name = nameAttr;

    var testId = el.getAttribute('data-testid');
    if (testId) meta.testId = testId;

    var title = el.getAttribute('title');
    if (title) meta.title = title;

    var placeholderAttr = el.getAttribute('placeholder');
    if (placeholderAttr) meta.placeholder = placeholderAttr;

    // 요소 위치 정보 (좌표 기반 폴백 클릭용)
    try {
      var rect = el.getBoundingClientRect();
      meta.boundingBox = {
        x: Math.round(rect.x),
        y: Math.round(rect.y),
        width: Math.round(rect.width),
        height: Math.round(rect.height)
      };
    } catch(e) {}

    // 가시성 확인
    try {
      var cStyle = window.getComputedStyle(el);
      meta.isVisible = (
        cStyle.display !== 'none' &&
        cStyle.visibility !== 'hidden' &&
        parseFloat(cStyle.opacity) > 0
      );
    } catch(e) {}

    // 활성화 상태
    meta.isEnabled = !el.disabled && !el.hasAttribute('aria-disabled');

    // 정규화된 텍스트 (self-heal 유사도 비교용)
    var rawText = (el.textContent || '').trim().replace(/\\s+/g, ' ');
    if (rawText) meta.textNormalized = rawText.length <= 200 ? rawText : rawText.substring(0, 200);
    var accessName = meta.label || ariaLabel || '';
    if (accessName) {
      meta.accessibleNameNormalized = accessName.trim().replace(/\\s+/g, ' ');
    }

    return meta;
  }

  function buildPreferredLocators(el) {
    if (!el || !el.getAttribute) return [];
    var locators = [];
    var tag = el.tagName ? el.tagName.toLowerCase() : '';

    // 1. data-testid (가장 안정)
    var testId = el.getAttribute('data-testid');
    if (testId) locators.push({ kind: 'testid', value: testId });

    // 2. role + accessible name
    var role = el.getAttribute('role');
    if (!role) {
      var implicitRoles = {
        'a': 'link', 'button': 'button', 'select': 'combobox',
        'textarea': 'textbox', 'img': 'img'
      };
      if (tag === 'input') {
        var inputType = (el.getAttribute('type') || 'text').toLowerCase();
        var inputRoles = {
          'button': 'button', 'checkbox': 'checkbox', 'radio': 'radio',
          'submit': 'button', 'reset': 'button', 'text': 'textbox',
          'email': 'textbox', 'password': 'textbox', 'tel': 'textbox',
          'url': 'textbox', 'search': 'searchbox', 'range': 'slider'
        };
        role = inputRoles[inputType] || null;
      } else {
        role = implicitRoles[tag] || null;
      }
    }
    if (role) {
      var accessibleName = '';
      var ariaLbl = el.getAttribute('aria-label');
      if (ariaLbl) {
        accessibleName = ariaLbl;
      }
      // aria-labelledby: 여러 id 참조에서 텍스트 합산
      if (!accessibleName) {
        var ariaLblBy = el.getAttribute('aria-labelledby');
        if (ariaLblBy) {
          try {
            var refIds = ariaLblBy.split(/\\s+/);
            var refTexts = [];
            for (var ri = 0; ri < refIds.length; ri++) {
              var refE = document.getElementById(refIds[ri]);
              if (refE) { var rTxt = (refE.textContent || '').trim(); if (rTxt) refTexts.push(rTxt); }
            }
            if (refTexts.length > 0) accessibleName = refTexts.join(' ');
          } catch(e) {}
        }
      }
      if (!accessibleName && el.id) {
        try {
          var labelFor = document.querySelector('label[for="' + CSS.escape(el.id) + '"]');
          if (labelFor) accessibleName = (labelFor.textContent || '').trim();
        } catch(e) {}
      }
      if (!accessibleName) {
        try { var pl = el.closest('label'); if (pl) accessibleName = (pl.textContent || '').trim(); } catch(e) {}
      }
      if (!accessibleName) {
        var innerT = (el.innerText || el.textContent || '').trim();
        if (innerT && innerT.length <= 80) accessibleName = innerT;
      }
      locators.push({ kind: 'role', value: role, role: role, name: accessibleName || undefined });
    }

    // 3. label (폼 요소용)
    if (tag === 'input' || tag === 'select' || tag === 'textarea') {
      var labelText = '';
      // aria-labelledby 우선
      var lblBy = el.getAttribute('aria-labelledby');
      if (lblBy) {
        try {
          var lblIds = lblBy.split(/\\s+/);
          var lblParts = [];
          for (var lbi = 0; lbi < lblIds.length; lbi++) {
            var lblRef = document.getElementById(lblIds[lbi]);
            if (lblRef) { var lt = (lblRef.textContent || '').trim(); if (lt) lblParts.push(lt); }
          }
          if (lblParts.length > 0) labelText = lblParts.join(' ');
        } catch(e) {}
      }
      if (!labelText && el.id) {
        try {
          var lbl = document.querySelector('label[for="' + CSS.escape(el.id) + '"]');
          if (lbl) labelText = (lbl.textContent || '').trim();
        } catch(e) {}
      }
      if (!labelText) {
        try { var pLabel = el.closest('label'); if (pLabel) labelText = (pLabel.textContent || '').trim(); } catch(e) {}
      }
      // 인접 텍스트 탐색 (label이 없는 경우)
      if (!labelText) {
        try {
          var prevSib = el.previousElementSibling;
          if (prevSib) {
            var pst = (prevSib.textContent || '').trim();
            if (pst && pst.length <= 50) labelText = pst;
          }
        } catch(e) {}
      }
      if (labelText) locators.push({ kind: 'label', value: labelText });
    }

    // 4. placeholder
    var ph = el.getAttribute('placeholder');
    if (ph) locators.push({ kind: 'placeholder', value: ph });

    // 5. title
    var titleAttr = el.getAttribute('title');
    if (titleAttr) locators.push({ kind: 'title', value: titleAttr });

    // 6. text (짧은 텍스트만)
    var visibleText = (el.innerText || el.textContent || '').trim();
    if (visibleText && visibleText.length <= 60) locators.push({ kind: 'text', value: visibleText });

    // 7. CSS selector 후보들 (getAllSelectors에서 가져온 것 중 안정적인 것)
    var cssSel = getUniqueSelector(el);
    if (cssSel) locators.push({ kind: 'css', value: cssSel });

    return locators;
  }

  function getPageContext() {
    return {
      scrollX: Math.round(window.scrollX),
      scrollY: Math.round(window.scrollY),
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
      readyState: document.readyState,
      title: document.title
    };
  }

  document.addEventListener('click', function(e) {
    var target = e.target;
    if (!target) return;
    var selector = getUniqueSelector(target);
    if (typeof window.__katabRecordEvent === 'function') {
      window.__katabRecordEvent(JSON.stringify({
        type: 'click',
        selector: selector,
        meta: {
          source: 'user_interaction',
          element: getElementMetadata(target),
          selectors: getAllSelectors(target),
          preferredLocators: buildPreferredLocators(target),
          pageContext: getPageContext()
        }
      }));
    }
  }, true);

  var inputTimer = null;
  var lastInputTarget = null;
  document.addEventListener('input', function(e) {
    var target = e.target;
    if (!target || !('value' in target)) return;
    // checkbox/radio는 click으로 이미 캡처되므로 fill 생성 스킵
    var inputType = (target.getAttribute && target.getAttribute('type') || '').toLowerCase();
    if (inputType === 'checkbox' || inputType === 'radio') return;
    lastInputTarget = target;
    clearTimeout(inputTimer);
    inputTimer = setTimeout(function() {
      if (lastInputTarget && 'value' in lastInputTarget) {
        var selector = getUniqueSelector(lastInputTarget);
        if (typeof window.__katabRecordEvent === 'function') {
          window.__katabRecordEvent(JSON.stringify({
            type: 'fill',
            selector: selector,
            value: lastInputTarget.value,
            meta: {
              source: 'user_interaction',
              element: getElementMetadata(lastInputTarget),
              selectors: getAllSelectors(lastInputTarget),
              preferredLocators: buildPreferredLocators(lastInputTarget),
              pageContext: getPageContext()
            }
          }));
        }
      }
    }, 500);
  }, true);

  document.addEventListener('change', function(e) {
    var target = e.target;
    if (!target || target.tagName !== 'SELECT') return;
    var selector = getUniqueSelector(target);
    if (typeof window.__katabRecordEvent === 'function') {
      window.__katabRecordEvent(JSON.stringify({
        type: 'select',
        selector: selector,
        value: target.value,
        meta: {
          source: 'user_interaction',
          element: getElementMetadata(target),
          selectors: getAllSelectors(target),
          preferredLocators: buildPreferredLocators(target),
          pageContext: getPageContext()
        }
      }));
    }
  }, true);
})();
`;
/**
 * SPA 네비게이션 감지 스크립트.
 * pushState/replaceState 오버라이드 + popstate/hashchange 리스너로
 * React Router, Vue Router 등의 클라이언트 사이드 라우팅을 캡처한다.
 */
exports.SPA_NAVIGATION_SCRIPT = `
(function() {
  var lastUrl = location.href;

  function checkUrlChange(source) {
    var currentUrl = location.href;
    if (currentUrl !== lastUrl) {
      lastUrl = currentUrl;
      if (window.__katabRecordEvent) {
        window.__katabRecordEvent(JSON.stringify({
          type: 'navigate',
          url: currentUrl,
          meta: {
            source: source,
            pageContext: {
              scrollX: Math.round(window.scrollX),
              scrollY: Math.round(window.scrollY),
              viewportWidth: window.innerWidth,
              viewportHeight: window.innerHeight,
              readyState: document.readyState,
              title: document.title
            }
          }
        }));
      }
    }
  }

  var origPushState = history.pushState;
  history.pushState = function() {
    origPushState.apply(this, arguments);
    checkUrlChange('spa_pushState');
  };

  var origReplaceState = history.replaceState;
  history.replaceState = function() {
    origReplaceState.apply(this, arguments);
    checkUrlChange('spa_replaceState');
  };

  window.addEventListener('popstate', function() {
    checkUrlChange('spa_popstate');
  });

  window.addEventListener('hashchange', function() {
    checkUrlChange('spa_hashchange');
  });
})();
`;
class WebRecorder {
    config;
    browser = null;
    context = null;
    page = null;
    scenario = null;
    storage;
    isPaused = false;
    eventBuffer = null;
    pageRegistry = new page_registry_1.PageRegistry();
    constructor(config = {}, storage) {
        this.config = config;
        this.storage = storage || new file_storage_1.FileStorage(config.outputDir);
    }
    /**
     * 특정 페이지에 이벤트 캡처 함수, 네비게이션 추적, 다이얼로그 핸들러를 등록한다.
     * 메인 페이지와 팝업 모두에 동일하게 적용된다.
     */
    async setupPageListeners(page, pageId) {
        // exposeFunction은 page 단위 — 팝업에도 개별 등록 필요
        await page.exposeFunction('__katabRecordEvent', (eventData) => {
            try {
                const event = JSON.parse(eventData);
                event.timestamp = Date.now();
                // 이벤트에 pageId 자동 부착
                if (!event.meta)
                    event.meta = {};
                event.meta.pageId = pageId;
                this.recordEvent(event);
            }
            catch (_e) {
                // ignore parse errors
            }
        });
        // 네비게이션 이벤트 추적
        page.on('load', async () => {
            if (this.scenario) {
                let title = '';
                try {
                    title = await page.title();
                }
                catch { }
                this.recordEvent({
                    type: 'navigate',
                    timestamp: Date.now(),
                    url: page.url(),
                    meta: {
                        source: 'page_load',
                        pageId,
                        pageContext: {
                            readyState: 'complete',
                            title,
                            scrollX: 0,
                            scrollY: 0,
                            viewportWidth: 0,
                            viewportHeight: 0,
                        },
                    },
                });
            }
        });
        // JS Dialog(alert/confirm/prompt/beforeunload) 녹화
        page.on('dialog', async (dialog) => {
            if (!this.scenario)
                return;
            if (this.isPaused)
                return;
            const dialogType = dialog.type();
            const message = dialog.message();
            const defaultValue = dialog.defaultValue();
            // 녹화 중에는 auto-accept로 고정 (Playwright는 미처리 dialog를 auto-dismiss하므로 명시적 accept 필요).
            // confirm/prompt에서 dismiss가 필요한 경우, 시나리오 편집기에서 action을 'dismiss'로 수정 가능.
            const action = 'accept';
            const promptText = dialogType === 'prompt' ? (defaultValue || '') : undefined;
            this.recordEvent({
                type: 'dialog',
                timestamp: Date.now(),
                meta: { pageId },
                dialogConfig: {
                    dialogType,
                    message,
                    defaultValue: defaultValue || undefined,
                    action,
                    promptText,
                },
            });
            // 다이얼로그를 실제로 처리하여 페이지가 멈추지 않도록
            try {
                if (dialogType === 'prompt') {
                    await dialog.accept(defaultValue || '');
                }
                else {
                    await dialog.accept();
                }
            }
            catch {
                // 이미 닫힌 다이얼로그 등 — 무시
            }
        });
    }
    /**
     * context 레벨에서 팝업(새 탭/윈도우) 감지 리스너를 등록한다.
     * 새 Page 생성 시 pageId를 부여하고, 이벤트 캡처를 설정하며,
     * popup_opened / popup_closed 이벤트를 시나리오에 기록한다.
     */
    setupPopupListener() {
        if (!this.context)
            return;
        this.context.on('page', async (popup) => {
            // pageId를 먼저 발급하되, 이벤트 캡처 설정(exposeFunction) 완료 후 popup_opened 기록
            // NOTE: addInitScript는 context 레벨이므로 팝업에도 자동 주입됨
            //       exposeFunction만 page 단위로 추가 등록 필요
            const pageId = this.pageRegistry.registerPopup(popup);
            // exposeFunction 등록 + domcontentloaded 대기로 이벤트 수집 준비 보장
            await this.setupPageListeners(popup, pageId);
            try {
                await popup.waitForLoadState('domcontentloaded', { timeout: 10000 });
            }
            catch { /* non-critical */ }
            // opener 추적
            let openerPageId = 'main';
            try {
                const opener = await popup.opener();
                if (opener) {
                    openerPageId = this.pageRegistry.findId(opener) || 'main';
                }
            }
            catch {
                // opener 조회 실패 — 기본값 유지
            }
            // popup_opened 이벤트 기록
            let popupUrl = '';
            try {
                popupUrl = popup.url();
            }
            catch { }
            this.recordEvent({
                type: 'popup_opened',
                timestamp: Date.now(),
                url: popupUrl,
                meta: {
                    pageId,
                    openerPageId,
                },
            });
            // 팝업 닫힘 추적
            popup.on('close', () => {
                this.recordEvent({
                    type: 'popup_closed',
                    timestamp: Date.now(),
                    meta: { pageId },
                });
                this.pageRegistry.remove(pageId);
            });
        });
    }
    /**
     * 이미 열려 있는 브라우저/페이지에 녹화 모드를 부착한다.
     * 부분 다시 녹화(PartialReRecorder)에서 리플레이 완료 후 호출.
     */
    async attachToPage(page, context, browser, scenario) {
        this.page = page;
        this.context = context;
        this.browser = browser;
        this.scenario = scenario;
        this.pageRegistry.clear();
        this.pageRegistry.registerMain(page);
        this.eventBuffer = new event_buffer_1.EventBuffer(() => this.storage.saveScenario(this.scenario, { compact: true }), 500, 30);
        await this.setupPageListeners(page, 'main');
        await context.addInitScript({ content: exports.RECORDING_SCRIPT });
        await context.addInitScript({ content: exports.SPA_NAVIGATION_SCRIPT });
        this.setupPopupListener();
        // 현재 페이지에도 스크립트 직접 주입 (addInitScript는 다음 네비게이션부터 적용)
        await page.evaluate(exports.RECORDING_SCRIPT).catch(() => { });
        await page.evaluate(exports.SPA_NAVIGATION_SCRIPT).catch(() => { });
    }
    async start() {
        if (this.scenario)
            throw new Error('Recording already started');
        const scenarioId = (0, crypto_1.randomUUID)();
        const browserType = this.config.browser || 'chromium';
        const url = this.config.url || this.config.baseURL || 'about:blank';
        // 디바이스 에뮬레이션 해석: deviceType 우선, 없으면 viewport fallback
        const deviceConfig = await (0, device_presets_1.resolveDeviceConfig)(this.config.deviceType);
        const contextOptions = this.config.deviceType
            ? (0, device_presets_1.toContextOptions)(deviceConfig)
            : { viewport: this.config.viewport || { width: 1280, height: 720 } };
        const launcher = browserType === 'firefox' ? playwright_1.firefox : browserType === 'webkit' ? playwright_1.webkit : playwright_1.chromium;
        this.browser = await launcher.launch({ headless: false });
        this.context = await this.browser.newContext(contextOptions);
        this.page = await this.context.newPage();
        // PageRegistry 초기화 및 메인 페이지 등록
        this.pageRegistry.clear();
        this.pageRegistry.registerMain(this.page);
        this.scenario = {
            id: scenarioId,
            name: this.config.sessionName || `Web Recording - ${new Date().toISOString()}`,
            platform: 'web',
            metadata: {
                browser: browserType,
                viewport: deviceConfig.viewport,
                baseURL: url,
                deviceType: this.config.deviceType,
                userAgent: deviceConfig.userAgent,
            },
            startedAt: Date.now(),
            events: [],
        };
        // 이벤트 버퍼 초기화: compact 모드로 저장하여 I/O 최적화
        this.eventBuffer = new event_buffer_1.EventBuffer(() => this.storage.saveScenario(this.scenario, { compact: true }), 500, // 500ms 디바운스
        30);
        // 메인 페이지에 이벤트 캡처/네비게이션/다이얼로그 리스너 설정
        await this.setupPageListeners(this.page, 'main');
        // Inject recording script into every frame (plain JS string to avoid DOM type issues)
        await this.context.addInitScript({ content: exports.RECORDING_SCRIPT });
        await this.context.addInitScript({ content: exports.SPA_NAVIGATION_SCRIPT });
        // 팝업(새 탭/윈도우) 감지 리스너 등록
        this.setupPopupListener();
        // 인증 프로필 주입
        if (this.config.authProfileId) {
            const authStore = new auth_store_1.AuthStore(this.config.outputDir || './scenarios');
            await authStore.injectIntoContext(this.context, this.config.authProfileId);
        }
        // Navigate to initial URL
        if (url !== 'about:blank') {
            await this.page.goto(url, { waitUntil: 'domcontentloaded' });
        }
        // 인증 스토리지 주입 (페이지 로드 후)
        if (this.config.authProfileId) {
            const authStore = new auth_store_1.AuthStore(this.config.outputDir || './scenarios');
            const hasStorage = await authStore.injectStorageIntoPage(this.page, this.config.authProfileId);
            if (hasStorage) {
                await this.page.reload({ waitUntil: 'domcontentloaded' });
            }
        }
        return scenarioId;
    }
    lastNavigateUrl = null;
    lastNavigateTime = 0;
    /**
     * 녹화 이벤트를 시나리오에 추가하고 버퍼에 push한다.
     * 모든 이벤트 기록은 이 메서드를 통해야 한다 (일관성).
     *
     * @param event 녹화 이벤트
     * @param forceRecord true이면 isPaused 상태에서도 기록 (마커 이벤트용)
     */
    recordEvent(event, forceRecord = false) {
        if (!this.scenario)
            return;
        if (this.isPaused && !forceRecord)
            return;
        // 모든 이벤트에 pageId 보장 (마커 이벤트 등 수동 생성 이벤트 포함)
        if (!event.meta)
            event.meta = {};
        if (!event.meta.pageId)
            event.meta.pageId = 'main';
        // navigate 이벤트 중복 제거 (강화)
        // page.on('load') + SPA history 오버라이드가 동일 네비게이션에 대해
        // 여러 source로 중복 이벤트를 발생시킬 수 있음
        // 예: pushState → page_load 순서로 같은 URL이 짧은 간격에 기록됨
        if (event.type === 'navigate' && event.url) {
            const now = Date.now();
            const source = event.meta?.source;
            // 마커 이벤트(recording_paused/unpaused/resumed)는 중복 제거 대상 제외
            const isMarker = source === 'recording_paused' ||
                source === 'recording_unpaused' ||
                source === 'recording_resumed';
            if (!isMarker) {
                // 동일 URL: source가 달라도 1000ms 이내면 중복으로 판정
                // (기존 500ms에서 확장 — SPA + page_load 조합에서 500ms 이상 차이날 수 있음)
                if (event.url === this.lastNavigateUrl && (now - this.lastNavigateTime) < 1000) {
                    return;
                }
                // URL이 다르더라도 쿼리파라미터/해시만 다른 경우 (같은 pathname)
                // SPA에서 query string이 변경되는 패턴에서 연속 기록 방지
                if (this.lastNavigateUrl && (now - this.lastNavigateTime) < 300) {
                    try {
                        const prevUrl = new URL(this.lastNavigateUrl);
                        const curUrl = new URL(event.url);
                        if (prevUrl.origin === curUrl.origin && prevUrl.pathname === curUrl.pathname) {
                            return;
                        }
                    }
                    catch {
                        // URL 파싱 실패 시 기본 중복 제거만 적용
                    }
                }
                this.lastNavigateUrl = event.url;
                this.lastNavigateTime = now;
            }
        }
        this.scenario.events.push(event);
        this.eventBuffer?.push(event);
    }
    /**
     * 기존 시나리오를 로드하고 마지막 URL에서 이어서 녹화한다.
     * 기존 이벤트는 유지되고, 새 이벤트가 뒤에 추가된다.
     */
    async resume(scenarioId) {
        if (this.scenario)
            throw new Error('Recording already started');
        // 1) 저장된 시나리오 로드
        const existing = await this.storage.loadScenario(scenarioId);
        if (!existing)
            throw new Error(`Scenario not found: ${scenarioId}`);
        // 2) 메타데이터에서 브라우저/디바이스 설정 복원
        const browserType = existing.metadata?.browser || this.config.browser || 'chromium';
        const deviceType = existing.metadata?.deviceType || this.config.deviceType;
        const deviceConfig = await (0, device_presets_1.resolveDeviceConfig)(deviceType);
        const contextOptions = deviceType
            ? (0, device_presets_1.toContextOptions)(deviceConfig)
            : { viewport: existing.metadata?.viewport || this.config.viewport || { width: 1280, height: 720 } };
        // 3) 마지막 URL 결정: 이벤트에서 역순으로 navigate 찾기
        let resumeUrl = existing.metadata?.baseURL || 'about:blank';
        for (let i = existing.events.length - 1; i >= 0; i--) {
            const ev = existing.events[i];
            if (ev.type === 'navigate' && ev.url) {
                resumeUrl = ev.url;
                break;
            }
        }
        // 4) 브라우저 시작
        const launcher = browserType === 'firefox' ? playwright_1.firefox : browserType === 'webkit' ? playwright_1.webkit : playwright_1.chromium;
        this.browser = await launcher.launch({ headless: false });
        this.context = await this.browser.newContext(contextOptions);
        this.page = await this.context.newPage();
        // PageRegistry 초기화 및 메인 페이지 등록
        this.pageRegistry.clear();
        this.pageRegistry.registerMain(this.page);
        // 5) 시나리오 복원 (기존 이벤트 유지, stoppedAt 초기화)
        this.scenario = {
            ...existing,
            stoppedAt: undefined,
        };
        // 이벤트 버퍼 초기화 (compact 모드)
        this.eventBuffer = new event_buffer_1.EventBuffer(() => this.storage.saveScenario(this.scenario, { compact: true }), 500, 30);
        // 이어서 녹화 표시 이벤트 추가
        this.recordEvent({
            type: 'navigate',
            timestamp: Date.now(),
            url: resumeUrl,
            meta: { source: 'recording_resumed' },
        });
        // 6) 메인 페이지에 이벤트 캡처/네비게이션/다이얼로그 리스너 설정
        await this.setupPageListeners(this.page, 'main');
        // 7) 녹화 스크립트 주입
        await this.context.addInitScript({ content: exports.RECORDING_SCRIPT });
        await this.context.addInitScript({ content: exports.SPA_NAVIGATION_SCRIPT });
        // 8) 팝업(새 탭/윈도우) 감지 리스너 등록
        this.setupPopupListener();
        // 9) 인증 프로필 주입
        if (this.config.authProfileId) {
            const authStore = new auth_store_1.AuthStore(this.config.outputDir || './scenarios');
            await authStore.injectIntoContext(this.context, this.config.authProfileId);
        }
        // 10) 마지막 URL로 이동
        if (resumeUrl !== 'about:blank') {
            await this.page.goto(resumeUrl, { waitUntil: 'domcontentloaded' });
        }
        // 11) 인증 스토리지 주입 (페이지 로드 후)
        if (this.config.authProfileId) {
            const authStore = new auth_store_1.AuthStore(this.config.outputDir || './scenarios');
            const hasStorage = await authStore.injectStorageIntoPage(this.page, this.config.authProfileId);
            if (hasStorage) {
                await this.page.reload({ waitUntil: 'domcontentloaded' });
            }
        }
        return scenarioId;
    }
    /**
     * 녹화 일시정지 – 브라우저는 유지하고 이벤트 캡처만 중단한다.
     * 일시정지 마커 이벤트를 기록하여 어디서 멈췄는지 추적 가능.
     */
    pause() {
        if (!this.scenario)
            throw new Error('No active recording');
        if (this.isPaused)
            return;
        // 마커 이벤트를 recordEvent()를 통해 기록 (forceRecord: 아직 isPaused가 아니므로 불필요)
        this.recordEvent({
            type: 'navigate',
            timestamp: Date.now(),
            url: this.page?.url(),
            meta: { source: 'recording_paused' },
        });
        this.isPaused = true;
        // 상태 전환점이므로 즉시 flush하여 이벤트 유실 방지
        this.eventBuffer?.flush();
    }
    /**
     * 일시정지 해제 – 이벤트 캡처를 다시 시작한다.
     * 재개 마커 이벤트를 기록한다.
     */
    unpause() {
        if (!this.scenario)
            throw new Error('No active recording');
        if (!this.isPaused)
            return;
        this.isPaused = false;
        // 마커 이벤트를 recordEvent()를 통해 기록 (isPaused가 이미 false이므로 정상 경로)
        this.recordEvent({
            type: 'navigate',
            timestamp: Date.now(),
            url: this.page?.url(),
            meta: { source: 'recording_unpaused' },
        });
        // 상태 전환점이므로 즉시 flush하여 이벤트 유실 방지
        this.eventBuffer?.flush();
    }
    getIsPaused() { return this.isPaused; }
    async stop() {
        if (!this.scenario)
            throw new Error('No active recording');
        // 버퍼에 남은 이벤트를 모두 flush
        if (this.eventBuffer) {
            await this.eventBuffer.destroy();
            this.eventBuffer = null;
        }
        // context.close()가 소속 page를 모두 닫으므로 수동 page.close() 불필요
        // (수동 close 후 context.close에서 중복 에러 발생 가능성 제거)
        if (this.context)
            await this.context.close().catch(() => { });
        this.pageRegistry.clear();
        if (this.browser)
            await this.browser.close().catch(() => { });
        this.scenario.stoppedAt = Date.now();
        // 최종 1회 저장 — pretty print (compact: false)로 사람이 읽기 쉽게
        await this.storage.saveScenario(this.scenario);
        const scenario = this.scenario;
        this.scenario = null;
        this.page = null;
        this.context = null;
        this.browser = null;
        return scenario;
    }
    getScenario() { return this.scenario; }
}
exports.WebRecorder = WebRecorder;
//# sourceMappingURL=recorder.js.map