"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.environmentsCheck = void 0;
const parser_1 = require("../parser");
const utils_1 = require("./utils");
exports.environmentsCheck = {
    name: 'environments',
    description: 'Validate environment: references exist in the repo',
    async run({ workflows, repo }) {
        const results = [];
        const lowercaseMap = new Map();
        for (const name of repo.environments)
            lowercaseMap.set(name.toLowerCase(), name);
        for (const wf of workflows) {
            if (wf.parseError)
                continue;
            for (const ref of (0, parser_1.extractEnvironmentRefs)(wf)) {
                if (repo.environments.has(ref.name))
                    continue;
                const actualCase = lowercaseMap.get(ref.name.toLowerCase());
                if (actualCase) {
                    results.push({
                        check: 'environments',
                        severity: 'warning',
                        message: `Environment "${ref.name}" has a case mismatch with repo environment "${actualCase}"`,
                        file: wf.relativePath,
                        job: ref.job,
                        fix: `Change "environment: ${ref.name}" to "environment: ${actualCase}".`,
                    });
                    continue;
                }
                const suggestion = (0, utils_1.suggestTypo)(ref.name, repo.environments);
                const fixParts = [
                    `Create the environment: https://github.com/${repo.owner}/${repo.repo}/settings/environments/new`,
                ];
                if (suggestion) {
                    fixParts.push(`Or did you mean "${suggestion}"?`);
                }
                results.push({
                    check: 'environments',
                    severity: 'error',
                    message: `Environment "${ref.name}" is not defined in the repo`,
                    file: wf.relativePath,
                    job: ref.job,
                    fix: fixParts.join('\n'),
                });
            }
        }
        return results;
    },
};
//# sourceMappingURL=environments.js.map