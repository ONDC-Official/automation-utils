import { Payload } from "../models/payload-Model.js";

export const getPayloads = async (
    domain: string,
    version: string,
    flowId: string,
    actions: string[],
    count: number,
) => {
    try {
        actions = actions.map((a) => a.trim().toUpperCase());

        const payloads = await Payload.find({
            "jsonRequest.context.domain": domain.trim(),
            $or: [
                { "jsonRequest.context.core_version": version },
                { "jsonRequest.context.version": version },
            ],
            flowId,
            action: { $in: actions },
        }).lean();

        if (!payloads.length) {
            console.warn(
                `[getPayloads] No payloads found for domain=${domain} version=${version} flowId=${flowId} actions=${actions.join(",")}`,
            );
            return null;
        }

        // Group by transactionId
        const grouped: Record<string, typeof payloads> = {};
        for (const payload of payloads) {
            const txn = payload.transactionId;
            if (!txn) {
                continue;
            }
            if (!grouped[txn]) grouped[txn] = [];
            grouped[txn].push(payload);
        }

        // Keep only groups that have at least `count` payloads and include all required actions
        const validGroups = Object.values(grouped).filter((group) => {
            const txnId = group[0].transactionId;
            if (group.length < count) {
                return false;
            }
            const actionsInGroup = new Set(group.map((p) => p.action));
            const missingActions = actions.filter(
                (a) => !actionsInGroup.has(a),
            );
            if (missingActions.length) {
                return false;
            }
            return true;
        });

        const groupsToUse = validGroups.length
            ? validGroups
            : Object.values(grouped);

        if (!validGroups.length) {
            console.warn(
                `[getPayloads] No valid transaction groups found after filtering, falling back to all ${groupsToUse.length} group(s)`,
            );
        } else {
            console.log(
                `[getPayloads] Found ${validGroups.length} valid transaction group(s)`,
            );
        }

        // Return each group ordered by the actions array
        return groupsToUse.map((group) =>
            actions.map((action) => group.find((p) => p.action === action)),
        );
    } catch (err) {
        console.error(`[getPayloads] Error fetching payloads:`, err);
        throw err;
    }
};
