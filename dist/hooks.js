"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.findHooksDir = findHooksDir;
exports.installHook = installHook;
exports.uninstallHook = uninstallHook;
const node_child_process_1 = require("node:child_process");
const node_fs_1 = require("node:fs");
const path = __importStar(require("node:path"));
const BEGIN_MARKER = '# preflight-ci:begin';
const END_MARKER = '# preflight-ci:end';
const HOOK_BLOCK = `${BEGIN_MARKER}
# Validate GitHub Actions workflows before push. Remove with: preflight hook uninstall
npx --yes preflight-ci || exit $?
${END_MARKER}`;
const DEFAULT_HOOK = `#!/bin/sh
${HOOK_BLOCK}
`;
function escapeRegex(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
function findHooksDir(cwd = process.cwd()) {
    let raw;
    try {
        raw = (0, node_child_process_1.execSync)('git rev-parse --git-path hooks', {
            cwd,
            stdio: ['ignore', 'pipe', 'pipe'],
            encoding: 'utf8',
        }).trim();
    }
    catch (err) {
        const detail = err instanceof Error ? err.message : String(err);
        throw new Error(`Not a git repository (cwd: ${cwd}).\n` +
            `Run this from inside a git repo.\nDetail: ${detail}`);
    }
    return path.isAbsolute(raw) ? raw : path.join(cwd, raw);
}
async function installHook(cwd = process.cwd()) {
    const hooksDir = findHooksDir(cwd);
    await node_fs_1.promises.mkdir(hooksDir, { recursive: true });
    const hookPath = path.join(hooksDir, 'pre-push');
    let existing = null;
    try {
        existing = await node_fs_1.promises.readFile(hookPath, 'utf8');
    }
    catch (err) {
        if (err.code !== 'ENOENT')
            throw err;
    }
    if (existing === null) {
        await node_fs_1.promises.writeFile(hookPath, DEFAULT_HOOK, { mode: 0o755 });
        return { action: 'created', hookPath };
    }
    if (existing.includes(BEGIN_MARKER)) {
        // Ensure executable bit is set even if a previous write lost it.
        await node_fs_1.promises.chmod(hookPath, 0o755);
        return { action: 'already-installed', hookPath };
    }
    // Insert our block after the shebang line (if any) so our checks run first,
    // preserving the rest of the user's hook.
    const lines = existing.split('\n');
    const insertAt = lines.length > 0 && lines[0].startsWith('#!') ? 1 : 0;
    const newContent = [
        ...lines.slice(0, insertAt),
        HOOK_BLOCK,
        ...lines.slice(insertAt),
    ].join('\n');
    const backup = `${hookPath}.preflight-backup`;
    await node_fs_1.promises.writeFile(backup, existing, { mode: 0o755 });
    await node_fs_1.promises.writeFile(hookPath, newContent, { mode: 0o755 });
    return { action: 'appended', hookPath, backup };
}
async function uninstallHook(cwd = process.cwd()) {
    const hooksDir = findHooksDir(cwd);
    const hookPath = path.join(hooksDir, 'pre-push');
    let content;
    try {
        content = await node_fs_1.promises.readFile(hookPath, 'utf8');
    }
    catch (err) {
        if (err.code === 'ENOENT') {
            return { action: 'no-hook', hookPath };
        }
        throw err;
    }
    if (!content.includes(BEGIN_MARKER)) {
        return { action: 'not-installed', hookPath };
    }
    const blockRe = new RegExp(`\\n?${escapeRegex(BEGIN_MARKER)}[\\s\\S]*?${escapeRegex(END_MARKER)}\\n?`, 'g');
    const stripped = content.replace(blockRe, '\n').replace(/\n{3,}/g, '\n\n');
    // If only a shebang + whitespace remain, the hook is effectively empty — delete it.
    const nonShebang = stripped.replace(/^#![^\n]*\n?/, '').trim();
    if (nonShebang === '') {
        await node_fs_1.promises.unlink(hookPath);
        return { action: 'deleted', hookPath };
    }
    await node_fs_1.promises.writeFile(hookPath, stripped, { mode: 0o755 });
    return { action: 'removed', hookPath };
}
//# sourceMappingURL=hooks.js.map