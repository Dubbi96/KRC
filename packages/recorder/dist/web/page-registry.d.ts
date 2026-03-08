import type { Page } from 'playwright';
/**
 * pageId ↔ Playwright Page 매핑을 관리하는 유틸리티.
 * Recorder/Replayer 양쪽에서 사용하여 다중 페이지(팝업/탭)를 추적한다.
 *
 * - 메인 페이지는 'main' ID로 등록
 * - 팝업은 'popup_1', 'popup_2', ... 순서로 자동 ID 부여
 */
export declare class PageRegistry {
    private pages;
    private counter;
    /** 메인 페이지 등록 */
    registerMain(page: Page): void;
    /** 새 팝업 페이지 등록 — 자동 ID ('popup_N') 반환 */
    registerPopup(page: Page): string;
    /** 지정 ID로 페이지 등록 (replayer에서 특정 pageId로 등록할 때) */
    register(pageId: string, page: Page): void;
    /** pageId로 Page 조회, 없으면 undefined */
    get(pageId: string): Page | undefined;
    /** 페이지 제거 (닫힘) */
    remove(pageId: string): void;
    /** Page 객체로 pageId를 역조회 */
    findId(page: Page): string | undefined;
    /** 등록된 모든 페이지 반환 (복사본) */
    getAll(): Map<string, Page>;
    /** 레지스트리 초기화 */
    clear(): void;
}
