import * as vscode from 'vscode';
import { DIAGNOSTIC_SOURCE } from './diagnostics';

interface DiagnosticWithFix extends vscode.Diagnostic {
  _preflightFix?: string;
}

const DID_YOU_MEAN = /[Dd]id you mean "([^"]+)"/;
const UPGRADE_TO = /[Uu]pgrade to ([^\s.]+)/;
const REPLACE_WITH = /[Rr]eplace with ([^\s.(]+)/;

export class PreflightCodeActionProvider implements vscode.CodeActionProvider {
  static readonly providedCodeActionKinds = [vscode.CodeActionKind.QuickFix];

  provideCodeActions(
    doc: vscode.TextDocument,
    _range: vscode.Range | vscode.Selection,
    context: vscode.CodeActionContext,
  ): vscode.CodeAction[] {
    const actions: vscode.CodeAction[] = [];
    const ours = context.diagnostics.filter(
      (d): d is DiagnosticWithFix => d.source === DIAGNOSTIC_SOURCE,
    );

    for (const diag of ours) {
      const fix = diag._preflightFix;
      if (!fix) continue;

      // Replace-based action when the fix suggests a specific replacement
      const replace = extractReplacement(fix, diag.message);
      if (replace) {
        const action = buildReplaceAction(doc, diag, replace.original, replace.suggested);
        if (action) actions.push(action);
      }

      // Always offer a copy action for the full fix text
      actions.push(buildCopyAction(diag, fix));
    }

    return actions;
  }
}

function quoted(msg: string): string | undefined {
  const m = msg.match(/"([^"]+)"/);
  return m ? m[1] : undefined;
}

function extractReplacement(
  fix: string,
  message: string,
): { original: string; suggested: string } | null {
  const didYouMean = fix.match(DID_YOU_MEAN);
  if (didYouMean) {
    const original = quoted(message);
    if (original && original !== didYouMean[1]) {
      return { original, suggested: didYouMean[1] };
    }
  }

  const upgrade = fix.match(UPGRADE_TO);
  if (upgrade) {
    const original = quoted(message);
    if (original && original.includes('@')) {
      return { original, suggested: upgrade[1] };
    }
  }

  // runners: "Replace with ubuntu-22.04 (or ...)"
  const replaceMatch = fix.match(REPLACE_WITH);
  if (replaceMatch) {
    const original = quoted(message);
    if (original) {
      return { original, suggested: replaceMatch[1] };
    }
  }

  return null;
}

function buildReplaceAction(
  doc: vscode.TextDocument,
  diag: vscode.Diagnostic,
  original: string,
  suggested: string,
): vscode.CodeAction | null {
  // Find the actual location of `original` in the diagnostic's range (or line)
  const searchRange = diag.range;
  const startLine = searchRange.start.line;
  const endLine = Math.max(searchRange.end.line, startLine);
  let hit: vscode.Range | null = null;
  for (let i = startLine; i <= endLine && i < doc.lineCount; i++) {
    const line = doc.lineAt(i);
    const col = line.text.indexOf(original);
    if (col >= 0) {
      hit = new vscode.Range(i, col, i, col + original.length);
      break;
    }
  }
  // Not in range? Search the whole document as a fallback
  if (!hit) {
    for (let i = 0; i < doc.lineCount; i++) {
      const line = doc.lineAt(i);
      const col = line.text.indexOf(original);
      if (col >= 0) {
        hit = new vscode.Range(i, col, i, col + original.length);
        break;
      }
    }
  }
  if (!hit) return null;

  const action = new vscode.CodeAction(
    `Replace "${original}" with "${suggested}"`,
    vscode.CodeActionKind.QuickFix,
  );
  action.diagnostics = [diag];
  action.isPreferred = true;
  const edit = new vscode.WorkspaceEdit();
  edit.replace(doc.uri, hit, suggested);
  action.edit = edit;
  return action;
}

function buildCopyAction(diag: vscode.Diagnostic, fix: string): vscode.CodeAction {
  const firstLine = fix.split('\n')[0];
  const truncated = firstLine.length > 60 ? firstLine.slice(0, 57) + '...' : firstLine;
  const action = new vscode.CodeAction(
    `Copy fix to clipboard: ${truncated}`,
    vscode.CodeActionKind.QuickFix,
  );
  action.diagnostics = [diag];
  action.command = {
    command: 'preflight._copyToClipboard',
    title: 'Copy fix',
    arguments: [fix],
  };
  return action;
}
