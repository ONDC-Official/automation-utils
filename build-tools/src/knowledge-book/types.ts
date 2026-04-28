export type { ILLMProvider, LLMMessage, LLMProviderConfig } from "./llm/types.js";

import type { BuildConfig } from "../types/build-type.js";
import type { ILLMProvider } from "./llm/types.js";

export type KnowledgeSection = {
    id: string;
    title: string;
    markdown: string;
    metadata?: Record<string, unknown>;
};

export type KnowledgeBook = {
    config: BuildConfig;
    sections: KnowledgeSection[];
    generatedAt: string;
};

export type ProcessorContext = {
    config: BuildConfig;
    llm: ILLMProvider;
    bookSoFar: KnowledgeSection[];
    outputDir: string;
};

export type KnowledgeProcessor = {
    id: string;
    title: string;
    run(ctx: ProcessorContext): Promise<KnowledgeSection>;
};
