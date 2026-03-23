import { readFileSync, writeFileSync } from "fs";
import { parse, stringify } from "yaml";
import { attributeConverter } from "./services/attributeConverted.js";
import { loadKnowledgeLookup } from "./services/knowledgebase.js";
import type { OldBuildType } from "./types/old-build.js";
import type { NewAttributes, NewBuildType } from "./types/new-build.js";

const KB_PATH = "knowledgebase.json";

// ─── Pipeline stages ────────────────────────────────────────────────────────

function read(filePath: string): string {
    return readFileSync(filePath, "utf-8");
}

function parseYaml(raw: string): OldBuildType {
    return parse(raw) as OldBuildType;
}

function transform(doc: OldBuildType): NewBuildType {
    const xAttributes = doc["x-attributes"];
    const xTags = doc["x-tags"] ?? {};
    const xEnums = doc["x-enum"] ?? {};
    const kbLookup = loadKnowledgeLookup(KB_PATH);

    const newXAttributes: NewAttributes[] | undefined = xAttributes
        ? Object.keys(xAttributes).map((useCaseId) =>
              attributeConverter(
                  xAttributes,
                  xTags,
                  xEnums,
                  useCaseId,
                  kbLookup,
              ),
          )
        : undefined;

    return {
        openapi: doc.openapi,
        info: doc.info,
        ...(doc.security !== undefined && { security: doc.security }),
        ...(doc.paths !== undefined && { paths: doc.paths }),
        ...(doc.components !== undefined && { components: doc.components }),
        ...(newXAttributes !== undefined && { "x-attributes": newXAttributes }),
        ...(doc["x-validations"] !== undefined && {
            "x-validations": doc["x-validations"],
        }),
        ...(doc["x-errorcodes"] !== undefined && {
            "x-errorcodes": doc["x-errorcodes"],
        }),
    };
}

function serializeYaml(doc: NewBuildType): string {
    return stringify(doc, {
        lineWidth: 0,
        defaultKeyType: "PLAIN",
        defaultStringType: "PLAIN",
    });
}

function write(filePath: string, content: string): void {
    writeFileSync(filePath, content, "utf-8");
}

// ─── Pipeline ───────────────────────────────────────────────────────────────

export function convert(inputPath: string, outputPath: string): void {
    console.log(`Reading:    ${inputPath}`);
    const raw = read(inputPath);

    console.log("Parsing...");
    const doc = parseYaml(raw);

    console.log("Transforming...");
    const transformed = transform(doc);

    console.log("Serializing...");
    const output = serializeYaml(transformed);

    console.log(`Writing:    ${outputPath}`);
    write(outputPath, output);

    console.log("Done.");
}
