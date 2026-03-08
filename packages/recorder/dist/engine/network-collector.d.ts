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
import type { NetworkLogEntry } from '../types';
export declare class NetworkLogCollector {
    private logs;
    private maxEntries;
    private watchedFile;
    private lastFileSize;
    private fileWatchInterval;
    constructor(maxEntries?: number);
    /** 단일 네트워크 로그 엔트리 추가 */
    add(entry: NetworkLogEntry): void;
    /** 여러 엔트리 한번에 추가 */
    addAll(entries: NetworkLogEntry[]): void;
    /** 전체 로그 반환 */
    getAll(): NetworkLogEntry[];
    /** 최근 N밀리초 이내의 로그만 반환 */
    getRecentLogs(windowMs?: number): NetworkLogEntry[];
    /** URL 패턴으로 필터링 (부분 문자열 또는 정규식) */
    findByUrl(pattern: string, isRegex?: boolean): NetworkLogEntry[];
    /** URL 패턴 + 최근 윈도우로 필터링 */
    findRecentByUrl(pattern: string, isRegex?: boolean, windowMs?: number): NetworkLogEntry[];
    /** 로그 초기화 */
    clear(): void;
    /** 현재 로그 수 */
    get size(): number;
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
    watchMitmproxyLog(filePath: string, pollIntervalMs?: number): void;
    /** 파일 감시 중단 */
    stopWatching(): void;
    /** 파일에서 새로 추가된 줄만 읽어 파싱 */
    private readNewLines;
    /**
     * HAR(HTTP Archive) 파일에서 네트워크 로그를 임포트한다.
     * Charles/Proxyman 등에서 내보낸 HAR 파일 지원
     */
    importHar(filePath: string): number;
    /**
     * 현재 로그의 스냅샷을 반환한다.
     * AssertionContext.networkLogs에 설정하여 assertion 검증에 사용
     */
    snapshot(windowMs?: number): NetworkLogEntry[];
    destroy(): void;
}
