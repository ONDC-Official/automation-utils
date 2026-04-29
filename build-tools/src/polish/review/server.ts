import { createServer, type IncomingMessage, type Server, type ServerResponse } from "http";
import { readFileSync, existsSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join, normalize } from "path";
import { spawn } from "child_process";
import { confirm } from "@inquirer/prompts";
import chalk from "chalk";
import type { ConsoleUI } from "../ui.js";
import type { ReviewSession } from "./types.js";
import type { ILLMProvider } from "../../knowledge-book/llm/types.js";
import { paraphraseUserDescription } from "../attributes/draft.js";

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
    const expected = [`127.0.0.1:${port}`, `localhost:${port}`];
    return expected.includes(host.toLowerCase());
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
    // strip /static/ prefix; normalize; must stay inside STATIC_DIR
    const rel = reqPath.replace(/^\/static\//, "");
    const joined = normalize(join(STATIC_DIR, rel));
    if (!joined.startsWith(STATIC_DIR)) return null;
    if (!existsSync(joined)) return null;
    return joined;
}

async function listenOnPort(server: Server, preferred: number): Promise<number> {
    return new Promise((resolve, reject) => {
        const onErr = (err: NodeJS.ErrnoException) => {
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
        // best-effort only
    }
}

export type RunReviewServerArgs = {
    kind: "attributes" | "flows";
    session: ReviewSession;
    writeBack: (session: ReviewSession) => void;
    ui: ConsoleUI;
    llm?: ILLMProvider;
};

export async function runReviewServer(args: RunReviewServerArgs): Promise<ReviewSession> {
    const { session, writeBack, ui } = args;

    let latest: ReviewSession = session;
    let boundPort = 0;
    let doneResolve: ((s: ReviewSession) => void) | null = null;
    const donePromise = new Promise<ReviewSession>((resolve) => {
        doneResolve = resolve;
    });

    const server = createServer(async (req, res) => {
        try {
            const urlStr = req.url ?? "/";
            const url = new URL(urlStr, "http://127.0.0.1");
            if (!isLocalHost(req.headers.host, boundPort)) {
                res.writeHead(403);
                res.end("forbidden");
                return;
            }

            if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/index.html")) {
                sendFile(res, join(STATIC_DIR, "index.html"));
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
            if (req.method === "GET" && url.pathname === "/api/session") {
                sendJson(res, 200, latest);
                return;
            }
            if (req.method === "POST" && url.pathname === "/api/save") {
                const body = await readBody(req);
                try {
                    const next = JSON.parse(body) as ReviewSession;
                    latest = next;
                    writeBack(latest);
                    sendJson(res, 200, { ok: true });
                } catch (err) {
                    sendJson(res, 400, {
                        ok: false,
                        error: err instanceof Error ? err.message : String(err),
                    });
                }
                return;
            }
            if (req.method === "POST" && url.pathname === "/api/paraphrase") {
                if (!args.llm) {
                    sendJson(res, 501, { ok: false, error: "llm not wired into review server" });
                    return;
                }
                const body = await readBody(req);
                try {
                    const parsed = JSON.parse(body) as {
                        path?: string;
                        action?: string;
                        userText?: string;
                    };
                    const path = parsed.path ?? "";
                    const action = parsed.action ?? "";
                    const userText = (parsed.userText ?? "").trim();
                    if (!userText) {
                        sendJson(res, 400, { ok: false, error: "empty userText" });
                        return;
                    }
                    const info = await paraphraseUserDescription(args.llm, {
                        path,
                        action,
                        userText,
                    });
                    sendJson(res, 200, { ok: true, info });
                } catch (err) {
                    sendJson(res, 500, {
                        ok: false,
                        error: err instanceof Error ? err.message : String(err),
                    });
                }
                return;
            }
            if (req.method === "POST" && url.pathname === "/api/done") {
                const body = await readBody(req);
                try {
                    const next = JSON.parse(body) as ReviewSession;
                    latest = next;
                    writeBack(latest);
                    sendJson(res, 200, { ok: true });
                    if (doneResolve) {
                        const r = doneResolve;
                        doneResolve = null;
                        // allow the response to flush before closing
                        setImmediate(() => r(latest));
                    }
                } catch (err) {
                    sendJson(res, 400, {
                        ok: false,
                        error: err instanceof Error ? err.message : String(err),
                    });
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
    });

    const preferred = Number(process.env["POLISH_PORT"] ?? 4747) || 4747;
    try {
        boundPort = await listenOnPort(server, preferred);
    } catch (err) {
        throw new Error(
            `could not bind review server: ${err instanceof Error ? err.message : String(err)}`,
        );
    }

    const url = `http://127.0.0.1:${boundPort}`;
    ui.pauseForInteraction();
    ui.path("review url", url);
    openBrowser(url);
    ui.spin(`reviewing ${args.kind} in browser — press Done in the UI when finished`);

    // Wait for either /api/done or user to bail via Ctrl+C.
    // Provide a best-effort escape hatch: if user presses Enter in terminal
    // we prompt them for resume/abort. We don't auto-detect browser close.
    const finalized = await donePromise;
    ui.stopSpinner();

    await new Promise<void>((resolve) => {
        server.close(() => resolve());
    });

    return finalized;
}

export async function confirmBrowserFallback(): Promise<"resume" | "abort"> {
    const ok = await confirm({
        message: chalk.yellow("Review aborted — resume with last saved state? (n to abort)"),
        default: true,
    });
    return ok ? "resume" : "abort";
}
