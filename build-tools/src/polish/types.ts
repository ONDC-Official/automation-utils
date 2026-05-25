import type { BuildConfig } from "../types/build-type.js";
import type { ILLMProvider } from "../knowledge-book/llm/types.js";
import type { ConsoleUI } from "./ui.js";
import type { PdfIndex } from "./context-pdfs/types.js";

export type PolishContext = {
    inputDir: string;
    outputDir: string;
    config: BuildConfig;
    llm: ILLMProvider;
    ui: ConsoleUI;
    state: Record<string, unknown>;
    /** Paths to user-supplied context PDFs (--context-pdf). Empty when unset. */
    contextPdfPaths: string[];
    /** Populated by the context-pdfs-load step; undefined when no PDFs given. */
    pdfIndex?: PdfIndex;
    /** Usecase IDs to skip entirely (--skip-usecase). Empty when unset. */
    skipUsecases: Set<string>;
};

export type PolishStep = {
    id: string;
    title: string;
    run(ctx: PolishContext): Promise<void>;
};
