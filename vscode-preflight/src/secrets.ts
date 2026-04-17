import * as vscode from 'vscode';

const KEY = 'preflight.anthropicApiKey';

export async function getAnthropicKey(
  context: vscode.ExtensionContext,
  options: { promptIfMissing?: boolean } = {},
): Promise<string | undefined> {
  const existing = await context.secrets.get(KEY);
  if (existing) return existing;
  if (options.promptIfMissing === false) return undefined;

  const entered = await vscode.window.showInputBox({
    title: 'Preflight: Anthropic API key',
    prompt:
      'Get one at https://console.anthropic.com/settings/keys. Stored securely in your OS keychain via VS Code SecretStorage.',
    password: true,
    ignoreFocusOut: true,
    placeHolder: 'sk-ant-...',
    validateInput: (value) => {
      if (!value.trim()) return 'Enter a key or press Escape to cancel';
      if (!value.startsWith('sk-ant-')) return 'Anthropic keys start with "sk-ant-"';
      return undefined;
    },
  });
  if (!entered) return undefined;
  await context.secrets.store(KEY, entered);
  return entered;
}

export async function clearAnthropicKey(context: vscode.ExtensionContext): Promise<void> {
  await context.secrets.delete(KEY);
}
