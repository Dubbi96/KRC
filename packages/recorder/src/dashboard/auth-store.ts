/**
 * Stub for AuthStore — provides auth profile injection into browser contexts.
 * The full implementation lived in the legacy dashboard module.
 */
export class AuthStore {
  constructor(..._: any[]) {}
  static load(..._: any[]): any { return new AuthStore(); }
  getProfile(..._: any[]): any { return null; }
  async injectIntoContext(..._: any[]): Promise<boolean> { return false; }
  async injectStorageIntoPage(..._: any[]): Promise<boolean> { return false; }
}
