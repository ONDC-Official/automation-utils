import Anthropic from "@anthropic-ai/sdk";
import type { ILLMProvider, LLMMessage, LLMProviderConfig } from "./types.js";

export class AnthropicProvider implements ILLMProvider {
    private readonly client: Anthropic;
    private readonly model: string;

    constructor(config: LLMProviderConfig) {
        this.client = new Anthropic({ apiKey: config.apiKey });
        this.model = config.model;
    }

    async ping(): Promise<void> {
        await this.client.messages.create({
            model: this.model,
            max_tokens: 1,
            messages: [{ role: "user", content: "ping" }],
        });
    }

    async complete(messages: LLMMessage[]): Promise<string> {
        const response = await this.client.messages.create({
            model: this.model,
            max_tokens: 4096,
            messages: messages.map((m) => ({
                role: m.role,
                content: m.content,
            })),
        });

        const block = response.content[0];
        if (!block || block.type !== "text") {
            throw new Error("AnthropicProvider: unexpected response — no text block returned");
        }
        return block.text;
    }
}
