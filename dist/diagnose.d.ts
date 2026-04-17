export interface DiagnoseOptions {
    cwd: string;
    runId?: number;
    verbose?: boolean;
}
export declare function diagnoseToString(opts: DiagnoseOptions): Promise<string>;
export declare function diagnose(opts: DiagnoseOptions): Promise<void>;
