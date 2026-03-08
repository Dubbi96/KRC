"use strict";
/**
 * Timestamp 정규화 유틸리티
 *
 * 시나리오 이벤트의 timestamp가 역전되거나 비정상적으로 큰 gap을 가질 때
 * 이를 보정하여 replayer의 대기 시간 계산이 정상 동작하도록 한다.
 *
 * 적용 시점:
 * 1. replayer 재생 시작 전 (방어적)
 * 2. dashboard 저장 시 (사전 예방)
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.normalizeTimestamps = normalizeTimestamps;
/**
 * 이벤트 배열의 timestamp를 정규화한다. (in-place 수정)
 *
 * - 이전 스텝보다 timestamp가 작으면 (역전) → prevTimestamp + defaultGap
 * - gap이 maxGap을 초과하면 → prevTimestamp + defaultGap
 * - 정상 범위(0 < diff ≤ maxGap)면 원본 유지
 *
 * @returns 보정된 스텝 수
 */
function normalizeTimestamps(events, options = {}) {
    const { maxGap = 30000, defaultGap = 500 } = options;
    if (events.length <= 1)
        return 0;
    let fixed = 0;
    let prev = events[0].timestamp;
    for (let i = 1; i < events.length; i++) {
        const diff = events[i].timestamp - prev;
        if (diff < 0 || diff > maxGap) {
            events[i].timestamp = prev + defaultGap;
            fixed++;
        }
        prev = events[i].timestamp;
    }
    return fixed;
}
//# sourceMappingURL=timestamp-utils.js.map