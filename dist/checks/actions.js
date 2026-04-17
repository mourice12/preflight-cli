"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.makeActionsCheck = makeActionsCheck;
const parser_1 = require("../parser");
const github_1 = require("../github");
const DEPRECATED_ACTIONS = {
    'actions/checkout': { latest: 'v4', versions: ['v1', 'v2', 'v3'] },
    'actions/setup-node': { latest: 'v4', versions: ['v1', 'v2', 'v3'] },
    'actions/setup-python': { latest: 'v5', versions: ['v1', 'v2', 'v3', 'v4'] },
    'actions/setup-go': { latest: 'v5', versions: ['v1', 'v2', 'v3', 'v4'] },
    'actions/setup-java': { latest: 'v4', versions: ['v1', 'v2', 'v3'] },
    'actions/upload-artifact': { latest: 'v4', versions: ['v1', 'v2', 'v3'] },
    'actions/download-artifact': { latest: 'v4', versions: ['v1', 'v2', 'v3'] },
    'actions/cache': { latest: 'v4', versions: ['v1', 'v2', 'v3'] },
};
function splitActionRef(actionRef) {
    const atIdx = actionRef.lastIndexOf('@');
    if (atIdx === -1)
        return { ownerRepo: actionRef, ref: '' };
    const repoPart = actionRef.slice(0, atIdx);
    const ref = actionRef.slice(atIdx + 1);
    const segments = repoPart.split('/');
    const ownerRepo = segments.slice(0, 2).join('/');
    return { ownerRepo, ref };
}
function makeActionsCheck(octokit) {
    return {
        name: 'actions',
        description: 'Validate uses: references resolve and aren\'t deprecated or risky',
        async run({ workflows }) {
            const results = [];
            const occurrences = [];
            for (const wf of workflows) {
                if (wf.parseError)
                    continue;
                for (const ref of (0, parser_1.extractActionRefs)(wf)) {
                    occurrences.push({
                        file: wf.relativePath,
                        actionRef: ref.ref,
                        job: ref.job,
                        step: ref.step,
                    });
                }
            }
            const existsCache = new Map();
            for (const occ of occurrences) {
                if (!existsCache.has(occ.actionRef)) {
                    existsCache.set(occ.actionRef, (0, github_1.checkActionExists)(octokit, occ.actionRef));
                }
            }
            for (const occ of occurrences) {
                const { ownerRepo, ref: version } = splitActionRef(occ.actionRef);
                const push = (r) => {
                    const out = { ...r, file: occ.file, job: occ.job };
                    if (occ.step)
                        out.step = occ.step;
                    results.push(out);
                };
                if (version === 'main' || version === 'master') {
                    push({
                        check: 'actions',
                        severity: 'warning',
                        message: `Action "${occ.actionRef}" is pinned to branch "${version}" — supply chain risk`,
                        fix: `Pin to a release tag (e.g. ${ownerRepo}@v4) or a full 40-character commit SHA. See: https://docs.github.com/en/actions/security-guides/security-hardening-for-github-actions#using-third-party-actions`,
                    });
                }
                const deprecated = DEPRECATED_ACTIONS[ownerRepo];
                if (deprecated && deprecated.versions.includes(version)) {
                    push({
                        check: 'actions',
                        severity: 'warning',
                        message: `Action "${occ.actionRef}" uses deprecated version "${version}"`,
                        fix: `Upgrade to ${ownerRepo}@${deprecated.latest}.`,
                    });
                }
                const existsPromise = existsCache.get(occ.actionRef);
                if (!existsPromise)
                    continue;
                const exists = await existsPromise;
                if (!exists.exists) {
                    push({
                        check: 'actions',
                        severity: 'error',
                        message: `Action "${occ.actionRef}" does not resolve: ${exists.error ?? 'not found'}`,
                        fix: `Verify the owner/repo and version are correct, or replace with an existing action.`,
                    });
                }
            }
            return results;
        },
    };
}
//# sourceMappingURL=actions.js.map