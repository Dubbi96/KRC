"use strict";
/**
 * SelfHealer — 결정론적 휴리스틱 기반 요소 복구 모듈
 *
 * 모든 locator 전략이 실패한 후, DOM에서 후보를 탐색하고
 * 점수화하여 가장 가까운 요소를 찾아내는 "자가 치유" 로직.
 *
 * LLM 없이 동작하며, 운영 비용/예측 가능성이 우수하다.
 *
 * 4가지 휴리스틱:
 * 1. role + name 유사도 (같은 role 요소 중 텍스트 유사도 최고)
 * 2. label-input 관계 재탐색 (label 텍스트로 연결된 input 찾기)
 * 3. 태그 + 텍스트 유사도 (같은 태그 중 텍스트 유사도 최고)
 * 4. boundingBox 근접도 (녹화 좌표 주변 clickable 요소)
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.SelfHealer = void 0;
const locator_resolver_1 = require("./locator-resolver");
class SelfHealer {
    /**
     * DOM에서 후보를 수집하고, 점수화하여 가장 적합한 요소를 찾는다.
     * @returns SelfHealResult 또는 null (복구 불가)
     */
    async heal(page, event, opts) {
        const elem = event.meta?.element;
        if (!elem)
            return null;
        const remaining = () => {
            const left = opts.deadline - Date.now();
            if (left <= 0)
                throw new Error('⏱ 스텝 타임아웃');
            return left;
        };
        // 후보 수집 timeout (최대 3초)
        const collectTimeout = Math.min(remaining(), 3000);
        // ── 전략 1: role + name 유사도 ──
        if (elem.role) {
            const result = await this.healByRoleNameSimilarity(page, elem, opts, collectTimeout);
            if (result)
                return result;
        }
        // ── 전략 2: label-input 관계 재탐색 ──
        if (elem.label && (elem.type === 'input' || elem.type === 'select' || elem.type === 'textarea')) {
            const result = await this.healByLabelInput(page, elem, opts, Math.min(remaining(), 2000));
            if (result)
                return result;
        }
        // ── 전략 3: 태그 + 텍스트 유사도 ──
        const targetText = elem.textNormalized || elem.textContent || elem.innerText;
        if (targetText && elem.type) {
            const result = await this.healByTagTextSimilarity(page, elem, opts, Math.min(remaining(), 2000));
            if (result)
                return result;
        }
        // ── 전략 4: boundingBox 근접도 ──
        if (elem.boundingBox && elem.boundingBox.width > 0) {
            const result = await this.healByBboxProximity(page, elem, opts, Math.min(remaining(), 2000));
            if (result)
                return result;
        }
        return null;
    }
    // ─── 전략 1: role + name 유사도 ─────────────────────────
    async healByRoleNameSimilarity(page, elem, opts, timeout) {
        const role = elem.role;
        const targetName = (0, locator_resolver_1.normalizeText)(elem.accessibleNameNormalized || elem.label || elem.innerText || elem.textContent);
        if (!targetName)
            return null;
        try {
            const candidates = await page.evaluate(`
        (function(role, maxCount) {
          var elems = document.querySelectorAll('[role="' + role + '"], ' + role);
          var results = [];
          for (var i = 0; i < Math.min(elems.length, maxCount); i++) {
            var el = elems[i];
            var style = window.getComputedStyle(el);
            var visible = style.display !== 'none' && style.visibility !== 'hidden' && parseFloat(style.opacity) > 0;
            if (!visible) continue;
            var rect = el.getBoundingClientRect();
            results.push({
              idx: i,
              text: (el.innerText || el.textContent || '').trim().substring(0, 200),
              ariaLabel: el.getAttribute('aria-label'),
              visible: visible,
              enabled: !el.disabled,
              bbox: rect.width > 0 ? { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) } : null
            });
          }
          return results;
        })('${role.replace(/'/g, "\\'")}', 50)
      `);
            if (candidates.length === 0)
                return null;
            // 점수화: 텍스트 유사도가 가장 높은 후보
            let bestScore = 0;
            let bestIdx = -1;
            let bestText = '';
            for (const c of candidates) {
                const candidateName = (0, locator_resolver_1.normalizeText)(c.ariaLabel || c.text);
                const sim = (0, locator_resolver_1.textSimilarity)(targetName, candidateName);
                // 최소 임계값: 0.3 이상이어야 후보로 인정
                if (sim > bestScore && sim >= 0.3) {
                    bestScore = sim;
                    bestIdx = c.idx;
                    bestText = c.ariaLabel || c.text;
                }
            }
            if (bestIdx < 0)
                return null;
            // 해당 요소의 locator 생성
            const locator = page.locator(`[role="${role}"], ${role}`).nth(bestIdx);
            try {
                await locator.waitFor({ state: 'visible', timeout: Math.min(timeout, 1000) });
            }
            catch {
                return null;
            }
            return {
                locator,
                strategy: 'role-name-similarity',
                score: bestScore,
                preferredLocator: {
                    kind: 'role',
                    value: role,
                    role,
                    name: bestText.substring(0, 80),
                },
            };
        }
        catch {
            return null;
        }
    }
    // ─── 전략 2: label-input 관계 재탐색 ────────────────────
    async healByLabelInput(page, elem, opts, timeout) {
        const labelText = elem.accessibleNameNormalized || elem.label;
        if (!labelText)
            return null;
        try {
            const locator = opts.scopeRoot.getByLabel(labelText, { exact: false }).first();
            await locator.waitFor({ state: 'visible', timeout: Math.min(timeout, 1500) });
            return {
                locator,
                strategy: 'label-input',
                score: 0.8,
                preferredLocator: {
                    kind: 'label',
                    value: labelText,
                },
            };
        }
        catch {
            return null;
        }
    }
    // ─── 전략 3: 태그 + 텍스트 유사도 ──────────────────────
    async healByTagTextSimilarity(page, elem, opts, timeout) {
        const tag = elem.type;
        const targetText = (0, locator_resolver_1.normalizeText)(elem.textNormalized || elem.textContent || elem.innerText);
        if (!tag || !targetText)
            return null;
        try {
            const candidates = await page.evaluate(`
        (function(tagName, maxCount) {
          var elems = document.querySelectorAll(tagName);
          var results = [];
          for (var i = 0; i < Math.min(elems.length, maxCount); i++) {
            var el = elems[i];
            var style = window.getComputedStyle(el);
            var visible = style.display !== 'none' && style.visibility !== 'hidden' && parseFloat(style.opacity) > 0;
            if (!visible) continue;
            var rect = el.getBoundingClientRect();
            results.push({
              idx: i,
              text: (el.innerText || el.textContent || '').trim().substring(0, 200),
              visible: visible,
              bbox: rect.width > 0 ? { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) } : null
            });
          }
          return results;
        })('${tag.replace(/'/g, "\\'")}', 100)
      `);
            if (candidates.length === 0)
                return null;
            let bestScore = 0;
            let bestIdx = -1;
            let bestText = '';
            for (const c of candidates) {
                const sim = (0, locator_resolver_1.textSimilarity)(targetText, (0, locator_resolver_1.normalizeText)(c.text));
                if (sim > bestScore && sim >= 0.4) {
                    bestScore = sim;
                    bestIdx = c.idx;
                    bestText = c.text;
                }
            }
            if (bestIdx < 0)
                return null;
            const locator = page.locator(tag).nth(bestIdx);
            try {
                await locator.waitFor({ state: 'visible', timeout: Math.min(timeout, 1000) });
            }
            catch {
                return null;
            }
            return {
                locator,
                strategy: 'tag-text-similarity',
                score: bestScore,
                preferredLocator: {
                    kind: 'text',
                    value: bestText.substring(0, 60),
                },
            };
        }
        catch {
            return null;
        }
    }
    // ─── 전략 4: boundingBox 근접도 ────────────────────────
    async healByBboxProximity(page, elem, opts, timeout) {
        const bbox = elem.boundingBox;
        if (!bbox || bbox.width <= 0)
            return null;
        const targetCx = bbox.x + bbox.width / 2;
        const targetCy = bbox.y + bbox.height / 2;
        // 동일한 role/tag의 clickable 요소를 탐색 범위로
        const role = elem.role;
        const tag = elem.type || 'a,button,input,select,textarea,[role]';
        try {
            const safeTag = tag.replace(/'/g, "\\'");
            const candidates = await page.evaluate(`
        (function(tagStr, tcx, tcy, sr, mc) {
          var selectors = tagStr.indexOf(',') >= 0 ? tagStr : tagStr + ', [role]';
          var elems = document.querySelectorAll(selectors);
          var results = [];
          for (var i = 0; i < Math.min(elems.length, mc); i++) {
            var el = elems[i];
            var style = window.getComputedStyle(el);
            if (style.display === 'none' || style.visibility === 'hidden') continue;
            var rect = el.getBoundingClientRect();
            if (rect.width <= 0 || rect.height <= 0) continue;
            var cx = rect.x + rect.width / 2;
            var cy = rect.y + rect.height / 2;
            var dist = Math.sqrt(Math.pow(cx - tcx, 2) + Math.pow(cy - tcy, 2));
            if (dist <= sr) {
              results.push({
                idx: i, dist: dist,
                text: (el.innerText || el.textContent || '').trim().substring(0, 100),
                tagName: el.tagName.toLowerCase(),
                role: el.getAttribute('role'),
                bbox: { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) }
              });
            }
          }
          return results.sort(function(a, b) { return a.dist - b.dist; }).slice(0, 10);
        })('${safeTag}', ${targetCx}, ${targetCy}, 150, 200)
      `);
            if (candidates.length === 0)
                return null;
            // 거리와 텍스트 유사도를 결합하여 점수화
            const targetText = (0, locator_resolver_1.normalizeText)(elem.textNormalized || elem.textContent || elem.innerText);
            let bestScore = 0;
            let bestCandidate = candidates[0];
            for (const c of candidates) {
                // 거리 점수: 0~50 (가까울수록 높음)
                const distScore = Math.max(0, 50 - (c.dist / 3));
                // 텍스트 유사도 점수: 0~30
                const textScore = targetText ? (0, locator_resolver_1.textSimilarity)(targetText, (0, locator_resolver_1.normalizeText)(c.text)) * 30 : 0;
                // role 일치 점수: 0 또는 20
                const roleScore = (role && c.role === role) ? 20 : 0;
                // 태그 일치: 0 또는 10
                const tagScore = (elem.type && c.tagName === elem.type) ? 10 : 0;
                const total = distScore + textScore + roleScore + tagScore;
                if (total > bestScore) {
                    bestScore = total;
                    bestCandidate = c;
                }
            }
            // 최소 임계값: 25점 이상
            if (bestScore < 25)
                return null;
            const selectors = tag.includes(',') ? tag : `${tag}, [role]`;
            const locator = page.locator(selectors).nth(bestCandidate.idx);
            try {
                await locator.waitFor({ state: 'visible', timeout: Math.min(timeout, 1000) });
            }
            catch {
                return null;
            }
            return {
                locator,
                strategy: 'bbox-proximity',
                score: bestScore / 100,
                preferredLocator: {
                    kind: 'text',
                    value: bestCandidate.text.substring(0, 60),
                },
            };
        }
        catch {
            return null;
        }
    }
}
exports.SelfHealer = SelfHealer;
//# sourceMappingURL=self-healer.js.map