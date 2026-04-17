# preflight

Validate your GitHub Actions workflows against the **real** GitHub repo config — secrets, variables, environments, action refs, permissions — **before** you push.

Think of it as `eslint` for your CI pipeline, connected to the live GitHub API. No Docker, no workflow execution, no guessing.

![preflight terminal output](docs/screenshot.png)

> *(Screenshot placeholder — generate one with `preflight` against your own repo.)*

A sample run looks like:

```text
── preflight v0.1.0 ────────────────────────────────────────────────────────
Scanning acme/widget — 3 workflow files found

→ syntax       Report YAML parse errors and missing required workflow keys
→ secrets      Validate ${{ secrets.X }} references exist in the repo
→ actions      Validate uses: references resolve and aren't deprecated or risky
...

── .github/workflows/deploy.yml ────────────────────────────────────────────

✕ ERROR [secrets] Secret "DEPLY_KEY" is not defined in the repo
  > job: deploy, step: push
  > Fix: Add the secret: gh secret set DEPLY_KEY --repo acme/widget
         Or did you mean "DEPLOY_KEY"? (change the reference)

⚠ WARN  [actions] Action "actions/checkout@v2" uses deprecated version "v2"
  > job: build, step: Checkout
  > Fix: Upgrade to actions/checkout@v4.

══════════════════════════════════════════════════════════════════════════════
✕ 1 error, 1 warning (820ms)
```

---

## Install

```sh
npm install -g preflight-ci
```

Node.js 18 or newer is required.

## Quick start

```sh
cd your-repo
preflight
```

That's it. Preflight reads `.github/workflows/*.{yml,yaml}`, cross-references every `${{ secrets.X }}`, `${{ vars.X }}`, `environment:` and `uses:` against your repo's actual config via the GitHub API, and prints a grouped, colorized report.

Exit code is `0` when clean, `1` when errors are found, and `2` when the tool itself can't run (missing auth, not a git repo, etc.).

## Authentication

Preflight needs a GitHub token to read your repo's secret names, variable names, and environments. **It never reads secret values** — see [Security](#security).

Tokens are resolved in this order:

1. **`gh` CLI** — preflight runs `gh auth token` transparently. This is the recommended path:
   ```sh
   gh auth login
   ```
2. **`GITHUB_TOKEN`** environment variable.
3. **`GH_TOKEN`** environment variable.

A fine-grained or classic PAT with `repo` scope is sufficient for private repos. For public repos, `public_repo` is enough.

## Usage

```text
preflight [options]
preflight hook <install|uninstall>
```

### Flags

| Flag | Description |
| --- | --- |
| `--checks <list>` | Comma-separated subset of checks to run. Defaults to all. Example: `--checks secrets,actions`. |
| `--json` | Emit results as a JSON array to stdout. Suppresses the header, per-check progress, and summary. Useful for CI. |
| `--verbose` | Show a `↳` trailer after each check with its issue count; include stack traces on crashes. |
| `--path <dir>` | Scan a different repo. Defaults to the current working directory. |
| `-V, --version` | Print the version and exit. |
| `-h, --help` | Print help and exit. |

### Checks

Nine checks ship in the box. Every finding includes a `Fix:` line with an actionable command, URL, or YAML change.

