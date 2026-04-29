// Paraphrase queue UI — polls /api/queue, lets user describe sentinel attributes
// in parallel with drafting. Closes when drafting is done and all items are
// resolved (or user clicks Continue).
//
// IMPORTANT: rendering uses a diff/upsert strategy — existing cards are
// reused across polls so a focused textarea is never destroyed by a refresh.

const $ = (sel) => document.querySelector(sel);

const state = {
    snapshot: { drafting: { done: false, unitsDone: 0, unitsTotal: 0 }, tasks: [] },
    cards: new Map(), // id -> { card, badge, ta, btn, skipBtn, statusEl, inputBlock, infoOut }
};

const el = (tag, attrs = {}, children = []) => {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
        if (k === "class") node.className = v;
        else if (k === "text") node.textContent = v;
        else if (k.startsWith("on")) node.addEventListener(k.slice(2), v);
        else if (v === false || v == null) continue;
        else if (v === true) node.setAttribute(k, "");
        else node.setAttribute(k, v);
    }
    for (const c of [].concat(children)) {
        if (c == null) continue;
        node.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
    }
    return node;
};

function toast(msg, kind = "") {
    const t = $("#toast");
    t.textContent = msg;
    t.className = `show ${kind}`;
    setTimeout(() => {
        t.className = "";
    }, 2200);
}

function renderPath(path) {
    const parts = path.split(".");
    const nodes = [];
    parts.forEach((p, i) => {
        if (i === 0) nodes.push(el("span", { class: "seg-root", text: p }));
        else nodes.push(el("span", { text: "." + p }));
    });
    return nodes;
}

async function postJson(path, body) {
    const r = await fetch(path, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
    });
    let data = {};
    try {
        data = await r.json();
    } catch {
        // ignore
    }
    return { ok: r.ok, status: r.status, data };
}

function findTask(id) {
    return (state.snapshot.tasks ?? []).find((t) => t.id === id);
}

async function submitParaphrase(id) {
    const entry = state.cards.get(id);
    if (!entry) return;
    const userText = (entry.ta.value || "").trim();
    if (!userText) {
        toast("type a description first", "error");
        return;
    }
    // optimistic in_flight (server will confirm on next poll)
    const t = findTask(id);
    if (t) t.status = "in_flight";
    updateCard(entry, t || { status: "in_flight" });
    const { ok, data } = await postJson("/api/paraphrase", { id, userText });
    if (ok && data.ok) {
        toast("paraphrased", "ok");
        if (t) {
            t.status = "done";
            t.info = data.info;
            updateCard(entry, t);
        }
    } else {
        if (t) {
            t.status = "failed";
            t.error = (data && data.error) || "paraphrase failed";
            updateCard(entry, t);
        }
        toast((data && data.error) || "paraphrase failed", "error");
    }
    updateHeader();
}

async function submitSkip(id) {
    const entry = state.cards.get(id);
    if (!entry) return;
    entry.btn.disabled = true;
    entry.skipBtn.disabled = true;
    const { ok, data } = await postJson("/api/skip", { id });
    if (ok && data.ok) {
        const t = findTask(id);
        if (t) {
            t.status = "skipped";
            updateCard(entry, t);
        }
        updateHeader();
    } else {
        entry.btn.disabled = false;
        entry.skipBtn.disabled = false;
        toast((data && data.error) || "skip failed", "error");
    }
}

