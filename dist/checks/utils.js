"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.levenshtein = levenshtein;
exports.suggestTypo = suggestTypo;
exports.formatLocation = formatLocation;
function levenshtein(a, b) {
    if (a === b)
        return 0;
    if (!a.length)
        return b.length;
    if (!b.length)
        return a.length;
    const prev = new Array(b.length + 1);
    const curr = new Array(b.length + 1);
    for (let j = 0; j <= b.length; j++)
        prev[j] = j;
    for (let i = 1; i <= a.length; i++) {
        curr[0] = i;
        for (let j = 1; j <= b.length; j++) {
            const cost = a[i - 1] === b[j - 1] ? 0 : 1;
            curr[j] = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
        }
        for (let j = 0; j <= b.length; j++)
            prev[j] = curr[j];
    }
    return prev[b.length];
}
function suggestTypo(candidate, pool, maxDistance = 3) {
    let best;
    for (const name of pool) {
        const dist = levenshtein(candidate, name);
        if (dist === 0)
            return undefined;
        if (dist > maxDistance)
            continue;
        if (!best || dist < best.dist)
            best = { name, dist };
    }
    return best?.name;
}
function formatLocation(ctx) {
    if (ctx.job && ctx.step)
        return ` in job "${ctx.job}", step "${ctx.step}"`;
    if (ctx.job)
        return ` in job "${ctx.job}"`;
    return '';
}
//# sourceMappingURL=utils.js.map