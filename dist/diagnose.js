"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.diagnoseToString = diagnoseToString;
exports.diagnose = diagnose;
const sdk_1 = __importDefault(require("@anthropic-ai/sdk"));
const chalk_1 = __importDefault(require("chalk"));
const node_child_process_1 = require("node:child_process");
const github_1 = require("./github");
const MODEL = 'claude-sonnet-4-6';
const MAX_OUTPUT_TOKENS = 4000;
const LOG_CHAR_BUDGET = 20_000;
const SYSTEM_PROMPT = `You are a senior DevOps engineer helping a developer diagnose a failed GitHub Actions workflow run. You receive the workflow YAML that ran and the tail of the failed job's logs.

Produce exactly three sections, each on its own line, labeled and in this order:

ROOT CAUSE: One sentence identifying the specific thing that went wrong. Be precise — "The Release step on line 42 lacks contents:write permission" beats "permissions issue".

DIAGNOSIS: 2-4 sentences explaining why the failure happened — what caused the conditions that triggered the error. Quote exact lines from the logs or YAML when citing evidence.

FIX: Concrete remediation. Prefer a YAML diff or a specific command (gh, npm, etc.). Use numbered steps if more than one. Make the fix copy-pasteable.

Rules:
- Be specific. "There is a permissions issue" is useless.
- Quote exact lines from the logs or YAML when citing evidence.
- If the logs are too truncated to diagnose confidently, say so and list what additional information would help.
- Do not speculate beyond the evidence.`;
function getCurrentBranch(cwd) {
    let branch;
    try {
        branch = (0, node_child_process_1.execSync)('git rev-parse --abbrev-ref HEAD', {
            cwd,
            stdio: ['ignore', 'pipe', 'pipe'],
            encoding: 'utf8',
        }).trim();
    }
    catch (err) {
        const detail = err instanceof Error ? err.message : String(err);
        throw new Error(`Could not determine current branch: ${detail}`);
    }
    if (branch === 'HEAD' || !branch) {
        throw new Error('Detached HEAD (no current branch). Pass --run-id to pick a specific run.');
    }
    return branch;
}
async function findMostRecentFailedRun(octokit, owner, repo, branch) {
    const { data } = await octokit.actions.listWorkflowRunsForRepo({
        owner,
        repo,
        branch,
        status: 'failure',
        per_page: 5,
    });
    if (!data.workflow_runs.length) {
        throw new Error(`No failed workflow runs found on branch "${branch}" in ${owner}/${repo}.\n` +
            'Pass --run-id to target a specific run, or push a commit that fails CI.');
    }
    return data.workflow_runs[0];
}
async function fetchRunById(octokit, owner, repo, runId) {
    try {
        const { data } = await octokit.actions.getWorkflowRun({
            owner,
            repo,
            run_id: runId,
        });
        return data;
    }
    catch (err) {
        const status = err.status;
        if (status === 404) {
            throw new Error(`Workflow run ${runId} not found in ${owner}/${repo} (or token lacks access).`);
        }
        throw err;
    }
}
async function fetchFailedJobLogs(octokit, owner, repo, runId) {
    const { data: jobsData } = await octokit.actions.listJobsForWorkflowRun({
        owner,
        repo,
        run_id: runId,
        per_page: 50,
    });
    const failedJobs = jobsData.jobs.filter((j) => j.conclusion === 'failure');
    if (failedJobs.length === 0)
        return [];
    const results = [];
    for (const job of failedJobs) {
        try {
            const response = await octokit.actions.downloadJobLogsForWorkflowRun({
                owner,
                repo,
                job_id: job.id,
            });
            const raw = response.data;
            let text;
            if (typeof raw === 'string') {
                text = raw;
            }
            else if (raw instanceof ArrayBuffer) {
                text = Buffer.from(raw).toString('utf8');
            }
            else if (Buffer.isBuffer(raw)) {
                text = raw.toString('utf8');
            }
            else {
                text = String(raw);
            }
            results.push({ name: job.name, logs: text });
        }
        catch (err) {
            const detail = err instanceof Error ? err.message : String(err);
            results.push({ name: job.name, logs: `[Failed to download logs: ${detail}]` });
        }
    }
    return results;
}
async function fetchWorkflowYaml(octokit, owner, repo, workflowPath, ref) {
    try {
        const response = await octokit.repos.getContent({
            owner,
            repo,
            path: workflowPath,
            ref,
            mediaType: { format: 'raw' },
        });
        if (typeof response.data === 'string')
            return response.data;
        return String(response.data);
    }
    catch (err) {
        const detail = err instanceof Error ? err.message : String(err);
        return `[Could not fetch ${workflowPath} at ${ref}: ${detail}]`;
    }
}
function truncateLogs(logs, maxChars) {
    if (logs.length <= maxChars)
        return { text: logs, truncated: false };
    const suffix = logs.slice(-maxChars);
    return { text: `... [earlier output truncated] ...\n${suffix}`, truncated: true };
}
function buildUserMessage(run, workflowYaml, jobLogs) {
    const parts = [];
    parts.push(`# Workflow YAML (${run.path} @ ${run.head_sha.slice(0, 7)})`);
    parts.push('```yaml');
    parts.push(workflowYaml);
    parts.push('```');
    parts.push('');
    if (jobLogs.length === 0) {
        parts.push('## No failed jobs were reported for this run — the run conclusion was failure but listJobsForWorkflowRun returned no jobs with conclusion=failure. This often means the run failed before any job started (invalid YAML, missing workflow file).');
    }
    else {
        for (const { name, logs } of jobLogs) {
            const { text, truncated } = truncateLogs(logs, LOG_CHAR_BUDGET);
            parts.push(`## Failed job: ${name}`);
            if (truncated) {
                parts.push(`*(logs truncated to last ${LOG_CHAR_BUDGET.toLocaleString()} characters)*`);
            }
            parts.push('```text');
            parts.push(text);
            parts.push('```');
            parts.push('');
        }
    }
    parts.push('Diagnose the failure and suggest a fix per the format in the system prompt.');
    return parts.join('\n');
}
async function diagnoseToString(opts) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
        throw new Error('ANTHROPIC_API_KEY environment variable is not set. Get a key at https://console.anthropic.com/');
    }
    const repoInfo = (0, github_1.getRepoInfo)(opts.cwd);
    const token = (0, github_1.getGhToken)();
    const octokit = (0, github_1.createOctokit)(token);
    const run = opts.runId
        ? await fetchRunById(octokit, repoInfo.owner, repoInfo.repo, opts.runId)
        : await findMostRecentFailedRun(octokit, repoInfo.owner, repoInfo.repo, getCurrentBranch(opts.cwd));
    const [workflowYaml, jobLogs] = await Promise.all([
        fetchWorkflowYaml(octokit, repoInfo.owner, repoInfo.repo, run.path, run.head_sha),
        fetchFailedJobLogs(octokit, repoInfo.owner, repoInfo.repo, run.id),
    ]);
    const userMessage = buildUserMessage(run, workflowYaml, jobLogs);
    const client = new sdk_1.default({ apiKey });
    try {
        const response = await client.messages.create({
            model: MODEL,
            max_tokens: MAX_OUTPUT_TOKENS,
            thinking: { type: 'adaptive' },
            system: SYSTEM_PROMPT,
            messages: [{ role: 'user', content: userMessage }],
        });
        const diagnosis = response.content
            .filter((b) => b.type === 'text')
            .map((b) => b.text)
            .join('\n');
        const title = run.display_title || run.name || 'workflow';
        const header = [
            `preflight diagnose — run #${run.run_number} (${title})`,
            `workflow: ${run.path}`,
            `branch:   ${run.head_branch ?? '?'} · commit ${run.head_sha.slice(0, 7)}`,
            `url:      ${run.html_url}`,
        ].join('\n');
        return `${header}\n\n${diagnosis}`;
    }
    catch (err) {
        if (err instanceof sdk_1.default.AuthenticationError) {
            throw new Error('Invalid ANTHROPIC_API_KEY. Verify at https://console.anthropic.com/settings/keys');
        }
        if (err instanceof sdk_1.default.RateLimitError) {
            throw new Error('Claude API rate limit exceeded. Wait a moment and retry.');
        }
        if (err instanceof sdk_1.default.APIError) {
            throw new Error(`Claude API error (${err.status}): ${err.message}`);
        }
        throw err;
    }
}
async function diagnose(opts) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
        throw new Error('ANTHROPIC_API_KEY environment variable is not set.\n' +
            'Get a key at https://console.anthropic.com/ and set:\n' +
            '  export ANTHROPIC_API_KEY=sk-ant-...');
    }
    const repoInfo = (0, github_1.getRepoInfo)(opts.cwd);
    const token = (0, github_1.getGhToken)();
    const octokit = (0, github_1.createOctokit)(token);
    const run = opts.runId
        ? await fetchRunById(octokit, repoInfo.owner, repoInfo.repo, opts.runId)
        : await findMostRecentFailedRun(octokit, repoInfo.owner, repoInfo.repo, getCurrentBranch(opts.cwd));
    const title = run.display_title || run.name || 'workflow';
    process.stdout.write(chalk_1.default.dim('── ') +
        chalk_1.default.bold(`preflight diagnose`) +
        chalk_1.default.dim(` — run #${run.run_number} (${title})\n`));
    process.stdout.write(chalk_1.default.dim(`workflow: ${run.path}\n`));
    process.stdout.write(chalk_1.default.dim(`branch:   ${run.head_branch ?? '?'} · commit ${run.head_sha.slice(0, 7)}\n`));
    process.stdout.write(chalk_1.default.dim(`url:      ${run.html_url}\n\n`));
    process.stdout.write(chalk_1.default.dim('→ fetching workflow YAML and failed-job logs...\n'));
    const [workflowYaml, jobLogs] = await Promise.all([
        fetchWorkflowYaml(octokit, repoInfo.owner, repoInfo.repo, run.path, run.head_sha),
        fetchFailedJobLogs(octokit, repoInfo.owner, repoInfo.repo, run.id),
    ]);
    if (opts.verbose) {
        process.stdout.write(chalk_1.default.dim(`  ↳ YAML: ${workflowYaml.length} chars\n`));
        process.stdout.write(chalk_1.default.dim(`  ↳ failed jobs: ${jobLogs.length}\n`));
        for (const { name, logs } of jobLogs) {
            process.stdout.write(chalk_1.default.dim(`     · ${name}: ${logs.length.toLocaleString()} chars of logs\n`));
        }
    }
    const userMessage = buildUserMessage(run, workflowYaml, jobLogs);
    process.stdout.write(chalk_1.default.dim(`→ diagnosing with ${MODEL}...\n\n`));
    const client = new sdk_1.default({ apiKey });
    try {
        const stream = client.messages.stream({
            model: MODEL,
            max_tokens: MAX_OUTPUT_TOKENS,
            thinking: { type: 'adaptive' },
            system: SYSTEM_PROMPT,
            messages: [{ role: 'user', content: userMessage }],
        });
        stream.on('text', (delta) => {
            process.stdout.write(delta);
        });
        const finalMessage = await stream.finalMessage();
        process.stdout.write('\n\n');
        if (opts.verbose) {
            const u = finalMessage.usage;
            const cacheRead = u.cache_read_input_tokens ?? 0;
            const cacheWrite = u.cache_creation_input_tokens ?? 0;
            process.stdout.write(chalk_1.default.dim(`─── usage: ${u.input_tokens} input, ${u.output_tokens} output` +
                (cacheRead || cacheWrite ? `, ${cacheRead} cached-read, ${cacheWrite} cached-write` : '') +
                ` · model: ${MODEL}\n`));
        }
    }
    catch (err) {
        if (err instanceof sdk_1.default.AuthenticationError) {
            throw new Error('Invalid ANTHROPIC_API_KEY. Verify at https://console.anthropic.com/settings/keys');
        }
        if (err instanceof sdk_1.default.RateLimitError) {
            throw new Error('Claude API rate limit exceeded. Wait a moment and retry.');
        }
        if (err instanceof sdk_1.default.APIError) {
            throw new Error(`Claude API error (${err.status}): ${err.message}`);
        }
        throw err;
    }
}
//# sourceMappingURL=diagnose.js.map