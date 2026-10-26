// rules.mjs の型宣言（tests から import するため）
export declare const BARE_DOMAIN_LABELS: Set<string>;
export declare const SECOND_LEVEL_LABELS: Set<string>;
export type HostCandidate = { line: number; kind: 'url' | 'email' | 'bare' | 'ipv4'; host: string };
export type Allow = { domains: string[]; ipv4: string[] };
export declare function extractHosts(text: string): HostCandidate[];
export declare function isAllowedHost(host: string, allow: Allow): boolean;
export declare function domainViolationLines(text: string, allow: Allow): number[];
export declare function checkLockfileResolved(text: string, prefix: string): { total: number; violationLines: number[] };
export declare function termPatterns(term: string): Uint8Array[];
export declare function countMatches(haystack: Uint8Array, patterns: Uint8Array[]): number;
export declare function forbiddenPathReason(path: string): string | null;
export declare function isPublicEmail(email: string, role: 'person' | 'co-author'): boolean;
