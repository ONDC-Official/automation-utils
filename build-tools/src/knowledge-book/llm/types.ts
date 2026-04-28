export type LLMMessage = {
    role: "user" | "assistant";
    content: string;
};

export type AnthropicProviderConfig = {
    provider: "anthropic";
    model: string;
    apiKey: string;
};

export type OpenAICompatProviderConfig = {
    provider: "openai-compat";
    model: string;
    apiKey?: string;
    /** Base URL of any OpenAI-compatible endpoint.
     *  Examples:
     *    Ollama Cloud  — https://api.ollama.com/v1
     *    Local Ollama  — http://localhost:11434/v1
     *    Together AI   — https://api.together.xyz/v1
     *    Groq          — https://api.groq.com/openai/v1
     */
    baseUrl: string;
};

export type LLMProviderConfig = AnthropicProviderConfig | OpenAICompatProviderConfig;

export interface ILLMProvider {
    /** Send a minimal request to verify connectivity and auth before running the pipeline. */
    ping(): Promise<void>;
    complete(messages: LLMMessage[]): Promise<string>;
}
