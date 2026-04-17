# Preflight CI for VS Code

Validate GitHub Actions workflows against your real repo config, right inside VS Code. Red/yellow squiggles in the gutter, quick-fix actions, and a status bar pill that tells you pass/fail at a glance.

Powered by the [preflight-ci](../README.md) core engine.

## What you get

- **On-save linting** for `.github/workflows/*.yml` / `*.yaml` files.
- **Diagnostics** (squiggles + Problems panel) for:
  - Undefined `${{ secrets.X }}` / `${{ vars.X }}` references (with typo suggestions)
  - Missing environments + case mismatches
  - Deprecated runner images and action versions
  - Invalid permission scopes/values, `write-all` warnings
  - `${{ }}` expression syntax: empty, unbalanced, unknown functions
  - `needs:` graph issues (missing refs, cycles)
  - YAML parse errors + missing required keys
- **Quick-fix actions** — "Replace 'DEPLY_KEY' with 'DEPLOY_KEY'" for typos, "Copy fix to clipboard" for everything else.
- **Status bar** — `✓ Preflight` when clean, `✕ Preflight: 2E 1W` with red/yellow background when there are issues. Click to open the Problems panel.
- **Built-in GitHub auth** — uses VS Code's GitHub sign-in; no token setup.

## Install (local dev)

From this repo:

```sh
cd vscode-preflight
npm install
npm run build
```

Then in VS Code, press **F5** to launch an Extension Development Host — a second VS Code window with the extension loaded. Open one of your repos in that window, save a workflow YAML file, and watch for squiggles + the status bar pill.

## Install (.vsix)

```sh
cd vscode-preflight
npx vsce package            # produces vscode-preflight-0.1.0.vsix
code --install-extension vscode-preflight-0.1.0.vsix
```

Note: because `preflight-ci` is wired via `file:..` during development, the `.vsix` build path assumes the dep resolves correctly at package time. Two ways to handle this for production distribution:

1. **Publish `preflight-ci` to npm first** (recommended). Change the dep in `package.json` to `"preflight-ci": "^0.3.0"`, `npm install`, `npx vsce package`. The `.vsix` then pulls from npm like any other extension.
2. **Bundle with esbuild.** Add an esbuild step that inlines `preflight-ci` + its transitive deps into `dist/extension.js`. Reduces `.vsix` size from ~15MB to <1MB and makes the symlink irrelevant. Not wired up in this repo yet.

## Settings

Open `Preferences: Open Settings (UI)` and search for "Preflight":

| Setting | Default | Description |
| --- | --- | --- |
| `preflight.runOnSave` | `true` | Run checks automatically when a workflow YAML is saved. |
| `preflight.disabledChecks` | `["actions"]` | Which checks to skip. `actions` is skipped by default because it hits the GitHub API per action ref and slows down saves — remove it from the list to enable full version/existence validation. |
| `preflight.contextCacheSeconds` | `60` | How long to cache fetched repo context (secrets/vars/envs lists). 0 disables the cache. |

## Commands

Access via `Cmd+Shift+P` / `Ctrl+Shift+P`:

- **Preflight: Run checks on workflows** — scan manually (useful when `runOnSave` is off, or to re-check without saving).
- **Preflight: Clear diagnostics** — wipe all squiggles and reset the status bar.
- **Preflight: Show output log** — open the Preflight output channel for per-run activity and error detail.

## Authentication

On first run, VS Code will prompt you to sign in to GitHub (uses the built-in `github` authentication provider — same one the Source Control and Pull Request panels use). No PATs, no env vars, no `gh auth login` required.

The token is only used to read **metadata** — secret names, variable names, environment names, and repo info. The extension never reads secret values, and no endpoint available to it can return them. See [the root project's Security section](../README.md#security) for details.

## Limitations

- **Static analysis only.** Preflight catches config-level issues (undefined secrets, bad syntax, deprecated actions). It does not catch runtime failures (test failures, build errors, rate limits). For those, use `preflight diagnose` in the CLI to get an AI-powered root-cause analysis of a failed run.
- **One workspace folder at a time.** Multi-root workspaces run checks against the first folder only.
- **No incremental re-checks.** Saving one file re-runs all checks for the whole repo. Usually fast (<500ms with `actions` skipped); see the output channel for timing.
