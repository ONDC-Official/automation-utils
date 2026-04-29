import { createServer, type IncomingMessage, type Server, type ServerResponse } from "http";
import { readFileSync, existsSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join, normalize } from "path";
import { spawn } from "child_process";
import type { ConsoleUI } from "../ui.js";
import type { ILLMProvider } from "../../knowledge-book/llm/types.js";
import type { LeafDraft } from "../attributes/types.js";
import { paraphraseUserDescription, NO_DATA_SENTINEL } from "../attributes/draft.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const STATIC_DIR = join(__dirname, "static");

const MIME: Record<string, string> = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".mjs": "application/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".svg": "image/svg+xml",
    ".ico": "image/x-icon",
};

function extOf(p: string): string {
    const i = p.lastIndexOf(".");
    return i < 0 ? "" : p.slice(i).toLowerCase();
}

function isLocalHost(host: string | undefined, port: number): boolean {
    if (!host) return false;
    return [`127.0.0.1:${port}`, `localhost:${port}`].includes(host.toLowerCase());
}

async function readBody(req: IncomingMessage): Promise<string> {
    return new Promise((resolve, reject) => {
        const chunks: Buffer[] = [];
        req.on("data", (c) => chunks.push(c as Buffer));
        req.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
        req.on("error", reject);
    });
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
    const s = JSON.stringify(body);
    res.writeHead(status, {
        "content-type": "application/json; charset=utf-8",
        "content-length": Buffer.byteLength(s),
        "cache-control": "no-store",
    });
    res.end(s);
}

function sendFile(res: ServerResponse, path: string): void {
    try {
        const buf = readFileSync(path);
        res.writeHead(200, {
            "content-type": MIME[extOf(path)] ?? "application/octet-stream",
            "content-length": buf.byteLength,
            "cache-control": "no-store",
        });
        res.end(buf);
    } catch {
        res.writeHead(404);
        res.end("not found");
    }
}

