#!/usr/bin/env node
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
const commander_1 = require("commander");
const chalk_1 = __importDefault(require("chalk"));
const fs = __importStar(require("node:fs"));
const path = __importStar(require("node:path"));
const github_1 = require("./github");
const parser_1 = require("./parser");
const checks_1 = require("./checks");
const reporter_1 = require("./reporter");
const hooks_1 = require("./hooks");
const diagnose_1 = require("./diagnose");
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
function writeErr(msg) {
    process.stderr.write(chalk_1.default.red.bold('error: ') + msg + '\n');
}
function writeHint(msg) {
    process.stderr.write(chalk_1.default.dim(msg) + '\n');
}
function fatal(message, code = 2) {
    writeErr(message);
    process.exit(code);
}
async function runChecks(opts) {
    const startTime = Date.now();
    let wantedCheckNames = null;
    if (opts.checks) {
        const wanted = opts.checks
            .split(',')
            .map((s) => s.trim())
            .filter((s) => s.length > 0);
        const available = new Set(checks_1.CHECK_NAMES);
        const invalid = wanted.filter((w) => !available.has(w));
        if (invalid.length) {
            writeErr(`Unknown check name(s): ${invalid.join(', ')}`);
            writeHint(`Available checks: ${checks_1.CHECK_NAMES.join(', ')}`);
            process.exit(2);
        }
        wantedCheckNames = new Set(wanted);
    }
    const resolvedPath = path.resolve(opts.path);
    if (!fs.existsSync(resolvedPath)) {
        fatal(`Path does not exist: ${resolvedPath}`);
    }
    let repoInfo;
    try {
        repoInfo = (0, github_1.getRepoInfo)(resolvedPath);
    }
    catch (e) {
        fatal(e instanceof Error ? e.message : String(e));
    }
    let token;
    try {
        token = (0, github_1.getGhToken)();
    }
    catch (e) {
        fatal(e instanceof Error ? e.message : String(e));
    }
    let workflows;
    try {
        workflows = await (0, parser_1.loadWorkflows)(resolvedPath);
    }
    catch (e) {
        fatal(`Failed to load workflow files: ${e instanceof Error ? e.message : String(e)}`);
    }
    if (workflows.length === 0) {
        fatal(`No workflow files found in ${path.join(resolvedPath, '.github', 'workflows')}\n` +
            'Create a workflow YAML there (e.g. .github/workflows/ci.yml) and re-run.');
    }
    if (!opts.json) {
        (0, reporter_1.printHeader)(repoInfo, workflows.length);
    }
    let built;
    try {
        built = await (0, github_1.buildRepoContext)(repoInfo.owner, repoInfo.repo, token);
    }
    catch (e) {
        fatal(`Failed to connect to GitHub API: ${e instanceof Error ? e.message : String(e)}\n` +
            'Check your token has "repo" scope and can access ' +
            `${repoInfo.owner}/${repoInfo.repo}.`);
    }
    let checks = (0, checks_1.getAllChecks)(built.octokit);
    if (wantedCheckNames) {
        checks = checks.filter((c) => wantedCheckNames.has(c.name));
    }
    const results = [];
    for (const check of checks) {
        if (!opts.json)
            (0, reporter_1.printCheckStart)(check.name, check.description);
        try {
            const checkResults = await check.run({
                workflows,
                repo: built.context,
            });
            results.push(...checkResults);
            if (opts.verbose && !opts.json) {
                const count = checkResults.length;
                const tail = count === 0 ? chalk_1.default.green('✓ no issues') : chalk_1.default.dim(`${count} issue${count === 1 ? '' : 's'}`);
                process.stdout.write(chalk_1.default.dim(`  ↳ `) + tail + '\n');
            }
        }
        catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            results.push({
                check: check.name,
                severity: 'error',
                message: `Check "${check.name}" failed to run: ${msg}`,
                fix: 'Report this as a bug (use --verbose to get a stack trace).',
            });
            if (opts.verbose && e instanceof Error && e.stack) {
                process.stderr.write(chalk_1.default.dim(e.stack) + '\n');
            }
        }
    }
    if (opts.json) {
        (0, reporter_1.printJson)(results);
    }
    else {
        (0, reporter_1.printResults)(results);
        (0, reporter_1.printSummary)(results, Date.now() - startTime);
    }
    const hasErrors = results.some((r) => r.severity === 'error');
    process.exit(hasErrors ? 1 : 0);
}
async function runHookInstall(cwd) {
    try {
        const result = await (0, hooks_1.installHook)(cwd);
        const hook = chalk_1.default.bold(result.hookPath);
        if (result.action === 'created') {
            process.stdout.write(chalk_1.default.green('✓ Installed pre-push hook at ') + hook + '\n');
            process.stdout.write(chalk_1.default.dim('  preflight-ci will run automatically before every `git push`.\n'));
        }
        else if (result.action === 'appended') {
            process.stdout.write(chalk_1.default.green('✓ Appended preflight block to existing pre-push hook: ') + hook + '\n');
            if (result.backup) {
                process.stdout.write(chalk_1.default.dim(`  backup saved to ${result.backup}\n`));
            }
        }
        else {
            process.stdout.write(chalk_1.default.cyan('ℹ Already installed — no changes to ') + hook + '\n');
        }
    }
    catch (e) {
        fatal(e instanceof Error ? e.message : String(e));
    }
}
async function runHookUninstall(cwd) {
    try {
        const result = await (0, hooks_1.uninstallHook)(cwd);
        const hook = chalk_1.default.bold(result.hookPath);
        switch (result.action) {
            case 'removed':
                process.stdout.write(chalk_1.default.green('✓ Removed preflight block from ') + hook + '\n');
                process.stdout.write(chalk_1.default.dim('  (other hook content preserved)\n'));
                break;
            case 'deleted':
                process.stdout.write(chalk_1.default.green('✓ Removed pre-push hook ') +
                    hook +
                    chalk_1.default.dim(' (no other content remained)\n'));
                break;
            case 'not-installed':
                process.stdout.write(chalk_1.default.cyan('ℹ No preflight block found in ') + hook + '\n');
                break;
            case 'no-hook':
                process.stdout.write(chalk_1.default.cyan('ℹ No pre-push hook exists at ') + hook + '\n');
                break;
        }
    }
    catch (e) {
        fatal(e instanceof Error ? e.message : String(e));
    }
}
function buildProgram() {
    const program = new commander_1.Command();
    program
        .name('preflight')
        .description('Validate GitHub Actions workflows against the real GitHub repo config before pushing.')
        .version(VERSION)
        .option('--checks <list>', 'comma-separated list of check names to run (default: all)')
        .option('--json', 'output results as JSON (suppresses progress and summary)')
        .option('--verbose', 'show extra detail and stack traces on errors')
        .option('--path <dir>', 'path to the repo to scan', process.cwd())
        .action(async (opts) => {
        await runChecks(opts);
    });
    const hook = program
        .command('hook')
        .description('Manage the git pre-push hook that runs preflight automatically');
    hook
        .command('install')
        .description('Install a pre-push hook that runs preflight before every push')
        .action(async () => {
        const parentOpts = program.opts();
        await runHookInstall(path.resolve(parentOpts.path ?? process.cwd()));
    });
    hook
        .command('uninstall')
        .description('Remove the preflight block from the pre-push hook')
        .action(async () => {
        const parentOpts = program.opts();
        await runHookUninstall(path.resolve(parentOpts.path ?? process.cwd()));
    });
    program
        .command('diagnose')
        .description('Diagnose the most recent failed GitHub Actions run on the current branch using Claude (requires ANTHROPIC_API_KEY)')
        .option('--run-id <id>', 'specific workflow run ID to diagnose (otherwise the most recent failed run on the current branch)', (value) => {
        const n = Number(value);
        if (!Number.isInteger(n) || n <= 0) {
            throw new Error(`--run-id must be a positive integer, got "${value}"`);
        }
        return n;
    })
        .action(async (subOpts) => {
        const parentOpts = program.opts();
        const cwd = path.resolve(parentOpts.path ?? process.cwd());
        try {
            await (0, diagnose_1.diagnose)({
                cwd,
                runId: subOpts.runId,
                verbose: parentOpts.verbose,
            });
        }
        catch (e) {
            if (parentOpts.verbose && e instanceof Error && e.stack) {
                process.stderr.write(chalk_1.default.dim(e.stack) + '\n');
            }
            fatal(e instanceof Error ? e.message : String(e));
        }
    });
    return program;
}
buildProgram()
    .parseAsync(process.argv)
    .catch((e) => {
    writeErr(e instanceof Error ? e.message : String(e));
    if (process.argv.includes('--verbose') && e instanceof Error && e.stack) {
        process.stderr.write(chalk_1.default.dim(e.stack) + '\n');
    }
    process.exit(2);
});
//# sourceMappingURL=index.js.map