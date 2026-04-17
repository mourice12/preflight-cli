"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.jobsCheck = exports.runnersCheck = exports.permissionsCheck = exports.expressionsCheck = exports.makeActionsCheck = exports.environmentsCheck = exports.variablesCheck = exports.secretsCheck = exports.syntaxCheck = exports.CHECK_NAMES = void 0;
exports.getAllChecks = getAllChecks;
const syntax_1 = require("./syntax");
Object.defineProperty(exports, "syntaxCheck", { enumerable: true, get: function () { return syntax_1.syntaxCheck; } });
const secrets_1 = require("./secrets");
Object.defineProperty(exports, "secretsCheck", { enumerable: true, get: function () { return secrets_1.secretsCheck; } });
const variables_1 = require("./variables");
Object.defineProperty(exports, "variablesCheck", { enumerable: true, get: function () { return variables_1.variablesCheck; } });
const environments_1 = require("./environments");
Object.defineProperty(exports, "environmentsCheck", { enumerable: true, get: function () { return environments_1.environmentsCheck; } });
const actions_1 = require("./actions");
Object.defineProperty(exports, "makeActionsCheck", { enumerable: true, get: function () { return actions_1.makeActionsCheck; } });
const expressions_1 = require("./expressions");
Object.defineProperty(exports, "expressionsCheck", { enumerable: true, get: function () { return expressions_1.expressionsCheck; } });
const permissions_1 = require("./permissions");
Object.defineProperty(exports, "permissionsCheck", { enumerable: true, get: function () { return permissions_1.permissionsCheck; } });
const runners_1 = require("./runners");
Object.defineProperty(exports, "runnersCheck", { enumerable: true, get: function () { return runners_1.runnersCheck; } });
const jobs_1 = require("./jobs");
Object.defineProperty(exports, "jobsCheck", { enumerable: true, get: function () { return jobs_1.jobsCheck; } });
exports.CHECK_NAMES = [
    'syntax',
    'secrets',
    'variables',
    'environments',
    'actions',
    'expressions',
    'permissions',
    'runners',
    'jobs',
];
function getAllChecks(octokit) {
    return [
        syntax_1.syntaxCheck,
        secrets_1.secretsCheck,
        variables_1.variablesCheck,
        environments_1.environmentsCheck,
        (0, actions_1.makeActionsCheck)(octokit),
        expressions_1.expressionsCheck,
        permissions_1.permissionsCheck,
        runners_1.runnersCheck,
        jobs_1.jobsCheck,
    ];
}
//# sourceMappingURL=index.js.map