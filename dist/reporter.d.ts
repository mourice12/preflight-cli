import type { CheckResult } from './types';
import type { RepoInfo } from './github';
export declare function printHeader(repo: RepoInfo, workflowCount: number): void;
export declare function printCheckStart(checkName: string, description: string): void;
export declare function printResults(results: CheckResult[]): void;
export declare function printSummary(results: CheckResult[], elapsedMs: number): void;
export declare function printJson(results: CheckResult[]): void;