function resolveStaticPath(reqPath: string): string | null {
    const rel = reqPath.replace(/^\/static\//, "");
    const joined = normalize(join(STATIC_DIR, rel));
    if (!joined.startsWith(STATIC_DIR)) return null;
    if (!existsSync(joined)) return null;
    return joined;
}

async function listenOnPort(server: Server, preferred: number): Promise<number> {
    return new Promise((resolve, reject) => {
        const onErr = (err: NodeJS.ErrnoException): void => {
            if (err.code === "EADDRINUSE" && preferred !== 0) {
                server.removeListener("error", onErr);
                server.once("error", reject);
                server.listen(0, "127.0.0.1", () => {
                    const addr = server.address();
                    if (addr && typeof addr === "object") resolve(addr.port);
                    else reject(new Error("no address"));
                });
            } else {
                reject(err);
            }
        };
        server.once("error", onErr);
        server.listen(preferred, "127.0.0.1", () => {
            server.removeListener("error", onErr);
            const addr = server.address();
            if (addr && typeof addr === "object") resolve(addr.port);
            else reject(new Error("no address"));
        });
    });
}

function openBrowser(url: string): void {
    try {
        if (process.platform === "darwin") {
            spawn("open", [url], { stdio: "ignore", detached: true }).unref();
        } else if (process.platform === "win32") {
            spawn("cmd", ["/c", "start", "", url], { stdio: "ignore", detached: true }).unref();
        } else {
            spawn("xdg-open", [url], { stdio: "ignore", detached: true }).unref();
        }
    } catch {
        // best-effort
    }
}

type TaskStatus = "pending" | "in_flight" | "done" | "skipped" | "failed";

type InternalTask = {
    id: string;
    path: string;
    action: string;
    drafts: LeafDraft[];
    status: TaskStatus;
    info?: string;
    userText?: string;
    error?: string;
};

export type ParaphraseQueueController = {
    push(task: { path: string; action: string; drafts: LeafDraft[] }): void;
    setProgress(p: { unitsDone: number; unitsTotal: number }): void;
    setDraftingDone(): void;
    waitForFinalize(): Promise<void>;
    shutdown(): Promise<void>;
};

export function createParaphraseController(
    llm: ILLMProvider,
    ui: ConsoleUI,
): ParaphraseQueueController {
    const tasks = new Map<string, InternalTask>();
    const order: string[] = [];
    const drafting = { done: false, unitsDone: 0, unitsTotal: 0 };
    let server: Server | null = null;
    let boundPort = 0;
    let starting: Promise<void> | null = null;
    let finalizeResolve: (() => void) | null = null;
    const finalizePromise = new Promise<void>((res) => {
        finalizeResolve = res;
    });
    let nextId = 1;

    const handler = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
        try {
            const urlStr = req.url ?? "/";
            const url = new URL(urlStr, "http://127.0.0.1");
            if (!isLocalHost(req.headers.host, boundPort)) {
                res.writeHead(403);
                res.end("forbidden");
                return;
            }

            if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/index.html")) {
                sendFile(res, join(STATIC_DIR, "paraphrase.html"));
                return;
            }
            if (req.method === "GET" && url.pathname.startsWith("/static/")) {
                const p = resolveStaticPath(url.pathname);
                if (!p) {
                    res.writeHead(404);
                    res.end("not found");
                    return;
                }
                sendFile(res, p);
                return;
            }
            if (req.method === "GET" && url.pathname === "/api/queue") {
                sendJson(res, 200, {
                    drafting: { ...drafting },
                    tasks: order.map((id) => {
                        const t = tasks.get(id)!;
                        return {
                            id: t.id,
                            path: t.path,
                            action: t.action,
                            memberCount: t.drafts.length,
                            status: t.status,
                            info: t.info,
                            userText: t.userText,
                            error: t.error,
                        };
                    }),
                });
                return;
            }
            if (req.method === "POST" && url.pathname === "/api/paraphrase") {
                const body = await readBody(req);
                let parsed: { id?: string; userText?: string };
                try {
                    parsed = JSON.parse(body);
                } catch {
                    sendJson(res, 400, { ok: false, error: "invalid json" });
                    return;
                }
                const id = parsed.id ?? "";
                const userText = (parsed.userText ?? "").trim();
                const t = tasks.get(id);
                if (!t) {
                    sendJson(res, 404, { ok: false, error: "no such task" });
                    return;
                }
                if (!userText) {
                    sendJson(res, 400, { ok: false, error: "empty userText" });
                    return;
                }
                t.status = "in_flight";
                t.userText = userText;
                try {
                    const newInfo = await paraphraseUserDescription(llm, {
                        path: t.path,
                        action: t.action,
                        userText,
                    });
                    const safe = newInfo && newInfo !== NO_DATA_SENTINEL ? newInfo : userText;
                    for (const d of t.drafts) d.info = safe;
                    t.info = safe;
                    t.status = "done";
                    t.error = undefined;
                    sendJson(res, 200, { ok: true, info: safe });
                } catch (err) {
                    const msg = err instanceof Error ? err.message : String(err);
                    t.status = "failed";
                    t.error = msg;
                    sendJson(res, 500, { ok: false, error: msg });
                }
                return;
            }
            if (req.method === "POST" && url.pathname === "/api/skip") {
                const body = await readBody(req);
                let parsed: { id?: string };
                try {
                    parsed = JSON.parse(body);
                } catch {
                    sendJson(res, 400, { ok: false, error: "invalid json" });
                    return;
                }
                const t = tasks.get(parsed.id ?? "");
                if (!t) {
                    sendJson(res, 404, { ok: false, error: "no such task" });
                    return;
                }
                t.status = "skipped";
                sendJson(res, 200, { ok: true });
                return;
            }
            if (req.method === "POST" && url.pathname === "/api/finalize") {
                sendJson(res, 200, { ok: true });
                if (finalizeResolve) {
                    const r = finalizeResolve;
                    finalizeResolve = null;
                    setImmediate(() => r());
                }
                return;
            }

            res.writeHead(404);
            res.end("not found");
        } catch (err) {
            try {
                res.writeHead(500);
                res.end(err instanceof Error ? err.message : String(err));
            } catch {
                // already sent
            }
        }
    };

    const ensureServer = async (): Promise<void> => {
        if (server) return;
        if (starting) return starting;
        starting = (async () => {
            const s = createServer((req, res) => {
                void handler(req, res);
            });
            const preferred = Number(process.env["POLISH_PORT"] ?? 4747) || 4747;
            boundPort = await listenOnPort(s, preferred);
            server = s;
            const url = `http://127.0.0.1:${boundPort}`;
            ui.pauseForInteraction();
            ui.path("paraphrase url", url);
            openBrowser(url);
            ui.spin("drafting in progress · paraphrase queue open in browser");
        })();
        return starting;
    };

    return {
        push(task) {
            const id = String(nextId++);
            const t: InternalTask = {
                id,
                path: task.path,
                action: task.action,
                drafts: task.drafts,
                status: "pending",
            };
            tasks.set(id, t);
            order.push(id);
            void ensureServer();
        },
        setProgress(p) {
            drafting.unitsDone = p.unitsDone;
            drafting.unitsTotal = p.unitsTotal;
        },
        setDraftingDone() {
            drafting.done = true;
        },
        async waitForFinalize() {
            if (!server && !starting) return; // never opened — no sentinels
            if (starting) await starting;
            await finalizePromise;
        },
        async shutdown() {
            if (!server) return;
            await new Promise<void>((res) => {
                server!.close(() => res());
            });
            server = null;
        },
    };
}
