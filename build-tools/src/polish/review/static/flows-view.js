// Flow review — description-only. Two card kinds:
//  - "flow"  → one per x-flows entry that had a stub description
//  - "step"  → one per flow-step that had a stub description
//
// Only the `description` textarea is editable. No JS, no mock panels.

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

function renderCard(entry, threshold, ctx) {
    const card = el("article", { class: "card" });

    const approveBox = el("input", { type: "checkbox", class: "approve" });
    if (entry.approved) approveBox.checked = true;
    approveBox.addEventListener("change", () => {
        entry.approved = approveBox.checked;
        ctx.updateCounter();
    });

    const pill = ctx.makeConfidencePill(entry.confidence, threshold);

    let headerContent;
    if (entry.kind === "flow") {
        headerContent = [
            el("span", { class: "tag", text: "FLOW" }),
            el("span", { class: "seg-root", text: entry.flowId }),
            el("span", { class: "dim", text: `  ·  ${entry.usecase}` }),
            entry.tags?.length
                ? el("span", { class: "dim", text: `  ·  ${entry.tags.join(", ")}` })
                : null,
        ];
    } else {
        headerContent = [
            el("span", { class: "tag", text: "STEP" }),
            el("span", { class: "seg-root", text: entry.action }),
            el("span", { text: `  @ ${entry.stepIndex}` }),
            el("span", { class: "dim", text: `  ·  ${entry.actionId}` }),
            el("span", { class: "dim", text: `  ·  ${entry.owner}` }),
        ];
    }

    const headerRow = el("div", { class: "card-header" }, [
        el("div", { class: "card-path" }, headerContent),
        pill,
        el("label", { class: "card-approve" }, [approveBox, document.createTextNode("approve")]),
    ]);

    const descFld = el("textarea", { rows: "3" });
    descFld.value = entry.draft?.description ?? "";
    descFld.addEventListener("input", () => {
        if (!entry.draft) entry.draft = {};
        entry.draft.description = descFld.value;
    });

    const currentDesc = el("div", { class: "current-box" });
    currentDesc.textContent = entry.current?.description?.trim().length
        ? entry.current.description
        : "(stub / empty)";

    const twocol = el("div", { class: "twocol" }, [
        el("div", { class: "col" }, [
            el("div", { class: "col-label", text: "current" }),
            currentDesc,
        ]),
        el("div", { class: "col" }, [
            el("div", { class: "col-label", text: "drafted (editable)" }),
            descFld,
        ]),
    ]);

    card.append(headerRow, twocol);
    return card;
}

export function renderFlows(mount, session, ctx) {
    const threshold = session.threshold ?? 0.8;

    for (const file of session.files ?? []) {
        const group = el("section", { class: "group" });
        const header = el("div", { class: "group-header" }, [
            el("h2", {}, [
                document.createTextNode(file.flowId),
                document.createTextNode("  ·  "),
                el("span", { class: "dim", text: `${file.entries?.length ?? 0} item(s)` }),
            ]),
        ]);
        group.appendChild(header);

        for (const entry of file.entries ?? []) {
            const card = renderCard(entry, threshold, ctx);
            group.appendChild(card);

            const kindTag = entry.kind === "flow" ? "flow" : entry.action;
            const searchBlob =
                `${file.flowId} ${kindTag} ${entry.actionId ?? ""} ${entry.draft?.description ?? ""} ${entry.current?.description ?? ""}`.toLowerCase();
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
