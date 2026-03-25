import { Command } from "commander";
import { NotImplementedError } from "../errors/NotImplementedError.js";

export interface MakeOnixOptions {
    input: string;
    output: string;
}

export function createMakeOnixCommand(): Command {
    return new Command("make-onix")
        .description("Generate an ONIX feed from a build artifact")
        .requiredOption(
            "-i, --input <path>",
            "Path to the source build YAML file",
        )
        .requiredOption(
            "-o, --output <path>",
            "Output path for the generated ONIX file",
        )
        .action((_opts: MakeOnixOptions) => {
            throw new NotImplementedError("make-onix");
        });
}
