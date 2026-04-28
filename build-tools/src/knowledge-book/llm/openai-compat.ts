import OpenAI from "openai";
import type { ILLMProvider, LLMMessage, OpenAICompatProviderConfig } from "./types.js";

export class OpenAICompatProvider implements ILLMProvider {
    private readonly client: OpenAI;
    private readonly model: string;

    constructor(config: OpenAICompatProviderConfig) {
        this.client = new OpenAI({
            apiKey: config.apiKey ?? "no-key",
            baseURL: config.baseUrl,
        });
        this.model = config.model;
    }

    async ping(): Promise<void> {
        // Use raw fetch so SDK middleware cannot interfere with auth debugging
        const url = `${this.client.baseURL.replace(/\/$/, "")}/chat/completions`;
        const res = await fetch(url, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${this.client.apiKey}`,
            },
            body: JSON.stringify({
                model: this.model,
                messages: [{ role: "user", content: "ping" }],
                max_tokens: 1,
            }),
        });
        if (!res.ok) {
            const body = await res.text().catch(() => "");
            const err = new Error(`${res.status} ${res.statusText}`) as Error &
                Record<string, unknown>;
            err["status"] = res.status;
            err["body"] = body;
            throw err;
        }
    }

    async complete(messages: LLMMessage[]): Promise<string> {
        const response = await this.client.chat.completions.create({
            model: this.model,
            messages: messages.map((m) => ({
                role: m.role,
                content: m.content,
            })),
        });

        const choice = response.choices[0];
        if (!choice?.message.content) {
            throw new Error("OllamaProvider: unexpected response — no content returned");
        }
        return choice.message.content;
    }
}
