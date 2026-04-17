import * as vscode from 'vscode';
import type { CheckResult } from 'preflight-ci';

const SEVERITY: Record<CheckResult['severity'], vscode.DiagnosticSeverity> = {
  error: vscode.DiagnosticSeverity.Error,
  warning: vscode.DiagnosticSeverity.Warning,
  info: vscode.DiagnosticSeverity.Information,
};

export const DIAGNOSTIC_SOURCE = 'preflight';

function quotedIdents(message: string): string[] {
  const matches = message.matchAll(/"([^"]+)"/g);
  return Array.from(matches, (m) => m[1]);
}

function findRange(doc: vscode.TextDocument, result: CheckResult): vscode.Range {
  if (typeof result.line === 'number' && result.line > 0) {
    const idx = Math.min(result.line - 1, Math.max(0, doc.lineCount - 1));
    return doc.lineAt(idx).range;
  }

  const idents = quotedIdents(result.message);
  const targets: string[] = [];
  for (const id of idents) {
    // Build likely in-text shapes for each check type
    if (result.check === 'secrets') targets.push(`secrets.${id}`);
    else if (result.check === 'variables') targets.push(`vars.${id}`);
    else if (result.check === 'environments')
      targets.push(`environment: ${id}`, `name: ${id}`);
    else if (result.check === 'actions') targets.push(id);
    else if (result.check === 'runners') targets.push(id);
    else if (result.check === 'jobs') targets.push(`${id}:`);
    else if (result.check === 'permissions') targets.push(id);
    targets.push(id); // plain fallback
  }

  for (const target of targets) {
    for (let i = 0; i < doc.lineCount; i++) {
      const line = doc.lineAt(i);
      const col = line.text.indexOf(target);
      if (col >= 0) {
        return new vscode.Range(i, col, i, col + target.length);
      }
    }
  }

  // Fall back to first non-empty line.
  for (let i = 0; i < doc.lineCount; i++) {
    const line = doc.lineAt(i);
    if (line.text.trim().length > 0) return line.range;
  }
  return new vscode.Range(0, 0, 0, 0);
}

export function resultsToDiagnostics(
  doc: vscode.TextDocument,
  results: CheckResult[],
): vscode.Diagnostic[] {
  return results.map((result) => {
    const range = findRange(doc, result);
    const diagnostic = new vscode.Diagnostic(
      range,
      `[${result.check}] ${result.message}`,
      SEVERITY[result.severity],
    );
    diagnostic.source = DIAGNOSTIC_SOURCE;
    diagnostic.code = result.check;
    // Stash the fix so the code-action provider can find it
    (diagnostic as vscode.Diagnostic & { _preflightFix?: string })._preflightFix = result.fix;
    return diagnostic;
  });
}

export function groupByFile(
  results: CheckResult[],
): Map<string, CheckResult[]> {
  const out = new Map<string, CheckResult[]>();
  for (const r of results) {
    if (!r.file) continue;
    const list = out.get(r.file) ?? [];
    list.push(r);
    out.set(r.file, list);
  }
  return out;
}
