import { readFileSync, readdirSync, existsSync, statSync, writeFileSync } from "fs";
import { resolve, join, dirname, extname, basename } from "path";
import { Command } from "commander";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import jsonPointer from "json-pointer";

export interface ParseOptions {
    input: string;
    output: string;
}

// ─── $ref resolver ───────────────────────────────────────────────────────────

/**
 * Resolve a single $ref string relative to `baseDir`.
 *
 * Supported forms:
 *   ./path/to/file.yaml            → entire parsed YAML document
 *   ./path/to/file.yaml#/key/sub   → JSON-pointer into the parsed document
 *   ./path/to/dir                  → { stem: fileContent } for all .md files in dir
 */
function resolveRef(ref: string, baseDir: string): unknown {
    const [filePart, pointer] = ref.split("#");
    const absPath = resolve(baseDir, filePart);

    if (!existsSync(absPath)) {
        throw new Error(`$ref target not found: ${absPath}`);
    }

    // Directory → collect markdown files as { stem: string }
    if (statSync(absPath).isDirectory()) {
        const files = readdirSync(absPath).filter((f) => extname(f) === ".md");
        const result: Record<string, string> = {};
        for (const f of files) {
            const stem = basename(f, ".md");
            result[stem] = readFileSync(join(absPath, f), "utf-8");
        }
        return result;
    }

    // File — parse YAML
    const raw = readFileSync(absPath, "utf-8");
    const doc = parseYaml(raw) as unknown;

    if (!pointer) return doc;

    // JSON Pointer (RFC 6901): #/key/sub/…
    try {
        return jsonPointer.get(doc as object, pointer);
    } catch {
        throw new Error(`$ref "${ref}": JSON pointer "${pointer}" not found in ${absPath}`);
    }
}

/**
 * Walk any parsed YAML value and recursively resolve $ref entries.
 * Handles:
 *   - Objects with a single `$ref` key → replaced by the resolved value
 *   - Arrays whose items are `{ $ref }` objects → resolved and flattened inline
 *   - Plain objects → each value is walked
 *   - Primitives → returned as-is
 */
function resolveRefs(value: unknown, baseDir: string): unknown {
    if (value === null || typeof value !== "object") return value;

    // Array — each item that is a pure $ref gets resolved; others are walked
    if (Array.isArray(value)) {
        const out: unknown[] = [];
        for (const item of value) {
            if (isRefObject(item)) {
                const resolved = resolveRef(item.$ref, baseDir);
                // If the resolved value is itself an array, flatten it in
                if (Array.isArray(resolved)) {
                    out.push(...resolved);
                } else {
                    out.push(
                        resolveRefs(resolved, dirname(resolve(baseDir, item.$ref.split("#")[0]))),
                    );
                }
            } else {
                out.push(resolveRefs(item, baseDir));
            }
        }
        return out;
    }

    // Object with only a $ref key → resolve and recurse from new baseDir
    const obj = value as Record<string, unknown>;
    if (isRefObject(obj)) {
        const [filePart] = obj.$ref.split("#");
        const refBaseDir = statSync(resolve(baseDir, filePart)).isDirectory()
            ? resolve(baseDir, filePart)
            : dirname(resolve(baseDir, filePart));
        const resolved = resolveRef(obj.$ref, baseDir);
        return resolveRefs(resolved, refBaseDir);
    }

    // Plain object — walk all values
    const OPENAPI_PASSTHROUGH_KEYS = new Set(["paths", "components"]);
    const result: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj)) {
        if (isRefObject(v)) {
            const resolved = resolveRef((v as RefObject).$ref, baseDir);
            // For OpenAPI sections that carry their own $refs, load the file but
            // do not recurse — preserve nested $refs as-is.
            if (OPENAPI_PASSTHROUGH_KEYS.has(k)) {
                result[k] = resolved;
            } else {
                const [filePart] = (v as RefObject).$ref.split("#");
                const targetAbs = resolve(baseDir, filePart);
                const refBaseDir =
                    existsSync(targetAbs) && statSync(targetAbs).isDirectory()
                        ? targetAbs
                        : dirname(targetAbs);
                result[k] = resolveRefs(resolved, refBaseDir);
            }
        } else {
            result[k] = resolveRefs(v, baseDir);
        }
    }
    return result;
}

type RefObject = { $ref: string };
function isRefObject(v: unknown): v is RefObject {
    return (
        v !== null &&
        typeof v === "object" &&
        !Array.isArray(v) &&
        "$ref" in (v as object) &&
        Object.keys(v as object).length === 1
    );
}

// ─── Command ──────────────────────────────────────────────────────────────────

export function createMergeCommand(): Command {
    return new Command("parse")
        .description(
            "Resolve a formatted config directory into a single merged build.yaml. " +
                "Reads index.yaml and recursively inlines all $ref links.",
        )
        .requiredOption(
            "-i, --input <path>",
            "Path to the config directory (containing index.yaml)",
        )
        .requiredOption("-o, --output <path>", "Output path for the merged build.yaml")
        .action((opts: ParseOptions) => {
            const configDir = resolve(opts.input);
            const indexPath = join(configDir, "index.yaml");

            if (!existsSync(indexPath)) {
                console.error(`\n  error: index.yaml not found in: ${configDir}\n`);
                process.exit(1);
            }

            let raw: string;
            try {
                raw = readFileSync(indexPath, "utf-8");
            } catch {
                console.error(`\n  error: cannot read ${indexPath}\n`);
                process.exit(1);
            }

            let doc: unknown;
            try {
                doc = parseYaml(raw);
            } catch (err) {
                const msg = err instanceof Error ? err.message : String(err);
                console.error(`\n  error: YAML parse failed: ${msg}\n`);
                process.exit(1);
            }

            let merged: unknown;
            try {
                merged = resolveRefs(doc, configDir);
            } catch (err) {
                const msg = err instanceof Error ? err.message : String(err);
                console.error(`\n  error: $ref resolution failed: ${msg}\n`);
                process.exit(1);
            }

            const outPath = resolve(opts.output);
            try {
                writeFileSync(outPath, stringifyYaml(merged, { lineWidth: 0 }), "utf-8");
            } catch {
                console.error(`\n  error: cannot write output: ${outPath}\n`);
                process.exit(1);
            }

            console.log(`\n  ✓ Merged config written to: ${outPath}\n`);
        });
}
