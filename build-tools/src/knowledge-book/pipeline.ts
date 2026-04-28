import type { KnowledgeProcessor } from "./types.js";
import { domainOverviewProcessor } from "./processors/domain-overview.js";
import { flowsSummaryProcessor } from "./processors/flows-summary.js";
import { reconstructAttributesDumpProcessor } from "./processors/reconstruct-attributes-dump.js";

/**
 * Ordered list of knowledge processors.
 *
 * To add a new processor:
 *   1. Create src/knowledge-book/processors/<name>.ts
 *   2. Export a KnowledgeProcessor const from it
 *   3. Import it here and append to this array
 *
 * Each processor receives bookSoFar — the accumulated sections from all
 * preceding processors. Use ctx.bookSoFar to cross-reference earlier content.
 */
export const KNOWLEDGE_PIPELINE: KnowledgeProcessor[] = [
    reconstructAttributesDumpProcessor,
    // domainOverviewProcessor,
    // flowsSummaryProcessor,
    // errorcodesSummaryProcessor,
    // attributesGuideProcessor,
    // actionsReferenceProcessor,
    // integrationGuideProcessor,
];
