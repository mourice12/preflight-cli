import type { Octokit } from '@octokit/rest';
import type { CheckFunction } from '../types';
import { syntaxCheck } from './syntax';
import { secretsCheck } from './secrets';
import { variablesCheck } from './variables';
import { environmentsCheck } from './environments';
import { makeActionsCheck } from './actions';
import { expressionsCheck } from './expressions';
import { permissionsCheck } from './permissions';
import { runnersCheck } from './runners';
import { jobsCheck } from './jobs';

export const CHECK_NAMES = [
  'syntax',
  'secrets',
  'variables',
  'environments',
  'actions',
  'expressions',
  'permissions',
  'runners',
  'jobs',
] as const;

export function getAllChecks(octokit: Octokit): CheckFunction[] {
  return [
    syntaxCheck,
    secretsCheck,
    variablesCheck,
    environmentsCheck,
    makeActionsCheck(octokit),
    expressionsCheck,
    permissionsCheck,
    runnersCheck,
    jobsCheck,
  ];
}

export {
  syntaxCheck,
  secretsCheck,
  variablesCheck,
  environmentsCheck,
  makeActionsCheck,
  expressionsCheck,
  permissionsCheck,
  runnersCheck,
  jobsCheck,
};
