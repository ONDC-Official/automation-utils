// Entry point. Fetches session, dispatches to the right view, wires global
// keyboard + toolbar handlers. All state lives in `state` (mutated in place
// by the per-view renderers). Save/Done POST the current state.

import { renderAttributes } from "/static/attributes-view.js";
import { renderFlows } from "/static/flows-view.js";

const $ = (sel) => document.querySelector(sel);

export const state = {
    session: null, // ReviewSession
    cards: [], // [{ el, entry, file, matches(text) }]
    focusedIdx: -1,
    filter: { search: "", lowOnly: false, unapprovedOnly: false },
};

function pillClass(score, threshold) {
    if (score >= threshold) return "green";
    if (score >= 0.5) return "yellow";
    return "red";
}

export function makeConfidencePill(conf, threshold) {
    const span = document.createElement("span");
    if (!conf) {
        span.className = "pill red";
        span.textContent = "no-score";
        return span;
    }
    const score = conf.score;
    span.className = `pill ${pillClass(score, threshold)}`;
    span.textContent = `conf ${score.toFixed(2)}`;
    const tip = Object.entries(conf.factors ?? {})
        .map(([k, v]) => `${k}: +${v.toFixed(2)}`)
        .join("\n");
    span.title = tip || "no factors";
    return span;
}

export function toast(msg, kind = "") {
    const el = $("#toast");
    el.textContent = msg;
    el.className = `show ${kind}`;
    setTimeout(() => {
        el.className = "";
    }, 2200);
}

function updateCounter() {
    const total = state.cards.length;
    let approved = 0;
    for (const c of state.cards) if (c.entry.approved) approved += 1;
    $("#counter").textContent = `${approved} / ${total} approved`;
}

function applyFilters() {
    const q = state.filter.search.toLowerCase();
    const threshold = state.session?.threshold ?? 0.8;
    let visible = 0;
    for (const c of state.cards) {
        const conf = c.entry.confidence;
        const score = conf?.score ?? 0;
        let show = true;
        if (state.filter.lowOnly && score >= threshold) show = false;
        if (state.filter.unapprovedOnly && c.entry.approved) show = false;
        if (q && show) show = c.matches(q);
        c.el.classList.toggle("hidden", !show);
        if (show) visible += 1;
    }
    // collapse empty groups (cards for flow view, table rows for attribute view)
    for (const g of document.querySelectorAll(".group")) {
        const anyVisible = g.querySelector(".card:not(.hidden), tr.row:not(.hidden)");
        g.classList.toggle("hidden", !anyVisible);
    }
    if (visible === 0) {
        // nothing to show — surface message
    }
}

function focusCard(idx) {
    const visible = state.cards.filter((c) => !c.el.classList.contains("hidden"));
    if (visible.length === 0) return;
    const next = ((idx % visible.length) + visible.length) % visible.length;
    state.focusedIdx = state.cards.indexOf(visible[next]);
    for (const c of state.cards) c.el.classList.remove("focused");
    const card = state.cards[state.focusedIdx];
    card.el.classList.add("focused");
    card.el.scrollIntoView({ block: "center", behavior: "smooth" });
}

function moveFocus(delta) {
    const visible = state.cards.filter((c) => !c.el.classList.contains("hidden"));
    if (visible.length === 0) return;
    const curVis = visible.indexOf(state.cards[state.focusedIdx]);
    const next = curVis < 0 ? 0 : (curVis + delta + visible.length) % visible.length;
    state.focusedIdx = state.cards.indexOf(visible[next]);
    for (const c of state.cards) c.el.classList.remove("focused");
    const card = state.cards[state.focusedIdx];
    card.el.classList.add("focused");
    card.el.scrollIntoView({ block: "center", behavior: "smooth" });
}

async function postJson(path, body) {
    const r = await fetch(path, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
    });
    return r.ok;
}

async function save() {
    const ok = await postJson("/api/save", state.session);
    toast(ok ? "saved" : "save failed", ok ? "ok" : "error");
}

