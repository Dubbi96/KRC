"use strict";
/**
 * 변수 보간 엔진
 *
 * {{userName}} 같은 패턴을 실제 값으로 치환한다.
 * 동적 함수도 지원: {{$date.today}}, {{$uuid}}, {{$rand.alnum(8)}}, {{$seq("user")}} 등
 * 우선순위: CLI --var > TestDataSet > scenario.variables > 런타임 캡처
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.VariableContext = void 0;
exports.resetSequences = resetSequences;
const VAR_PATTERN = /\{\{(\w+)\}\}/g;
// 동적 함수 패턴: {{$funcName}} 또는 {{$funcName(args)}} 또는 {{$ns.funcName}} 또는 {{$ns.funcName(args)}}
const DYNAMIC_FN_PATTERN = /\{\{\$([a-zA-Z_][a-zA-Z0-9_.]*?)(?:\(([^)]*)\))?\}\}/g;
// ─── 내장 동적 함수 ─────────────────────────────────────────
function padTwo(n) {
    return n < 10 ? '0' + n : String(n);
}
function formatDate(fmt) {
    const now = new Date();
    const Y = String(now.getFullYear());
    const M = padTwo(now.getMonth() + 1);
    const D = padTwo(now.getDate());
    const H = padTwo(now.getHours());
    const m = padTwo(now.getMinutes());
    const s = padTwo(now.getSeconds());
    const ms = String(now.getMilliseconds()).padStart(3, '0');
    return fmt
        .replace(/YYYY/g, Y).replace(/YY/g, Y.slice(2))
        .replace(/MM/g, M).replace(/DD/g, D)
        .replace(/HH/g, H).replace(/mm/g, m).replace(/ss/g, s).replace(/SSS/g, ms);
}
function randomAlpha(len) {
    const chars = 'abcdefghijklmnopqrstuvwxyz';
    let r = '';
    for (let i = 0; i < len; i++)
        r += chars[Math.floor(Math.random() * chars.length)];
    return r;
}
function randomAlnum(len) {
    const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
    let r = '';
    for (let i = 0; i < len; i++)
        r += chars[Math.floor(Math.random() * chars.length)];
    return r;
}
function randomInt(min, max) {
    return String(Math.floor(Math.random() * (max - min + 1)) + min);
}
function generateUUID() {
    // 간단한 v4 UUID 생성
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
        const r = Math.random() * 16 | 0;
        const v = c === 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
}
// 전역 시퀀스 카운터 (런 단위로 초기화됨)
const seqCounters = new Map();
function nextSeq(prefix) {
    const current = seqCounters.get(prefix) || 0;
    const next = current + 1;
    seqCounters.set(prefix, next);
    return prefix + '-' + next;
}
/** 시퀀스 카운터 초기화 (새 런 시작 시 호출) */
function resetSequences() {
    seqCounters.clear();
}
function stripQuotes(s) {
    s = s.trim();
    if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
        return s.slice(1, -1);
    }
    return s;
}
/** 동적 함수 호출을 실제 값으로 치환 */
function resolveDynamicFunctions(template) {
    return template.replace(DYNAMIC_FN_PATTERN, (_match, funcPath, rawArgs) => {
        const args = rawArgs ? rawArgs.split(',').map(a => stripQuotes(a.trim())) : [];
        switch (funcPath) {
            // ── 날짜/시간 ──
            case 'date.today':
                return formatDate('YYYY-MM-DD');
            case 'date.now':
                return formatDate('YYYY-MM-DD_HH-mm-ss');
            case 'date.format':
                return args[0] ? formatDate(args[0]) : formatDate('YYYY-MM-DD');
            case 'date.timestamp':
                return String(Date.now());
            case 'date.iso':
                return new Date().toISOString();
            // ── 랜덤/유니크 ──
            case 'uuid':
                return generateUUID();
            case 'rand.int':
                return randomInt(Number(args[0]) || 0, Number(args[1]) || 9999);
            case 'rand.alpha':
                return randomAlpha(Number(args[0]) || 8);
            case 'rand.alnum':
                return randomAlnum(Number(args[0]) || 8);
            // ── 시퀀스 ──
            case 'seq':
                return nextSeq(args[0] || 'item');
            default:
                return _match; // 알 수 없는 함수는 원본 유지
        }
    });
}
class VariableContext {
    store;
    constructor(defaults) {
        this.store = new Map();
        if (defaults) {
            for (const [k, v] of Object.entries(defaults)) {
                this.store.set(k, v);
            }
        }
    }
    /** 변수 설정 */
    set(name, value) {
        this.store.set(name, value);
    }
    /** 변수 조회 (없으면 undefined) */
    get(name) {
        return this.store.get(name);
    }
    /** 모든 변수를 Record로 반환 */
    getAll() {
        const result = {};
        for (const [k, v] of this.store.entries()) {
            result[k] = v;
        }
        return result;
    }
    /** 문자열 내 {{변수}} 와 {{$동적함수}} 를 실제 값으로 치환 */
    resolve(template) {
        if (!template || !template.includes('{{'))
            return template;
        // 1) 동적 함수 먼저 치환 ({{$...}})
        let result = resolveDynamicFunctions(template);
        // 2) 일반 변수 치환 ({{varName}})
        result = result.replace(VAR_PATTERN, (_match, name) => {
            const val = this.store.get(name);
            return val !== undefined ? val : `{{${name}}}`; // 미해결은 원본 유지
        });
        return result;
    }
    /** 문자열이 변수 참조를 포함하는지 검사 */
    hasVariables(template) {
        return VAR_PATTERN.test(template) || DYNAMIC_FN_PATTERN.test(template);
    }
    /** 객체 내 모든 문자열 값을 재귀적으로 치환 */
    resolveObject(obj) {
        if (obj === null || obj === undefined)
            return obj;
        if (typeof obj === 'string')
            return this.resolve(obj);
        if (Array.isArray(obj))
            return obj.map(item => this.resolveObject(item));
        if (typeof obj === 'object') {
            const result = {};
            for (const [key, val] of Object.entries(obj)) {
                result[key] = this.resolveObject(val);
            }
            return result;
        }
        return obj;
    }
    /** 현재 context를 복제 */
    clone() {
        return new VariableContext(this.getAll());
    }
    /** 다른 Record의 값을 merge (덮어쓰기) */
    merge(vars) {
        for (const [k, v] of Object.entries(vars)) {
            this.store.set(k, v);
        }
    }
    get size() {
        return this.store.size;
    }
}
exports.VariableContext = VariableContext;
//# sourceMappingURL=variables.js.map