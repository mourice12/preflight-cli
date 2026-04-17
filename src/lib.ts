// Public library API — entry point for programmatic consumers (VS Code extension,
// MCP server, other tooling). The CLI continues to use the individual modules
// directly; external code should import from here instead of dist/internals.

export {
  loadWorkflows,
  findRepoRoot,
  extractSecretRefs,
  extractVariableRefs,
  extractEnvironmentRefs,
  extractActionRefs,
  extractExpressions,
} from './parser';

export type {
  SecretRef,
  VariableRef,
  EnvironmentRef,
  ActionRef,
  ExpressionRef,
} from './parser';

export {
  getAllChecks,
  CHECK_NAMES,
  syntaxCheck,
  secretsCheck,
  variablesCheck,
  environmentsCheck,
  makeActionsCheck,
  expressionsCheck,
  permissionsCheck,
  runnersCheck,
  jobsCheck,
} from './checks';

export {
  createOctokit,
  buildRepoContext,
  getGhToken,
  getRepoInfo,
  parseGitHubRemote,
  checkActionExists,
} from './github';

export type {
  RepoInfo,
  BuildRepoContextResult,
  ActionExistsResult,
} from './github';

export { diagnoseToString } from './diagnose';
export type { DiagnoseOptions } from './diagnose';

export type {
  Severity,
  CheckResult,
  CheckFunction,
  CheckContext,
  RepoContext,
  WorkflowFile,
  WorkflowDefinition,
  JobDefinition,
  StepDefinition,
} from './types';
