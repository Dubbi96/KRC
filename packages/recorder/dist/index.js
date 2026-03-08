"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __exportStar = (this && this.__exportStar) || function(m, exports) {
    for (var p in m) if (p !== "default" && !Object.prototype.hasOwnProperty.call(exports, p)) __createBinding(exports, m, p);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ScenarioValidator = exports.NetworkLogCollector = exports.PageRegistry = exports.EventBuffer = exports.SelfHealer = exports.LocatorResolver = exports.EventOptimizer = exports.RunnerManager = exports.TestRunner = exports.ScenarioComposer = exports.AssertionEngine = exports.resetSequences = exports.VariableContext = exports.ReportGenerator = exports.ResultCollector = exports.FileStorage = exports.AndroidPickServer = exports.AndroidReplayer = exports.AndroidRecorder = exports.IOSPickServer = exports.networkAssertionSet = exports.listResultAssertionSet = exports.navigationAssertionSet = exports.iosScenario = exports.IOSScenarioBuilder = exports.IOSReplayer = exports.IOSRecorder = exports.AVAILABLE_DEVICES = exports.toContextOptions = exports.resolveDeviceConfig = exports.WebReplayer = exports.WebRecorder = void 0;
__exportStar(require("./types"), exports);
var recorder_1 = require("./web/recorder");
Object.defineProperty(exports, "WebRecorder", { enumerable: true, get: function () { return recorder_1.WebRecorder; } });
var replayer_1 = require("./web/replayer");
Object.defineProperty(exports, "WebReplayer", { enumerable: true, get: function () { return replayer_1.WebReplayer; } });
var device_presets_1 = require("./web/device-presets");
Object.defineProperty(exports, "resolveDeviceConfig", { enumerable: true, get: function () { return device_presets_1.resolveDeviceConfig; } });
Object.defineProperty(exports, "toContextOptions", { enumerable: true, get: function () { return device_presets_1.toContextOptions; } });
Object.defineProperty(exports, "AVAILABLE_DEVICES", { enumerable: true, get: function () { return device_presets_1.AVAILABLE_DEVICES; } });
var recorder_2 = require("./ios/recorder");
Object.defineProperty(exports, "IOSRecorder", { enumerable: true, get: function () { return recorder_2.IOSRecorder; } });
var replayer_2 = require("./ios/replayer");
Object.defineProperty(exports, "IOSReplayer", { enumerable: true, get: function () { return replayer_2.IOSReplayer; } });
var scenario_builder_1 = require("./ios/scenario-builder");
Object.defineProperty(exports, "IOSScenarioBuilder", { enumerable: true, get: function () { return scenario_builder_1.IOSScenarioBuilder; } });
Object.defineProperty(exports, "iosScenario", { enumerable: true, get: function () { return scenario_builder_1.iosScenario; } });
Object.defineProperty(exports, "navigationAssertionSet", { enumerable: true, get: function () { return scenario_builder_1.navigationAssertionSet; } });
Object.defineProperty(exports, "listResultAssertionSet", { enumerable: true, get: function () { return scenario_builder_1.listResultAssertionSet; } });
Object.defineProperty(exports, "networkAssertionSet", { enumerable: true, get: function () { return scenario_builder_1.networkAssertionSet; } });
var pick_server_1 = require("./ios/pick-server");
Object.defineProperty(exports, "IOSPickServer", { enumerable: true, get: function () { return pick_server_1.IOSPickServer; } });
var recorder_3 = require("./android/recorder");
Object.defineProperty(exports, "AndroidRecorder", { enumerable: true, get: function () { return recorder_3.AndroidRecorder; } });
var replayer_3 = require("./android/replayer");
Object.defineProperty(exports, "AndroidReplayer", { enumerable: true, get: function () { return replayer_3.AndroidReplayer; } });
var pick_server_2 = require("./android/pick-server");
Object.defineProperty(exports, "AndroidPickServer", { enumerable: true, get: function () { return pick_server_2.AndroidPickServer; } });
var file_storage_1 = require("./storage/file-storage");
Object.defineProperty(exports, "FileStorage", { enumerable: true, get: function () { return file_storage_1.FileStorage; } });
var collector_1 = require("./reporter/collector");
Object.defineProperty(exports, "ResultCollector", { enumerable: true, get: function () { return collector_1.ResultCollector; } });
var generator_1 = require("./reporter/generator");
Object.defineProperty(exports, "ReportGenerator", { enumerable: true, get: function () { return generator_1.ReportGenerator; } });
// Engine modules
var variables_1 = require("./engine/variables");
Object.defineProperty(exports, "VariableContext", { enumerable: true, get: function () { return variables_1.VariableContext; } });
Object.defineProperty(exports, "resetSequences", { enumerable: true, get: function () { return variables_1.resetSequences; } });
var assertions_1 = require("./engine/assertions");
Object.defineProperty(exports, "AssertionEngine", { enumerable: true, get: function () { return assertions_1.AssertionEngine; } });
var composer_1 = require("./engine/composer");
Object.defineProperty(exports, "ScenarioComposer", { enumerable: true, get: function () { return composer_1.ScenarioComposer; } });
var runner_1 = require("./engine/runner");
Object.defineProperty(exports, "TestRunner", { enumerable: true, get: function () { return runner_1.TestRunner; } });
var runner_manager_1 = require("./engine/runner-manager");
Object.defineProperty(exports, "RunnerManager", { enumerable: true, get: function () { return runner_manager_1.RunnerManager; } });
var event_optimizer_1 = require("./engine/event-optimizer");
Object.defineProperty(exports, "EventOptimizer", { enumerable: true, get: function () { return event_optimizer_1.EventOptimizer; } });
// Locator resolver & self-healer
var locator_resolver_1 = require("./web/locator-resolver");
Object.defineProperty(exports, "LocatorResolver", { enumerable: true, get: function () { return locator_resolver_1.LocatorResolver; } });
var self_healer_1 = require("./web/self-healer");
Object.defineProperty(exports, "SelfHealer", { enumerable: true, get: function () { return self_healer_1.SelfHealer; } });
// Event buffer
var event_buffer_1 = require("./web/event-buffer");
Object.defineProperty(exports, "EventBuffer", { enumerable: true, get: function () { return event_buffer_1.EventBuffer; } });
// Page registry (multi-page/popup support)
var page_registry_1 = require("./web/page-registry");
Object.defineProperty(exports, "PageRegistry", { enumerable: true, get: function () { return page_registry_1.PageRegistry; } });
// Network log collector
var network_collector_1 = require("./engine/network-collector");
Object.defineProperty(exports, "NetworkLogCollector", { enumerable: true, get: function () { return network_collector_1.NetworkLogCollector; } });
// Scenario Validator
var scenario_validator_1 = require("./engine/scenario-validator");
Object.defineProperty(exports, "ScenarioValidator", { enumerable: true, get: function () { return scenario_validator_1.ScenarioValidator; } });
//# sourceMappingURL=index.js.map