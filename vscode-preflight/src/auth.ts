import * as vscode from 'vscode';

export async function getGitHubToken(options?: {
  silent?: boolean;
}): Promise<string | undefined> {
  try {
    const session = await vscode.authentication.getSession(
      'github',
      ['repo'],
      { createIfNone: !options?.silent, silent: options?.silent ?? false },
    );
    return session?.accessToken;
  } catch (err) {
    // User dismissed the sign-in prompt or provider errored.
    return undefined;
  }
}
