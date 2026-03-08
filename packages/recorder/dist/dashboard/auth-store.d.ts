/**
 * Stub for AuthStore — provides auth profile injection into browser contexts.
 * The full implementation lived in the legacy dashboard module.
 */
export declare class AuthStore {
    constructor(..._: any[]);
    static load(..._: any[]): any;
    getProfile(..._: any[]): any;
    injectIntoContext(..._: any[]): Promise<boolean>;
    injectStorageIntoPage(..._: any[]): Promise<boolean>;
}
