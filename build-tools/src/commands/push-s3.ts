import { Command } from "commander";
import { NotImplementedError } from "../errors/NotImplementedError.js";

export interface PushS3Options {
    input: string;
    bucket: string;
    key: string;
    region?: string;
}

export function createPushS3Command(): Command {
    return new Command("push-s3")
        .description("Push a build artifact to an Amazon S3 bucket")
        .requiredOption("-i, --input <path>", "Path to the file to upload")
        .requiredOption("-b, --bucket <name>", "Target S3 bucket name")
        .requiredOption("-k, --key <key>", "S3 object key (destination path)")
        .option("-r, --region <region>", "AWS region", "ap-south-1")
        .action((_opts: PushS3Options) => {
            throw new NotImplementedError("push-s3");
        });
}
