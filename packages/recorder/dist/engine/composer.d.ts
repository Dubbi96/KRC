/**
 * 시나리오 합성기
 *
 * includes[] 를 재귀적으로 해석하여 이벤트 목록을 플래튼한다.
 * 예: COMMON-SIGNUP-WEB-ENTRY 시나리오를 WEB-SIGNUP-NAVER-A14 에 include로 연결
 */
import type { RecordingScenario, RecordingEvent } from '../types';
import { FileStorage } from '../storage/file-storage';
export declare class ScenarioComposer {
    private storage;
    private resolvedIds;
    constructor(storage: FileStorage);
    /**
     * includes를 재귀 해석하여 최종 이벤트 배열 반환
     * 순서: include된 시나리오 이벤트 → 본 시나리오 이벤트
     * 정규화 패스를 적용하여 "click 후 관측된 navigate"를 "wait_for + assert"로 변환
     */
    compose(scenario: RecordingScenario): Promise<RecordingEvent[]>;
    private resolveRecursive;
    /**
     * 정규화 패스: "click/keyboard(Enter/submit) 직후 관측된 navigate"를
     * "wait_for(url_change) + assert(url_contains)"로 변환한다.
     *
     * 패턴:
     *   [click/keyboard(Enter)] → [navigate(source=page_load|spa_*, 1500ms 이내)]
     * 변환 후:
     *   [click/keyboard(Enter)] → [wait_for(url_change)] → [assert(url_contains)]
     *
     * 첫 번째 navigate(index=0)와 explicit_goto는 변환 대상에서 제외한다.
     */
    private normalizeNavigations;
    /**
     * 시나리오 ID 또는 aliasId(tcId)로 검색
     */
    findByAlias(aliasId: string): Promise<RecordingScenario | null>;
}
