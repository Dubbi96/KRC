export * from './types';
export { WebRecorder } from './web/recorder';
export { WebReplayer } from './web/replayer';
export { resolveDeviceConfig, toContextOptions, AVAILABLE_DEVICES } from './web/device-presets';
export { IOSRecorder } from './ios/recorder';
export { IOSReplayer } from './ios/replayer';
export { IOSScenarioBuilder, iosScenario, navigationAssertionSet, listResultAssertionSet, networkAssertionSet } from './ios/scenario-builder';
export { IOSPickServer } from './ios/pick-server';
export { AndroidRecorder } from './android/recorder';
export { AndroidReplayer } from './android/replayer';
export { AndroidPickServer } from './android/pick-server';
export { FileStorage } from './storage/file-storage';
export { ResultCollector } from './reporter/collector';
export { ReportGenerator } from './reporter/generator';

// Engine modules
export { VariableContext, resetSequences } from './engine/variables';
export { AssertionEngine } from './engine/assertions';
export { ScenarioComposer } from './engine/composer';
export { TestRunner } from './engine/runner';
export { RunnerManager } from './engine/runner-manager';
export { EventOptimizer } from './engine/event-optimizer';

// Locator resolver & self-healer
export { LocatorResolver } from './web/locator-resolver';
export { SelfHealer } from './web/self-healer';

// Event buffer
export { EventBuffer } from './web/event-buffer';

// Page registry (multi-page/popup support)
export { PageRegistry } from './web/page-registry';

// Network log collector
export { NetworkLogCollector } from './engine/network-collector';

// Scenario Validator
export { ScenarioValidator } from './engine/scenario-validator';
