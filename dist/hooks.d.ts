export declare function findHooksDir(cwd?: string): string;
export type InstallAction = 'created' | 'appended' | 'already-installed';
export interface InstallResult {
    action: InstallAction;
    hookPath: string;
    backup?: string;
}
export declare function installHook(cwd?: string): Promise<InstallResult>;
export type UninstallAction = 'removed' | 'deleted' | 'not-installed' | 'no-hook';
export interface UninstallResult {
    action: UninstallAction;
    hookPath: string;
}
export declare function uninstallHook(cwd?: string): Promise<UninstallResult>;
