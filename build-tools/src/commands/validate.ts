import { Command } from "commander";
import { NotImplementedError } from "../errors/NotImplementedError.js";

export interface ValidateOptions {
    input: string;
    schema?: string;
}

export function createValidateCommand(): Command {
    return new Command("validate")
        .description("Validate a build YAML file against the ONDC schema")
        .requiredOption("-i, --input <path>", "Path to the build YAML file to validate")
        .option("-s, --schema <path>", "Path to a custom JSON schema file")
        .action((_opts: ValidateOptions) => {
            throw new NotImplementedError("validate");
        });
}
