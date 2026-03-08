"use strict";
/**
 * LocatorResolver — 다중 후보 + 점수화 기반 요소 탐색 모듈
 *
 * 녹화 시 수집된 풍부한 locator 후보(preferredLocators, selectors, meta.element)를
 * 우선순위와 점수에 따라 평가하여 가장 안정적인 요소를 찾는다.
 *
 * self-heal 로직과 분리되어 있으며, resolve 실패 시 SelfHealer를 호출하는 구조.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.LocatorResolver = void 0;
exports.normalizeText = normalizeText;
exports.textSimilarity = textSimilarity;
const self_healer_1 = require("./self-healer");
// ─── 유틸리티 ──────────────────────────────────────────
/** CSS 특수문자가 포함된 selector를 안전한 형태로 변환 */
function safeSelector(sel) {
    const idMatch = sel.match(/^#([^\s[]+)$/);
    if (idMatch) {
        const idValue = idMatch[1];
        if (/^[0-9]/.test(idValue) || /[.:\\[\]()>+~,\s"']/.test(idValue)) {
            return `[id="${escapeAttr(idValue)}"]`;
        }
        return sel;
    }
    const attrMatch = sel.match(/^\[(\w[\w-]*)="(.*)"\]$/);
    if (attrMatch) {
        const escaped = escapeAttr(attrMatch[2]);
        if (escaped !== attrMatch[2])
            return `[${attrMatch[1]}="${escaped}"]`;
    }
    return sel;
}
function escapeAttr(val) {
    return val.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}
/** 텍스트 정규화 (유사도 비교용) */
function normalizeText(text) {
    if (!text)
        return '';
    return text.trim().replace(/\s+/g, ' ').toLowerCase();
}
/** 두 텍스트의 유사도 점수 (0~1, 1=동일) — 간단한 토큰 겹침 기반 */
function textSimilarity(a, b) {
    const na = normalizeText(a);
    const nb = normalizeText(b);
    if (!na || !nb)
        return 0;
    if (na === nb)
        return 1;
    const tokensA = new Set(na.split(' '));
    const tokensB = new Set(nb.split(' '));
    let overlap = 0;
    for (const t of tokensA) {
        if (tokensB.has(t))
            overlap++;
    }
    const total = Math.max(tokensA.size, tokensB.size);
    return total > 0 ? overlap / total : 0;
}
// ─── 메인 Resolver ──────────────────────────────────────
class LocatorResolver {
    selfHealer = new self_healer_1.SelfHealer();
    /**
     * 다중 전략으로 요소를 탐색한다.
     *
     * 탐색 순서:
     * 0. healedLocators (이전 self-heal 성공 이력)
     * 1. preferredLocators (기록 시 생성된 권장 후보)
     * 2. primary CSS selector
     * 3. CSS fallback selectors
     * 4. text-scoped CSS
     * 5. tag+text direct match
     * 6. Playwright semantic locators (testId/role/label/placeholder/title/text)
     * 7. self-heal 시도 (실패 시)
     *
     * 모든 단계에서 deadline 초과 시 즉시 중단.
     */
    async resolve(page, event, opts) {
        const { scopeRoot, scopeDescription, deadline, variables: vars, matchText } = opts;
        const remaining = () => {
            const left = deadline - Date.now();
            if (left <= 0)
                throw new Error('⏱ 스텝 타임아웃');
            return left;
        };
        const withScope = (strategy) => scopeDescription ? `${scopeDescription} > ${strategy}` : strategy;
        const elem = event.meta?.element;
        const elemText = matchText || elem?.textContent || elem?.innerText;
        const recordedBBox = elem?.boundingBox;
        /** 다수 매칭 시 텍스트 필터 + 거리 기반 선택 */
        const narrowLocator = async (base) => {
            const filtered = elemText ? base.filter({ hasText: elemText }) : base;
            if (recordedBBox && recordedBBox.width > 0) {
                try {
                    const count = await filtered.count().catch(() => 0);
                    if (count >= 2)
                        return await this.selectNearestByDistance(filtered, recordedBBox, count);
                }
                catch { /* fallthrough */ }
            }
            return filtered.first();
        };
        /** locator 평가: visible 확인 후 반환 */
        const tryLocator = async (locator, strategyName, timeout) => {
            try {
                await locator.first().waitFor({ state: 'visible', timeout: Math.min(remaining(), timeout) });
                return { locator: locator.first(), resolvedBy: withScope(strategyName) };
            }
            catch {
                if (Date.now() >= deadline)
                    throw new Error('⏱ 스텝 타임아웃');
                return null;
            }
        };
        // ── Phase 0: healedLocators (이전 복구 성공 이력 우선) ──
        const healedLocators = event.meta?.healedLocators;
        if (healedLocators && healedLocators.length > 0) {
            // 성공 횟수가 높은 순으로 정렬
            const sorted = [...healedLocators].sort((a, b) => b.successCount - a.successCount);
            for (const healed of sorted) {
                const result = await this.tryPreferredLocator(scopeRoot, healed.locator, `healed(${healed.strategy})`, narrowLocator, tryLocator, remaining, recordedBBox, elemText);
                if (result) {
                    // successCount 누적을 위해 usedHealedLocator를 전달
                    result.usedHealedLocator = healed;
                    return result;
                }
            }
        }
        // ── Phase 1: preferredLocators (기록 시 권장 후보) ──
        const preferred = event.meta?.preferredLocators;
        if (preferred && preferred.length > 0) {
            for (const pref of preferred) {
                const result = await this.tryPreferredLocator(scopeRoot, pref, `preferred(${pref.kind})`, narrowLocator, tryLocator, remaining, recordedBBox, elemText);
                if (result) {
                    // 기록된 요소 속성(name, placeholder)과 실제 매칭 요소가 다르면 건너뜀
                    const mismatch = await this.checkAttributeMismatch(result.locator, elem);
                    if (mismatch)
                        continue;
                    result.usedPreferredLocator = pref;
                    return result;
                }
            }
        }
        // ── Phase 2: primary CSS selector ──
        if (event.selector) {
            const sel = safeSelector(vars.resolve(event.selector));
            try {
                const base = scopeRoot.locator(sel);
                const locator = await narrowLocator(base);
                const result = await tryLocator(locator, `primary: ${sel}`, 3000);
                if (result)
                    return result;
            }
            catch {
                if (Date.now() >= deadline)
                    throw new Error('⏱ 스텝 타임아웃');
            }
        }
        // ── Phase 3: CSS fallback selectors ──
        const fallbackSelectors = event.meta?.selectors || [];
        for (const fallbackSel of fallbackSelectors) {
            if (fallbackSel === event.selector)
                continue;
            const safeSel = safeSelector(vars.resolve(fallbackSel));
            try {
                const base = scopeRoot.locator(safeSel);
                const locator = await narrowLocator(base);
                const result = await tryLocator(locator, `css-fallback: ${safeSel}`, 1000);
                if (result)
                    return result;
            }
            catch {
                if (Date.now() >= deadline)
                    throw new Error('⏱ 스텝 타임아웃');
            }
        }
        // ── Phase 4: text-scoped CSS ──
        const elemTextContent = matchText
            ? vars.resolve(matchText)
            : elem?.innerText || elem?.textContent;
        if (elemTextContent && elemTextContent.length <= 80 && event.selector) {
            const parentTag = extractParentSection(event.selector);
            if (parentTag) {
                try {
                    const elemType = elem?.type || 'a';
                    const scopedLocator = scopeRoot.locator(parentTag)
                        .filter({ has: scopeRoot.locator(elemType).filter({ hasText: elemTextContent }) })
                        .locator(elemType)
                        .filter({ hasText: elemTextContent })
                        .first();
                    const result = await tryLocator(scopedLocator, `text-scoped: ${parentTag} >> ${elemType}:has-text("${elemTextContent.substring(0, 30)}")`, 1500);
                    if (result)
                        return result;
                }
                catch {
                    if (Date.now() >= deadline)
                        throw new Error('⏱ 스텝 타임아웃');
                }
            }
            // tag+text direct match
            const tagName = elem?.type || extractTagFromSelector(event.selector);
            if (tagName) {
                try {
                    const textLocator = scopeRoot.locator(tagName)
                        .filter({ hasText: elemTextContent })
                        .first();
                    const result = await tryLocator(textLocator, `tag-text: ${tagName}:has-text("${elemTextContent.substring(0, 30)}")`, 1500);
                    if (result)
                        return result;
                }
                catch {
                    if (Date.now() >= deadline)
                        throw new Error('⏱ 스텝 타임아웃');
                }
            }
        }
        // ── Phase 5: Playwright semantic locators ──
        if (elem) {
            const semanticResult = await this.trySemantic(scopeRoot, elem, matchText, withScope, remaining, recordedBBox);
            if (semanticResult)
                return semanticResult;
        }
        // ── Phase 6: Self-heal 시도 ──
        try {
            const healResult = await this.selfHealer.heal(page, event, opts);
            if (healResult) {
                return {
                    locator: healResult.locator,
                    resolvedBy: withScope(`self-healed(${healResult.strategy})`),
                    healedLocator: {
                        locator: healResult.preferredLocator,
                        healedAt: Date.now(),
                        successCount: 1,
                        originalSelector: event.selector,
                        strategy: healResult.strategy,
                    },
                };
            }
        }
        catch {
            // self-heal도 실패 — 아래 에러로 fall through
        }
        // 모든 전략 실패
        throw this.buildDetailedError(event, elem, scopeDescription, matchText, fallbackSelectors);
    }
    // ─── preferredLocator 시도 ──────────────────────────────
    async tryPreferredLocator(scopeRoot, pref, strategyLabel, narrowLocator, tryLocator, remaining, recordedBBox, elemText) {
        try {
            let baseLocator = null;
            switch (pref.kind) {
                case 'testid':
                    baseLocator = scopeRoot.getByTestId(pref.value);
                    break;
                case 'role': {
                    const roleValue = (pref.role ?? pref.value);
                    baseLocator = pref.name
                        ? scopeRoot.getByRole(roleValue, { name: pref.name, exact: pref.exact ?? false })
                        : scopeRoot.getByRole(roleValue);
                    break;
                }
                case 'label':
                    baseLocator = scopeRoot.getByLabel(pref.value, { exact: pref.exact ?? false });
                    break;
                case 'placeholder':
                    baseLocator = scopeRoot.getByPlaceholder(pref.value, { exact: pref.exact ?? false });
                    break;
                case 'title':
                    baseLocator = scopeRoot.getByTitle(pref.value, { exact: pref.exact ?? false });
                    break;
                case 'text':
                    baseLocator = scopeRoot.getByText(pref.value, { exact: pref.exact ?? false });
                    break;
                case 'css': {
                    const base = scopeRoot.locator(safeSelector(pref.value));
                    const narrowed = await narrowLocator(base);
                    return await tryLocator(narrowed, `${strategyLabel}:${pref.value?.substring(0, 40)}`, 1500);
                }
                case 'xpath':
                    baseLocator = scopeRoot.locator(`xpath=${pref.value}`);
                    break;
            }
            if (!baseLocator)
                return null;
            // count == 1 → 바로 사용, count > 1 → pickBestMatch로 최적 1개 선택
            const picked = await this.pickBestMatch(baseLocator, recordedBBox, elemText, remaining);
            if (!picked)
                return null;
            return await tryLocator(picked, `${strategyLabel}:${pref.value?.substring(0, 40)}`, 1500);
        }
        catch {
            // 개별 후보 실패 → 다음 후보로
        }
        return null;
    }
    /**
     * 다중 매칭 시 최적의 1개를 선택한다.
     * count==1 이면 즉시 반환, count>1 이면 bbox 거리 + 텍스트 유사도로 최적 1개를 고른다.
     * count>10 (너무 많은 매칭)이면 신뢰도가 낮아 null 반환하여 다음 전략으로 넘긴다.
     */
    async pickBestMatch(locator, recordedBBox, elemText, remaining) {
        try {
            const count = await locator.count();
            if (count === 0)
                return null;
            if (count === 1)
                return locator.first();
            // 10개 초과 매칭 → 너무 많아서 신뢰도 낮음 → 다음 전략으로
            if (count > 10)
                return null;
            // bbox가 있으면 거리 기반 선택
            if (recordedBBox && recordedBBox.width > 0) {
                return await this.selectNearestByDistance(locator, recordedBBox, count);
            }
            // bbox 없고 텍스트가 있으면 텍스트 유사도로 선택
            if (elemText) {
                const normalizedTarget = normalizeText(elemText);
                let bestIdx = 0;
                let bestSim = -1;
                const maxCheck = Math.min(count, 10);
                for (let i = 0; i < maxCheck; i++) {
                    try {
                        let text = await locator.nth(i).textContent({ timeout: 500 });
                        // input 요소는 textContent가 비어 있으므로 placeholder/aria-label로 보완
                        if (!text || !text.trim()) {
                            const ph = await locator.nth(i).getAttribute('placeholder').catch(() => '') || '';
                            const ariaLabel = await locator.nth(i).getAttribute('aria-label').catch(() => '') || '';
                            const name = await locator.nth(i).getAttribute('name').catch(() => '') || '';
                            text = ph || ariaLabel || name;
                        }
                        const sim = textSimilarity(normalizedTarget, normalizeText(text));
                        if (sim > bestSim) {
                            bestSim = sim;
                            bestIdx = i;
                        }
                    }
                    catch { /* skip */ }
                }
                return locator.nth(bestIdx);
            }
            // 둘 다 없으면 first()로 fallback
            return locator.first();
        }
        catch {
            return locator.first();
        }
    }
    /**
     * 기록된 요소 속성(name, placeholder)과 실제 해석된 요소의 속성이 다른지 검사.
     * 다르면 true 반환 → 이 locator 결과를 거부하고 다음 후보로 넘긴다.
     */
    async checkAttributeMismatch(locator, elem) {
        if (!elem)
            return false;
        try {
            // name 속성 검증: 기록에 name이 있으면 실제 요소도 같아야 함
            if (elem.name) {
                const actualName = await locator.getAttribute('name', { timeout: 500 });
                if (actualName !== null && actualName !== elem.name)
                    return true;
            }
            // placeholder 속성 검증
            if (elem.placeholder) {
                const actualPh = await locator.getAttribute('placeholder', { timeout: 500 });
                if (actualPh !== null && actualPh !== elem.placeholder)
                    return true;
            }
        }
        catch {
            // 속성 읽기 실패 시 mismatch로 판정하지 않음
        }
        return false;
    }
    // ─── Playwright semantic locators ─────────────────────
    async trySemantic(scopeRoot, elem, matchText, withScope, remaining, recordedBBox) {
        if (!elem)
            return null;
        const elemTextForMatch = matchText || elem?.innerText || elem?.textContent;
        const tryLoc = async (locator, name) => {
            try {
                const picked = await this.pickBestMatch(locator, recordedBBox, elemTextForMatch, remaining);
                if (!picked)
                    return null;
                await picked.waitFor({ state: 'visible', timeout: Math.min(remaining(), 1000) });
                return { locator: picked, resolvedBy: withScope(name) };
            }
            catch {
                return null;
            }
        };
        if (elem.testId) {
            const r = await tryLoc(scopeRoot.getByTestId(elem.testId), `semantic:testId(${elem.testId})`);
            if (r)
                return r;
        }
        if (elem.role) {
            const roleName = matchText || elem.label || elem.innerText || elem.textContent;
            const loc = roleName
                ? scopeRoot.getByRole(elem.role, { name: roleName, exact: false })
                : scopeRoot.getByRole(elem.role);
            const r = await tryLoc(loc, `semantic:role(${elem.role}, ${roleName || ''})`);
            if (r)
                return r;
        }
        if (elem.label) {
            const r = await tryLoc(scopeRoot.getByLabel(elem.label, { exact: false }), `semantic:label(${elem.label})`);
            if (r)
                return r;
        }
        if (elem.placeholder) {
            const r = await tryLoc(scopeRoot.getByPlaceholder(elem.placeholder, { exact: false }), `semantic:placeholder(${elem.placeholder})`);
            if (r)
                return r;
        }
        if (elem.title) {
            const r = await tryLoc(scopeRoot.getByTitle(elem.title, { exact: false }), `semantic:title(${elem.title})`);
            if (r)
                return r;
        }
        const textToMatch = matchText || elem.innerText || elem.textContent;
        if (textToMatch && textToMatch.length <= 100) {
            const r = await tryLoc(scopeRoot.getByText(textToMatch, { exact: false }), `semantic:text(${textToMatch.substring(0, 50)})`);
            if (r)
                return r;
        }
        return null;
    }
    // ─── 거리 기반 선택 ──────────────────────────────────
    async selectNearestByDistance(locator, recordedBox, count) {
        const cx = recordedBox.x + recordedBox.width / 2;
        const cy = recordedBox.y + recordedBox.height / 2;
        let bestIdx = 0;
        let bestDist = Infinity;
        const maxCheck = Math.min(count, 10);
        for (let i = 0; i < maxCheck; i++) {
            try {
                const box = await locator.nth(i).boundingBox({ timeout: 500 });
                if (!box)
                    continue;
                const dist = Math.sqrt((box.x + box.width / 2 - cx) ** 2 +
                    (box.y + box.height / 2 - cy) ** 2);
                if (dist < bestDist) {
                    bestDist = dist;
                    bestIdx = i;
                }
            }
            catch { /* skip */ }
        }
        return locator.nth(bestIdx);
    }
    // ─── 상세 에러 메시지 ──────────────────────────────────
    buildDetailedError(event, elem, scopeDescription, matchText, fallbackSelectors) {
        const triedMethods = [];
        if (scopeDescription)
            triedMethods.push(`스코프: ${scopeDescription}`);
        const preferred = event.meta?.preferredLocators;
        if (preferred && preferred.length > 0) {
            triedMethods.push(`preferredLocators: ${preferred.map(p => `${p.kind}="${p.value?.substring(0, 30)}"`).join(', ')}`);
        }
        if (event.selector)
            triedMethods.push(`CSS 셀렉터: "${event.selector}"`);
        if (fallbackSelectors.length > 0) {
            triedMethods.push(`CSS 폴백: ${fallbackSelectors.map(s => `"${s}"`).join(', ')}`);
        }
        if (elem) {
            const semanticTried = [];
            if (elem.testId)
                semanticTried.push(`testId="${elem.testId}"`);
            if (elem.role)
                semanticTried.push(`role="${elem.role}"${elem.label ? ` name="${elem.label}"` : ''}`);
            if (elem.label)
                semanticTried.push(`label="${elem.label}"`);
            if (elem.placeholder)
                semanticTried.push(`placeholder="${elem.placeholder}"`);
            if (elem.title)
                semanticTried.push(`title="${elem.title}"`);
            const errorText = matchText || elem.innerText || elem.textContent;
            if (errorText)
                semanticTried.push(`text="${errorText.substring(0, 50)}"`);
            if (semanticTried.length)
                triedMethods.push(`시맨틱: ${semanticTried.join(', ')}`);
        }
        triedMethods.push('self-heal: 휴리스틱 복구 시도 실패');
        return new Error(`요소를 찾을 수 없습니다.\n` +
            `  시도한 방법:\n` +
            triedMethods.map(m => `    - ${m}`).join('\n') +
            `\n  힌트: 브라우저 DevTools에서 "Copy selector"로 정확한 셀렉터를 복사해 사용하세요.`);
    }
}
exports.LocatorResolver = LocatorResolver;
// ─── 헬퍼: selector에서 부모 섹션 추출 ─────────────────
function extractParentSection(selector) {
    const parts = selector.split(/\s*>\s*/);
    for (let i = parts.length - 2; i >= 0; i--) {
        const part = parts[i].trim();
        if (/^(section|nav|aside|main|article|header|footer)[\.\[#]?/.test(part))
            return part;
        if (/^div\.\w+/.test(part))
            return part;
    }
    return null;
}
function extractTagFromSelector(selector) {
    const parts = selector.split(/[\s>]+/);
    const last = parts[parts.length - 1]?.trim();
    if (!last)
        return null;
    const tagMatch = last.match(/^([a-z][a-z0-9]*)/i);
    return tagMatch ? tagMatch[1].toLowerCase() : null;
}
//# sourceMappingURL=locator-resolver.js.map