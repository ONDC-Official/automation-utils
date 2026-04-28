// Attribute review — editable fields per LeafDraft. Context collapsible.

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

    return el("details", { class: "context" }, [
        el("summary", { text: "Context (openapi / samples / references / saveData)" }),
        ...blocks,
    ]);
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
            // rebuild draft.enums from DOM order
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

function renderCurrentBox(entry) {
    // We don't carry the current AttributeLeaf on the entry, but we can show
    // the placeholder fingerprint + any context hint that tells the user
    // "this is a gap".
    const lines = [
        "(placeholder — attributes lib filled with DUMMY_LEAF / 'edit later')",
        "",
        `path: ${entry.path}`,
    ];
    return el("div", { class: "current-box", text: lines.join("\n") });
}

function renderDraftEditor(entry) {
    const d = entry.draft;
    const box = el("div", { class: "editor" });

    const infoFld = el("textarea", { rows: "3" });
    infoFld.value = d.info ?? "";
    infoFld.addEventListener("input", () => (d.info = infoFld.value));

    const usageFld = el("input", { type: "text" });
    usageFld.value = d.usage ?? "";
    usageFld.addEventListener("input", () => (d.usage = usageFld.value));

    const ownerSel = el("select");
    for (const o of ["BAP", "BPP", "any", "BG", "BPP/BG"]) {
        const opt = el("option", { value: o, text: o });
        if ((d.owner ?? "") === o) opt.selected = true;
        ownerSel.appendChild(opt);
    }
    ownerSel.addEventListener("change", () => (d.owner = ownerSel.value));

    const typeSel = el("select");
    for (const t of ["string", "enum", "number", "boolean", "object", "array", "date-time"]) {
        const opt = el("option", { value: t, text: t });
        if ((d.type ?? "") === t) opt.selected = true;
        typeSel.appendChild(opt);
    }
    typeSel.addEventListener("change", () => (d.type = typeSel.value));

    const reqBox = el("input", { type: "checkbox" });
    if (d.required) reqBox.checked = true;
    reqBox.addEventListener("change", () => (d.required = reqBox.checked));

    box.append(
        el("div", { class: "field" }, [el("label", { text: "info (description)" }), infoFld]),
        el("div", { class: "field" }, [el("label", { text: "usage" }), usageFld]),
        el("div", { class: "field-row" }, [
            el("div", { class: "field" }, [el("label", { text: "owner" }), ownerSel]),
            el("div", { class: "field" }, [el("label", { text: "type" }), typeSel]),
            el(
                "div",
                { class: "field checkbox-field" },
                [reqBox, el("label", { text: "required" })],
            ),
        ]),
        el("div", { class: "field" }, [el("label", { text: "enums" }), renderEnumsEditor(d)]),
    );
    return box;
}

function renderPath(path) {
    // Show path with leading segment accented.
    const parts = path.split(".");
    const nodes = [];
    parts.forEach((p, i) => {
        if (i === 0) nodes.push(el("span", { class: "seg-root", text: p }));
        else nodes.push(el("span", { text: "." + p }));
    });
    return nodes;
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

        for (const entry of file.attributes ?? []) {
            const card = el("article", { class: "card" });

            const approveBox = el("input", { type: "checkbox", class: "approve" });
            if (entry.approved) approveBox.checked = true;
            approveBox.addEventListener("change", () => {
                entry.approved = approveBox.checked;
                ctx.updateCounter();
            });

            const pill = ctx.makeConfidencePill(entry.confidence, threshold);

            const header = el("div", { class: "card-header" }, [
                el("div", { class: "card-path" }, renderPath(entry.path)),
                pill,
                el("label", { class: "card-approve" }, [
                    approveBox,
                    document.createTextNode("approve"),
                ]),
            ]);

            const twocol = el("div", { class: "twocol" }, [
                el("div", { class: "col" }, [
                    el("div", { class: "col-label", text: "current (placeholder)" }),
                    renderCurrentBox(entry),
                ]),
                el("div", { class: "col" }, [
                    el("div", { class: "col-label", text: "draft (editable)" }),
                    renderDraftEditor(entry),
                ]),
            ]);

            card.append(header, twocol, renderContext(entry));
            group.appendChild(card);

            const searchBlob = `${file.usecase} ${file.action} ${entry.path} ${entry.draft?.info ?? ""} ${entry.draft?.usage ?? ""}`.toLowerCase();
            ctx.state.cards.push({
                el: card,
                entry,
                file,
                matches: (q) => searchBlob.includes(q),
            });
        }

        mount.appendChild(group);
    }
}
