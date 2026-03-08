export type Platform = 'web' | 'ios' | 'android';
export type WebDeviceType = 'desktop' | 'iphone-14' | 'iphone-14-pro-max' | 'iphone-15-pro' | 'pixel-7' | 'galaxy-s24';
export interface DeviceEmulationConfig {
    deviceType: WebDeviceType;
    viewport: {
        width: number;
        height: number;
    };
    userAgent?: string;
    deviceScaleFactor?: number;
    isMobile?: boolean;
    hasTouch?: boolean;
}
export type RecordingEventType = 'click' | 'fill' | 'select' | 'navigate' | 'wait' | 'tap' | 'swipe' | 'scroll' | 'type' | 'longPress' | 'home' | 'back' | 'clear_app' | 'wait_for_user' | 'check_email' | 'api_request' | 'assert' | 'run_script' | 'set_variable' | 'extract_data' | 'keyboard' | 'hover' | 'wait_for' | 'image_match' | 'ocr_extract' | 'for_each_start' | 'for_each_end' | 'if_start' | 'if_end' | 'block_start' | 'block_end' | 'ios_alert_accept' | 'ios_alert_dismiss' | 'popup_opened' | 'popup_closed' | 'dialog';
export type AssertionType = 'url_contains' | 'url_equals' | 'url_matches' | 'element_exists' | 'element_not_exists' | 'element_visible' | 'text_contains' | 'text_equals' | 'element_text_contains' | 'element_text_equals' | 'element_attribute_equals' | 'http_status' | 'response_body_contains' | 'variable_equals' | 'video_playing' | 'video_no_error' | 'video_auto' | 'video_visual' | 'stream_segments_loaded' | 'custom' | 'ios_element_visible' | 'ios_element_not_exists' | 'ios_text_contains' | 'ios_text_absent' | 'ios_element_value_equals' | 'ios_list_count' | 'ios_no_alert' | 'ios_screen_changed' | 'network_request_sent' | 'network_response_status' | 'network_response_json' | 'network_image_loads' | 'network_no_errors' | 'android_element_visible' | 'android_element_not_exists' | 'android_text_contains' | 'android_element_text_equals';
export interface Assertion {
    type: AssertionType;
    target?: string;
    expected: string;
    attribute?: string;
    message?: string;
    optional?: boolean;
    videoConfig?: {
        observeMs?: number;
        minTimeAdvance?: number;
        requireDimension?: boolean;
    };
    visualConfig?: {
        observeMs?: number;
        changeThreshold?: number;
        clip?: {
            x: number;
            y: number;
            width: number;
            height: number;
        };
    };
    iosSelector?: {
        strategy: 'accessibility_id' | 'name' | 'label' | 'xpath';
        value: string;
    };
    androidSelector?: {
        strategy: 'resource_id' | 'content_desc' | 'text' | 'xpath';
        value: string;
    };
    streamConfig?: {
        manifestPattern?: string;
        segmentPattern?: string;
        windowMs?: number;
        minSegmentResponses?: number;
        minManifestResponses?: number;
        allowedStatus?: number[];
        requireSegmentBytes?: number;
    };
    iosListConfig?: {
        elementType?: string;
        minCount?: number;
    };
    iosAbsentTexts?: string[];
    previousPageSource?: string;
    networkConfig?: {
        urlPattern: string;
        urlIsRegex?: boolean;
        method?: string;
        expectedStatus?: number;
        jsonPath?: string;
        jsonOp?: '>' | '>=' | '<' | '<=' | '==' | '!=' | 'exists' | 'not_empty';
        jsonValue?: string | number;
        sampleCount?: number;
        imageUrlJsonPath?: string;
        windowMs?: number;
        allowedErrorStatus?: number[];
    };
}
export interface AssertionResult {
    assertion: Assertion;
    passed: boolean;
    actual?: string;
    error?: string;
}
export interface NetworkLogEntry {
    url: string;
    method?: string;
    status: number;
    contentType: string;
    contentLength: number;
    timestamp: number;
    responseBody?: string;
    requestBody?: string;
    duration?: number;
    error?: string;
}
export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
export interface ApiRequestConfig {
    method: HttpMethod;
    url: string;
    headers?: Record<string, string>;
    body?: string | Record<string, any>;
    timeout?: number;
    captureResponseAs?: string;
    captureHeaders?: Record<string, string>;
    captureJsonPath?: Record<string, string>;
    captureExpression?: string;
    captureExpressionAs?: string;
    expectedStatus?: number;
    successCondition?: {
        jsonPath: string;
        operator: '==' | '!=' | '>' | '>=' | '<' | '<=' | 'contains' | 'not_contains';
        expected: string;
    };
    usePageCookies?: boolean;
}
export interface WaitForUserConfig {
    message: string;
    timeout?: number;
    resumeOn?: 'keypress' | 'url_change' | 'element_appear';
    resumeSelector?: string;
    resumeUrlPattern?: string;
}
export type EmailProvider = 'gmail' | 'naver' | 'outlook' | 'custom';
export interface CheckEmailConfig {
    provider: EmailProvider;
    host?: string;
    port?: number;
    user: string;
    pass: string;
    from?: string;
    subject?: string;
    linkPattern?: string;
    linkIndex?: number;
    captureUrlAs?: string;
    navigateToLink?: boolean;
    timeout?: number;
    pollInterval?: number;
    deleteAfterRead?: boolean;
}
export interface ScriptConfig {
    language: 'javascript' | 'shell';
    code: string;
    captureOutputAs?: string;
    timeout?: number;
}
export type ExtractTransformType = 'trim' | 'regex' | 'replace' | 'number_only' | 'jsonPath';
export interface ExtractTransform {
    type: ExtractTransformType;
    pattern?: string;
    replacement?: string;
    group?: number;
}
export interface ExtractDataConfig {
    selector: string;
    extractType: 'text' | 'attribute' | 'innerHTML' | 'value' | 'table' | 'list' | 'count' | 'url_param' | 'url_path';
    attribute?: string;
    captureAs: string;
    rowSelector?: string;
    cellSelector?: string;
    transform?: ExtractTransform[];
    assertNotEmpty?: boolean;
    urlParam?: string;
    urlPathIndex?: number;
}
export interface KeyboardConfig {
    key: string;
    selector?: string;
}
export interface WaitForConfig {
    waitType: 'element_visible' | 'element_hidden' | 'url_change' | 'network_idle' | 'ios_element_visible' | 'ios_element_not_exists' | 'ios_text_contains';
    selector?: string;
    iosSelector?: {
        strategy: 'accessibility_id' | 'name' | 'label' | 'xpath';
        value: string;
    };
    iosExpectedText?: string;
    urlPattern?: string;
    timeout?: number;
    pollInterval?: number;
    waitUntil?: 'domcontentloaded' | 'load' | 'networkidle';
}
export interface ForEachConfig {
    selector: string;
    itemVariable?: string;
    countVariable?: string;
    maxIterations?: number;
}
export interface IfConditionConfig {
    conditionType: 'element_exists' | 'element_visible' | 'variable_equals' | 'variable_contains' | 'url_contains' | 'custom' | 'ios_element_visible' | 'ios_element_exists' | 'ios_alert_present';
    selector?: string;
    variable?: string;
    expected?: string;
    expression?: string;
    iosSelector?: {
        strategy: string;
        value: string;
    };
    iosElementType?: string;
}
export interface BlockConfig {
    name: string;
    description?: string;
    parentId?: string;
    color?: string;
}
export type OcrSource = 'element' | 'viewport' | 'page';
export type OcrEngine = 'tesseract' | 'claude_vision';
export interface OcrPreprocess {
    grayscale?: boolean;
    threshold?: boolean;
    invert?: boolean;
    scale?: number;
}
export interface OcrPostprocess {
    regex?: string;
    stripSpaces?: boolean;
    upper?: boolean;
    lower?: boolean;
    trimWhitespace?: boolean;
}
export interface OcrExtractConfig {
    source: OcrSource;
    selector?: string;
    region?: {
        x: number;
        y: number;
        width: number;
        height: number;
    };
    targetVar: string;
    engine?: OcrEngine;
    preprocess?: OcrPreprocess;
    postprocess?: OcrPostprocess;
    confidenceThreshold?: number;
    timeoutMs?: number;
    language?: string;
    retryWithPreprocess?: boolean;
    psm?: number;
    charWhitelist?: string;
}
export interface OcrResult {
    rawText: string;
    processedText: string;
    confidence: number;
    engine: string;
    imagePath?: string;
    preprocessApplied?: OcrPreprocess;
    retryCount?: number;
}
export interface ImageMatchConfig {
    templateBase64: string;
    threshold?: number;
    maxDiffPercent?: number;
    timeout?: number;
    pollInterval?: number;
    clip?: {
        x: number;
        y: number;
        width: number;
        height: number;
    };
}
export type PreferredLocatorKind = 'testid' | 'role' | 'label' | 'placeholder' | 'text' | 'title' | 'css' | 'xpath';
export interface PreferredLocator {
    kind: PreferredLocatorKind;
    value: string;
    role?: string;
    name?: string;
    exact?: boolean;
}
export interface HealedLocator {
    locator: PreferredLocator;
    healedAt: number;
    successCount: number;
    originalSelector?: string;
    strategy: string;
}
export type DialogAction = 'accept' | 'dismiss';
export interface DialogConfig {
    dialogType: 'alert' | 'confirm' | 'prompt' | 'beforeunload';
    message: string;
    defaultValue?: string;
    action: DialogAction;
    promptText?: string;
}
export interface WithinScope {
    selector: string;
    hasText?: string;
}
export interface RecordingEvent {
    type: RecordingEventType;
    timestamp: number;
    selector?: string;
    value?: string;
    url?: string;
    coordinates?: {
        x: number;
        y: number;
    };
    from?: {
        x: number;
        y: number;
    };
    to?: {
        x: number;
        y: number;
    };
    duration?: number;
    text?: string;
    meta?: {
        element?: {
            type?: string;
            label?: string;
            name?: string;
            accessibilityId?: string;
            xpath?: string;
            cssSelector?: string;
            testId?: string;
            textContent?: string;
            innerText?: string;
            role?: string;
            placeholder?: string;
            title?: string;
            boundingBox?: {
                x: number;
                y: number;
                width: number;
                height: number;
            };
            isVisible?: boolean;
            isEnabled?: boolean;
            textNormalized?: string;
            accessibleNameNormalized?: string;
            resourceId?: string;
            contentDesc?: string;
            text?: string;
        };
        selectors?: string[];
        preferredLocators?: PreferredLocator[];
        healedLocators?: HealedLocator[];
        source?: string;
        screenshot?: string;
        pageContext?: {
            scrollX: number;
            scrollY: number;
            viewportWidth: number;
            viewportHeight: number;
            readyState: string;
            title: string;
        };
        [key: string]: any;
    };
    stepNo?: number;
    description?: string;
    assertion?: Assertion;
    assertions?: Assertion[];
    apiRequest?: ApiRequestConfig;
    waitForUser?: WaitForUserConfig;
    checkEmail?: CheckEmailConfig;
    script?: ScriptConfig;
    variableName?: string;
    variableValue?: string;
    variableExpression?: string;
    extractData?: ExtractDataConfig;
    keyboard?: KeyboardConfig;
    waitForConfig?: WaitForConfig;
    forEachConfig?: ForEachConfig;
    ifCondition?: IfConditionConfig;
    blockConfig?: BlockConfig;
    imageMatchConfig?: ImageMatchConfig;
    ocrConfig?: OcrExtractConfig;
    dialogConfig?: DialogConfig;
    clearAppBundleId?: string;
    iosSelector?: {
        strategy: 'accessibility_id' | 'name' | 'label' | 'xpath';
        value: string;
    };
    androidSelector?: {
        strategy: 'resource_id' | 'content_desc' | 'text' | 'xpath';
        value: string;
    };
    captureResolvedAs?: string;
    matchText?: string;
    within?: WithinScope;
    takeScreenshot?: boolean;
    notes?: string;
    tags?: string[];
    disabled?: boolean;
    onFail?: OnFailPolicy;
}
export interface TestDataSet {
    name: string;
    variables: Record<string, string>;
}
export interface TestDataProfile {
    id: string;
    name: string;
    description?: string;
    dataSets: TestDataSet[];
}
export interface ScenarioRef {
    scenarioId: string;
    aliasId?: string;
}
export interface RecordingScenario {
    id: string;
    name: string;
    platform: Platform;
    metadata?: {
        browser?: string;
        viewport?: {
            width: number;
            height: number;
        };
        baseURL?: string;
        userAgent?: string;
        deviceType?: WebDeviceType;
    };
    deviceType?: 'ios' | 'android';
    udid?: string;
    deviceId?: string;
    bundleId?: string;
    package?: string;
    appiumServerUrl?: string;
    startedAt: number;
    stoppedAt?: number;
    events: RecordingEvent[];
    tcId?: string;
    version?: number;
    includes?: ScenarioRef[];
    testData?: TestDataProfile;
    testDataProfileId?: string;
    variables?: Record<string, string>;
    chainExports?: string[];
    chainRequires?: string[];
    tags?: string[];
    flowLayout?: FlowLayout;
}
/** Flow 시각화 레이아웃 — 노드 위치/방향/뷰포트를 시나리오에 저장 */
export interface FlowLayout {
    layoutVersion: number;
    direction: 'UD' | 'LR';
    nodes: Record<string, {
        x: number;
        y: number;
        fixed?: boolean;
    }>;
    viewport?: {
        scale: number;
        x: number;
        y: number;
    };
    collapsedBlocks?: string[];
}
export interface RecordingConfig {
    outputDir?: string;
    sessionName?: string;
    url?: string;
    browser?: 'chromium' | 'firefox' | 'webkit';
    viewport?: {
        width: number;
        height: number;
    };
    deviceType?: WebDeviceType;
    authProfileId?: string;
    baseURL?: string;
    udid?: string;
    deviceId?: string;
    bundleId?: string;
    package?: string;
    appiumServerUrl?: string;
    mirror?: boolean;
    mirrorPort?: number;
    controlOptions?: {
        tapPauseDuration?: number;
        tapReleaseDelay?: number;
        tapPostDelay?: number;
        swipePauseDuration?: number;
        swipeMinDuration?: number;
        swipeReleaseDelay?: number;
        swipePostDelay?: number;
        coordinateOrigin?: 'viewport' | 'pointer';
        coordinateOffset?: {
            x: number;
            y: number;
        };
    };
}
export interface ReplayOptions {
    speed?: number;
    delayBetweenEvents?: number;
    takeScreenshots?: boolean;
    reportDir?: string;
    variables?: Record<string, string>;
    chainVariables?: Record<string, string>;
    testDataSetName?: string;
    testDataProfilePath?: string;
    stopOnFailure?: boolean;
    headless?: boolean;
    timeout?: number;
    existingPage?: any;
    existingContext?: any;
    existingBrowser?: any;
    skipBrowserClose?: boolean;
    authProfileId?: string;
    deviceType?: WebDeviceType;
    fromStep?: number;
    toStep?: number;
    onWaitForUserStart?: () => void;
    onWaitForUserEnd?: () => void;
    networkLogFile?: string;
    networkHarFile?: string;
}
export interface TestResult {
    scenarioId: string;
    scenarioName: string;
    platform: Platform;
    status: 'passed' | 'failed' | 'skipped';
    duration: number;
    startedAt: number;
    completedAt: number;
    events: EventResult[];
    error?: string;
    stackTrace?: string;
    tcId?: string;
    testDataSetName?: string;
    variables?: Record<string, string>;
    chainExportedVariables?: Record<string, string>;
    assertionsSummary?: {
        total: number;
        passed: number;
        failed: number;
    };
    signals?: {
        fallbackCount: number;
        coordinateFallbackCount: number;
        forceClickCount: number;
        fallbacksByType: Record<string, number>;
        infraFailures: string[];
    };
    outcomeClass?: 'PASS' | 'FLAKY_PASS' | 'RETRYABLE_FAIL' | 'FAIL' | 'INFRA_FAIL';
}
export interface AuthCookie {
    name: string;
    value: string;
    domain: string;
    path: string;
    expires?: number;
    httpOnly?: boolean;
    secure?: boolean;
    sameSite?: 'Strict' | 'Lax' | 'None';
}
export interface AuthProfile {
    id: string;
    name: string;
    domain: string;
    domainPatterns?: string[];
    cookies?: AuthCookie[];
    localStorage?: Record<string, string>;
    sessionStorage?: Record<string, string>;
    headers?: Record<string, string>;
    createdAt: number;
    updatedAt: number;
    notes?: string;
}
export interface ScenarioGroup {
    id: string;
    name: string;
    mode: 'batch' | 'chain';
    scenarioIds: string[];
    authProfileId?: string;
    options: {
        speed?: number;
        takeScreenshots?: boolean;
        headless?: boolean;
        stopOnFailure?: boolean;
        deviceType?: WebDeviceType;
    };
    createdAt: number;
    updatedAt: number;
}
export interface ScenarioFolder {
    id: string;
    name: string;
    parentId: string | null;
    scenarioIds: string[];
    childFolderIds: string[];
    createdAt: number;
    updatedAt: number;
}
export interface RunConfig {
    scenarioIds: string[];
    mode: 'batch' | 'chain';
    authProfileId?: string;
    options: ReplayOptions;
}
export interface RunStatus {
    runId: string;
    mode: 'batch' | 'chain';
    status: 'running' | 'completed' | 'failed';
    scenarioIds: string[];
    currentIndex: number;
    results: TestResult[];
    startedAt: number;
    completedAt?: number;
    error?: string;
}
export interface BatchResult {
    runId: string;
    mode: 'batch' | 'chain';
    results: TestResult[];
    summary: {
        total: number;
        passed: number;
        failed: number;
        skipped: number;
        totalDuration: number;
    };
}
export interface PageNode {
    id: string;
    url: string;
    title: string;
    domain: string;
    screenshot?: string;
    /** DFS 탐색용 상태 키 (URL + DOM fingerprint 기반) */
    stateKey?: string;
    metadata?: {
        visitedAt: number;
        visitCount: number;
        hasAuth?: boolean;
        popupCount?: number;
        isPopup?: boolean;
        statusCode?: number;
        outLinks?: number;
        urlPattern?: string;
        urlVariations?: string[];
        variationTitles?: Record<string, string>;
        /** DOM fingerprint 해시 (DFS 탐색에서 상태 구분용) */
        fingerprint?: string;
        /** DFS 탐색 깊이 */
        depth?: number;
    };
}
export interface PageEdge {
    id: string;
    source: string;
    target: string;
    linkText?: string;
    linkSelector?: string;
    linkUrl: string;
    metadata?: {
        discoveredAt: number;
        discoveredBy: 'manual' | 'crawl' | 'dfs';
        /** DFS 탐색에서 사용된 액션 정보 */
        action?: {
            type: string;
            selector: string;
            text?: string;
            role?: string;
        };
    };
}
export type ExplorationStatus = 'idle' | 'exploring' | 'crawling' | 'dfs_crawling' | 'paused' | 'completed' | 'stopped';
export interface GraphRoot {
    id: string;
    url: string;
    label: string;
    authProfileId?: string;
    addedAt: number;
}
export interface ExplorationGraph {
    id: string;
    name: string;
    rootUrl: string;
    rootUrls?: GraphRoot[];
    allowedDomains: string[];
    createdAt: number;
    updatedAt: number;
    nodes: PageNode[];
    edges: PageEdge[];
    config: {
        authProfileId?: string;
        maxDepth?: number;
        maxNodes?: number;
        crawlDelay?: number;
        ignoreFragments?: boolean;
        ignoreQueryParams?: string[];
        enablePatternGrouping?: boolean;
        deviceType?: WebDeviceType;
        /** DFS 탐색 설정 */
        dfs?: {
            maxDepth?: number;
            maxStates?: number;
            maxActionsPerState?: number;
            maxSameUrlStates?: number;
            timeBudgetMs?: number;
            actionDelayMs?: number;
            executeUnknownRisk?: boolean;
        };
    };
    status: ExplorationStatus;
}
export interface ExplorationSession {
    graphId: string;
    status: ExplorationStatus;
    currentUrl?: string;
    currentNodeId?: string;
    visitedUrls: string[];
    queuedUrls: string[];
    stats: {
        nodesDiscovered: number;
        edgesDiscovered: number;
        pagesVisited: number;
        startedAt: number;
        lastActivityAt: number;
    };
}
export interface ProcessEdge {
    id: string;
    source: string;
    target: string;
    condition: string;
    type?: 'success' | 'failure';
    originalEdgeId?: string;
}
export interface ProcessTestMeta {
    tcId?: string;
    module?: string;
    feature?: string;
    requirementId?: string;
    type?: 'Smoke' | 'Regression' | 'Functional' | 'UAT' | 'Exploratory' | 'NonFunctional';
    priority?: 'P0' | 'P1' | 'P2' | 'P3';
    severity?: 'S0(Blocking)' | 'S1(Critical)' | 'S2(Major)' | 'S3(Minor)' | 'S4(Trivial)';
    risk?: 'High' | 'Medium' | 'Low';
    platform?: 'Web' | 'Mobile Web' | 'WebView(App)' | 'API';
    environment?: 'Local' | 'Dev' | 'QA' | 'Stage' | 'Prod-like';
    browserDevice?: string;
    automation?: 'Manual' | 'Auto' | 'Candidate';
    automationId?: string;
    preconditions?: string;
    expectedResultSummary?: string;
    postconditions?: string;
    owner?: string;
    reviewer?: string;
    status?: 'Draft' | 'Ready' | 'Deprecated';
    defectId?: string;
    notes?: string;
    version?: string;
    executionStatus?: 'Not Run' | 'Pass' | 'Fail' | 'Blocked' | 'Skipped';
    evidenceLink?: string;
}
export interface Process {
    id: string;
    name: string;
    description?: string;
    graphId: string;
    nodeIds: string[];
    edges: ProcessEdge[];
    createdAt: number;
    updatedAt: number;
    tags?: string[];
    nodePositions?: Record<string, {
        x: number;
        y: number;
    }>;
    testMeta?: ProcessTestMeta;
    linkedScenarios?: LinkedScenarioRef[];
}
export interface LinkedScenarioRef {
    id: string;
    type: 'scenario' | 'group';
    refId: string;
    addedAt: number;
}
export interface EventResult {
    eventIndex: number;
    eventType: RecordingEventType;
    status: 'passed' | 'failed' | 'skipped';
    duration: number;
    error?: string;
    screenshot?: string;
    stepNo?: number;
    description?: string;
    resolvedBy?: string;
    assertionResults?: AssertionResult[];
    apiResponse?: {
        status: number;
        headers: Record<string, string>;
        body: any;
        duration: number;
    };
    capturedVariables?: Record<string, string>;
    ocrResult?: OcrResult;
    imageMatchData?: {
        templateBase64: string;
        screenshotBase64: string;
        diffBase64?: string;
        diffPercent: number;
        matched: boolean;
        clip?: {
            x: number;
            y: number;
            width: number;
            height: number;
        };
    };
    artifacts?: StepArtifacts;
}
export interface StepArtifacts {
    screenshotBase64?: string;
    pageSourceXml?: string;
    pageSourceSummary?: string;
    timestamp: number;
}
export type FlowNodeType = 'start' | 'end' | 'action' | 'condition' | 'loop_start' | 'loop_end' | 'wait' | 'api' | 'script' | 'extract' | 'assert' | 'dialog' | 'popup' | 'block' | 'block_end';
export type FlowEdgeType = 'next' | 'if_true' | 'if_false' | 'loop_back' | 'on_fail' | 'on_fail_retry';
export interface OnFailPolicy {
    action: 'stop' | 'jump' | 'retry' | 'skip' | 'fallback_route';
    jumpToStep?: number;
    maxRetry?: number;
    retryDelayMs?: number;
    fallbackSteps?: number[];
}
export interface FlowNode {
    id: string;
    stepIndex: number;
    type: FlowNodeType;
    label: string;
    eventType?: RecordingEventType;
    metadata?: {
        selector?: string;
        value?: string;
        url?: string;
        condition?: string;
        loopSelector?: string;
        onFail?: OnFailPolicy;
        description?: string;
        disabled?: boolean;
        blockName?: string;
        blockId?: string;
        blockColor?: string;
        isCollapsed?: boolean;
        childStepCount?: number;
    };
}
export interface FlowEdge {
    id: string;
    source: string;
    target: string;
    type: FlowEdgeType;
    label?: string;
    metadata?: {
        jumpFromStep?: number;
        jumpToStep?: number;
    };
}
export interface FlowGraph {
    scenarioId: string;
    scenarioName: string;
    nodes: FlowNode[];
    edges: FlowEdge[];
    metadata?: {
        totalSteps: number;
        hasConditions: boolean;
        hasLoops: boolean;
        hasOnFailPolicies: boolean;
        hasBlocks?: boolean;
    };
}
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
export interface SelectorHealthResult {
    score: number;
    level: 'excellent' | 'good' | 'fair' | 'fragile' | 'none';
    color: string;
}