async function done() {
    if (
        !confirm(
            `Submit ${state.cards.filter((c) => c.entry.approved).length} approved entries and close review?`,
        )
    )
        return;
    const ok = await postJson("/api/done", state.session);
    if (ok) {
        document.body.innerHTML =
            '<div style="padding:48px;text-align:center;color:#8b949e">Review finalized. You can close this tab.</div>';
    } else {
        toast("done failed", "error");
    }
}

function approveAllVisible() {
    const visible = state.cards.filter((c) => !c.el.classList.contains("hidden"));
    if (visible.length === 0) {
        toast("nothing visible to approve");
        return;
    }
    const pending = visible.filter((c) => !c.entry.approved);
    if (pending.length === 0) {
        toast("all visible already approved");
        return;
    }
    if (!confirm(`Approve ${pending.length} visible entries?`)) return;
    for (const c of pending) {
        c.entry.approved = true;
        const box = c.el.querySelector('input[type="checkbox"].approve');
        if (box) box.checked = true;
    }
    updateCounter();
    toast(`approved ${pending.length}`, "ok");
}

function wireToolbar() {
    $("#save").addEventListener("click", save);
    $("#done").addEventListener("click", done);
    $("#approve-all").addEventListener("click", approveAllVisible);
    $("#search").addEventListener("input", (e) => {
        state.filter.search = e.target.value;
        applyFilters();
    });
    $("#filter-low").addEventListener("change", (e) => {
        state.filter.lowOnly = e.target.checked;
        applyFilters();
    });
    $("#filter-unapproved").addEventListener("change", (e) => {
        state.filter.unapprovedOnly = e.target.checked;
        applyFilters();
    });

    document.addEventListener("keydown", (e) => {
        const target = e.target;
        const isEditable =
            target instanceof HTMLInputElement ||
            target instanceof HTMLTextAreaElement ||
            target instanceof HTMLSelectElement ||
            target?.isContentEditable;
        if ((e.ctrlKey || e.metaKey) && e.key === "s") {
            e.preventDefault();
            save();
            return;
        }
        if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
            e.preventDefault();
            done();
            return;
        }
        if (isEditable) return;
        if (e.key === "j") moveFocus(1);
        else if (e.key === "k") moveFocus(-1);
        else if (e.key === "a") {
            if (state.focusedIdx >= 0) {
                const c = state.cards[state.focusedIdx];
                const box = c.el.querySelector('input[type="checkbox"].approve');
                if (box) {
                    box.checked = !box.checked;
                    box.dispatchEvent(new Event("change", { bubbles: true }));
                }
            }
        } else if (e.key === "e") {
            if (state.focusedIdx >= 0) {
                const card = state.cards[state.focusedIdx];
                const expandBtn = card.el.querySelector(".expand-btn");
                if (expandBtn) {
                    expandBtn.click();
                } else {
                    const d = card.el.querySelector("details.context");
                    if (d) d.open = !d.open;
                }
            }
        } else if (e.key === "/") {
            e.preventDefault();
            $("#search").focus();
        }
    });
}

async function main() {
    wireToolbar();
    try {
        const r = await fetch("/api/session");
        if (!r.ok) throw new Error("session fetch " + r.status);
        const session = await r.json();
        state.session = session;

        const threshold = session.threshold ?? 0.8;
        $("#subtitle").textContent = `${session.kind} · threshold ${threshold.toFixed(2)}`;
        document.title = `Polish Review — ${session.kind}`;

        const app = $("#app");
        app.innerHTML = "";

        const ctx = { state, makeConfidencePill, toast, updateCounter, applyFilters };
        if (session.kind === "attributes") {
            renderAttributes(app, session, ctx);
        } else if (session.kind === "flows") {
            renderFlows(app, session, ctx);
        } else {
            app.textContent = `Unknown session kind: ${session.kind}`;
            return;
        }
        updateCounter();
        applyFilters();
    } catch (err) {
        $("#app").innerHTML =
            '<div class="loading" style="color:#f85149">Failed to load session: ' +
            String(err?.message ?? err) +
            "</div>";
    }
}

main();
