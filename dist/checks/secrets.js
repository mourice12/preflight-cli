"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.secretsCheck = void 0;
const parser_1 = require("../parser");
const utils_1 = require("./utils");
exports.secretsCheck = {
    name: 'secrets',
    description: 'Validate ${{ secrets.X }} references exist in the repo',
    async run({ workflows, repo }) {
        const results = [];
        const pool = Array.from(repo.secrets).filter((s) => s !== 'GITHUB_TOKEN');
        for (const wf of workflows) {
            if (wf.parseError)
                continue;
            const seen = new Set();
            for (const ref of (0, parser_1.extractSecretRefs)(wf)) {
                if (ref.name === 'GITHUB_TOKEN')
                    continue;
                if (repo.secrets.has(ref.name))
                    continue;
                const dedupKey = `${ref.name}::${ref.job ?? ''}::${ref.step ?? ''}`;
                if (seen.has(dedupKey))
                    continue;
                seen.add(dedupKey);
                const suggestion = (0, utils_1.suggestTypo)(ref.name, pool);
                const fixParts = [
                    `Add the secret: gh secret set ${ref.name} --repo ${repo.owner}/${repo.repo}`,
                ];
                if (suggestion) {
                    fixParts.push(`Or did you mean "${suggestion}"? (change the reference)`);
                }
                const out = {
                    check: 'secrets',
                    severity: 'error',
                    message: `Secret "${ref.name}" is not defined in the repo`,
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
//# sourceMappingURL=secrets.js.map