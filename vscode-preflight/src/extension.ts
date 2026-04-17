import * as vscode from 'vscode';
import * as path from 'node:path';
import {
  loadWorkflows,
  getAllChecks,
  CHECK_NAMES,
  createOctokit,
  buildRepoContext,
  getRepoInfo,
  type CheckResult,
  type BuildRepoContextResult,
  type RepoInfo,
} from 'preflight-ci';
import {
  DIAGNOSTIC_SOURCE,
  resultsToDiagnostics,
  groupByFile,
} from './diagnostics';
import { PreflightCodeActionProvider } from './codeActions';
import { createStatusBar, updateStatusBar } from './status';
import { getGitHubToken } from './auth';
import { runDiagnose, promptForRunIdAndDiagnose } from './diagnose';
import { clearAnthropicKey } from './secrets';

let diagnosticCollection: vscode.DiagnosticCollection;
let statusBar: vscode.StatusBarItem;
let output: vscode.OutputChannel;

interface ContextCache {
  workspacePath: string;
  owner: string;
  repo: string;
  built: BuildRepoContextResult;
  ts: number;
}
let contextCache: ContextCache | null = null;

let runLock = false;
let pendingRun = false;

export function activate(context: vscode.ExtensionContext): void {
  diagnosticCollection = vscode.languages.createDiagnosticCollection(DIAGNOSTIC_SOURCE);
  statusBar = createStatusBar();
  output = vscode.window.createOutputChannel('Preflight');

  context.subscriptions.push(diagnosticCollection, statusBar, output);

  context.subscriptions.push(
    vscode.languages.registerCodeActionsProvider(
      [
        { language: 'yaml', pattern: '**/.github/workflows/*.yml' },
        { language: 'yaml', pattern: '**/.github/workflows/*.yaml' },
      ],
      new PreflightCodeActionProvider(),
      { providedCodeActionKinds: PreflightCodeActionProvider.providedCodeActionKinds },
    ),
  );

  context.subscriptions.push(
    vscode.workspace.onDidSaveTextDocument((doc) => {
      if (!isWorkflowDoc(doc)) return;
      const config = vscode.workspace.getConfiguration('preflight');
      if (!config.get<boolean>('runOnSave', true)) return;
      void scheduleRun(doc.uri);
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('preflight.run', async () => {
      const uri =
        vscode.window.activeTextEditor?.document.uri ??
        vscode.workspace.workspaceFolders?.[0]?.uri;
      if (!uri) {
        vscode.window.showWarningMessage('Preflight: open a workspace first.');
        return;
      }
      await scheduleRun(uri);
    }),
    vscode.commands.registerCommand('preflight.clear', () => {
      diagnosticCollection.clear();
      contextCache = null;
      updateStatusBar(statusBar, { kind: 'idle' });
    }),
    vscode.commands.registerCommand('preflight.showOutput', () => {
      output.show(true);
    }),
    vscode.commands.registerCommand(
      'preflight._copyToClipboard',
      async (text: string) => {
        await vscode.env.clipboard.writeText(text);
        vscode.window.showInformationMessage('Preflight: fix copied to clipboard.');
      },
    ),
    vscode.commands.registerCommand('preflight.diagnoseLatest', () =>
      runDiagnose(context, output, {}),
    ),
    vscode.commands.registerCommand('preflight.diagnoseRun', () =>
      promptForRunIdAndDiagnose(context, output),
    ),
    vscode.commands.registerCommand('preflight.clearApiKey', async () => {
      await clearAnthropicKey(context);
      vscode.window.showInformationMessage('Preflight: Anthropic API key cleared.');
    }),
  );
}

export function deactivate(): void {
  diagnosticCollection?.dispose();
  statusBar?.dispose();
  output?.dispose();
}

function isWorkflowDoc(doc: vscode.TextDocument): boolean {
  if (doc.uri.scheme !== 'file') return false;
  const rel = vscode.workspace.asRelativePath(doc.uri, false);
  return /(^|\/)\.github\/workflows\/[^/]+\.ya?ml$/.test(rel);
}

async function scheduleRun(uri: vscode.Uri): Promise<void> {
  // Debounce: if a run is in flight, mark that another is pending and return.
  // The current run finishes, sees `pendingRun`, and restarts once.
  if (runLock) {
    pendingRun = true;
    return;
  }
  runLock = true;
  try {
    await runPreflight(uri);
    while (pendingRun) {
      pendingRun = false;
      await runPreflight(uri);
    }
  } finally {
    runLock = false;
  }
}

function log(msg: string): void {
  const ts = new Date().toISOString().slice(11, 19);
  output.appendLine(`[${ts}] ${msg}`);
}

async function runPreflight(uri: vscode.Uri): Promise<void> {
  const folder = vscode.workspace.getWorkspaceFolder(uri) ?? vscode.workspace.workspaceFolders?.[0];
  if (!folder) {
    updateStatusBar(statusBar, { kind: 'error', message: 'No workspace folder open.' });
    return;
  }
  const workspacePath = folder.uri.fsPath;

  updateStatusBar(statusBar, { kind: 'running' });
  log(`Running preflight in ${workspacePath}`);

  let repoInfo: RepoInfo;
  try {
    repoInfo = getRepoInfo(workspacePath);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log(`Error: ${message}`);
    updateStatusBar(statusBar, { kind: 'error', message: 'Not a git repo with a GitHub remote.' });
    diagnosticCollection.clear();
    return;
  }

  const token = await getGitHubToken();
  if (!token) {
    updateStatusBar(statusBar, { kind: 'error', message: 'Sign in to GitHub to enable preflight.' });
    log('No GitHub session — skipping. Run "GitHub: Sign in" from the command palette.');
    return;
  }

  let workflows;
  try {
    workflows = await loadWorkflows(workspacePath);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log(`Failed to load workflows: ${message}`);
    updateStatusBar(statusBar, { kind: 'error', message: 'Could not load workflow files.' });
    return;
  }

  if (workflows.length === 0) {
    diagnosticCollection.clear();
    updateStatusBar(statusBar, { kind: 'idle' });
    log('No workflow files found.');
    return;
  }

  const config = vscode.workspace.getConfiguration('preflight');
  const disabled = new Set(config.get<string[]>('disabledChecks', []) ?? []);
  const cacheSeconds = config.get<number>('contextCacheSeconds', 60);

  let built: BuildRepoContextResult;
  try {
    built = await getOrFetchContext(workspacePath, repoInfo, token, cacheSeconds);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log(`GitHub API error: ${message}`);
    updateStatusBar(statusBar, { kind: 'error', message: 'GitHub API error — see Preflight output.' });
    return;
  }

  const activeChecks = getAllChecks(built.octokit).filter((c) => !disabled.has(c.name));
  const results: CheckResult[] = [];
  for (const check of activeChecks) {
    try {
      results.push(...(await check.run({ workflows, repo: built.context })));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log(`Check "${check.name}" threw: ${message}`);
    }
  }

  diagnosticCollection.clear();
  const byFile = groupByFile(results);
  for (const wf of workflows) {
    const fileResults = byFile.get(wf.relativePath) ?? [];
    const fileUri = vscode.Uri.file(path.join(workspacePath, wf.relativePath));
    const doc = await vscode.workspace.openTextDocument(fileUri);
    diagnosticCollection.set(fileUri, resultsToDiagnostics(doc, fileResults));
  }

  const counts = { errors: 0, warnings: 0, info: 0 };
  for (const r of results) {
    if (r.severity === 'error') counts.errors++;
    else if (r.severity === 'warning') counts.warnings++;
    else counts.info++;
  }

  if (counts.errors === 0 && counts.warnings === 0 && counts.info === 0) {
    updateStatusBar(statusBar, { kind: 'clean' });
  } else {
    updateStatusBar(statusBar, { kind: 'issues', ...counts });
  }

  const ran = activeChecks.map((c) => c.name).join(', ');
  const skipped = Array.from(disabled).filter((c) => (CHECK_NAMES as readonly string[]).includes(c));
  log(
    `Done: ${counts.errors} errors, ${counts.warnings} warnings, ${counts.info} info. ` +
      `Ran [${ran}]${skipped.length ? `, skipped [${skipped.join(', ')}]` : ''}.`,
  );
}

async function getOrFetchContext(
  workspacePath: string,
  repoInfo: RepoInfo,
  token: string,
  cacheSeconds: number,
): Promise<BuildRepoContextResult> {
  const now = Date.now();
  if (
    cacheSeconds > 0 &&
    contextCache &&
    contextCache.workspacePath === workspacePath &&
    contextCache.owner === repoInfo.owner &&
    contextCache.repo === repoInfo.repo &&
    now - contextCache.ts < cacheSeconds * 1000
  ) {
    return contextCache.built;
  }
  const built = await buildRepoContext(repoInfo.owner, repoInfo.repo, token);
  // buildRepoContext creates its own Octokit from the token — that's the one
  // our checks will use; the token we got from VS Code's auth flow was only
  // needed for this one call.
  void createOctokit;
  contextCache = {
    workspacePath,
    owner: repoInfo.owner,
    repo: repoInfo.repo,
    built,
    ts: now,
  };
  return built;
}
