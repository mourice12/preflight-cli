# mcp-preflight

Model Context Protocol server exposing [preflight-ci](../README.md) as tools for Claude Code and other MCP clients.

Three tools:

| Tool | What it does |
| --- | --- |
| `preflight_scan` | Run all nine preflight checks on a repo. JSON or text output. |
| `preflight_check_workflow` | Same, filtered to a single workflow file. |
| `preflight_diagnose` | Fetch a failed run's logs + YAML, ask Claude Sonnet for a ROOT CAUSE / DIAGNOSIS / FIX. Requires `ANTHROPIC_API_KEY`. |

## Install

```sh
cd mcp-preflight
npm install
npm run build
```

This builds `dist/server.js` with a Node shebang. The local dev flow references the sibling `preflight-ci` package via `file:..`; once that's published to npm, update the dependency to `"preflight-ci": "^0.3.0"` and this package can be published independently.

## Wiring into Claude Code

```sh
claude mcp add preflight -- node /absolute/path/to/mcp-preflight/dist/server.js
```

Pass env vars through the same command if needed:

```sh
claude mcp add preflight \
  --env ANTHROPIC_API_KEY=sk-ant-... \
  --env GITHUB_TOKEN=ghp_... \
  -- node /absolute/path/to/mcp-preflight/dist/server.js
```

The server uses stdio transport. Claude Code spawns it as a subprocess; the server inherits cwd from Claude Code, which is normally the repo you're working in — that's why the `path` argument on every tool is optional and defaults to `process.cwd()`.

## Authentication

- **GitHub:** resolves via `gh auth token` → `GITHUB_TOKEN` → `GH_TOKEN`, the same priority chain as the CLI. `gh auth login` once and you're set.
- **Anthropic (only for `preflight_diagnose`):** `ANTHROPIC_API_KEY` must be present in the server's env. The server reads it on tool invocation; missing/invalid keys surface as tool errors, they don't crash the server.

## Tool reference

### `preflight_scan`

Arguments (all optional):

- `path` — absolute repo path. Defaults to the server's cwd.
- `checks` — array subset of `["syntax", "secrets", "variables", "environments", "actions", "expressions", "permissions", "runners", "jobs"]`. Defaults to all. Note: `actions` hits the GitHub API per unique action ref — skip it if you want a fast scan.
- `format` — `"json"` (default) or `"text"`.

Returns a `{ summary, results }` JSON blob (or a human-readable text listing when `format: "text"`). Every result includes a `fix` field with actionable remediation.

### `preflight_check_workflow`

- `file` *(required)* — absolute or repo-relative path to a `.github/workflows/*.yml` file.
- `path` — as above.

Runs the full scan, then filters results to the specified workflow. Useful when the model is focused on one file and you don't want noise from the others. Cross-file findings (like circular `needs:` cycles) don't apply to a single file and are naturally absent.

### `preflight_diagnose`

- `runId` — specific workflow run ID. Omit to target the most recent failed run on the current branch.
- `path` — as above.

Returns a plain-text diagnosis. Token cost per call is ~a few thousand input tokens (workflow YAML + last 20 KB of failed-job logs) plus up to ~4K output tokens. Log truncation keeps the prompt bounded.

## Operational notes

- The server writes protocol messages to stdout; anything else goes to stderr. Do not add `console.log`s inside tool handlers — it'll corrupt the JSON-RPC stream.
- Errors inside a tool handler become `{ isError: true, content: [...] }` responses — the server stays up.
- Tool results are plain text blocks. JSON output is pretty-printed (2-space indent) so the model can read it directly and cite specific findings.
