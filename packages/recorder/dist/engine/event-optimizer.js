"use strict";
/**
 * EventOptimizer (이벤트 후처리 추론 엔진)
 *
 * 녹화된 로우레벨 이벤트(click, fill, navigate)를 분석하여
 * 자동화 품질을 향상시키는 후처리를 수행한다.
 *
 * 모든 변환은 immutable — 원본 이벤트를 수정하지 않고 새 배열을 반환한다.
 *
 * 수행하는 최적화:
 * 1. 연속 fill 그룹화 (자동 description)
 * 2. Auto-wait 삽입 (click → navigate 사이에 network_idle 대기)
 * 3. 셀렉터 안정화 (data-testid > role > aria-label 우선순위)
 * 4. Assert 추천 (navigate 후 url_contains 자동 생성)
 * 5. 자동 Description 생성
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.EventOptimizer = void 0;
class EventOptimizer {
    /**
     * 모든 최적화를 순차 적용한다.
     * @param events 원본 이벤트 배열
     * @returns 최적화된 새 이벤트 배열 (원본 불변)
     */
    optimize(events) {
        // shallow copy로 원본 불변 보장
        let result = events.map(e => {
            const copy = { ...e };
            if (e.meta)
                copy.meta = { ...e.meta };
            return copy;
        });
        result = this.generateDescriptions(result);
        result = this.stabilizeSelectors(result);
        result = this.enrichPreferredLocators(result);
        result = this.mergeConsecutiveFills(result);
        result = this.insertAutoWaits(result);
        result = this.suggestAssertions(result);
        result = this.suggestDynamicTracking(result);
        result = this.suggestClickStabilization(result);
        return result;
    }
    // ─── 1. 연속 fill 그룹화 ────────────────────────────
    /**
     * 연속된 fill 이벤트들에 폼 입력 그룹 description을 부여한다.
     * 연속 fill 2개 이상이면 첫 fill에 그룹 설명을 추가하고,
     * 각 fill에 필드명 기반 설명을 부여한다.
     */
    mergeConsecutiveFills(events) {
        const result = [];
        let i = 0;
        while (i < events.length) {
            if (events[i].type !== 'fill') {
                result.push(events[i]);
                i++;
                continue;
            }
            // 연속 fill 구간 탐색
            const fillStart = i;
            while (i < events.length && events[i].type === 'fill') {
                i++;
            }
            const fillCount = i - fillStart;
            if (fillCount >= 2) {
                // 첫 fill에 그룹 설명 추가
                const firstFill = { ...events[fillStart] };
                const fieldNames = events.slice(fillStart, i).map(e => this.getFieldName(e));
                const summary = fieldNames.filter(Boolean).join(', ');
                firstFill.description = firstFill.description || `폼 입력 (${fillCount}개 필드${summary ? ': ' + summary : ''})`;
                result.push(firstFill);
                // 나머지 fill에 개별 설명 유지
                for (let j = fillStart + 1; j < i; j++) {
                    result.push(events[j]);
                }
            }
            else {
                result.push(events[fillStart]);
            }
        }
        return result;
    }
    // ─── 2. Auto-wait 삽입 ──────────────────────────────
    /**
     * click 직후 navigate(page_load)가 오면,
     * 사이에 wait_for(network_idle) 이벤트를 삽입한다.
     *
     * 이벤트 간 시간 갭이 2초 이상이면 암묵적 대기가 필요한 구간으로 판단.
     */
    insertAutoWaits(events) {
        const result = [];
        for (let i = 0; i < events.length; i++) {
            result.push(events[i]);
            if (i >= events.length - 1)
                continue;
            const current = events[i];
            const next = events[i + 1];
            // click/fill 뒤에 navigate(page_load)가 오면 auto-wait 삽입
            if ((current.type === 'click' || current.type === 'fill') &&
                next.type === 'navigate' &&
                next.meta?.source === 'page_load') {
                const waitEvent = {
                    type: 'wait_for',
                    timestamp: current.timestamp + 1,
                    description: '페이지 전환 대기 (자동 삽입)',
                    waitForConfig: {
                        waitType: 'network_idle',
                        timeout: 5000,
                    },
                };
                result.push(waitEvent);
                continue;
            }
            // 시간 갭이 2초 이상인 click/fill → DOM 기반 대기 추가
            const timeDiff = next.timestamp - current.timestamp;
            if (timeDiff >= 2000 &&
                (current.type === 'click') &&
                next.type !== 'navigate' &&
                next.type !== 'wait' &&
                next.type !== 'wait_for' &&
                next.type !== 'wait_for_user' &&
                next.type !== 'popup_opened' &&
                next.type !== 'popup_closed' &&
                next.type !== 'dialog') {
                // 다음 이벤트의 셀렉터가 있으면 해당 요소 visible 대기
                if (next.selector) {
                    const waitEvent = {
                        type: 'wait_for',
                        timestamp: current.timestamp + 1,
                        description: '요소 출현 대기 (자동 삽입)',
                        waitForConfig: {
                            waitType: 'element_visible',
                            selector: next.selector,
                            timeout: 5000,
                        },
                    };
                    result.push(waitEvent);
                }
            }
        }
        return result;
    }
    // ─── 3. 셀렉터 안정화 ──────────────────────────────
    /**
     * meta.selectors[] 후보를 안정성 기준으로 재정렬하고,
     * 가장 안정적인 셀렉터를 primary selector로 교체한다.
     *
     * 우선순위: data-testid > [role][name] > [aria-label] > [name] > [placeholder] > text > CSS class
     */
    stabilizeSelectors(events) {
        return events.map(event => {
            if (!event.meta?.selectors || event.meta.selectors.length === 0)
                return event;
            const ranked = [...event.meta.selectors].sort((a, b) => {
                return this.selectorPriority(a) - this.selectorPriority(b);
            });
            const bestSelector = ranked[0];
            // primary selector보다 더 안정적인 후보가 있으면 교체
            if (bestSelector && event.selector) {
                const currentPriority = this.selectorPriority(event.selector);
                const bestPriority = this.selectorPriority(bestSelector);
                if (bestPriority < currentPriority) {
                    return {
                        ...event,
                        selector: bestSelector,
                        meta: {
                            ...event.meta,
                            selectors: ranked,
                        },
                    };
                }
            }
            return {
                ...event,
                meta: {
                    ...event.meta,
                    selectors: ranked,
                },
            };
        });
    }
    // ─── 3.5. preferredLocators 보강 ─────────────────────
    /**
     * 기록 시 생성된 preferredLocators가 없거나 부족한 이벤트에 대해
     * meta.element 정보를 기반으로 preferredLocators를 생성/보강한다.
     *
     * 기록 스크립트가 이미 preferredLocators를 생성하지만,
     * 이전 버전 녹화 데이터나 모바일 이벤트 등에는 없을 수 있어 후처리로 보강한다.
     */
    enrichPreferredLocators(events) {
        return events.map(event => {
            // 요소 기반 이벤트만 대상
            if (!['click', 'fill', 'select', 'hover', 'keyboard'].includes(event.type))
                return event;
            const elem = event.meta?.element;
            if (!elem)
                return event;
            const existing = event.meta?.preferredLocators || [];
            const existingKinds = new Set(existing.map(l => l.kind));
            const newLocators = [...existing];
            // data-testid
            if (elem.testId && !existingKinds.has('testid')) {
                newLocators.push({ kind: 'testid', value: elem.testId });
            }
            // role + name
            if (elem.role && !existingKinds.has('role')) {
                const name = elem.label || elem.innerText || elem.textContent;
                newLocators.push({
                    kind: 'role',
                    value: elem.role,
                    role: elem.role,
                    name: name ? name.substring(0, 80) : undefined,
                });
            }
            // label (폼 입력)
            if (elem.label && !existingKinds.has('label') &&
                (elem.type === 'input' || elem.type === 'select' || elem.type === 'textarea')) {
                newLocators.push({ kind: 'label', value: elem.label });
            }
            // placeholder
            if (elem.placeholder && !existingKinds.has('placeholder')) {
                newLocators.push({ kind: 'placeholder', value: elem.placeholder });
            }
            // title
            if (elem.title && !existingKinds.has('title')) {
                newLocators.push({ kind: 'title', value: elem.title });
            }
            // text (짧은 텍스트만)
            const visibleText = elem.innerText || elem.textContent;
            if (visibleText && visibleText.length <= 60 && !existingKinds.has('text')) {
                newLocators.push({ kind: 'text', value: visibleText });
            }
            // CSS (primary selector)
            if (event.selector && !existingKinds.has('css')) {
                newLocators.push({ kind: 'css', value: event.selector });
            }
            if (newLocators.length === existing.length)
                return event;
            // 안정성 우선순위로 정렬
            const kindOrder = {
                testid: 0, role: 1, label: 2, placeholder: 3, title: 4, text: 5, css: 6, xpath: 7,
            };
            newLocators.sort((a, b) => (kindOrder[a.kind] ?? 9) - (kindOrder[b.kind] ?? 9));
            return {
                ...event,
                meta: {
                    ...event.meta,
                    preferredLocators: newLocators,
                },
            };
        });
    }
    /** 셀렉터 안정성 우선순위 (낮을수록 좋음) */
    selectorPriority(selector) {
        if (selector.includes('data-testid'))
            return 0;
        if (selector.startsWith('[role='))
            return 1;
        if (selector.includes('aria-label'))
            return 2;
        if (selector.startsWith('[name='))
            return 3;
        if (selector.startsWith('[placeholder='))
            return 4;
        if (selector.startsWith('#'))
            return 5;
        if (selector.includes('[id='))
            return 5;
        // class 기반 (tag.class)
        if (/^[a-z]+\.\w/.test(selector))
            return 7;
        // nth-of-type 등 구조 의존
        if (selector.includes(':nth'))
            return 8;
        // 기타
        return 6;
    }
    // ─── 4. Assert 추천 ────────────────────────────────
    /**
     * navigate 이벤트 후에 url_contains assertion을 자동 첨부한다.
     * 클릭 후 페이지 제목 변경이 감지되면 text_contains assertion 후보도 추가.
     */
    suggestAssertions(events) {
        // 로그인 플로우 감지를 위한 사전 분석
        const loginSequences = this.detectLoginSequences(events);
        return events.map((event, i) => {
            const suggestions = [];
            const existingAssertions = event.assertions || (event.assertion ? [event.assertion] : []);
            // ── 기존 패턴 1: navigate(page_load) → url_contains ──
            if (event.type === 'navigate' && event.url &&
                event.meta?.source === 'page_load' &&
                !existingAssertions.length) {
                try {
                    const urlObj = new URL(event.url);
                    const pathSegment = urlObj.pathname.split('/').filter(Boolean).pop();
                    if (pathSegment && pathSegment !== '') {
                        suggestions.push({
                            assertion: {
                                type: 'url_contains',
                                expected: `/${pathSegment}`,
                                message: `URL에 "/${pathSegment}" 포함 확인 (자동 추천)`,
                                optional: true,
                            },
                            confidence: 'high',
                            reason: `페이지 이동 후 URL 검증`,
                        });
                    }
                }
                catch { /* URL 파싱 실패 무시 */ }
            }
            // ── 기존 패턴 2: click 후 title 변경 → text_contains ──
            if (event.type === 'click' && i + 1 < events.length) {
                const next = events[i + 1];
                const currentTitle = event.meta?.pageContext?.title;
                const nextTitle = next.meta?.pageContext?.title;
                if (currentTitle && nextTitle && currentTitle !== nextTitle && nextTitle.length > 0) {
                    suggestions.push({
                        assertion: {
                            type: 'text_contains',
                            target: 'title',
                            expected: nextTitle,
                            message: `페이지 제목 "${nextTitle}" 확인 (자동 추천)`,
                            optional: true,
                        },
                        confidence: 'medium',
                        reason: `클릭 후 페이지 제목 변경 감지`,
                    });
                }
            }
            // ── 추가 패턴 1: click + SPA URL 변화 → url_contains ──
            if (event.type === 'click' && i + 1 < events.length) {
                const next = events[i + 1];
                if (next.type === 'navigate' && next.url &&
                    typeof next.meta?.source === 'string' && next.meta.source.startsWith('spa_')) {
                    try {
                        const urlObj = new URL(next.url);
                        const pathname = urlObj.pathname;
                        if (pathname && pathname !== '/') {
                            suggestions.push({
                                assertion: {
                                    type: 'url_contains',
                                    expected: pathname,
                                    message: `SPA 이동 후 URL "${pathname}" 확인 (자동 추천)`,
                                    optional: true,
                                },
                                confidence: 'high',
                                reason: `클릭 후 SPA URL 변경 감지`,
                            });
                        }
                    }
                    catch { /* 무시 */ }
                }
            }
            // ── 추가 패턴 2: click + 새 요소 등장 (모달/드롭다운) → element_visible ──
            if (event.type === 'click' && i + 1 < events.length) {
                const next = events[i + 1];
                if (next.selector && next.type !== 'navigate' && next.type !== 'wait_for') {
                    // 다음 스텝의 selector가 현재 스텝과 다르면 새 요소 등장으로 간주
                    if (next.selector !== event.selector) {
                        suggestions.push({
                            assertion: {
                                type: 'element_visible',
                                target: next.selector,
                                expected: '',
                                message: `클릭 후 요소 출현 확인 (자동 추천)`,
                                optional: true,
                            },
                            confidence: 'medium',
                            reason: `클릭 후 새 요소 등장 감지`,
                        });
                    }
                }
            }
            // ── 추가 패턴 3: fill/select 후 값 검증 → element_attribute_equals ──
            if ((event.type === 'fill' || event.type === 'select') && event.selector && event.value) {
                suggestions.push({
                    assertion: {
                        type: 'element_attribute_equals',
                        target: event.selector,
                        attribute: 'value',
                        expected: event.value,
                        message: `입력값 "${event.value}" 반영 확인 (자동 추천)`,
                        optional: true,
                    },
                    confidence: 'medium',
                    reason: `${event.type === 'fill' ? '입력' : '선택'} 후 값 반영 검증`,
                });
            }
            // ── 추가 패턴 4: 로그인 플로우 후 password 필드 소멸 검증 ──
            if (loginSequences.has(i)) {
                suggestions.push({
                    assertion: {
                        type: 'element_not_exists',
                        target: 'input[type="password"]',
                        expected: '',
                        message: `로그인 후 비밀번호 필드 소멸 확인 (자동 추천)`,
                        optional: true,
                    },
                    confidence: 'high',
                    reason: `로그인 성공 후 인증 화면 이탈 검증`,
                });
            }
            // ── 추가 패턴 5: 동영상 재생 클릭 → video_auto 검증 ──
            if (event.type === 'click') {
                const elem = event.meta?.element;
                const selector = event.selector || '';
                const textContent = (elem?.textContent || elem?.innerText || '').toLowerCase();
                const ariaLabel = (elem?.label || '').toLowerCase();
                // 재생 버튼/영상 클릭 패턴 감지:
                // 1. 'play' 관련 텍스트/라벨이 있는 클릭
                // 2. video 요소 또는 video 관련 컨테이너 클릭
                // 3. media player 관련 셀렉터 클릭
                const isPlayClick = /play|재생|▶|시청|watch/i.test(textContent) ||
                    /play|재생|▶|시청|watch/i.test(ariaLabel) ||
                    /video|player|media|vjs|plyr|jwplayer/i.test(selector) ||
                    (elem?.role === 'button' && /play/i.test(ariaLabel));
                if (isPlayClick) {
                    // video 요소 셀렉터 추정
                    const videoTarget = /video/i.test(selector)
                        ? selector
                        : (selector ? selector.replace(/\s*>?\s*[^>]*$/, '') + ' video' : 'video');
                    suggestions.push({
                        assertion: {
                            type: 'video_auto',
                            target: videoTarget,
                            expected: '',
                            message: '영상 재생 검증 (자동 추천: video 요소 → 스트림 네트워크 폴백)',
                            optional: true,
                            videoConfig: { observeMs: 3000, minTimeAdvance: 0.5 },
                            streamConfig: { windowMs: 5000, minSegmentResponses: 2 },
                        },
                        confidence: 'high',
                        reason: '재생 버튼 클릭 감지 → 영상 재생 검증 추천',
                    });
                }
            }
            // ── 추가 패턴 5-2: 폼 제출 후 에러 부재 검증 ──
            if (event.type === 'click' && i >= 1) {
                // 이전에 fill 시퀀스가 있었는지 확인 (submit 패턴)
                let hasPrecedingFills = false;
                for (let j = i - 1; j >= Math.max(0, i - 5); j--) {
                    if (events[j].type === 'fill') {
                        hasPrecedingFills = true;
                        break;
                    }
                    if (events[j].type === 'click' || events[j].type === 'navigate')
                        break;
                }
                if (hasPrecedingFills) {
                    suggestions.push({
                        assertion: {
                            type: 'element_not_exists',
                            target: '.error, .alert-danger, [role="alert"]',
                            expected: '',
                            message: `폼 제출 후 에러 메시지 부재 확인 (자동 추천)`,
                            optional: true,
                        },
                        confidence: 'low',
                        reason: `폼 제출 후 에러 상태 검증`,
                    });
                }
            }
            // suggestions를 이벤트에 반영
            if (suggestions.length > 0) {
                // 기존 assertions가 없는 경우에만 첫 번째 high confidence를 inline assertion으로 추가
                const inlineAssertions = [...existingAssertions];
                const highConfidence = suggestions.filter(s => s.confidence === 'high');
                if (inlineAssertions.length === 0 && highConfidence.length > 0) {
                    inlineAssertions.push(highConfidence[0].assertion);
                }
                return {
                    ...event,
                    assertions: inlineAssertions.length > 0 ? inlineAssertions : undefined,
                    meta: {
                        ...(event.meta || {}),
                        suggestedAssertions: suggestions,
                    },
                };
            }
            return event;
        });
    }
    /**
     * 로그인 플로우를 감지한다.
     * 패턴: 연속 fill 중 password 타입 → click → navigate
     * @returns navigate 스텝의 인덱스 집합
     */
    detectLoginSequences(events) {
        const loginNavigateIndices = new Set();
        for (let i = 0; i < events.length; i++) {
            if (events[i].type !== 'fill')
                continue;
            // password 필드가 있는 fill 시퀀스 탐색
            let hasPasswordFill = false;
            let j = i;
            while (j < events.length && events[j].type === 'fill') {
                const el = events[j].meta?.element;
                if (el && (el.type === 'password' || el.name === 'password')) {
                    hasPasswordFill = true;
                }
                j++;
            }
            if (!hasPasswordFill)
                continue;
            // fill 시퀀스 이후 click → navigate 패턴 탐색
            if (j < events.length && events[j].type === 'click') {
                const clickIdx = j;
                // click 이후 navigate/wait_for 탐색 (3스텝 이내)
                for (let k = clickIdx + 1; k < Math.min(clickIdx + 4, events.length); k++) {
                    if (events[k].type === 'navigate' || events[k].type === 'wait_for') {
                        loginNavigateIndices.add(k);
                        break;
                    }
                }
            }
            i = j; // fill 시퀀스 건너뛰기
        }
        return loginNavigateIndices;
    }
    // ─── 5. 자동 Description 생성 ──────────────────────
    /**
     * 각 이벤트에 사람이 읽을 수 있는 description을 자동 생성한다.
     * 이미 description이 있으면 덮어쓰지 않는다.
     */
    generateDescriptions(events) {
        return events.map(event => {
            if (event.description)
                return event;
            const desc = this.buildDescription(event);
            if (!desc)
                return event;
            return { ...event, description: desc };
        });
    }
    /** 이벤트 타입별 description 생성 */
    buildDescription(event) {
        const elem = event.meta?.element;
        const label = elem?.label || elem?.placeholder || elem?.name || elem?.testId;
        const text = elem?.innerText || elem?.textContent;
        const shortText = text ? (text.length > 30 ? text.substring(0, 30) + '…' : text) : '';
        switch (event.type) {
            case 'click': {
                const target = label || shortText || event.selector;
                if (!target)
                    return '클릭';
                const role = elem?.role;
                if (role === 'button' || role === 'link') {
                    return `'${this.truncate(target, 40)}' ${role === 'button' ? '버튼' : '링크'} 클릭`;
                }
                return `'${this.truncate(target, 40)}' 클릭`;
            }
            case 'fill': {
                const fieldName = this.getFieldName(event);
                if (fieldName)
                    return `'${fieldName}' 필드에 입력`;
                return '텍스트 입력';
            }
            case 'select': {
                const fieldName = this.getFieldName(event);
                const value = event.value;
                if (fieldName && value)
                    return `'${fieldName}'에서 '${this.truncate(value, 20)}' 선택`;
                return '옵션 선택';
            }
            case 'navigate': {
                if (!event.url)
                    return '페이지 이동';
                try {
                    const urlObj = new URL(event.url);
                    return `페이지 이동: ${urlObj.pathname}`;
                }
                catch {
                    return `페이지 이동: ${this.truncate(event.url, 50)}`;
                }
            }
            case 'wait':
                return `${event.duration || 1000}ms 대기`;
            case 'wait_for':
                return event.waitForConfig?.waitType === 'network_idle'
                    ? '네트워크 유휴 대기'
                    : event.waitForConfig?.waitType === 'element_visible'
                        ? `요소 출현 대기: ${event.waitForConfig.selector || ''}`
                        : '조건 대기';
            case 'wait_for_user':
                return event.waitForUser?.message || '사용자 입력 대기';
            case 'api_request': {
                const api = event.apiRequest;
                if (!api)
                    return 'API 호출';
                return `${api.method} ${this.truncate(api.url, 50)}`;
            }
            case 'assert':
                return '어설션 검증';
            case 'set_variable':
                return event.variableName ? `변수 설정: ${event.variableName}` : '변수 설정';
            case 'extract_data':
                return event.extractData?.captureAs
                    ? `데이터 추출 → ${event.extractData.captureAs}`
                    : '데이터 추출';
            case 'keyboard':
                return event.keyboard ? `키보드: ${event.keyboard.key}` : '키보드 입력';
            case 'hover':
                return label ? `'${this.truncate(label, 40)}' 호버` : '마우스 호버';
            case 'for_each_start':
                return `반복 시작: ${event.forEachConfig?.selector || ''}`;
            case 'for_each_end':
                return '반복 종료';
            case 'if_start':
                return `조건 시작: ${event.ifCondition?.conditionType || ''}`;
            case 'if_end':
                return '조건 종료';
            case 'block_start':
                return `블록 시작: ${event.blockConfig?.name || ''}`;
            case 'block_end':
                return '블록 종료';
            case 'run_script':
                return event.script?.language === 'javascript' ? 'JS 스크립트 실행' : '쉘 스크립트 실행';
            case 'popup_opened': {
                const popupUrl = event.url;
                return '팝업 열림' + (popupUrl ? `: ${this.truncate(popupUrl, 40)}` : '');
            }
            case 'popup_closed':
                return '팝업 닫힘';
            case 'dialog': {
                const dc = event.dialogConfig;
                if (!dc)
                    return '다이얼로그';
                return `${dc.dialogType}: ${dc.action}` + (dc.message ? ` ("${this.truncate(dc.message, 30)}")` : '');
            }
            default:
                return undefined;
        }
    }
    // ─── 6. 동적 값 추적 추천 ───────────────────────────
    /**
     * 동적 값({{$uuid}} 등) 추적을 위한 자동 추천:
     *
     * A. fill에 동적 함수가 있으면 captureResolvedAs 추천
     * B. click의 textContent가 이전 fill 동적 값의 prefix와 매칭되면 matchText 자동 설정
     * C. click textContent가 "코드 패턴"(대문자+숫자 4~16자)이면 extract_data 추천
     */
    suggestDynamicTracking(events) {
        // 1단계: 동적 fill 값 수집 — {prefix → varName} 매핑
        const dynamicFillMap = new Map();
        for (let i = 0; i < events.length; i++) {
            const event = events[i];
            if (event.type !== 'fill' || !event.value)
                continue;
            if (!event.value.includes('{{$'))
                continue;
            // 이미 captureResolvedAs가 설정되어 있으면 기존 변수명 사용
            const varName = event.captureResolvedAs || this.extractVarNameFromSelector(event.selector || '');
            if (!varName)
                continue;
            // 동적 함수 앞의 정적 prefix 추출 (예: "GIFT_BALL_TEST_{{$uuid}}" → "GIFT_BALL_TEST_")
            const prefix = event.value.replace(/\{\{\$[^}]+\}\}/g, '').trim();
            if (prefix.length >= 3) {
                dynamicFillMap.set(prefix, { varName, index: i });
            }
        }
        // 2단계: 각 이벤트에 추천 적용
        return events.map((event, i) => {
            const transforms = [];
            // 규칙 A: fill에 동적 함수 포함 && captureResolvedAs 미설정 → 추천
            if (event.type === 'fill' && event.value?.includes('{{$') && !event.captureResolvedAs) {
                const suggestedVarName = this.extractVarNameFromSelector(event.selector || '');
                if (suggestedVarName) {
                    transforms.push({
                        type: 'captureResolvedAs',
                        description: `동적 값을 변수 "${suggestedVarName}"에 저장 추천`,
                        field: 'captureResolvedAs',
                        value: suggestedVarName,
                        confidence: 'high',
                    });
                }
            }
            // 규칙 B: click textContent가 이전 동적 fill의 prefix와 매칭 → matchText 자동 설정
            if (event.type === 'click' && !event.matchText) {
                const elemText = event.meta?.element?.textContent || event.meta?.element?.innerText || '';
                if (elemText) {
                    for (const [prefix, { varName }] of dynamicFillMap) {
                        if (elemText.startsWith(prefix) && elemText.length > prefix.length) {
                            // 자동 적용: matchText 설정 (high confidence는 inline 적용)
                            transforms.push({
                                type: 'matchText',
                                description: `동적 텍스트 매칭 "{{${varName}}}" 자동 적용 (prefix: "${prefix}")`,
                                field: 'matchText',
                                value: `{{${varName}}}`,
                                confidence: 'high',
                            });
                            break;
                        }
                    }
                }
            }
            // 규칙 C: click textContent가 코드 패턴 (대문자+숫자 4~16자) → extract_data 추천
            if (event.type === 'click') {
                const elemText = (event.meta?.element?.textContent || '').trim();
                if (/^[A-Z0-9]{4,16}$/.test(elemText)) {
                    transforms.push({
                        type: 'extract_data',
                        description: `"${elemText}"은 동적 코드로 보입니다. extract_data로 변수 캡처 추천`,
                        field: 'extractData',
                        value: elemText,
                        confidence: 'medium',
                    });
                }
            }
            // 규칙 D: click/hover textContent가 동적 코드 패턴이고 captureResolvedAs 미설정 → captureResolvedAs 추천
            // 클릭한 요소의 텍스트를 변수로 저장하여 이후 스텝에서 재사용 가능하게 함
            if ((event.type === 'click' || event.type === 'hover') && !event.captureResolvedAs) {
                const elemText = (event.meta?.element?.textContent || '').trim();
                // 조건: 코드/ID 패턴 (대문자+숫자+언더스코어+하이픈, 4~32자)
                if (/^[A-Z0-9_-]{4,32}$/.test(elemText)) {
                    const suggestedVarName = this.extractVarNameFromSelector(event.selector || '') || 'clickedCode';
                    transforms.push({
                        type: 'captureResolvedAs',
                        description: `클릭 요소 텍스트 "${elemText.length > 20 ? elemText.substring(0, 20) + '...' : elemText}"를 변수 "${suggestedVarName}"에 캡처 추천`,
                        field: 'captureResolvedAs',
                        value: suggestedVarName,
                        confidence: 'medium',
                    });
                }
            }
            // 추천 결과 반영
            if (transforms.length > 0) {
                const updated = { ...event, meta: { ...(event.meta || {}), suggestedTransforms: transforms } };
                // high confidence matchText는 inline 적용 (기존 matchText가 없는 경우만)
                const autoMatchText = transforms.find(t => t.type === 'matchText' && t.confidence === 'high');
                if (autoMatchText && !event.matchText) {
                    updated.matchText = autoMatchText.value;
                }
                // high confidence captureResolvedAs는 inline 적용
                const autoCaptureAs = transforms.find(t => t.type === 'captureResolvedAs' && t.confidence === 'high');
                if (autoCaptureAs && !event.captureResolvedAs) {
                    updated.captureResolvedAs = autoCaptureAs.value;
                }
                return updated;
            }
            return event;
        });
    }
    /**
     * CSS selector에서 변수명을 추출한다.
     * 예: "#form_GiftCodeName" → "giftCodeName"
     * 예: "[name='SearchText']" → "searchText"
     */
    extractVarNameFromSelector(selector) {
        // #form_FieldName → FieldName 추출
        const idMatch = selector.match(/#(?:form_)?(\w+)/i);
        if (idMatch) {
            const raw = idMatch[1];
            // PascalCase/snake_case → camelCase
            return raw.charAt(0).toLowerCase() + raw.slice(1);
        }
        // [name="fieldName"] → fieldName 추출
        const nameMatch = selector.match(/\[name=["'](\w+)["']\]/);
        if (nameMatch) {
            return nameMatch[1].charAt(0).toLowerCase() + nameMatch[1].slice(1);
        }
        return '';
    }
    // ─── 7. 클릭 안정화 추천 ──────────────────────────────
    /**
     * 클릭 이벤트의 셀렉터 안정성을 분석하고 개선 추천을 생성한다.
     *
     * 추천 카테고리:
     * A) 셀렉터 안정화 — 깊은 CSS 경로를 text/role/section 기반으로 교체 추천
     * B) 대기 보정 — 클릭 전 element_visible 대기, 클릭 후 URL/요소 검증
     * C) 스크롤/가시성 — scrollIntoView 자동 삽입
     * D) 폴백 체인 — 다중 후보 셀렉터 구성 추천
     */
    suggestClickStabilization(events) {
        return events.map((event, i) => {
            if (event.type !== 'click')
                return event;
            const fixes = [];
            const sel = event.selector || '';
            const elem = event.meta?.element;
            const textContent = elem?.textContent || elem?.innerText || '';
            const health = this.selectorPriority(sel);
            // ── A) 셀렉터 안정화 추천 ──
            // A-1: 셀렉터가 깊거나(> 3단계) 길면(80자) 텍스트 기반 대체 추천
            const depth = (sel.match(/>/g) || []).length;
            const isDeep = depth > 3 || sel.length > 80;
            if (isDeep && textContent && textContent.length <= 50) {
                // 부모 섹션 추출
                const parentSection = this.extractParentFromSelector(sel);
                const tagName = this.extractLastTag(sel);
                if (parentSection && tagName) {
                    const stableSel = `${parentSection} ${tagName}:has-text("${textContent}")`;
                    fixes.push({
                        type: 'selector_replace',
                        description: `셀렉터가 ${depth}단계로 깊습니다. 텍스트 기반 셀렉터 추천: ${parentSection} 범위 내 "${textContent}" 매칭`,
                        score: 80,
                        value: stableSel,
                        field: 'selector',
                    });
                }
                else if (tagName) {
                    const stableSel = `${tagName}:has-text("${textContent}")`;
                    fixes.push({
                        type: 'selector_replace',
                        description: `셀렉터가 과도하게 깊습니다. 태그+텍스트 기반 추천: ${tagName} + "${textContent}"`,
                        score: 60,
                        value: stableSel,
                        field: 'selector',
                    });
                }
            }
            // A-2: data-testid가 있는데 사용하지 않는 경우
            if (elem?.testId && !sel.includes('data-testid')) {
                fixes.push({
                    type: 'selector_replace',
                    description: `data-testid="${elem.testId}" 사용 추천 (가장 안정적)`,
                    score: 95,
                    value: `[data-testid="${elem.testId}"]`,
                    field: 'selector',
                });
            }
            // A-3: role+name 사용 가능하지만 미사용
            if (elem?.role && (elem.role === 'button' || elem.role === 'link' || elem.role === 'tab' || elem.role === 'menuitem')
                && health > 1 && textContent) {
                fixes.push({
                    type: 'selector_replace',
                    description: `getByRole("${elem.role}", name: "${this.truncate(textContent, 30)}") 사용 추천`,
                    score: 85,
                    value: `role=${elem.role}[name="${textContent}"]`,
                    field: 'selector',
                });
            }
            // A-4: aria-label 사용 가능하지만 미사용
            if (elem?.label && !sel.includes('aria-label') && health > 2) {
                fixes.push({
                    type: 'selector_replace',
                    description: `aria-label="${elem.label}" 사용 추천`,
                    score: 80,
                    value: `[aria-label="${elem.label}"]`,
                    field: 'selector',
                });
            }
            // A-5: matchText 설정 추천 (동일 셀렉터 다수 매칭 방지)
            if (textContent && textContent.length <= 60 && !event.matchText && isDeep) {
                fixes.push({
                    type: 'match_text',
                    description: `matchText "${this.truncate(textContent, 30)}" 설정으로 동일 셀렉터 중 정확한 요소 매칭`,
                    score: 70,
                    value: textContent,
                    field: 'matchText',
                });
            }
            // ── B) 대기/동기화 추천 ──
            // B-1: 클릭 전 대기 추천 (이전 스텝이 navigate/click이고 시간 차이가 크면)
            if (i > 0) {
                const prev = events[i - 1];
                const timeDiff = event.timestamp - prev.timestamp;
                // 이전 스텝이 wait_for면 이미 대기 처리됨 → 건너뜀
                if (prev.type !== 'wait_for' && prev.type !== 'wait' &&
                    (prev.type === 'navigate' || prev.type === 'click') && timeDiff >= 1000) {
                    fixes.push({
                        type: 'wait_before',
                        description: `클릭 전 ${Math.round(timeDiff / 1000)}초 갭 감지. element_visible 대기 추천`,
                        score: 65,
                        value: sel || '',
                        field: 'waitForConfig',
                    });
                }
            }
            // B-2: 클릭 후 URL 변화 감지 시 wait_for + assert 추천
            if (i + 1 < events.length) {
                const next = events[i + 1];
                if (next.type === 'navigate' && next.url) {
                    const hasUrlAssert = (event.assertions || []).some(a => a.type === 'url_contains');
                    if (!hasUrlAssert) {
                        fixes.push({
                            type: 'wait_after',
                            description: `클릭 후 페이지 이동 감지. URL 변화 대기 + 검증 추천`,
                            score: 60,
                            value: next.url,
                        });
                    }
                }
            }
            // ── C) 스크롤/가시성 보정 ──
            // C-1: boundingBox 기반 스크롤 필요 감지
            const bbox = elem?.boundingBox;
            const viewport = event.meta?.pageContext;
            if (bbox && viewport) {
                const isBelow = bbox.y > (viewport.viewportHeight || 800);
                const isRight = bbox.x > (viewport.viewportWidth || 1280);
                if (isBelow || isRight) {
                    fixes.push({
                        type: 'scroll',
                        description: `요소가 뷰포트 밖에 위치 (${isBelow ? '아래' : '오른쪽'}). scrollIntoView 자동 적용됨`,
                        score: 55,
                        value: `scrollTo(${bbox.x}, ${bbox.y})`,
                    });
                }
            }
            // ── D) 폴백 셀렉터 체인 보강 ──
            // 현재 후보가 1개뿐이면 추가 후보 생성 추천
            const existingAlts = event.meta?.selectors || [];
            if (existingAlts.length <= 1 && textContent && sel) {
                const candidates = [];
                // tag + text 기반 후보
                const tag = this.extractLastTag(sel);
                if (tag && textContent.length <= 50) {
                    candidates.push(`${tag}:has-text("${textContent}")`);
                }
                if (elem?.testId)
                    candidates.push(`[data-testid="${elem.testId}"]`);
                if (elem?.label)
                    candidates.push(`[aria-label="${elem.label}"]`);
                if (elem?.role && textContent)
                    candidates.push(`role=${elem.role}[name="${textContent}"]`);
                if (candidates.length > 0) {
                    fixes.push({
                        type: 'selector_add',
                        description: `폴백 셀렉터 ${candidates.length}개 추가 추천 (현재 ${existingAlts.length}개)`,
                        score: 50,
                        value: candidates.join(' | '),
                    });
                }
            }
            // ── E) 동일 셀렉터 다수 매칭 → within 스코프 추천 ──
            // 셀렉터가 공통 패턴(짧은 클래스, 범용 태그)이고 within이 없는 경우,
            // 부모 섹션을 자동 추출하여 within.selector로 추천
            if (!event.within && sel) {
                const isGenericSelector = this.isLikelyDuplicate(sel, textContent);
                if (isGenericSelector) {
                    const parentScope = this.extractParentFromSelector(sel);
                    if (parentScope) {
                        // 부모 섹션 내 고유 텍스트 힌트 탐색 (인접 이벤트의 pageContext.title 등)
                        const sectionTitle = this.findNearestSectionTitle(events, i);
                        const withinPayload = { selector: parentScope };
                        let description = `"${this.truncate(sel, 40)}" 셀렉터가 페이지 내 여러 곳에 존재할 수 있습니다.`;
                        description += ` "${parentScope}" 범위로 제한 추천`;
                        if (sectionTitle) {
                            withinPayload.hasText = sectionTitle;
                            description += ` (텍스트 힌트: "${sectionTitle}")`;
                        }
                        fixes.push({
                            type: 'add_within',
                            description,
                            score: 88,
                            value: parentScope,
                            field: 'within',
                            withinPayload,
                        });
                    }
                }
            }
            // 스코어 순 정렬 후 상위 5개만 유지
            fixes.sort((a, b) => b.score - a.score);
            const topFixes = fixes.slice(0, 5);
            if (topFixes.length > 0) {
                // auto-apply: 최상위 셀렉터 교체 추천이 score 90+ 이면 selectors에 자동 추가
                const bestSelectorFix = topFixes.find(f => (f.type === 'selector_replace' || f.type === 'selector_add') && f.score >= 90);
                const updatedSelectors = [...(event.meta?.selectors || [])];
                if (bestSelectorFix && bestSelectorFix.type === 'selector_replace') {
                    // selector가 아직 후보에 없으면 맨 앞에 추가
                    if (!updatedSelectors.includes(bestSelectorFix.value)) {
                        updatedSelectors.unshift(bestSelectorFix.value);
                    }
                }
                return {
                    ...event,
                    meta: {
                        ...(event.meta || {}),
                        selectors: updatedSelectors.length > 0 ? updatedSelectors : event.meta?.selectors,
                        suggestedClickFixes: topFixes,
                    },
                };
            }
            return event;
        });
    }
    /**
     * 셀렉터가 페이지 내 다수 매칭될 가능성이 높은지 판단한다.
     * 짧은 클래스 셀렉터, 공통 텍스트(더보기, 자세히, See more 등),
     * 공통 컨테이너 패턴(div.more, .btn, .link 등)이면 true.
     */
    isLikelyDuplicate(selector, textContent) {
        const lastPart = selector.split(/[\s>]+/).pop()?.trim() || '';
        // ID 셀렉터(#xxx)나 data-testid는 고유하므로 즉시 제외
        if (lastPart.startsWith('#') || /\[data-testid/.test(lastPart))
            return false;
        // 1) 셀렉터가 짧고 범용적인 패턴
        const genericPatterns = [
            /^\.more\b/, /^div\.more\b/, /^\.btn\b/, /^\.link\b/, /^\.item\b/,
            /^a\b/, /^button\b/, /^\.card\b/, /^\.action\b/,
        ];
        const isGenericSel = genericPatterns.some(p => p.test(lastPart)) ||
            (lastPart.length <= 10 && !lastPart.includes('[')) || // 짧은 셀렉터 (속성 셀렉터 제외)
            (selector.split('>').length >= 3 && lastPart.split('.').length <= 2); // 깊지만 마지막이 단순
        // 2) 텍스트가 공통 패턴 (더보기, 자세히 등)
        const commonTexts = /^(더보기|더 보기|자세히|자세히보기|see more|view more|show more|read more|more|view all|전체보기|전체 보기)$/i;
        const isCommonText = commonTexts.test(textContent.trim());
        // 둘 중 하나라도 해당하면 다수 매칭 가능성 높음
        return isGenericSel || isCommonText;
    }
    /**
     * 인접 이벤트(특히 이전 navigate/click)에서 섹션 제목 힌트를 추출한다.
     * pageContext.title이나 이전 이벤트의 textContent를 활용.
     */
    findNearestSectionTitle(events, currentIdx) {
        // 현재 클릭 이벤트의 selector에서 섹션 클래스명 추출 시도
        const event = events[currentIdx];
        const sel = event.selector || '';
        const parts = sel.split(/\s*>\s*/);
        for (const part of parts) {
            // section.sec.video_section.main → "video_section" 추출
            const sectionMatch = part.match(/section\.sec\.([a-z_]+)/i);
            if (sectionMatch) {
                // 클래스명을 읽기 좋게 변환: video_section → video
                return sectionMatch[1].replace(/_section$/, '').replace(/_/g, ' ');
            }
        }
        // 직전 이벤트들에서 고유 텍스트 힌트 탐색 (최대 3스텝 뒤)
        for (let j = currentIdx - 1; j >= Math.max(0, currentIdx - 3); j--) {
            const prev = events[j];
            if (prev.type === 'click' && prev.meta?.element?.textContent) {
                const prevText = prev.meta.element.textContent.trim();
                // 짧고 고유한 텍스트만 사용 (섹션 제목 같은 것)
                if (prevText.length >= 2 && prevText.length <= 20) {
                    return prevText;
                }
            }
        }
        return null;
    }
    /** CSS selector에서 부모 섹션(section/nav/div.class)을 추출 */
    extractParentFromSelector(selector) {
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
    /** CSS selector에서 마지막 요소의 태그명을 추출 */
    extractLastTag(selector) {
        const parts = selector.split(/[\s>]+/);
        const last = parts[parts.length - 1]?.trim();
        if (!last)
            return null;
        const tagMatch = last.match(/^([a-z][a-z0-9]*)/i);
        return tagMatch ? tagMatch[1].toLowerCase() : null;
    }
    // ─── 헬퍼 ──────────────────────────────────────────
    /** 필드명 추출 (label > placeholder > name > testId) */
    getFieldName(event) {
        const elem = event.meta?.element;
        if (!elem)
            return '';
        return elem.label || elem.placeholder || elem.name || elem.testId || '';
    }
    truncate(str, max) {
        return str.length > max ? str.substring(0, max) + '…' : str;
    }
}
exports.EventOptimizer = EventOptimizer;
//# sourceMappingURL=event-optimizer.js.map