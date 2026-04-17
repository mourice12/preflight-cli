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
Object.defineProperty(exports, "__esModule", { value: true });
exports.findRepoRoot = findRepoRoot;
exports.loadWorkflows = loadWorkflows;
exports.extractSecretRefs = extractSecretRefs;
exports.extractVariableRefs = extractVariableRefs;
exports.extractEnvironmentRefs = extractEnvironmentRefs;
exports.extractActionRefs = extractActionRefs;
exports.extractExpressions = extractExpressions;
const node_fs_1 = require("node:fs");
const path = __importStar(require("node:path"));
const yaml = __importStar(require("js-yaml"));
const glob_1 = require("glob");
async function findRepoRoot(start = process.cwd()) {
    let dir = path.resolve(start);
    while (true) {
        try {
            await node_fs_1.promises.stat(path.join(dir, '.git'));
            return dir;
        }
        catch {
            // no .git here — keep walking
        }
        const parent = path.dirname(dir);
        if (parent === dir)
            break;
        dir = parent;
    }
    return path.resolve(start);
}
async function loadWorkflows(repoRoot) {
    const root = repoRoot ? path.resolve(repoRoot) : await findRepoRoot();
    const workflowDir = path.join(root, '.github', 'workflows');
    const found = new Set();
    for (const pat of ['*.yml', '*.yaml']) {
        const matches = await (0, glob_1.glob)(pat, {
            cwd: workflowDir,
            absolute: true,
            nodir: true,
        });
        for (const m of matches)
            found.add(m);
    }
    const results = [];
    for (const filePath of Array.from(found).sort()) {
        const raw = await node_fs_1.promises.readFile(filePath, 'utf8');
        const relativePath = path.relative(root, filePath);
        let parsed = {};
        let parseError;
        try {
            const doc = yaml.load(raw);
            if (doc && typeof doc === 'object' && !Array.isArray(doc)) {
                parsed = doc;
            }
            else if (doc !== null && doc !== undefined) {
                parseError = `Top-level workflow must be a mapping (got ${Array.isArray(doc) ? 'array' : typeof doc}).`;
            }
            else {
                parseError = 'Workflow file is empty.';
            }
        }
        catch (err) {
            parseError = err instanceof Error ? err.message : String(err);
        }
        results.push({ path: filePath, relativePath, raw, parsed, parseError });
    }
    return results;
}
function walkStrings(obj, visit) {
    if (typeof obj === 'string') {
        visit(obj);
    }
    else if (Array.isArray(obj)) {
        for (const v of obj)
            walkStrings(v, visit);
    }
    else if (obj && typeof obj === 'object') {
        for (const v of Object.values(obj))
            walkStrings(v, visit);
    }
}
function stepIdentifier(step, idx) {
    if (typeof step.name === 'string' && step.name.trim())
        return step.name.trim();
    if (typeof step.id === 'string' && step.id.trim())
        return step.id.trim();
    if (typeof step.uses === 'string' && step.uses.trim())
        return step.uses.trim();
    return `step-${idx + 1}`;
}
function walkWorkflow(parsed, visit) {
    const { jobs, ...workflowRest } = parsed;
    walkStrings(workflowRest, (s) => visit(s, {}));
    for (const [jobName, job] of Object.entries(jobs ?? {})) {
        if (!job || typeof job !== 'object')
            continue;
        const { steps, ...jobRest } = job;
        walkStrings(jobRest, (s) => visit(s, { job: jobName }));
        if (Array.isArray(steps)) {
            steps.forEach((step, idx) => {
                if (!step || typeof step !== 'object')
                    return;
                const stepName = stepIdentifier(step, idx);
                walkStrings(step, (s) => visit(s, { job: jobName, step: stepName }));
            });
        }
    }
}
function contextPayload(ctx) {
    const out = {};
    if (ctx.job)
        out.job = ctx.job;
    if (ctx.step)
        out.step = ctx.step;
    return out;
}
const SECRET_RE = /\$\{\{\s*secrets\.([A-Za-z_][A-Za-z0-9_]*)\s*\}\}/g;
const VAR_RE = /\$\{\{\s*vars\.([A-Za-z_][A-Za-z0-9_]*)\s*\}\}/g;
const EXPR_RE = /\$\{\{([\s\S]*?)\}\}/g;
function extractSecretRefs(workflow) {
    const refs = [];
    walkWorkflow(workflow.parsed, (value, ctx) => {
        for (const m of value.matchAll(SECRET_RE)) {
            refs.push({ name: m[1], ...contextPayload(ctx) });
        }
    });
    return refs;
}
function extractVariableRefs(workflow) {
    const refs = [];
    walkWorkflow(workflow.parsed, (value, ctx) => {
        for (const m of value.matchAll(VAR_RE)) {
            refs.push({ name: m[1], ...contextPayload(ctx) });
        }
    });
    return refs;
}
function extractEnvironmentRefs(workflow) {
    const refs = [];
    const jobs = workflow.parsed.jobs ?? {};
    for (const [jobName, job] of Object.entries(jobs)) {
        if (!job || typeof job !== 'object')
            continue;
        const env = job.environment;
        let envName;
        if (typeof env === 'string') {
            envName = env;
        }
        else if (env && typeof env === 'object' && !Array.isArray(env)) {
            const nameField = env.name;
            if (typeof nameField === 'string')
                envName = nameField;
        }
        if (!envName)
            continue;
        if (envName.includes('${{'))
            continue;
        refs.push({ name: envName, job: jobName });
    }
    return refs;
}
function extractActionRefs(workflow) {
    const refs = [];
    const jobs = workflow.parsed.jobs ?? {};
    for (const [jobName, job] of Object.entries(jobs)) {
        if (!job || typeof job !== 'object')
            continue;
        if (typeof job.uses === 'string') {
            const u = job.uses.trim();
            if (u && !u.startsWith('./') && !u.startsWith('../') && !u.startsWith('docker://')) {
                refs.push({ ref: u, job: jobName });
            }
        }
        const steps = job.steps;
        if (!Array.isArray(steps))
            continue;
        steps.forEach((step, idx) => {
            if (!step || typeof step !== 'object')
                return;
            if (typeof step.uses !== 'string')
                return;
            const useRef = step.uses.trim();
            if (!useRef)
                return;
            if (useRef.startsWith('./') || useRef.startsWith('../'))
                return;
            if (useRef.startsWith('docker://'))
                return;
            refs.push({ ref: useRef, job: jobName, step: stepIdentifier(step, idx) });
        });
    }
    return refs;
}
function extractExpressions(workflow) {
    const raw = workflow.raw;
    const lines = raw.split('\n');
    const lineStartOffsets = new Array(lines.length);
    {
        let offset = 0;
        for (let i = 0; i < lines.length; i++) {
            lineStartOffsets[i] = offset;
            offset += lines[i].length + 1; // +1 for the \n
        }
    }
    // Track which job each line belongs to (for expressions under `jobs:`).
    const jobByLine = new Array(lines.length);
    {
        let currentJob;
        let inJobs = false;
        for (let i = 0; i < lines.length; i++) {
            const stripped = lines[i].replace(/#.*$/, '').replace(/\s+$/, '');
            if (!inJobs) {
                if (/^jobs:\s*$/.test(stripped))
                    inJobs = true;
            }
            else if (stripped.length > 0 && /^\S/.test(stripped)) {
                // Left the jobs block (new top-level key)
                inJobs = false;
                currentJob = undefined;
            }
            else {
                const m = stripped.match(/^ {2}([A-Za-z_][A-Za-z0-9_-]*):\s*$/);
                if (m)
                    currentJob = m[1];
            }
            jobByLine[i] = currentJob;
        }
    }
    const findLineIndex = (pos) => {
        let lo = 0;
        let hi = lineStartOffsets.length - 1;
        let ans = 0;
        while (lo <= hi) {
            const mid = (lo + hi) >> 1;
            if (lineStartOffsets[mid] <= pos) {
                ans = mid;
                lo = mid + 1;
            }
            else {
                hi = mid - 1;
            }
        }
        return ans;
    };
    const results = [];
    for (const m of raw.matchAll(EXPR_RE)) {
        const pos = m.index ?? 0;
        const lineIdx = findLineIndex(pos);
        const job = jobByLine[lineIdx];
        const entry = { expr: m[1].trim(), line: lineIdx + 1 };
        if (job)
            entry.job = job;
        results.push(entry);
    }
    return results;
}
//# sourceMappingURL=parser.js.map