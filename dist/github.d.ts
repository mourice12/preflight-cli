import { Octokit } from '@octokit/rest';
import type { RepoContext } from './types';
export declare function getGhToken(): string;
export interface RepoInfo {
    owner: string;
    repo: string;
}
export declare function getRepoInfo(cwd?: string): RepoInfo;
export declare function parseGitHubRemote(remoteUrl: string): RepoInfo | null;
export interface BuildRepoContextResult {
    octokit: Octokit;
    context: RepoContext;
}
export declare function createOctokit(token: string): Octokit;
export declare function buildRepoContext(owner: string, repo: string, token: string): Promise<BuildRepoContextResult>;
export interface ActionExistsResult {
    exists: boolean;
    error?: string;
}
export declare function checkActionExists(octokit: Octokit, actionRef: string): Promise<ActionExistsResult>;
