import { Command } from "commander";

export function createGenChangeLogsCommand(): Command {
    return new Command("gen-change-logs")
        .description("Generate change logs for a build artifact")
        .requiredOption(
            "-i, --input <path>",
            "Path to the source build YAML file",
        )
        .requiredOption(
            "-o, --output <path>",
            "Output path for the generated change logs",
        )
        .action((_opts: { input: string; output: string }) => {
            console.log(
                "Generating change logs is not yet implemented. Please check back later.",
            );
        });
}
