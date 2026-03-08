"use strict";
/**
 * 네트워크 로그 수집기
 *
 * 모바일 E2E 테스트에서 네트워크 요청/응답을 캡처하여
 * assertion 검증의 증거로 제공한다.
 *
 * 수집 경로:
 * 1. mitmproxy 로그 파일 (JSONL 형식) — 가장 강력
 * 2. 프로그래밍 방식 수동 등록 (api_request step 결과 등)
 * 3. (향후) HAR 파일 임포트
 *
 * 사용법:
 * ```ts
 * const collector = new NetworkLogCollector();
 *
 * // mitmproxy 로그 파일 감시 시작
 * collector.watchMitmproxyLog('/tmp/mitmproxy-flows.jsonl');
 *
 * // 또는 수동 등록
 * collector.add({ url: '/api/search', status: 200, ... });
 *
 * // assertion context에 전달
 * const logs = collector.getRecentLogs(30000); // 최근 30초
 * ```
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.NetworkLogCollector = void 0;
const fs_1 = require("fs");
// ─── Ring Buffer ───────────────────────────────────────────
const DEFAULT_MAX_ENTRIES = 1000;
const DEFAULT_WINDOW_MS = 60000; // 60초
class NetworkLogCollector {
    logs = [];
    maxEntries;
    watchedFile = null;
    lastFileSize = 0;
    fileWatchInterval = null;
    constructor(maxEntries = DEFAULT_MAX_ENTRIES) {
        this.maxEntries = maxEntries;
    }
    // ─── 로그 추가 ─────────────────────────────────────────
    /** 단일 네트워크 로그 엔트리 추가 */
    add(entry) {
        this.logs.push(entry);
        // 링 버퍼: 최대 크기 초과 시 오래된 것부터 제거
        if (this.logs.length > this.maxEntries) {
            this.logs = this.logs.slice(-this.maxEntries);
        }
    }
    /** 여러 엔트리 한번에 추가 */
    addAll(entries) {
        for (const entry of entries) {
            this.add(entry);
        }
    }
    // ─── 로그 조회 ─────────────────────────────────────────
    /** 전체 로그 반환 */
    getAll() {
        return [...this.logs];
    }
    /** 최근 N밀리초 이내의 로그만 반환 */
    getRecentLogs(windowMs = DEFAULT_WINDOW_MS) {
        const cutoff = Date.now() - windowMs;
        return this.logs.filter(log => log.timestamp >= cutoff);
    }
    /** URL 패턴으로 필터링 (부분 문자열 또는 정규식) */
    findByUrl(pattern, isRegex = false) {
        if (isRegex) {
            const regex = new RegExp(pattern, 'i');
            return this.logs.filter(log => regex.test(log.url));
        }
        return this.logs.filter(log => log.url.includes(pattern));
    }
    /** URL 패턴 + 최근 윈도우로 필터링 */
    findRecentByUrl(pattern, isRegex = false, windowMs = DEFAULT_WINDOW_MS) {
        const cutoff = Date.now() - windowMs;
        if (isRegex) {
            const regex = new RegExp(pattern, 'i');
            return this.logs.filter(log => log.timestamp >= cutoff && regex.test(log.url));
        }
        return this.logs.filter(log => log.timestamp >= cutoff && log.url.includes(pattern));
    }
    /** 로그 초기화 */
    clear() {
        this.logs = [];
    }
    /** 현재 로그 수 */
    get size() {
        return this.logs.length;
    }
    // ─── mitmproxy JSONL 로그 감시 ──────────────────────────
    /**
     * mitmproxy가 출력하는 JSONL 로그 파일을 감시하여
     * 새 엔트리가 추가되면 자동으로 수집한다.
     *
     * mitmproxy 실행 예시:
     * ```bash
     * mitmdump -s /path/to/katab-mitm-addon.py \
     *   --set katab_log=/tmp/katab-network.jsonl \
     *   -p 8888
     * ```
     *
     * 또는 간단한 mitmdump 스크립트로 JSONL 형식 출력:
     * ```python
     * # katab-mitm-addon.py
     * import json, time
     *
     * def response(flow):
     *     entry = {
     *         "url": flow.request.pretty_url,
     *         "method": flow.request.method,
     *         "status": flow.response.status_code,
     *         "contentType": flow.response.headers.get("content-type", ""),
     *         "contentLength": len(flow.response.content),
     *         "timestamp": int(time.time() * 1000),
     *         "duration": int((flow.response.timestamp_end - flow.request.timestamp_start) * 1000),
     *     }
     *     # JSON body 캡처 (선택)
     *     ct = flow.response.headers.get("content-type", "")
     *     if "json" in ct:
     *         try:
     *             entry["responseBody"] = flow.response.text
     *         except:
     *             pass
     *     with open(flow.metadata.get("katab_log", "/tmp/katab-network.jsonl"), "a") as f:
     *         f.write(json.dumps(entry) + "\n")
     * ```
     */
    watchMitmproxyLog(filePath, pollIntervalMs = 500) {
        this.stopWatching();
        this.watchedFile = filePath;
        // 파일이 없으면 빈 파일 생성
        if (!(0, fs_1.existsSync)(filePath)) {
            (0, fs_1.writeFileSync)(filePath, '', 'utf-8');
        }
        // 현재 파일 크기 기록 (기존 내용은 스킵)
        try {
            const content = (0, fs_1.readFileSync)(filePath, 'utf-8');
            this.lastFileSize = Buffer.byteLength(content, 'utf-8');
        }
        catch {
            this.lastFileSize = 0;
        }
        // 폴링 방식으로 파일 변경 감시 (watchFile보다 안정적)
        this.fileWatchInterval = setInterval(() => {
            this.readNewLines(filePath);
        }, pollIntervalMs);
    }
    /** 파일 감시 중단 */
    stopWatching() {
        if (this.fileWatchInterval) {
            clearInterval(this.fileWatchInterval);
            this.fileWatchInterval = null;
        }
        this.watchedFile = null;
        this.lastFileSize = 0;
    }
    /** 파일에서 새로 추가된 줄만 읽어 파싱 */
    readNewLines(filePath) {
        try {
            const content = (0, fs_1.readFileSync)(filePath, 'utf-8');
            const currentSize = Buffer.byteLength(content, 'utf-8');
            if (currentSize <= this.lastFileSize)
                return;
            // 새로 추가된 부분만 추출
            const newContent = Buffer.from(content, 'utf-8')
                .subarray(this.lastFileSize)
                .toString('utf-8');
            this.lastFileSize = currentSize;
            // JSONL 파싱
            const lines = newContent.split('\n').filter(l => l.trim());
            for (const line of lines) {
                try {
                    const raw = JSON.parse(line);
                    const entry = {
                        url: raw.url || '',
                        method: raw.method,
                        status: raw.status || raw.statusCode || 0,
                        contentType: raw.contentType || raw.content_type || '',
                        contentLength: raw.contentLength ?? raw.content_length ?? -1,
                        timestamp: raw.timestamp || Date.now(),
                        responseBody: raw.responseBody || raw.response_body,
                        requestBody: raw.requestBody || raw.request_body,
                        duration: raw.duration,
                        error: raw.error,
                    };
                    this.add(entry);
                }
                catch {
                    // 파싱 실패한 줄은 무시
                }
            }
        }
        catch {
            // 파일 읽기 실패는 무시 (다음 폴링에서 재시도)
        }
    }
    // ─── HAR 파일 임포트 ──────────────────────────────────
    /**
     * HAR(HTTP Archive) 파일에서 네트워크 로그를 임포트한다.
     * Charles/Proxyman 등에서 내보낸 HAR 파일 지원
     */
    importHar(filePath) {
        try {
            const content = (0, fs_1.readFileSync)(filePath, 'utf-8');
            const har = JSON.parse(content);
            const entries = har.log?.entries || [];
            let count = 0;
            for (const entry of entries) {
                const request = entry.request || {};
                const response = entry.response || {};
                const startTime = new Date(entry.startedDateTime || 0).getTime();
                this.add({
                    url: request.url || '',
                    method: request.method,
                    status: response.status || 0,
                    contentType: response.content?.mimeType || '',
                    contentLength: response.content?.size ?? response.bodySize ?? -1,
                    timestamp: startTime || Date.now(),
                    duration: entry.time ? Math.round(entry.time) : undefined,
                    responseBody: response.content?.text,
                });
                count++;
            }
            return count;
        }
        catch {
            return 0;
        }
    }
    // ─── 스냅샷 (assertion context 연동) ──────────────────
    /**
     * 현재 로그의 스냅샷을 반환한다.
     * AssertionContext.networkLogs에 설정하여 assertion 검증에 사용
     */
    snapshot(windowMs) {
        if (windowMs)
            return this.getRecentLogs(windowMs);
        return this.getAll();
    }
    // ─── Cleanup ──────────────────────────────────────────
    destroy() {
        this.stopWatching();
        this.logs = [];
    }
}
exports.NetworkLogCollector = NetworkLogCollector;
//# sourceMappingURL=network-collector.js.map