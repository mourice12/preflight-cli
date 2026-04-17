"use strict";
// Public library API — entry point for programmatic consumers (VS Code extension,
// MCP server, other tooling). The CLI continues to use the individual modules
// directly; external code should import from here instead of dist/internals.
Object.defineProperty(exports, "__esModule", { value: true });
exports.diagnoseToString = exports.checkActionExists = exports.parseGitHubRemote = exports.getRepoInfo = exports.getGhToken = exports.buildRepoContext = exports.createOctokit = exports.jobsCheck = exports.runnersCheck = exports.permissionsCheck = exports.expressionsCheck = exports.makeActionsCheck = exports.environmentsCheck = exports.variablesCheck = exports.secretsCheck = exports.syntaxCheck = exports.CHECK_NAMES = exports.getAllChecks = exports.extractExpressions = exports.extractActionRefs = exports.extractEnvironmentRefs = exports.extractVariableRefs = exports.extractSecretRefs = exports.findRepoRoot = exports.loadWorkflows = void 0;
var parser_1 = require("./parser");
Object.defineProperty(exports, "loadWorkflows", { enumerable: true, get: function () { return parser_1.loadWorkflows; } });
Object.defineProperty(exports, "findRepoRoot", { enumerable: true, get: function () { return parser_1.findRepoRoot; } });
Object.defineProperty(exports, "extractSecretRefs", { enumerable: true, get: function () { return parser_1.extractSecretRefs; } });
Object.defineProperty(exports, "extractVariableRefs", { enumerable: true, get: function () { return parser_1.extractVariableRefs; } });
Object.defineProperty(exports, "extractEnvironmentRefs", { enumerable: true, get: function () { return parser_1.extractEnvironmentRefs; } });
Object.defineProperty(exports, "extractActionRefs", { enumerable: true, get: function () { return parser_1.extractActionRefs; } });
Object.defineProperty(exports, "extractExpressions", { enumerable: true, get: function () { return parser_1.extractExpressions; } });
var checks_1 = require("./checks");
Object.defineProperty(exports, "getAllChecks", { enumerable: true, get: function () { return checks_1.getAllChecks; } });
Object.defineProperty(exports, "CHECK_NAMES", { enumerable: true, get: function () { return checks_1.CHECK_NAMES; } });
Object.defineProperty(exports, "syntaxCheck", { enumerable: true, get: function () { return checks_1.syntaxCheck; } });
Object.defineProperty(exports, "secretsCheck", { enumerable: true, get: function () { return checks_1.secretsCheck; } });
Object.defineProperty(exports, "variablesCheck", { enumerable: true, get: function () { return checks_1.variablesCheck; } });
Object.defineProperty(exports, "environmentsCheck", { enumerable: true, get: function () { return checks_1.environmentsCheck; } });
Object.defineProperty(exports, "makeActionsCheck", { enumerable: true, get: function () { return checks_1.makeActionsCheck; } });
Object.defineProperty(exports, "expressionsCheck", { enumerable: true, get: function () { return checks_1.expressionsCheck; } });
Object.defineProperty(exports, "permissionsCheck", { enumerable: true, get: function () { return checks_1.permissionsCheck; } });
Object.defineProperty(exports, "runnersCheck", { enumerable: true, get: function () { return checks_1.runnersCheck; } });
Object.defineProperty(exports, "jobsCheck", { enumerable: true, get: function () { return checks_1.jobsCheck; } });
var github_1 = require("./github");
Object.defineProperty(exports, "createOctokit", { enumerable: true, get: function () { return github_1.createOctokit; } });
Object.defineProperty(exports, "buildRepoContext", { enumerable: true, get: function () { return github_1.buildRepoContext; } });
Object.defineProperty(exports, "getGhToken", { enumerable: true, get: function () { return github_1.getGhToken; } });
Object.defineProperty(exports, "getRepoInfo", { enumerable: true, get: function () { return github_1.getRepoInfo; } });
Object.defineProperty(exports, "parseGitHubRemote", { enumerable: true, get: function () { return github_1.parseGitHubRemote; } });
Object.defineProperty(exports, "checkActionExists", { enumerable: true, get: function () { return github_1.checkActionExists; } });
var diagnose_1 = require("./diagnose");
Object.defineProperty(exports, "diagnoseToString", { enumerable: true, get: function () { return diagnose_1.diagnoseToString; } });
//# sourceMappingURL=lib.js.map