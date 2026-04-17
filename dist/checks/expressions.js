"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.expressionsCheck = void 0;
const parser_1 = require("../parser");
const utils_1 = require("./utils");
const KNOWN_CONTEXTS = new Set([
    'github',
    'env',
    'vars',
    'job',
    'jobs',
    'steps',
    'runner',
    'secrets',
    'strategy',
    'matrix',
    'needs',
    'inputs',
]);
const KNOWN_FUNCTIONS = new Set([
    'contains',
    'startsWith',
    'endsWith',
    'format',
    'join',
    'toJSON',
    'fromJSON',
    'hashFiles',
    'success',
    'always',
    'cancelled',
    'failure',
]);
const LITERALS = new Set(['true', 'false', 'null']);
const FUNCTION_TYPOS = {
    contain: 'contains',
    startWith: 'startsWith',
    starts_with: 'startsWith',
    endWith: 'endsWith',
    ends_with: 'endsWith',
    toJson: 'toJSON',
    tojson: 'toJSON',
    fromJson: 'fromJSON',
    fromjson: 'fromJSON',
};
function extractTopLevelIdents(expr) {
    const idents = [];
    const n = expr.length;
    let i = 0;
    while (i < n) {
        const c = expr[i];
        if (c === "'") {
            i++;
            while (i < n) {
                if (expr[i] === "'") {
                    if (expr[i + 1] === "'") {
                        i += 2;
                        continue;
                    }
                    i++;
                    break;
                }
                i++;
            }
            continue;
        }
        if (/[A-Za-z_]/.test(c)) {
            const prev = i === 0 ? '' : expr[i - 1];
            if (/[\w.]/.test(prev)) {
                while (i < n && /\w/.test(expr[i]))
                    i++;
                continue;
            }
            const start = i;
            while (i < n && /\w/.test(expr[i]))
                i++;
            const name = expr.slice(start, i);
            let k = i;
            while (k < n && /\s/.test(expr[k]))
                k++;
            const isCall = k < n && expr[k] === '(';
            idents.push({ name, isCall });
            continue;
        }
        i++;
    }
    return idents;
}
function parenBalance(expr) {
    let depth = 0;
    let i = 0;
    const n = expr.length;
    while (i < n) {
        const c = expr[i];
        if (c === "'") {
            i++;
            while (i < n) {
                if (expr[i] === "'") {
                    if (expr[i + 1] === "'") {
                        i += 2;
                        continue;
                    }
                    i++;
                    break;
                }
                i++;
            }
            continue;
        }
        if (c === '(')
            depth++;
        else if (c === ')')
            depth--;
        i++;
    }
    return depth;
}
exports.expressionsCheck = {
    name: 'expressions',
    description: 'Validate ${{ }} expression syntax and context/function names',
    async run({ workflows }) {
        const results = [];
        for (const wf of workflows) {
            if (wf.parseError)
                continue;
            for (const expr of (0, parser_1.extractExpressions)(wf)) {
                const trimmed = expr.expr;
                const base = { file: wf.relativePath, line: expr.line };
                if (expr.job)
                    base.job = expr.job;
                if (!trimmed) {
                    results.push({
                        check: 'expressions',
                        severity: 'error',
                        message: `Empty expression \${{ }}`,
                        fix: 'Remove the empty ${{ }} or add an expression inside.',
                        ...base,
                    });
                    continue;
                }
                const balance = parenBalance(trimmed);
                if (balance !== 0) {
                    results.push({
                        check: 'expressions',
                        severity: 'error',
                        message: balance > 0
                            ? `Unclosed parenthesis in expression "${trimmed}"`
                            : `Extra closing parenthesis in expression "${trimmed}"`,
                        fix: 'Balance the parentheses in this expression.',
                        ...base,
                    });
                }
                for (const ident of extractTopLevelIdents(trimmed)) {
                    if (LITERALS.has(ident.name))
                        continue;
                    if (ident.isCall) {
                        if (KNOWN_FUNCTIONS.has(ident.name))
                            continue;
                        const suggestion = FUNCTION_TYPOS[ident.name] ?? (0, utils_1.suggestTypo)(ident.name, KNOWN_FUNCTIONS);
                        results.push({
                            check: 'expressions',
                            severity: 'error',
                            message: `Unknown function "${ident.name}" in expression "${trimmed}"`,
                            fix: suggestion
                                ? `Did you mean "${suggestion}"?`
                                : `Valid functions: ${Array.from(KNOWN_FUNCTIONS).join(', ')}.`,
                            ...base,
                        });
                    }
                    else {
                        if (KNOWN_CONTEXTS.has(ident.name))
                            continue;
                        const suggestion = (0, utils_1.suggestTypo)(ident.name, KNOWN_CONTEXTS);
                        results.push({
                            check: 'expressions',
                            severity: 'warning',
                            message: `Unknown identifier "${ident.name}" in expression "${trimmed}"`,
                            fix: suggestion
                                ? `Did you mean "${suggestion}"?`
                                : `Valid contexts: ${Array.from(KNOWN_CONTEXTS).join(', ')}.`,
                            ...base,
                        });
                    }
                }
            }
        }
        return results;
    },
};
//# sourceMappingURL=expressions.js.map