import type { Octokit } from '@octokit/rest';
import type { CheckFunction } from '../types';
export declare function makeActionsCheck(octokit: Octokit): CheckFunction;
