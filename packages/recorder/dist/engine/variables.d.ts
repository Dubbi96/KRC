/**
 * 변수 보간 엔진
 *
 * {{userName}} 같은 패턴을 실제 값으로 치환한다.
 * 동적 함수도 지원: {{$date.today}}, {{$uuid}}, {{$rand.alnum(8)}}, {{$seq("user")}} 등
 * 우선순위: CLI --var > TestDataSet > scenario.variables > 런타임 캡처
 */
/** 시퀀스 카운터 초기화 (새 런 시작 시 호출) */
export declare function resetSequences(): void;
export declare class VariableContext {
    private store;
    constructor(defaults?: Record<string, string>);
    /** 변수 설정 */
    set(name: string, value: string): void;
    /** 변수 조회 (없으면 undefined) */
    get(name: string): string | undefined;
    /** 모든 변수를 Record로 반환 */
    getAll(): Record<string, string>;
    /** 문자열 내 {{변수}} 와 {{$동적함수}} 를 실제 값으로 치환 */
    resolve(template: string): string;
    /** 문자열이 변수 참조를 포함하는지 검사 */
    hasVariables(template: string): boolean;
    /** 객체 내 모든 문자열 값을 재귀적으로 치환 */
    resolveObject<T>(obj: T): T;
    /** 현재 context를 복제 */
    clone(): VariableContext;
    /** 다른 Record의 값을 merge (덮어쓰기) */
    merge(vars: Record<string, string>): void;
    get size(): number;
}
