import type { BuildConfig } from "../types/build-type.js";
import type { ILLMProvider } from "../knowledge-book/llm/types.js";
import type { ConsoleUI } from "./ui.js";

export type PolishContext = {
    inputDir: string;
    outputDir: string;
    config: BuildConfig;
    llm: ILLMProvider;
    ui: ConsoleUI;
    state: Record<string, unknown>;
};

export type PolishStep = {
    id: string;
    title: string;
    run(ctx: PolishContext): Promise<void>;
};
