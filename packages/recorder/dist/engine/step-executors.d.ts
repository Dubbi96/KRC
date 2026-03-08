/**
 * 새 이벤트 타입 실행기
 *
 * wait_for_user, api_request, assert, run_script, set_variable
 */
import type { Page } from 'playwright';
import type { RecordingEvent, EventResult, AssertionResult, NetworkLogEntry } from '../types';
import type { VariableContext } from './variables';
import { AssertionEngine } from './assertions';
export interface ExecutionContext {
    page?: Page;
    iosController?: any;
    variables: VariableContext;
    assertionEngine: AssertionEngine;
    lastApiResponse?: {
        status: number;
        headers: Record<string, string>;
        body: any;
    };
    networkLogs?: NetworkLogEntry[];
    lastIOSPageSource?: string;
    onWaitForUserStart?: () => void;
    onWaitForUserEnd?: () => void;
    appiumKeepAlive?: () => Promise<void>;
}
export declare function executeWaitForUser(event: RecordingEvent, ctx: ExecutionContext): Promise<Partial<EventResult>>;
export declare function executeApiRequest(event: RecordingEvent, ctx: ExecutionContext): Promise<Partial<EventResult>>;
export declare function executeSetVariable(event: RecordingEvent, ctx: ExecutionContext): Promise<Partial<EventResult>>;
export declare function executeRunScript(event: RecordingEvent, ctx: ExecutionContext): Promise<Partial<EventResult>>;
export declare function executeAssert(event: RecordingEvent, ctx: ExecutionContext): Promise<{
    assertionResults: AssertionResult[];
    error?: string;
}>;
/** 기존 이벤트(click, fill 등) 실행 후 부착된 어설션을 평가 */
export declare function evaluatePostStepAssertions(event: RecordingEvent, ctx: ExecutionContext): Promise<AssertionResult[]>;
export declare function executeExtractData(event: RecordingEvent, ctx: ExecutionContext): Promise<Partial<EventResult>>;
export declare function executeWaitFor(event: RecordingEvent, ctx: ExecutionContext): Promise<Partial<EventResult>>;
export declare function evaluateIfCondition(event: RecordingEvent, ctx: ExecutionContext): Promise<boolean>;
/**
 * 화면 스크린샷과 기준 이미지를 pixelmatch로 비교
 * DOM이 없는 웹뷰/하이브리드 앱에서 요소 출현 확인용
 *
 * Web replayer: page.screenshot() 사용
 * iOS replayer: controller.screenshot() 사용
 */
export declare function executeImageMatch(event: RecordingEvent, ctx: ExecutionContext): Promise<Partial<EventResult>>;
/**
 * 이미지에서 OCR로 텍스트를 추출하여 변수에 저장.
 *
 * 실행 흐름:
 * 1. source에 따라 element/region/page 스크린샷 캡처 (PNG buffer)
 * 2. 전처리 (grayscale, threshold, scale, invert)
 * 3. OCR 수행 (로컬 Tesseract 1차 → 실패 시 전처리 변경 재시도)
 * 4. 후처리 (regex, stripSpaces, upper/lower, trim)
 * 5. confidence 검사
 * 6. vars[targetVar] = processedText
 * 7. 디버그 아티팩트 저장 (out/ocr/)
 */
export declare function executeOcrExtract(event: RecordingEvent, ctx: ExecutionContext, reportDir?: string): Promise<Partial<EventResult>>;
/**
 * IMAP으로 이메일 수신함에 접속 → 인증 이메일 검색 → 본문에서 인증 링크 추출
 * → (선택) 브라우저에서 해당 링크 열기
 */
export declare function executeCheckEmail(event: RecordingEvent, ctx: ExecutionContext): Promise<Partial<EventResult>>;