function createCard(t) {
    const badge = el("span", { class: "para-tag" });
    const actionEl = el("span", { class: "para-action mono", text: t.action });
    const pathEl = el("span", { class: "para-path mono" }, renderPath(t.path));
    const membersEl = el("span", {
        class: "para-members dim",
        text: `${t.memberCount}× members`,
    });
    const header = el("div", { class: "para-card-row" }, [badge, actionEl, pathEl, membersEl]);

    const ta = el("textarea", {
        rows: "3",
        class: "para-input",
        placeholder:
            "Describe this attribute in plain words — what does it mean here, who sets it, who reads it.",
    });
    if (t.userText) ta.value = t.userText;
    ta.addEventListener("keydown", (e) => {
        if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
            e.preventDefault();
            submitParaphrase(t.id);
        }
    });

    const btn = el("button", { type: "button", class: "primary", text: "Paraphrase" });
    btn.addEventListener("click", () => submitParaphrase(t.id));
    const skipBtn = el("button", { type: "button", text: "Skip" });
    skipBtn.addEventListener("click", () => submitSkip(t.id));
    const statusEl = el("span", { class: "para-status dim" });
    const actions = el("div", { class: "para-actions" }, [btn, skipBtn, statusEl]);

    const inputBlock = el("div", { class: "para-input-block" }, [ta, actions]);
    const infoOut = el("div", { class: "para-info-out" });

    const card = el("div", { class: "para-card" }, [header, inputBlock, infoOut]);
    return { card, badge, ta, btn, skipBtn, statusEl, inputBlock, infoOut };
}

function updateCard(entry, t) {
    const { card, badge, ta, btn, skipBtn, statusEl, inputBlock, infoOut } = entry;

    // badge text/class
    if (t.status === "done") {
        badge.className = "para-tag ok";
        badge.textContent = "✓ paraphrased";
    } else if (t.status === "skipped") {
        badge.className = "para-tag warn";
        badge.textContent = "skipped";
    } else if (t.status === "failed") {
        badge.className = "para-tag bad";
        badge.textContent = "failed";
    } else if (t.status === "in_flight") {
        badge.className = "para-tag bad";
        badge.textContent = "generating…";
    } else {
        badge.className = "para-tag bad";
        badge.textContent = "needs description";
    }

    // card-level status class
    card.classList.remove("pending", "failed", "resolved", "skipped");
    if (t.status === "done") card.classList.add("resolved");
    else if (t.status === "skipped") card.classList.add("resolved", "skipped");
    else if (t.status === "failed") card.classList.add("failed");
    else card.classList.add("pending");

    // section visibility — only write style when it actually changes, so we
    // never touch display on the ancestor of a focused textarea unnecessarily.
    const isResolved = t.status === "done" || t.status === "skipped";
    const wantInputDisplay = isResolved ? "none" : "";
    if (inputBlock.style.display !== wantInputDisplay) {
        inputBlock.style.display = wantInputDisplay;
    }
    const wantInfoDisplay = t.status === "done" && t.info ? "" : "none";
    if (infoOut.style.display !== wantInfoDisplay) {
        infoOut.style.display = wantInfoDisplay;
    }
    if (t.status === "done" && t.info && infoOut.textContent !== t.info) {
        infoOut.textContent = t.info;
    }

    // disabled flags — but DON'T touch textarea contents or focus
    const inFlight = t.status === "in_flight";
    if (btn.disabled !== inFlight) btn.disabled = inFlight;
    if (skipBtn.disabled !== inFlight) skipBtn.disabled = inFlight;
    if (ta.disabled !== inFlight) ta.disabled = inFlight;

    // status text
    let nextStatus = "";
    if (t.status === "in_flight") nextStatus = "generating…";
    else if (t.status === "failed" && t.error) nextStatus = t.error;
    if (statusEl.textContent !== nextStatus) statusEl.textContent = nextStatus;
}

