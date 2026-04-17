import * as vscode from 'vscode';
import { diagnoseToString } from 'preflight-ci';
import { getAnthropicKey } from './secrets';

interface DiagnoseOpts {
  runId?: number;
}

export async function runDiagnose(
  context: vscode.ExtensionContext,
  output: vscode.OutputChannel,
  opts: DiagnoseOpts,
): Promise<void> {
  const folder = vscode.workspace.workspaceFolders?.[0];
  if (!folder) {
    vscode.window.showErrorMessage('Preflight: open a workspace folder first.');
    return;
  }
  const cwd = folder.uri.fsPath;

  const apiKey = await getAnthropicKey(context);
  if (!apiKey) {
    vscode.window.showWarningMessage(
      'Preflight: an Anthropic API key is required to diagnose failed runs.',
    );
    return;
  }

  // diagnoseToString reads ANTHROPIC_API_KEY from process.env — expose the
  // SecretStorage value for the duration of this call, then restore.
  const previous = process.env.ANTHROPIC_API_KEY;
  process.env.ANTHROPIC_API_KEY = apiKey;

  const title = opts.runId
    ? `Preflight: diagnosing run #${opts.runId}...`
    : 'Preflight: diagnosing latest failed run...';
  const startedAt = Date.now();

  try {
    const result = await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title,
        cancellable: false,
      },
      () => diagnoseToString({ cwd, runId: opts.runId }),
    );

    await openAsMarkdown(result);

    const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
    const ts = new Date().toISOString().slice(11, 19);
    output.appendLine(
      `[${ts}] Diagnose ${opts.runId ? `run #${opts.runId}` : 'latest failed run'} completed in ${elapsed}s`,
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const ts = new Date().toISOString().slice(11, 19);
    output.appendLine(`[${ts}] Diagnose failed: ${message}`);

    const selection = await vscode.window.showErrorMessage(
      `Preflight diagnose failed: ${message}`,
      'Set API key',
      'Show log',
    );
    if (selection === 'Set API key') {
      await context.secrets.delete('preflight.anthropicApiKey');
      await getAnthropicKey(context); // prompts
    } else if (selection === 'Show log') {
      output.show(true);
    }
  } finally {
    if (previous === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = previous;
  }
}

export async function promptForRunIdAndDiagnose(
  context: vscode.ExtensionContext,
  output: vscode.OutputChannel,
): Promise<void> {
  const input = await vscode.window.showInputBox({
    title: 'Preflight: Diagnose specific run',
    prompt: 'GitHub Actions run ID (the number in the run URL)',
    placeHolder: '1234567890',
    ignoreFocusOut: true,
    validateInput: (value) => {
      const trimmed = value.trim();
      if (!trimmed) return 'Run ID is required';
      const n = Number(trimmed);
      if (!Number.isInteger(n) || n <= 0) return 'Must be a positive integer';
      return undefined;
    },
  });
  if (!input) return;
  await runDiagnose(context, output, { runId: Number(input.trim()) });
}

async function openAsMarkdown(content: string): Promise<void> {
  // diagnoseToString starts with a plain-text header like
  //   "preflight diagnose — run #123 (title)\nworkflow: ...\n..."
  // Upgrade that first line to a markdown H1 for prettier rendering.
  const lines = content.split('\n');
  if (lines[0]?.startsWith('preflight diagnose')) {
    lines[0] = `# ${lines[0]}`;
  }
  const doc = await vscode.workspace.openTextDocument({
    language: 'markdown',
    content: lines.join('\n'),
  });
  await vscode.window.showTextDocument(doc, { preview: false });
  // Open the preview alongside so the user sees rendered markdown immediately.
  try {
    await vscode.commands.executeCommand('markdown.showPreviewToSide');
  } catch {
    // Preview not available — silently skip.
  }
}
