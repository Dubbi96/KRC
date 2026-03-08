import type { RecordingScenario, ReplayOptions, TestResult } from '../types';
export declare class AndroidReplayer {
    private collector;
    private generator;
    private currentDeviceId?;
    private currentPackage?;
    replay(scenario: RecordingScenario, options?: ReplayOptions): Promise<TestResult>;
    private replayEvent;
    /**
     * androidSelector로 UIAutomator dump에서 요소를 찾아 중심 좌표로 탭한다.
     * 성공 시 true, 실패 시 false (좌표 fallback 필요)
     */
    private tapBySelector;
    /**
     * meta.element에서 최적의 androidSelector를 생성한다.
     * 우선순위: resource-id > content-desc > text
     */
    private elementToSelector;
    /**
     * 매 스텝 실행 후 스크린샷을 수집하여 디버깅 증거로 남긴다.
     * - 모든 UI 관련 스텝에서 수집 (report 시각적 증거용)
     * - set_variable, run_script, api_request 등 UI 없는 스텝은 스킵
     */
    private collectStepArtifacts;
    /**
     * artifacts의 base64 스크린샷을 파일로 저장하고 경로를 반환한다.
     */
    private saveScreenshotToFile;
    private sleep;
}