| Name | What it catches |
| --- | --- |
| `syntax` | YAML parse errors, missing top-level `on:` / `jobs:`, missing `runs-on:` / `steps:` per job (reusable-workflow calls are exempt), missing workflow `name:`. |
| `secrets` | Every `${{ secrets.X }}` reference that isn't defined in the repo's Actions secrets. Suggests close Levenshtein matches ("did you mean `DEPLOY_KEY`?"). Skips `GITHUB_TOKEN`. |
| `variables` | Same, for `${{ vars.X }}` against the repo's Actions variables. |
| `environments` | Every `environment:` reference against the repo's configured environments. Case mismatches are warnings with the exact fix; missing environments are errors. |
| `actions` | Deprecated versions of common actions (`checkout` v1–v3 → v4, `setup-node` v1–v3 → v4, `setup-python` v1–v4 → v5, etc.), branch pins (`@main`, `@master`) flagged as supply-chain risk, and existence of every `owner/repo@ref` via the GitHub API (with per-ref caching so duplicates aren't re-queried). |
| `expressions` | Invalid `${{ }}` syntax: empty expressions, unbalanced parens, unknown top-level contexts, typo'd function names (`contain` → `contains`, `toJson` → `toJSON`, etc.). |
| `permissions` | Invalid scope names (with typo suggestions), invalid values, `write-all` warning, and scope-mismatch between declared permissions and actions that need specific scopes (e.g. `actions/checkout` needs `contents:`). |
| `runners` | Deprecated runner images (`ubuntu-18.04`, `macos-10.15`, `windows-2019`, etc.) with replacement suggestions. Matrix/dynamic expressions and self-hosted label sets are skipped. |
| `jobs` | Circular `needs:` dependencies, references to non-existent jobs (with typo suggestions), jobs with no `steps:`, and downstream jobs depending on `continue-on-error` jobs. |

Run a subset:

```sh
preflight --checks secrets,actions
```

## Git hook

Set up a one-time hook so every `git push` triggers preflight automatically:

```sh
preflight hook install
```

This creates (or appends to) `.git/hooks/pre-push` with a marker block:

```sh
# preflight-ci:begin
# Validate GitHub Actions workflows before push. Remove with: preflight hook uninstall
npx --yes preflight-ci || exit $?
# preflight-ci:end
```

- Idempotent: running `hook install` twice is a no-op.
- Safe: if you already have a pre-push hook, preflight prepends its block after the shebang and saves a backup at `pre-push.preflight-backup`. Your existing content runs after preflight passes.
- Removable: `preflight hook uninstall` strips only the preflight block. If the hook becomes empty, it's deleted.

The hook resolves hooks directory via `git rev-parse --git-path hooks`, so it respects worktrees and `core.hooksPath` configuration.

## Usage as a GitHub Action

Run preflight automatically on every pull request. Findings show up as inline annotations on the PR diff (red ❌ for errors, yellow ⚠ for warnings), and a full report lands in the job summary.

Minimal workflow — drop this into `.github/workflows/preflight.yml`:

```yaml
name: Preflight
on: [pull_request]

jobs:
  preflight:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      actions: read
    steps:
      - uses: actions/checkout@v4
      - uses: jefferyreed/preflight@v1
```

That's it. No secrets to configure, no API keys — the Action uses the built-in `GITHUB_TOKEN` that every workflow has access to. The `permissions:` block above is the minimum required: `contents: read` to read your workflow YAML, `actions: read` for variable/environment names.

### Inputs

| Input | Default | Description |
| --- | --- | --- |
| `checks` | all nine | Comma-separated subset. Example: `checks: "secrets,actions,permissions"`. |
| `verbose` | `false` | When `true`, the job summary includes the full `Fix:` text for every finding. |
| `github-token` | `${{ github.token }}` | Token used for API reads. Override only if you need a different permission scope. |

### Outputs

| Output | Description |
| --- | --- |
| `error_count` | Number of error-severity findings. Non-zero → the job fails. |
| `warning_count` | Number of warnings. |
| `info_count` | Number of info-level findings. |

### How failures surface

- **Inline annotations** on the PR diff — click the file tab in the PR to see red/yellow markers on the offending lines, with the check name and message.
- **Job summary** — a markdown table of every finding, grouped by severity, with file/line/job/step context. If you enable `verbose: "true"`, each row also shows the actionable `Fix:` text inline.
- **Exit status** — the job fails (red X in the checks list) if any error-severity findings exist. Warnings and info don't fail the build.

### Which checks run in the Action

The same nine checks the CLI runs — see the "Checks" table above. The Action is the free tier; no API keys or paid services involved. For richer workflows (like log-based post-mortems of failed runs), those features live in the CLI (`preflight diagnose`) and run on your local machine.

## What this tool does *not* do

- **It does not execute your workflows.** This is static analysis plus GitHub API reads. Unlike [`act`](https://github.com/nektos/act), there is no Docker, no runners, no sandbox, no workflow simulation.
- **It never reads secret values.** The GitHub API endpoints preflight hits (`listRepoSecrets`, `listRepoVariables`, `getAllEnvironments`) return names and metadata only — not values. Secret values are not available through the API, and preflight does not ask for them through any other channel.
- **It does not modify your workflows.** All suggestions are printed as `Fix:` text; no YAML is ever written back.
- **It does not require Docker, Python, or any non-Node runtime.** TypeScript compiled to CommonJS, run on any Node ≥ 18.

## Security

Preflight is built around a simple trust model: **nothing about your tokens or workflow contents leaves your machine except routine GitHub API calls you authenticate yourself.**

- **Local-only execution.** Parsing, analysis, and reporting all run in your shell. The only network traffic is to `api.github.com`, using your own token.
- **Metadata-only API endpoints.** The GitHub API itself only exposes secret and variable *names* — not values. Preflight calls those metadata endpoints exclusively. There is no code path that reads a secret value because there is no API for doing so.
- **No telemetry.** Preflight emits no pings, no analytics, no error reporting. You can confirm by running `preflight --verbose` and watching the process with `lsof` or a network sniffer.
- **No token persistence.** Preflight calls `gh auth token` or reads `GITHUB_TOKEN` / `GH_TOKEN` from the environment. It never writes tokens to disk or caches them.
- **Open source.** Every line of code is in this repo. The `github.ts` module carries a top-of-file banner reminding contributors that secret values must never be read.

If you find a security concern, please email the maintainers or open a confidential advisory in the GitHub repo rather than a public issue.

## Contributing

```sh
git clone https://github.com/your-org/preflight-ci
cd preflight-ci
npm install
npm run build
npm test
```

- `npm run dev` — `tsc --watch` for iterative work.
- `npm test` — Node's built-in test runner (`node:test`) via `tsx`, 40+ tests across parser and every check module.
- New checks go in `src/checks/<name>.ts` and are registered in `src/checks/index.ts`. Each check exports a `CheckFunction` with `name`, `description`, and `async run(ctx)`. Results must include a `fix` string with actionable remediation.
- Do **not** add tests that mock the GitHub API for unit tests — exercise the parsing/analysis logic with fixture YAML strings. Integration tests can be separate.

## License

MIT.
