"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AuthStore = void 0;
/**
 * Stub for AuthStore — provides auth profile injection into browser contexts.
 * The full implementation lived in the legacy dashboard module.
 */
class AuthStore {
    constructor(..._) { }
    static load(..._) { return new AuthStore(); }
    getProfile(..._) { return null; }
    async injectIntoContext(..._) { return false; }
    async injectStorageIntoPage(..._) { return false; }
}
exports.AuthStore = AuthStore;
//# sourceMappingURL=auth-store.js.map