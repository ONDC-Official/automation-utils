import "dotenv/config";
import { Command } from "commander";
import { convert } from "./convert.js";
import { convertAll } from "./convert-all.js";
import { getFlows } from "./services/fetch-flows.js";
import { connectDB } from "./utils/db.js";
import { finalBuild as fetchBuilds } from "./services/fetch-build.js";
import { formatAllBuilds } from "./services/formatter.js";
import { pushAll } from "./services/push-all.js";

const program = new Command();

program
    .name("build-cleanser")
    .description("ONDC build cleanser CLI")
    .version("1.0.0");

program
    .command("convert")
    .description("Convert a build YAML file")
    .option("-i, --input <path>", "Input YAML file", "config/build.yaml")
    .option("-o, --output <path>", "Output YAML file", "config/output.yaml")
    .action(async (opts) => {
        await convert(opts.input, opts.output);
    });

program
    .command("flows")
    .description("Fetch and print available flows")
    .action(async () => {
        await connectDB();
        const flows = await getFlows();
    });

program
    .command("fetch-builds")
    .description("Generate final build YAML file")
    .action(async () => {
        await fetchBuilds();
    });

program
    .command("convert-all")
    .description("Convert all flows for all domains and versions")
    .action(async () => {
        await convertAll();
    });

program
    .command("format-all")
    .description("Format all YAML files in the config directory")
    .action(async () => {
        // Implement formatting logic here
        await formatAllBuilds();
    });

program.command("push-all").description("push all to specs").action(async () => {
    await pushAll();    
}    
)

program.parse();
