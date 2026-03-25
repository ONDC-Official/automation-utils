import { Command } from "commander";
import { NotImplementedError } from "../errors/NotImplementedError.js";

export interface MergeOptions {
    input: string[];
    output: string;
}

export function createMergeCommand(): Command {
    return new Command("merge")
        .description("Merge multiple build YAML files into a single artifact")
        .requiredOption(
            "-i, --input <paths...>",
            "One or more input build YAML file paths",
        )
        .requiredOption("-o, --output <path>", "Output file path for the merged artifact")
        .action((_opts: MergeOptions) => {
            throw new NotImplementedError("merge");
        });
}
