import type { ILLMProvider, LLMProviderConfig } from "./types.js";
import { AnthropicProvider } from "./anthropic.js";
import { OpenAICompatProvider } from "./openai-compat.js";
import { ClaudeCodeProvider } from "./claude-code.js";

export function createLLMProvider(config: LLMProviderConfig): ILLMProvider {
    switch (config.provider) {
        case "anthropic":
            return new AnthropicProvider(config);
        case "openai-compat":
            return new OpenAICompatProvider(config);
        case "claude-code":
            return new ClaudeCodeProvider(config);
        default: {
            const _exhaustive: never = config;
            throw new Error(
                `Unknown LLM provider: ${String((_exhaustive as LLMProviderConfig).provider)}`,
            );
        }
    }
}
