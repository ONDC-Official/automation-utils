// Attribute review — Excel-style table per (usecase, action) group.

const NO_DATA_SENTINEL = "<no-enough-data>";

const el = (tag, attrs = {}, children = []) => {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
        if (k === "class") node.className = v;
        else if (k === "text") node.textContent = v;
        else if (k === "html") node.innerHTML = v;
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

function formatSample(v) {
    try {
        if (typeof v === "string") return JSON.stringify(v);
        if (v === null || typeof v === "undefined") return String(v);
        if (typeof v === "object") return JSON.stringify(v);
        return String(v);
    } catch {
        return String(v);
    }
}

function renderContext(entry) {
    const ctx = entry.context_preview ?? {};
    const blocks = [];

    if (ctx.openapi_info) {
        blocks.push(
            el("div", { class: "ctx-block" }, [
                el("h4", { text: "OpenAPI" }),
                el("pre", { text: String(ctx.openapi_info) }),
            ]),
        );
    }
    if (ctx.sample_values?.length) {
        blocks.push(
            el("div", { class: "ctx-block" }, [
                el("h4", { text: `Sample values (${ctx.sample_values.length})` }),
                el("pre", {
                    text: ctx.sample_values.slice(0, 5).map(formatSample).join("\n"),
                }),
            ]),
        );
    }
    if (ctx.referenced_in?.length) {
        const refs = ctx.referenced_in.slice(0, 3);
        blocks.push(
            el("div", { class: "ctx-block" }, [
                el("h4", { text: `Referenced in (${ctx.referenced_in.length})` }),
                ...refs.map((r) =>
                    el("div", {}, [
                        el("div", {}, [
                            el("span", { class: "tag", text: r.kind ?? "?" }),
                            el("span", { class: "tag", text: r.flow ?? "?" }),
                            el("span", { class: "tag", text: r.action_id ?? "?" }),
                        ]),
                        el("pre", { text: r.snippet ?? "" }),
                    ]),
                ),
            ]),
        );
    }
    if (ctx.save_data?.length) {
        blocks.push(
            el("div", { class: "ctx-block" }, [
                el("h4", { text: "saveData" }),
                el("pre", {
                    text: ctx.save_data
                        .map((s) => `[${s.flow}] ${s.key} ← ${s.jsonpath}`)
                        .join("\n"),
                }),
            ]),
        );
    }
    if (blocks.length === 0) {
        blocks.push(el("div", { class: "dim", text: "no context gathered" }));
    }

    return el("div", { class: "context-blocks" }, blocks);
}

function renderEnumsEditor(draft) {
    const wrap = el("div", { class: "enums" });
    const list = draft.enums ?? [];

    const addRow = (initial = { code: "", description: "", reference: "" }) => {
        const row = el("div", { class: "enum-row" });
        const codeIn = el("input", { type: "text", placeholder: "code", value: initial.code ?? "" });
        const descIn = el("input", {
            type: "text",
            placeholder: "description",
            value: initial.description ?? "",
        });
        const rm = el("button", { type: "button", text: "×" });
        const sync = () => {
            const rows = wrap.querySelectorAll(".enum-row");
            const next = [];
            for (const r of rows) {
                const ins = r.querySelectorAll("input");
                const code = ins[0].value.trim();
                const desc = ins[1].value.trim();
                if (code) next.push({ code, description: desc, reference: initial.reference ?? "" });
            }
            draft.enums = next.length ? next : undefined;
        };
        codeIn.addEventListener("input", sync);
        descIn.addEventListener("input", sync);
        rm.addEventListener("click", () => {
            row.remove();
            sync();
        });
        row.append(codeIn, descIn, rm);
        return row;
    };

    for (const e of list) wrap.appendChild(addRow(e));

    const addBtn = el("button", { type: "button", text: "+ enum" });
    addBtn.addEventListener("click", () => {
        wrap.insertBefore(addRow(), addBtn);
    });
    wrap.appendChild(addBtn);
    return wrap;
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

function renderInfoCell(entry, file, ctx, infoCell) {
    infoCell.innerHTML = "";
    const d = entry.draft;
    if ((d.info ?? "").trim() === NO_DATA_SENTINEL) {
        renderSentinelInfo(entry, file, ctx, infoCell);
    } else {
        renderTextareaInfo(entry, file, ctx, infoCell);
    }
}

function renderTextareaInfo(entry, file, ctx, infoCell) {
    const d = entry.draft;
    const ta = el("textarea", { rows: "2", class: "info-area" });
    ta.value = d.info ?? "";
    ta.addEventListener("input", () => (d.info = ta.value));
    infoCell.appendChild(ta);
}

function renderSentinelInfo(entry, file, ctx, infoCell) {
    const wrap = el("div", { class: "sentinel-wrap" });
    const badge = el("div", { class: "sentinel-badge" }, [
        el("span", { class: "sentinel-dot" }),
        el("span", { text: "no evidence — describe this attribute" }),
    ]);
    const ta = el("textarea", {
        rows: "2",
        class: "sentinel-input",
        placeholder: "what does this attribute represent? plain words are fine.",
    });
    const btn = el("button", { type: "button", class: "sentinel-btn", text: "Paraphrase" });
    const status = el("span", { class: "sentinel-status dim" });

    btn.addEventListener("click", async () => {
        const userText = ta.value.trim();
        if (!userText) {
            ctx.toast("type a description first", "error");
            return;
        }
        btn.disabled = true;
        ta.disabled = true;
        status.textContent = "generating…";
        try {
            const r = await fetch("/api/paraphrase", {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({
                    path: entry.path,
                    action: file.action,
                    userText,
                }),
            });
            const body = await r.json().catch(() => ({}));
            if (!r.ok || !body.ok || typeof body.info !== "string" || !body.info.trim()) {
                throw new Error(body.error || `paraphrase failed (${r.status})`);
            }
            const newInfo = body.info.trim();
            if (newInfo === NO_DATA_SENTINEL) {
                throw new Error("LLM returned sentinel — try more detail");
            }
            entry.draft.info = newInfo;
            renderInfoCell(entry, file, ctx, infoCell);
            const tr = infoCell.closest("tr");
            if (tr) tr.classList.remove("row-needs-input");
            ctx.toast("paraphrased", "ok");
        } catch (err) {
            status.textContent = "";
            btn.disabled = false;
            ta.disabled = false;
            ctx.toast(err?.message || "paraphrase failed", "error");
        }
    });

    wrap.append(badge, ta, el("div", { class: "sentinel-actions" }, [btn, status]));
    infoCell.appendChild(wrap);
}

function renderRow(entry, file, ctx, threshold) {
    const d = entry.draft;
    const isSentinel = (d.info ?? "").trim() === NO_DATA_SENTINEL;

    const tr = el("tr", { class: "row" + (isSentinel ? " row-needs-input" : "") });
    const trDetail = el("tr", { class: "row-detail collapsed" });

    // approve checkbox
    const approveBox = el("input", { type: "checkbox", class: "approve" });
    if (entry.approved) approveBox.checked = true;
    approveBox.addEventListener("change", () => {
        entry.approved = approveBox.checked;
        ctx.updateCounter();
    });
    tr.appendChild(el("td", { class: "col-approve" }, [approveBox]));

    // path
    tr.appendChild(el("td", { class: "col-path mono" }, renderPath(entry.path)));

    // confidence pill
    const pill = ctx.makeConfidencePill(entry.confidence, threshold);
    tr.appendChild(el("td", { class: "col-conf" }, [pill]));

    // info (textarea or sentinel form)
    const infoCell = el("td", { class: "col-info" });
    renderInfoCell(entry, file, ctx, infoCell);
    tr.appendChild(infoCell);

    // usage
    const usageIn = el("input", { type: "text", class: "usage-in" });
    usageIn.value = d.usage ?? "";
    usageIn.addEventListener("input", () => (d.usage = usageIn.value));
    tr.appendChild(el("td", { class: "col-usage" }, [usageIn]));

    // owner
    const ownerSel = el("select");
    for (const o of ["BAP", "BPP", "any", "BG", "BPP/BG", "unknown"]) {
        const opt = el("option", { value: o, text: o });
        if ((d.owner ?? "") === o) opt.selected = true;
        ownerSel.appendChild(opt);
    }
    ownerSel.addEventListener("change", () => (d.owner = ownerSel.value));
    tr.appendChild(el("td", { class: "col-owner" }, [ownerSel]));

    // type
    const typeSel = el("select");
    for (const t of ["string", "enum", "number", "boolean", "object", "array", "date-time"]) {
        const opt = el("option", { value: t, text: t });
        if ((d.type ?? "") === t) opt.selected = true;
        typeSel.appendChild(opt);
    }
    typeSel.addEventListener("change", () => (d.type = typeSel.value));
    tr.appendChild(el("td", { class: "col-type" }, [typeSel]));

    // required
    const reqBox = el("input", { type: "checkbox" });
    if (d.required) reqBox.checked = true;
    reqBox.addEventListener("change", () => (d.required = reqBox.checked));
    tr.appendChild(el("td", { class: "col-req" }, [reqBox]));

    // expand button
    const expandBtn = el("button", {
        type: "button",
        class: "expand-btn",
        title: "show context + enums (e)",
        text: "⋯",
    });
    expandBtn.addEventListener("click", () => {
        const open = trDetail.classList.toggle("collapsed") === false;
        expandBtn.classList.toggle("open", open);
    });
    tr.appendChild(el("td", { class: "col-expand" }, [expandBtn]));

    // detail row
    const detailCell = el("td", { class: "row-detail-cell", colspan: "9" }, [
        el("div", { class: "row-detail-grid" }, [
            el("div", { class: "detail-block" }, [
                el("h4", { text: "context" }),
                renderContext(entry),
            ]),
            el("div", { class: "detail-block" }, [
                el("h4", { text: "enums" }),
                renderEnumsEditor(d),
            ]),
        ]),
    ]);
    trDetail.appendChild(detailCell);

    return { tr, trDetail };
}

export function renderAttributes(mount, session, ctx) {
    const threshold = session.threshold ?? 0.8;

    for (const file of session.files ?? []) {
        const group = el("section", { class: "group" });
        const header = el("div", { class: "group-header" }, [
            el("h2", {}, [
                document.createTextNode(file.usecase),
                document.createTextNode("  ·  "),
                el("span", { class: "mono", text: file.action }),
            ]),
            el("span", {
                class: "group-count",
                text: `${file.attributes?.length ?? 0} draft(s)`,
            }),
        ]);
        group.appendChild(header);

        const table = el("table", { class: "attr-table" });
        const thead = el("thead", {}, [
            el("tr", {}, [
                el("th", { class: "col-approve", text: "✓" }),
                el("th", { class: "col-path", text: "path" }),
                el("th", { class: "col-conf", text: "conf" }),
                el("th", { class: "col-info", text: "info (description)" }),
                el("th", { class: "col-usage", text: "usage" }),
                el("th", { class: "col-owner", text: "owner" }),
                el("th", { class: "col-type", text: "type" }),
                el("th", { class: "col-req", text: "req" }),
                el("th", { class: "col-expand", text: "" }),
            ]),
        ]);
        const tbody = el("tbody");
        table.append(thead, tbody);

        for (const entry of file.attributes ?? []) {
            const { tr, trDetail } = renderRow(entry, file, ctx, threshold);
            tbody.append(tr, trDetail);

            const searchBlob =
                `${file.usecase} ${file.action} ${entry.path} ${entry.draft?.info ?? ""} ${entry.draft?.usage ?? ""}`.toLowerCase();
            ctx.state.cards.push({
                el: tr,
                detailEl: trDetail,
                entry,
                file,
                matches: (q) => searchBlob.includes(q),
            });
        }

        group.appendChild(table);
        mount.appendChild(group);
    }
}
