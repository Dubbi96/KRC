"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PageRegistry = void 0;
/**
 * pageId ↔ Playwright Page 매핑을 관리하는 유틸리티.
 * Recorder/Replayer 양쪽에서 사용하여 다중 페이지(팝업/탭)를 추적한다.
 *
 * - 메인 페이지는 'main' ID로 등록
 * - 팝업은 'popup_1', 'popup_2', ... 순서로 자동 ID 부여
 */
class PageRegistry {
    pages = new Map();
    counter = 0;
    /** 메인 페이지 등록 */
    registerMain(page) {
        this.pages.set('main', page);
    }
    /** 새 팝업 페이지 등록 — 자동 ID ('popup_N') 반환 */
    registerPopup(page) {
        this.counter++;
        const pageId = `popup_${this.counter}`;
        this.pages.set(pageId, page);
        return pageId;
    }
    /** 지정 ID로 페이지 등록 (replayer에서 특정 pageId로 등록할 때) */
    register(pageId, page) {
        this.pages.set(pageId, page);
        // counter 동기화: popup_N 형태면 N을 추적
        const match = pageId.match(/^popup_(\d+)$/);
        if (match) {
            const n = parseInt(match[1], 10);
            if (n > this.counter)
                this.counter = n;
        }
    }
    /** pageId로 Page 조회, 없으면 undefined */
    get(pageId) {
        return this.pages.get(pageId);
    }
    /** 페이지 제거 (닫힘) */
    remove(pageId) {
        this.pages.delete(pageId);
    }
    /** Page 객체로 pageId를 역조회 */
    findId(page) {
        for (const [id, p] of this.pages.entries()) {
            if (p === page)
                return id;
        }
        return undefined;
    }
    /** 등록된 모든 페이지 반환 (복사본) */
    getAll() {
        return new Map(this.pages);
    }
    /** 레지스트리 초기화 */
    clear() {
        this.pages.clear();
        this.counter = 0;
    }
}
exports.PageRegistry = PageRegistry;
//# sourceMappingURL=page-registry.js.map