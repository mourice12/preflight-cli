export declare function levenshtein(a: string, b: string): number;
export declare function suggestTypo(candidate: string, pool: Iterable<string>, maxDistance?: number): string | undefined;
export declare function formatLocation(ctx: {
    job?: string;
    step?: string;
}): string;