function renderQueue() {
    const queue = $("#queue");
    const empty = $("#empty-state");
    const tasks = state.snapshot.tasks ?? [];
    if (tasks.length === 0) {
        empty.style.display = "";
        queue.style.display = "none";
        updateHeader();
        return;
    }
    empty.style.display = "none";
    queue.style.display = "";

    // upsert (create-or-update) each card
    const seen = new Set();
    for (const t of tasks) {
        seen.add(t.id);
        let entry = state.cards.get(t.id);
        if (!entry) {
            entry = createCard(t);
            state.cards.set(t.id, entry);
            queue.appendChild(entry.card);
        }
        updateCard(entry, t);
    }

    // drop stale cards (defensive — shouldn't happen)
    for (const id of [...state.cards.keys()]) {
        if (!seen.has(id)) {
            const e = state.cards.get(id);
            e.card.remove();
            state.cards.delete(id);
        }
    }

    // reorder: pending/in_flight → failed → done → skipped.
    // Skip while a queue descendant has focus — moving an ancestor blurs the
    // focused element. Catch up on the next poll where focus has moved out.
    // When reorder runs, only move nodes that are actually out of place.
    const focusInQueue = queue.contains(document.activeElement);
    if (!focusInQueue) {
        const orderRank = (s) =>
            s === "pending" || s === "in_flight" ? 0 : s === "failed" ? 1 : s === "done" ? 2 : 3;
        const sorted = tasks
            .slice()
            .sort((a, b) => orderRank(a.status) - orderRank(b.status));
        const desired = sorted
            .map((t) => state.cards.get(t.id)?.card)
            .filter(Boolean);
        for (let i = 0; i < desired.length; i++) {
            if (queue.children[i] !== desired[i]) {
                queue.insertBefore(desired[i], queue.children[i] || null);
            }
        }
    }

    updateHeader();
}

function updateHeader() {
    const d = state.snapshot.drafting ?? {};
    const tasks = state.snapshot.tasks ?? [];
    const pending = tasks.filter((t) => t.status === "pending" || t.status === "in_flight").length;
    const done = tasks.filter((t) => t.status === "done").length;
    const skipped = tasks.filter((t) => t.status === "skipped").length;
    const failed = tasks.filter((t) => t.status === "failed").length;

    const draftPart = d.done
        ? `drafting done (${d.unitsDone}/${d.unitsTotal})`
        : `drafting ${d.unitsDone}/${d.unitsTotal}`;
    $("#drafting-status").textContent = draftPart;
    const counterParts = [];
    if (pending) counterParts.push(`${pending} pending`);
    if (done) counterParts.push(`${done} done`);
    if (skipped) counterParts.push(`${skipped} skipped`);
    if (failed) counterParts.push(`${failed} failed`);
    const next = counterParts.join(" · ") || "no tasks";
    if ($("#counter").textContent !== next) $("#counter").textContent = next;

    const continueBtn = $("#continue");
    const allResolved = pending === 0;
    const ready = d.done && allResolved;
    if (continueBtn.disabled !== !ready) continueBtn.disabled = !ready;
    const label = ready ? "Continue to review" : "Continue (waiting…)";
    if (continueBtn.textContent !== label) continueBtn.textContent = label;
}

function mergeSnapshot(next) {
    // Preserve any in-flight optimistic status the user just triggered: if a
    // local card is in_flight and the server still says pending, keep in_flight
    // until the server catches up.
    const prev = state.snapshot.tasks ?? [];
    const prevById = new Map(prev.map((t) => [t.id, t]));
    for (const t of next.tasks ?? []) {
        const old = prevById.get(t.id);
        if (old && old.status === "in_flight" && t.status === "pending") {
            t.status = "in_flight";
        }
    }
    state.snapshot = next;
}

async function poll() {
    try {
        const r = await fetch("/api/queue");
        if (!r.ok) throw new Error("queue " + r.status);
        const next = await r.json();
        mergeSnapshot(next);
        renderQueue();
    } catch {
        // server may be shutting down — ignore
    }
}

async function continueToReview() {
    const { ok, data } = await postJson("/api/finalize", {});
    if (ok && data.ok) {
        document.body.innerHTML =
            '<div style="padding:48px;text-align:center;color:#8b949e">Continuing to review… you can close this tab.</div>';
    } else {
        toast((data && data.error) || "could not finalize", "error");
    }
}

function main() {
    $("#continue").addEventListener("click", continueToReview);
    poll();
    setInterval(poll, 1500);
}

main();
