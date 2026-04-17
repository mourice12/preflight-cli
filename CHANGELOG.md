# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.3.0] — 2026-04-16

### Added

- **Public library API** — `preflight-ci` is now importable as a package (`import { getAllChecks, loadWorkflows, diagnoseToString, ... } from 'preflight-ci'`). New `src/lib.ts` re-exports the parser, checks, GitHub client, diagnose entry point, and all public types. `main`/`types` fields added to `package.json` point at `dist/lib.js` / `dist/lib.d.ts`. The CLI `bin` continues to ship alongside.
- **`diagnoseToString(opts)`** — non-streaming variant of the diagnose flow that returns the full diagnosis as a string with no stdout side effects. Enables the MCP tool and any other programmatic consumer; the existing CLI `diagnose()` remains unchanged (still streams).
- **`mcp-preflight/` sibling package** — Model Context Protocol server exposing three tools to Claude Code and other MCP clients:
  - `preflight_scan({ path?, checks?, format? })` — full repo scan, JSON or text output.
  - `preflight_check_workflow({ file, path? })` — scans the repo, filters results to a single workflow file.
  - `preflight_diagnose({ runId?, path? })` — AI failure diagnosis via `diagnoseToString()`.
  Built on `@modelcontextprotocol/sdk` 1.29 with Zod input schemas and `StdioServerTransport`. Wires into Claude Code via `claude mcp add preflight -- node path/to/mcp-preflight/dist/server.js`.

### Notes

- `mcp-preflight` depends on `preflight-ci` via `file:..` for local development. To publish independently, first publish `preflight-ci` to npm and replace with a semver range.

## [0.2.0] — 2026-04-16

### Added

- **`preflight diagnose`** — new subcommand that diagnoses the most recent failed GitHub Actions run on the current branch using Claude Sonnet 4.6.
  - Resolves the current branch via `git rev-parse --abbrev-ref HEAD` and fetches the latest `status=failure` run via `octokit.actions.listWorkflowRunsForRepo`.
  - `--run-id <id>` flag to target a specific run instead (positive-integer validated by the CLI parser).
  - Downloads logs for each failed job via `downloadJobLogsForWorkflowRun`, fetches the exact workflow YAML at the run's `head_sha` via `repos.getContent` (raw media type), truncates logs to the last 20,000 characters when oversized.
  - Streams diagnosis via `client.messages.stream()` with adaptive thinking — user sees tokens as they arrive rather than a long pause.
  - System prompt produces three labeled sections (ROOT CAUSE / DIAGNOSIS / FIX) with copy-pasteable remediation.
  - Requires `ANTHROPIC_API_KEY` env var; fails fast with a link to the console if missing.
  - Handles `Anthropic.AuthenticationError`, `Anthropic.RateLimitError`, and `Anthropic.APIError` with specific messages; verbose mode emits token-usage telemetry.
- `createOctokit(token)` — factory exported from `src/github.ts` with the log-silencing defaults, so `diagnose` and `buildRepoContext` share a single Octokit configuration.

### Dependencies

- Added `@anthropic-ai/sdk` (^0.90.0) as a production dependency.

## [0.1.0] — 2026-04-16

Initial release.

### Added

- **Core CLI** (`preflight`) with `--checks`, `--json`, `--verbose`, `--path` flags and `-V`/`-h` shortcuts. Exit codes: 0 clean, 1 errors found, 2 tool error.
- **Workflow parser** that loads `.github/workflows/*.{yml,yaml}` and extracts secret refs, variable refs, environment refs, action refs, and every `${{ }}` expression (with line numbers). Malformed YAML surfaces as `parseError` rather than throwing.
- **Nine checks**, each with actionable `Fix:` remediation:
  - `syntax` — YAML parse errors, missing required keys, per-job structural checks.
  - `secrets` — undefined `${{ secrets.X }}` refs with Levenshtein typo suggestions.
  - `variables` — undefined `${{ vars.X }}` refs with Levenshtein typo suggestions.
  - `environments` — undefined environments (error) and case mismatches (warning).
  - `actions` — deprecated versions, branch-pin supply-chain risk, `owner/repo@ref` existence via GitHub API (cached per ref).
  - `expressions` — empty / unbalanced / unknown functions and contexts with typo map.
  - `permissions` — invalid scopes/values, `write-all` warning, scope-mismatch for `actions/checkout` and `actions/github-script`.
  - `runners` — deprecated runner images (`ubuntu-18.04`, `macos-10.15`, `windows-2019`, …) with replacement suggestions.
  - `jobs` — circular `needs:`, missing refs with typo suggestions, empty jobs, `continue-on-error` downstream-dependency warnings.
- **Reporter** with chalk v4 coloring, per-file rule separators, severity icons (`✕`/`⚠`/`ℹ`), dimmed `> job/step/line` context and `> Fix:` lines, summary divider with counts and elapsed time, and a JSON mode.
- **GitHub API client** with three-stage token resolution (`gh auth token` → `GITHUB_TOKEN` → `GH_TOKEN`), parallel `Promise.allSettled` metadata fetch for secrets, variables, environments (repo + org), and `checkActionExists` with tag/branch/SHA fallbacks.
- **Git pre-push hook** via `preflight hook install` / `preflight hook uninstall`. Idempotent, worktree-aware (uses `git rev-parse --git-path hooks`), preserves existing user hooks by prepending a sentinel-wrapped block and saving a backup.
- **Test suite** — 42 tests across 17 suites using Node's built-in `node:test`, covering parser extraction, every check module, and a comprehensive multi-check fixture. No GitHub API mocking.

### Security

- Module-level banner in `src/github.ts` documenting that secret values are never read. The only API endpoints called return secret/variable/environment names — a property of the GitHub API itself.
- No telemetry, no token persistence, no outbound network traffic beyond `api.github.com` with the user's own token.
