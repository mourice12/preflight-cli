"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.permissionsCheck = void 0;
const utils_1 = require("./utils");
const VALID_SCOPES = new Set([
    'actions',
    'checks',
    'contents',
    'deployments',
    'id-token',
    'issues',
    'packages',
    'pages',
    'pull-requests',
    'repository-projects',
    'security-events',
    'statuses',
]);
const VALID_VALUES = new Set(['read', 'write', 'none']);
const VALID_SHORTHANDS = new Set(['read-all', 'write-all']);
function attachJob(r, job) {
    if (job)
        r.job = job;
    return r;
}
function validatePermissionsBlock(perms, file, scopeLabel, job) {
    const results = [];
    if (perms === undefined || perms === null)
        return results;
    if (typeof perms === 'string') {
        if (perms === 'write-all') {
            results.push(attachJob({
                check: 'permissions',
                severity: 'warning',
                message: `permissions: write-all ${scopeLabel} grants broad access — security risk`,
                file,
                fix: 'Replace write-all with explicit per-scope permissions (e.g. contents: read, pull-requests: write).',
            }, job));
        }
        else if (!VALID_SHORTHANDS.has(perms)) {
            results.push(attachJob({
                check: 'permissions',
                severity: 'error',
                message: `Invalid permissions shorthand "${perms}" ${scopeLabel}`,
                file,
                fix: 'Use "read-all", "write-all", or a mapping of scope: value.',
            }, job));
        }
        return results;
    }
    if (typeof perms !== 'object' || Array.isArray(perms)) {
        results.push(attachJob({
            check: 'permissions',
            severity: 'error',
            message: `permissions block ${scopeLabel} must be a string or mapping`,
            file,
            fix: 'Use either a shorthand ("read-all"/"write-all") or a mapping of scope: value.',
        }, job));
        return results;
    }
    for (const [scope, value] of Object.entries(perms)) {
        if (!VALID_SCOPES.has(scope)) {
            const suggestion = (0, utils_1.suggestTypo)(scope, VALID_SCOPES);
            results.push(attachJob({
                check: 'permissions',
                severity: 'error',
                message: `Invalid permission scope "${scope}" ${scopeLabel}`,
                file,
                fix: suggestion
                    ? `Did you mean "${suggestion}"?`
                    : `Valid scopes: ${Array.from(VALID_SCOPES).join(', ')}.`,
            }, job));
        }
        if (typeof value !== 'string' || !VALID_VALUES.has(value)) {
            results.push(attachJob({
                check: 'permissions',
                severity: 'error',
                message: `Invalid permission value "${String(value)}" for scope "${scope}" ${scopeLabel}`,
                file,
                fix: 'Values must be read, write, or none.',
            }, job));
        }
    }
    return results;
}
function permsHasScope(perms, scope) {
    if (perms === 'write-all')
        return 'write-all';
    if (!perms || typeof perms !== 'object' || Array.isArray(perms))
        return false;
    return Object.prototype.hasOwnProperty.call(perms, scope);
}
function collectJobActions(job) {
    const out = [];
    for (const step of job.steps ?? []) {
        if (typeof step?.uses === 'string')
            out.push(step.uses.split('@')[0]);
    }
    return out;
}
exports.permissionsCheck = {
    name: 'permissions',
    description: 'Validate permissions blocks use valid scopes/values and required scopes for common actions',
    async run({ workflows }) {
        const results = [];
        for (const wf of workflows) {
            if (wf.parseError)
                continue;
            const doc = wf.parsed;
            results.push(...validatePermissionsBlock(doc.permissions, wf.relativePath, 'at workflow level'));
            const workflowPerms = doc.permissions;
            for (const [jobName, job] of Object.entries(doc.jobs ?? {})) {
                if (!job || typeof job !== 'object')
                    continue;
                results.push(...validatePermissionsBlock(job.permissions, wf.relativePath, 'at job level', jobName));
                const activePerms = job.permissions !== undefined ? job.permissions : workflowPerms;
                if (activePerms === undefined)
                    continue;
                const uses = collectJobActions(job);
                if (uses.includes('actions/checkout') &&
                    !permsHasScope(activePerms, 'contents')) {
                    results.push({
                        check: 'permissions',
                        severity: 'warning',
                        message: 'Uses actions/checkout but the active permissions block omits "contents"',
                        file: wf.relativePath,
                        job: jobName,
                        fix: 'Add `contents: read` (or write, if you need to push) to the permissions block.',
                    });
                }
                if (uses.includes('actions/github-script') &&
                    typeof activePerms === 'object' &&
                    Object.keys(activePerms).length === 0) {
                    results.push({
                        check: 'permissions',
                        severity: 'info',
                        message: 'Uses actions/github-script with an empty permissions block — scripts will have no API access',
                        file: wf.relativePath,
                        job: jobName,
                        fix: 'Declare the scopes the script needs (e.g. issues: write, pull-requests: write).',
                    });
                }
            }
        }
        return results;
    },
};
//# sourceMappingURL=permissions.js.map