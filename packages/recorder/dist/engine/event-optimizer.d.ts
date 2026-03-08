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
import type { RecordingEvent } from '../types';
export declare class EventOptimizer {
    /**
     * 모든 최적화를 순차 적용한다.
     * @param events 원본 이벤트 배열
     * @returns 최적화된 새 이벤트 배열 (원본 불변)
     */
    optimize(events: RecordingEvent[]): RecordingEvent[];
    /**
     * 연속된 fill 이벤트들에 폼 입력 그룹 description을 부여한다.
     * 연속 fill 2개 이상이면 첫 fill에 그룹 설명을 추가하고,
     * 각 fill에 필드명 기반 설명을 부여한다.
     */
    private mergeConsecutiveFills;
    /**
     * click 직후 navigate(page_load)가 오면,
     * 사이에 wait_for(network_idle) 이벤트를 삽입한다.
     *
     * 이벤트 간 시간 갭이 2초 이상이면 암묵적 대기가 필요한 구간으로 판단.
     */
    private insertAutoWaits;
    /**
     * meta.selectors[] 후보를 안정성 기준으로 재정렬하고,
     * 가장 안정적인 셀렉터를 primary selector로 교체한다.
     *
     * 우선순위: data-testid > [role][name] > [aria-label] > [name] > [placeholder] > text > CSS class
     */
    private stabilizeSelectors;
    /**
     * 기록 시 생성된 preferredLocators가 없거나 부족한 이벤트에 대해
     * meta.element 정보를 기반으로 preferredLocators를 생성/보강한다.
     *
     * 기록 스크립트가 이미 preferredLocators를 생성하지만,
     * 이전 버전 녹화 데이터나 모바일 이벤트 등에는 없을 수 있어 후처리로 보강한다.
     */
    private enrichPreferredLocators;
    /** 셀렉터 안정성 우선순위 (낮을수록 좋음) */
    private selectorPriority;
    /**
     * navigate 이벤트 후에 url_contains assertion을 자동 첨부한다.
     * 클릭 후 페이지 제목 변경이 감지되면 text_contains assertion 후보도 추가.
     */
    private suggestAssertions;
    /**
     * 로그인 플로우를 감지한다.
     * 패턴: 연속 fill 중 password 타입 → click → navigate
     * @returns navigate 스텝의 인덱스 집합
     */
    private detectLoginSequences;
    /**
     * 각 이벤트에 사람이 읽을 수 있는 description을 자동 생성한다.
     * 이미 description이 있으면 덮어쓰지 않는다.
     */
    private generateDescriptions;
    /** 이벤트 타입별 description 생성 */
    private buildDescription;
    /**
     * 동적 값({{$uuid}} 등) 추적을 위한 자동 추천:
     *
     * A. fill에 동적 함수가 있으면 captureResolvedAs 추천
     * B. click의 textContent가 이전 fill 동적 값의 prefix와 매칭되면 matchText 자동 설정
     * C. click textContent가 "코드 패턴"(대문자+숫자 4~16자)이면 extract_data 추천
     */
    private suggestDynamicTracking;
    /**
     * CSS selector에서 변수명을 추출한다.
     * 예: "#form_GiftCodeName" → "giftCodeName"
     * 예: "[name='SearchText']" → "searchText"
     */
    private extractVarNameFromSelector;
    /**
     * 클릭 이벤트의 셀렉터 안정성을 분석하고 개선 추천을 생성한다.
     *
     * 추천 카테고리:
     * A) 셀렉터 안정화 — 깊은 CSS 경로를 text/role/section 기반으로 교체 추천
     * B) 대기 보정 — 클릭 전 element_visible 대기, 클릭 후 URL/요소 검증
     * C) 스크롤/가시성 — scrollIntoView 자동 삽입
     * D) 폴백 체인 — 다중 후보 셀렉터 구성 추천
     */
    private suggestClickStabilization;
    /**
     * 셀렉터가 페이지 내 다수 매칭될 가능성이 높은지 판단한다.
     * 짧은 클래스 셀렉터, 공통 텍스트(더보기, 자세히, See more 등),
     * 공통 컨테이너 패턴(div.more, .btn, .link 등)이면 true.
     */
    private isLikelyDuplicate;
    /**
     * 인접 이벤트(특히 이전 navigate/click)에서 섹션 제목 힌트를 추출한다.
     * pageContext.title이나 이전 이벤트의 textContent를 활용.
     */
    private findNearestSectionTitle;
    /** CSS selector에서 부모 섹션(section/nav/div.class)을 추출 */
    private extractParentFromSelector;
    /** CSS selector에서 마지막 요소의 태그명을 추출 */
    private extractLastTag;
    /** 필드명 추출 (label > placeholder > name > testId) */
    private getFieldName;
    private truncate;
}
