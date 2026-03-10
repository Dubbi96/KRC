/**
 * Provider Registry
 *
 * Maps (platform, deviceType) to the correct Provider instance.
 * Used by WorkerManager and SessionManager to dispatch to the right provider.
 */

import { Provider } from './provider.interface';
import { ProviderType } from 'katab-shared';
import { WebBrowserProvider } from './web-browser.provider';
import { IOSRealProvider } from './ios-real.provider';
import { AndroidRealProvider } from './android-real.provider';

export class ProviderRegistry {
  private providers = new Map<ProviderType, Provider>();

  constructor(opts?: { iosAppiumPort?: number; androidAppiumPort?: number }) {
    this.providers.set(ProviderType.WEB_BROWSER, new WebBrowserProvider());
    this.providers.set(ProviderType.IOS_REAL, new IOSRealProvider(opts?.iosAppiumPort ?? 4723));
    this.providers.set(ProviderType.ANDROID_REAL, new AndroidRealProvider(opts?.androidAppiumPort ?? 4724));
  }

  /**
   * Get provider by explicit type.
   */
  get(type: ProviderType): Provider | undefined {
    return this.providers.get(type);
  }

  /**
   * Resolve provider from platform string and device characteristics.
   */
  resolve(platform: string, opts?: { isSimulator?: boolean; isEmulator?: boolean }): Provider | undefined {
    switch (platform) {
      case 'web':
        return this.providers.get(ProviderType.WEB_BROWSER);
      case 'ios':
        if (opts?.isSimulator) {
          // iOS simulator provider — fallback to real for now
          return this.providers.get(ProviderType.IOS_REAL);
        }
        return this.providers.get(ProviderType.IOS_REAL);
      case 'android':
        if (opts?.isEmulator) {
          // Android emulator provider — fallback to real for now
          return this.providers.get(ProviderType.ANDROID_REAL);
        }
        return this.providers.get(ProviderType.ANDROID_REAL);
      default:
        return undefined;
    }
  }

  /**
   * Get all registered providers.
   */
  all(): Provider[] {
    return Array.from(this.providers.values());
  }

  /**
   * Get providers for specific platforms.
   */
  forPlatforms(platforms: string[]): Provider[] {
    const result: Provider[] = [];
    for (const p of platforms) {
      const provider = this.resolve(p);
      if (provider && !result.includes(provider)) {
        result.push(provider);
      }
    }
    return result;
  }
}
