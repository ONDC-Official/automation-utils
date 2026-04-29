import ora from "ora";
import type { Ora } from "ora";
import chalk from "chalk";

const INDENT = "  ";
const SUB = "    ";

export class ConsoleUI {
    private spinner: Ora | null = null;
    private stepStart = 0;
    private lastSpinText = "";

    banner(title: string, meta: Record<string, string>): void {
        const bar = chalk.cyan("━".repeat(68));
        console.log("\n" + bar);
        console.log("  " + chalk.bold.cyanBright(title));
        const keyWidth =
            Math.max(...Object.keys(meta).map((k) => k.length), 4) + 1;
        for (const [k, v] of Object.entries(meta)) {
            console.log(
                "  " +
                    chalk.dim((k + ":").padEnd(keyWidth)) +
                    " " +
                    chalk.whiteBright(v),
            );
        }
        console.log(bar + "\n");
    }

    section(title: string): void {
        console.log("\n" + chalk.bold.magenta("━━ " + title + " ━━"));
    }

    beginStep(id: string, title: string, index?: number, total?: number): void {
        this.stopSpinner();
        this.stepStart = Date.now();
        const badge = chalk.bgBlue.black(` ${id} `);
        const counter =
            index !== undefined && total !== undefined
                ? chalk.dim(` (${index}/${total})`)
                : "";
        console.log("\n" + badge + " " + chalk.bold.whiteBright(title) + counter);
    }

    endStep(ok: boolean): void {
        const ms = Date.now() - this.stepStart;
        const dur = ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;
        if (ok) {
            console.log(INDENT + chalk.green("✓") + chalk.dim(` completed in ${dur}`));
        } else {
            console.log(INDENT + chalk.red("✗") + chalk.dim(` failed after ${dur}`));
        }
    }

    // ── Spinner controls ─────────────────────────────────────────────────────
    spin(text: string): void {
        this.stopSpinner();
        this.lastSpinText = text;
        this.spinner = ora({
            text,
            prefixText: INDENT,
            color: "cyan",
            spinner: "dots",
            discardStdin: false,
        }).start();
    }

    update(text: string): void {
        this.lastSpinText = text;
        if (this.spinner) this.spinner.text = text;
        else console.log(INDENT + chalk.cyan("▸") + " " + text);
    }

    /**
     * Spinner-safe permanent log line. Pauses the spinner, prints the line,
     * and restarts the spinner with its previous text. Safe to call from
     * parallel workers.
     */
    note(text: string, color: "dim" | "cyan" | "green" | "yellow" | "red" = "dim"): void {
        const pen =
            color === "cyan"
                ? chalk.cyan
                : color === "green"
                  ? chalk.green
                  : color === "yellow"
                    ? chalk.yellow
                    : color === "red"
                      ? chalk.red
                      : chalk.dim;
        const hadSpinner = Boolean(this.spinner);
        const savedText = this.lastSpinText;
        if (hadSpinner) this.stopSpinner();
        console.log(SUB + pen(text));
        if (hadSpinner && savedText) {
            this.spin(savedText);
        }
    }

    succeed(text: string): void {
        this.stopSpinner();
        console.log(INDENT + chalk.green("✓") + " " + text);
    }

    stopSpinner(): void {
        if (this.spinner) {
            this.spinner.stop();
            this.spinner = null;
        }
    }

    fail(text: string): void {
        this.stopSpinner();
        console.log(INDENT + chalk.red("✗") + " " + text);
    }

    // ── Inline sub-output ────────────────────────────────────────────────────
    info(text: string): void {
        this.stopSpinner();
        console.log(SUB + chalk.dim(text));
    }

    warn(text: string): void {
        this.stopSpinner();
        console.log(SUB + chalk.yellow("⚠") + " " + text);
    }

    stat(label: string, value: string | number): void {
        this.stopSpinner();
        console.log(
            SUB +
                chalk.dim((label + ":").padEnd(14)) +
                " " +
                chalk.cyanBright(String(value)),
        );
    }

    hint(text: string): void {
        this.stopSpinner();
        console.log(SUB + chalk.gray("▷ " + text));
    }

    path(label: string, p: string): void {
        this.stopSpinner();
        console.log(SUB + chalk.dim((label + ":").padEnd(14)) + " " + chalk.underline.white(p));
    }

    pauseForInteraction(): void {
        this.stopSpinner();
    }
}
