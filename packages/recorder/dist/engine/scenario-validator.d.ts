/**
 * ScenarioValidator
 *
 * \uc2dc\ub098\ub9ac\uc624\uc758 \uad6c\uc870\uc801 \ubb34\uacb0\uc131\uc744 \uac80\uc0ac\ud55c\ub2e4.
 * - \ud544\uc218 \ud544\ub4dc \ub204\ub77d \uac80\uc0ac
 * - for_each/if \ub9c8\ucee4 \uc9dd \uac80\uc0ac
 * - \uc140\ub809\ud130 \uac74\uac15\ub3c4 \uacbd\uace0
 * - \ubcc0\uc218 \ucc38\uc870 \ubbf8\uc815\uc758 \uacbd\uace0
 * - API \uc694\uccad \uc124\uc815 \uac80\uc99d
 * - \ud0c0\uc784\uc544\uc6c3 \ubbf8\uc124\uc815 \uacbd\uace0
 */
import type { RecordingScenario } from '../types';
export interface ValidationIssue {
    level: 'error' | 'warning' | 'info';
    stepIndex?: number;
    field?: string;
    message: string;
    code: string;
}
export interface ScenarioValidationResult {
    issues: ValidationIssue[];
    summary: {
        errors: number;
        warnings: number;
        info: number;
    };
}
export declare class ScenarioValidator {
    validate(scenario: RecordingScenario): ScenarioValidationResult;
    private checkRequiredFields;
    private checkMarkerBalance;
    private checkSelectorHealth;
    private checkVariableReferences;
    private checkApiRequests;
    private checkTimeouts;
    private checkOnFailPolicies;
}
