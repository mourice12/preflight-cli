export type Severity = 'error' | 'warning' | 'info';

export interface StepDefinition {
  id?: string;
  name?: string;
  uses?: string;
  run?: string;
  shell?: string;
  with?: Record<string, unknown>;
  env?: Record<string, string>;
  if?: string;
  'working-directory'?: string;
  'continue-on-error'?: boolean | string;
  'timeout-minutes'?: number;
  [key: string]: unknown;
}

export interface JobDefinition {
  name?: string;
  'runs-on'?: string | string[];
  needs?: string | string[];
  if?: string;
  environment?: string | { name: string; url?: string };
  permissions?: string | Record<string, string>;
  strategy?: Record<string, unknown>;
  steps?: StepDefinition[];
  uses?: string;
  with?: Record<string, unknown>;
  secrets?: Record<string, string> | 'inherit';
  outputs?: Record<string, string>;
  env?: Record<string, string>;
  defaults?: Record<string, unknown>;
  concurrency?: string | Record<string, unknown>;
  'timeout-minutes'?: number;
  'continue-on-error'?: boolean | string;
  container?: string | Record<string, unknown>;
  services?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface WorkflowDefinition {
  name?: string;
  on?: string | string[] | Record<string, unknown>;
  permissions?: string | Record<string, string>;
  env?: Record<string, string>;
  defaults?: Record<string, unknown>;
  concurrency?: string | Record<string, unknown>;
  jobs?: Record<string, JobDefinition>;
  [key: string]: unknown;
}

export interface WorkflowFile {
  path: string;
  relativePath: string;
  raw: string;
  parsed: WorkflowDefinition;
  parseError?: string;
}

export interface CheckResult {
  check: string;
  severity: Severity;
  message: string;
  file?: string;
  line?: number;
  column?: number;
  job?: string;
  step?: string;
  fix?: string;
}

export interface RepoContext {
  owner: string;
  repo: string;
  defaultBranch: string;
  secrets: Set<string>;
  variables: Set<string>;
  environments: Set<string>;
  environmentSecrets: Map<string, Set<string>>;
  environmentVariables: Map<string, Set<string>>;
}

export interface CheckContext {
  workflows: WorkflowFile[];
  repo: RepoContext;
}

export interface CheckFunction {
  name: string;
  description: string;
  run(context: CheckContext): Promise<CheckResult[]>;
}
