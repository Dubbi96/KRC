import type { RecordingScenario, ReplayOptions, TestResult } from '../types';
export declare class WebReplayer {
    private collector;
    private generator;
    private pageRegistry;
    private locatorResolver;
    /** healedLocator 결과를 시나리오 이벤트에 반영 (다음 실행에서 우선 사용) */
    private applyHealedLocator;
    /** 기존 healedLocator로 resolve 성공 시 successCount를 누적한다 (학습 루프) */
    private bumpHealedLocatorSuccess;
    /**
     * resolveElement 대신 locatorResolver.resolve에 전달할 옵션을 구성한다.
     * within 스코프 처리, matchText 해석을 포함.
     */
    private buildResolverOptions;
    replay(scenario: RecordingScenario, options?: ReplayOptions): Promise<TestResult>;
    /**
     * 이벤트에 기록된 meta.pageId로 올바른 Page를 해석한다.
     * pageId가 없거나 'main'이면 fallbackPage를 반환한다.
     *
     * Fallback 정책 (pageId가 registry에 없는 경우):
     * 1) registry에 등록된 page 중 닫히지 않은 마지막 page 사용
     * 2) 모든 page가 닫혔으면 fallbackPage(main) 사용
     * 경고 로그를 남겨서 flaky 디버깅에 도움을 준다.
     */
    private resolvePageForEvent;
    /** 스텝 단위 타임아웃 (ms) — 이 시간 내에 완료되지 않으면 즉시 실패 처리 */
    private static STEP_TIMEOUT;
    /** 이벤트 특성에 따른 동적 타임아웃 계산 */
    private static getStepTimeout;
    private replayEvent;
    /** replayEvent 내부 실제 실행 로직 (deadline으로 전체 시간 제어) */
    private executeStep;
    /** CSS 특수문자가 포함된 selector를 안전한 형태로 변환 */
    private safeSelector;
    private escapeAttributeValue;
    /**
     * 녹화 시점의 스크롤 위치를 복원하여 lazy-load/fold 하단 요소 접근성을 보장한다.
     * 실패해도 무시 — 스크롤 복원은 보조적 수단이므로 치명적이지 않음.
     */
    private restoreScrollPosition;
    /**
     * 요소가 즉시 발견되지 않을 때 점진적 스크롤로 페이지를 탐색하여
     * 레이지 로딩, 동적 렌더링, 뷰포트 밖 요소를 발견한다.
     *
     * 탐색 순서:
     * 1. 녹화된 스크롤 위치에서 resolve 시도 (기존 동작)
     * 2. 실패 시 → 페이지를 뷰포트 70% 단위로 점진 스크롤하며 재시도
     * 3. 각 스크롤 위치에서 300ms 대기 (레이지 로딩 트리거)
     * 4. 성공 시 즉시 반환, 전부 실패 시 마지막 에러 throw
     */
    private resolveWithScrollDiscovery;
    /**
     * 중첩 마커 짝 매칭: startType에 대응하는 endType의 인덱스를 반환.
     * 중첩된 동일 마커 쌍을 올바르게 처리한다.
     */
    private findMatchingEnd;
    private sleep;
}
