import type { RecordingScenario, ReplayOptions, TestResult } from '../types';
export declare class IOSReplayer {
    private collector;
    private generator;
    private currentBundleId?;
    private networkCollector?;
    replay(scenario: RecordingScenario, options?: ReplayOptions): Promise<TestResult>;
    private replayEvent;
    /**
     * iosSelector로 Appium에서 요소를 찾아 직접 클릭한다.
     * 성공 시 true, 실패 시 false (좌표 fallback 필요)
     */
    /** XML 엔티티 디코딩 (&#10; → \n 등) */
    private decodeXmlEntities;
    private tapBySelector;
    /**
     * meta.element에서 최적의 iosSelector를 생성한다.
     * 우선순위: accessibilityId > name > label
     */
    private elementToSelector;
    /**
     * 매 스텝 실행 후 스크린샷과 pageSource를 수집하여 디버깅 증거로 남긴다.
     * - 모든 UI 관련 스텝에서 스크린샷 수집 (report 시각적 증거용)
     * - set_variable, run_script, api_request 등 UI 없는 스텝은 스킵
     */
    private collectStepArtifacts;
    /**
     * artifacts의 base64 스크린샷을 파일로 저장하고 경로를 반환한다.
     * report HTML에서 img src로 사용할 수 있는 상대 경로를 반환한다.
     */
    private saveScreenshotToFile;
    private sleep;
    /**
     * 중첩 구조의 매칭 end 마커를 찾는다.
     * 예: if_start → if_end, for_each_start → for_each_end
     */
    private findMatchingEnd;
    /**
     * UI 액션 후 화면 안정화 대기
     *
     * 최소 minWait ms 대기 후, pageSource를 비교하여 변화가 멈출 때까지 대기.
     * maxWait ms 이내에 안정화되지 않으면 타임아웃.
     *
     * 이를 통해 timestamp gap이 부정확한 시나리오에서도
     * 다음 스텝 실행 전 UI가 준비된 상태를 보장한다.
     */
    private waitForUISettle;
}
