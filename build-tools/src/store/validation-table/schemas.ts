/**
 * Stored document types for the `build_validation_table` collection.
 *
 * Each document stores the raw validation table for a specific (domain, version)
 * build. The raw table is a map from action name → action table data.
 */

// ─── Raw table row ────────────────────────────────────────────────────────────

export interface ValidationTableRow {
    rowType: "group" | "leaf";
    name: string;
    group: string;
    scope: string;
    description: string;
    skipIf: string;
    errorCode: string;
    successCode: string;
}

// ─── Raw table action ─────────────────────────────────────────────────────────

export interface ValidationTableAction {
    action: string;
    codeName: string;
    numLeafTests: number;
    generated: string;
    rows: ValidationTableRow[];
}

// ─── Stored document ─────────────────────────────────────────────────────────

/**
 * One document per `(domain, version)` pair stored in `build_validation_table`.
 * The `table` field is the raw_table.json content keyed by action name.
 */
export interface StoredValidationTable {
    domain: string;
    version: string;
    /** Raw table keyed by action name (e.g. "search", "select", …). */
    table: Record<string, ValidationTableAction>;
    ingestedAt: Date;
}
