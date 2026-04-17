import * as vscode from 'vscode';

export type StatusState =
  | { kind: 'idle' }
  | { kind: 'running' }
  | { kind: 'clean' }
  | { kind: 'issues'; errors: number; warnings: number; info: number }
  | { kind: 'error'; message: string };

export function createStatusBar(): vscode.StatusBarItem {
  const bar = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Left,
    100,
  );
  bar.command = 'workbench.actions.view.problems';
  updateStatusBar(bar, { kind: 'idle' });
  bar.show();
  return bar;
}

export function updateStatusBar(bar: vscode.StatusBarItem, state: StatusState): void {
  switch (state.kind) {
    case 'idle':
      bar.text = '$(shield) Preflight';
      bar.tooltip = 'Preflight: not yet run — save a workflow YAML to trigger a scan.';
      bar.backgroundColor = undefined;
      break;
    case 'running':
      bar.text = '$(sync~spin) Preflight';
      bar.tooltip = 'Preflight: running checks...';
      bar.backgroundColor = undefined;
      break;
    case 'clean':
      bar.text = '$(check) Preflight';
      bar.tooltip = 'Preflight: all checks passed.';
      bar.backgroundColor = undefined;
      break;
    case 'issues': {
      const { errors, warnings, info } = state;
      const parts: string[] = [];
      if (errors) parts.push(`${errors}E`);
      if (warnings) parts.push(`${warnings}W`);
      if (info) parts.push(`${info}I`);
      bar.text = `$(error) Preflight: ${parts.join(' ')}`;
      bar.tooltip = `${errors} errors, ${warnings} warnings, ${info} info. Click to open Problems panel.`;
      bar.backgroundColor = errors
        ? new vscode.ThemeColor('statusBarItem.errorBackground')
        : warnings
          ? new vscode.ThemeColor('statusBarItem.warningBackground')
          : undefined;
      break;
    }
    case 'error':
      bar.text = '$(warning) Preflight';
      bar.tooltip = `Preflight could not run: ${state.message}`;
      bar.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
      break;
  }
}
