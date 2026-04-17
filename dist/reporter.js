"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.printHeader = printHeader;
exports.printCheckStart = printCheckStart;
exports.printResults = printResults;
exports.printSummary = printSummary;
exports.printJson = printJson;
const chalk_1 = __importDefault(require("chalk"));
const fs = __importStar(require("node:fs"));
const path = __importStar(require("node:path"));
const VERSION = (() => {
    try {
        const pkgPath = path.join(__dirname, '..', 'package.json');
        const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
        return typeof pkg.version === 'string' ? pkg.version : '0.0.0';
    }
    catch {
        return '0.0.0';
    }
})();
function termWidth() {
    const cols = process.stdout.columns;
    if (typeof cols === 'number' && cols >= 40)
        return Math.min(cols, 120);
    return 80;
}
function rule(title) {
    const w = termWidth();
    const lead = '── ';
    const gap = ' ';
    const chrome = lead.length + title.length + gap.length;
    const pad = Math.max(3, w - chrome);
    return chalk_1.default.dim(lead) + chalk_1.default.bold(title) + chalk_1.default.dim(gap + '─'.repeat(pad));
}
function divider(char) {
    return chalk_1.default.dim(char.repeat(termWidth()));
}
function printHeader(repo, workflowCount) {
    process.stdout.write(rule(`preflight v${VERSION}`) + '\n');
    const noun = workflowCount === 1 ? 'workflow file' : 'workflow files';
    process.stdout.write(chalk_1.default.cyan('Scanning ') +
        chalk_1.default.bold(`${repo.owner}/${repo.repo}`) +
        chalk_1.default.dim(` — ${workflowCount} ${noun} found`) +
        '\n\n');
}
function printCheckStart(checkName, description) {
    const arrow = chalk_1.default.dim('→');
    const name = chalk_1.default.cyan(checkName.padEnd(12));
    const desc = chalk_1.default.dim(description);
    process.stdout.write(`${arrow} ${name} ${desc}\n`);
}
const ICON = {
    error: '✕',
    warning: '⚠',
    info: 'ℹ',
};
const LABEL = {
    error: 'ERROR',
    warning: 'WARN ',
    info: 'INFO ',
};
const TINT = {
    error: chalk_1.default.red,
    warning: chalk_1.default.yellow,
    info: chalk_1.default.cyan,
};
const SEV_ORDER = { error: 0, warning: 1, info: 2 };
function contextParts(r) {
    const parts = [];
    if (r.job)
        parts.push(`job: ${r.job}`);
    if (r.step)
        parts.push(`step: ${r.step}`);
    if (typeof r.line === 'number')
        parts.push(`line ${r.line}`);
    if (typeof r.column === 'number')
        parts.push(`col ${r.column}`);
    return parts;
}
function printOne(r) {
    const tint = TINT[r.severity];
    const head = tint.bold(`${ICON[r.severity]} ${LABEL[r.severity]}`);
    const tag = chalk_1.default.dim(`[${r.check}]`);
    process.stdout.write(`${head} ${tag} ${r.message}\n`);
    const ctx = contextParts(r);
    if (ctx.length) {
        process.stdout.write(chalk_1.default.dim(`  > ${ctx.join(', ')}`) + '\n');
    }
    if (r.fix) {
        const [first, ...rest] = r.fix.split('\n');
        process.stdout.write(chalk_1.default.dim(`  > Fix: ${first}`) + '\n');
        for (const line of rest) {
            process.stdout.write(chalk_1.default.dim(`         ${line}`) + '\n');
        }
    }
    process.stdout.write('\n');
}
function sortForFile(list) {
    return list.slice().sort((a, b) => {
        const sev = SEV_ORDER[a.severity] - SEV_ORDER[b.severity];
        if (sev !== 0)
            return sev;
        if (a.check !== b.check)
            return a.check.localeCompare(b.check);
        const aLine = typeof a.line === 'number' ? a.line : Number.MAX_SAFE_INTEGER;
        const bLine = typeof b.line === 'number' ? b.line : Number.MAX_SAFE_INTEGER;
        return aLine - bLine;
    });
}
function printResults(results) {
    if (results.length === 0)
        return;
    const byFile = new Map();
    const noFile = [];
    for (const r of results) {
        if (r.file) {
            const list = byFile.get(r.file) ?? [];
            list.push(r);
            byFile.set(r.file, list);
        }
        else {
            noFile.push(r);
        }
    }
    for (const file of Array.from(byFile.keys()).sort()) {
        process.stdout.write('\n' + rule(file) + '\n\n');
        for (const r of sortForFile(byFile.get(file)))
            printOne(r);
    }
    if (noFile.length) {
        process.stdout.write('\n' + rule('(general)') + '\n\n');
        for (const r of sortForFile(noFile))
            printOne(r);
    }
}
function formatElapsed(ms) {
    if (ms < 1000)
        return `${Math.max(0, Math.round(ms))}ms`;
    return `${(ms / 1000).toFixed(2)}s`;
}
function plural(n, one, many = one + 's') {
    return `${n} ${n === 1 ? one : many}`;
}
function printSummary(results, elapsedMs) {
    const counts = { error: 0, warning: 0, info: 0 };
    for (const r of results)
        counts[r.severity]++;
    const elapsed = formatElapsed(elapsedMs);
    process.stdout.write('\n' + divider('═') + '\n');
    if (results.length === 0) {
        process.stdout.write(chalk_1.default.green.bold('✓ All clear') +
            chalk_1.default.dim(` — 0 issues (${elapsed})`) +
            '\n');
        return;
    }
    const parts = [];
    if (counts.error)
        parts.push(chalk_1.default.red.bold(plural(counts.error, 'error')));
    if (counts.warning)
        parts.push(chalk_1.default.yellow.bold(plural(counts.warning, 'warning')));
    if (counts.info)
        parts.push(chalk_1.default.cyan.bold(plural(counts.info, 'info', 'info')));
    const leadIcon = counts.error > 0
        ? chalk_1.default.red.bold('✕')
        : counts.warning > 0
            ? chalk_1.default.yellow.bold('⚠')
            : chalk_1.default.cyan.bold('ℹ');
    process.stdout.write(`${leadIcon} ${parts.join(chalk_1.default.dim(', '))} ${chalk_1.default.dim(`(${elapsed})`)}\n`);
}
function printJson(results) {
    process.stdout.write(JSON.stringify(results, null, 2) + '\n');
}
//# sourceMappingURL=reporter.js.map