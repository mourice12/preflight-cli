"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.variablesCheck = void 0;
const parser_1 = require("../parser");
const utils_1 = require("./utils");
exports.variablesCheck = {
    name: 'variables',
    description: 'Validate ${{ vars.X }} references exist in the repo',
    async run({ workflows, repo }) {
        const results = [];
        const pool = Array.from(repo.variables);
        for (const wf of workflows) {
            if (wf.parseError)
                continue;
            const seen = new Set();
            for (const ref of (0, parser_1.extractVariableRefs)(wf)) {
                if (repo.variables.has(ref.name))
                    continue;
                const dedupKey = `${ref.name}::${ref.job ?? ''}::${ref.step ?? ''}`;
                if (seen.has(dedupKey))
                    continue;
                seen.add(dedupKey);
                const suggestion = (0, utils_1.suggestTypo)(ref.name, pool);
                const fixParts = [
                    `Add the variable: gh variable set ${ref.name} --repo ${repo.owner}/${repo.repo}`,
                ];
                if (suggestion) {
                    fixParts.push(`Or did you mean "${suggestion}"? (change the reference)`);
                }
                const out = {
                    check: 'variables',
                    severity: 'error',
                    message: `Variable "${ref.name}" is not defined in the repo`,
                    file: wf.relativePath,
                    fix: fixParts.join('\n'),
                };
                if (ref.job)
                    out.job = ref.job;
                if (ref.step)
                    out.step = ref.step;
                results.push(out);
            }
        }
        return results;
    },
};
//# sourceMappingURL=variables.js.map