const PLACEHOLDER_DESCRIPTIONS = new Set([
    "please add relevant description",
    "add relevant description",
    "tbd",
    "--",
    "",
]);

/**
 * A description is treated as a stub if it's missing, empty, a known
 * placeholder string, or shorter than 20 non-whitespace chars. Same rule for
 * step-level and flow-level descriptions.
 */
export function isDescriptionStub(desc: string | undefined | null): boolean {
    if (!desc) return true;
    const v = desc.trim().toLowerCase();
    if (v.length < 20) return true;
    if (PLACEHOLDER_DESCRIPTIONS.has(v)) return true;
    return false;
}

export function isGoodDescription(desc: string | undefined | null): boolean {
    return !isDescriptionStub(desc);
}
