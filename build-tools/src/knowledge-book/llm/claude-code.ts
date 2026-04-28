import { query } from "@anthropic-ai/claude-agent-sdk";
import type {
    ClaudeCodeProviderConfig,
    ILLMProvider,
    LLMMessage,
} from "./types.js";

export class ClaudeCodeProvider implements ILLMProvider {
    private readonly model: string;

    constructor(config: ClaudeCodeProviderConfig) {
        this.model = config.model;
        if (config.apiKey) {
            process.env["ANTHROPIC_API_KEY"] = config.apiKey;
        }
    }

    async ping(): Promise<void> {
        await this.complete([{ role: "user", content: "ping" }]);
    }

    async complete(messages: LLMMessage[]): Promise<string> {
        const prompt = serializePrompt(messages);

        const q = query({
            prompt,
            options: {
                model: this.model,
                tools: [],
                systemPrompt: "",
                maxTurns: 1,
                persistSession: false,
                includePartialMessages: false,
            },
        });

        let assistantError: string | undefined;
        try {
            for await (const msg of q) {
                if (msg.type === "assistant" && msg.error) {
                    assistantError = msg.error;
                }
                if (msg.type === "result") {
                    if (msg.subtype === "success") {
                        return msg.result;
                    }
                    const detail = msg.errors?.join("; ") || msg.subtype;
                    throw new Error(
                        `ClaudeCodeProvider: ${msg.subtype}${detail ? ` — ${detail}` : ""}`,
                    );
                }
            }
        } catch (err) {
            if (assistantError) {
                throw new Error(
                    `ClaudeCodeProvider: ${assistantError} — ${err instanceof Error ? err.message : String(err)}`,
                );
            }
            throw err;
        }

        throw new Error(
            `ClaudeCodeProvider: stream ended without result message${assistantError ? ` (last error: ${assistantError})` : ""}`,
        );
    }
}

function serializePrompt(messages: LLMMessage[]): string {
    if (messages.length === 1 && messages[0]!.role === "user") {
        return messages[0]!.content;
    }
    return messages
        .map((m) => `[${m.role.toUpperCase()}]\n${m.content}`)
        .join("\n\n");
}
