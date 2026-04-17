import type { WorkflowFile } from './types';
export interface SecretRef {
    name: string;
    job?: string;
    step?: string;
}
export interface VariableRef {
    name: string;
    job?: string;
    step?: string;
}
export interface EnvironmentRef {
    name: string;
    job: string;
}
export interface ActionRef {
    ref: string;
    job: string;
    step?: string;
}
export interface ExpressionRef {
    expr: string;
    line: number;
    job?: string;
}
export declare function findRepoRoot(start?: string): Promise<string>;
export declare function loadWorkflows(repoRoot?: string): Promise<WorkflowFile[]>;
export declare function extractSecretRefs(workflow: WorkflowFile): SecretRef[];
export declare function extractVariableRefs(workflow: WorkflowFile): VariableRef[];
export declare function extractEnvironmentRefs(workflow: WorkflowFile): EnvironmentRef[];
export declare function extractActionRefs(workflow: WorkflowFile): ActionRef[];
export declare function extractExpressions(workflow: WorkflowFile): ExpressionRef[];
