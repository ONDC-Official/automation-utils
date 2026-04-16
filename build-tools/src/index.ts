#!/usr/bin/env node
import { Command } from "commander";
import { createMergeCommand } from "./commands/merge.js";
import { createValidateCommand } from "./commands/validate.js";
import { createMakeOnixCommand } from "./commands/make-onix.js";
import { NotImplementedError } from "./errors/NotImplementedError.js";
import { createGenChangeLogsCommand } from "./commands/gen-change-logs.js";
import { createGenRagTableCommand } from "./commands/gen-rag-table.js";
import { createPushToDbCommand } from "./commands/push-to-db.js";
import { createMdCommand } from "./commands/gen-markdowns.js";
const program = new Command();

program.name("ondc-tools").description("ONDC build toolchain CLI").version("1.0.0");

program.addCommand(createMergeCommand());
program.addCommand(createValidateCommand());
program.addCommand(createMakeOnixCommand());
program.addCommand(createGenChangeLogsCommand());
program.addCommand(createGenRagTableCommand());
program.addCommand(createPushToDbCommand());
program.addCommand(createMdCommand());

program.parseAsync(process.argv).catch((error: unknown) => {
    if (error instanceof NotImplementedError) {
        console.error(`\n  error: ${error.message}\n`);
        process.exit(1);
    }

    if (error instanceof Error) {
        console.error(`\n  error: ${error.message}\n`);
    } else {
        console.error("\n  unexpected error:", error, "\n");
    }

    process.exit(1);
});
