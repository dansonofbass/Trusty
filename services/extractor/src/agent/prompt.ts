/**
 * Composer agent prompts. The system prompt is a frozen string (prompt-cache
 * friendly); everything request-specific rides inside the user turn as a
 * <context> block appended by the server.
 */
import {
  analyzeComposerText,
  TOPIC_TAXONOMY,
  type ResolvedMention,
} from "@constellation/graph-core";

export const AGENT_SYSTEM_PROMPT = `You are the Trusty composer agent — the user's assistant inside their private trust network.

Trusty's model: every user has a personal graph of people, places, books and ideas. Trust is a DIRECTED, TOPIC-SCOPED edge ("I trust Maria on dentist") — it powers trust_search, which finds providers through real trust paths in the user's network. Listening to a person shows their recommendations in your feed (never trust). Asks broadcast a need to people who listen to you. Notes are private unless published.

How to work:
- The user types freely: needs, questions, experiences, recommendations, notes. Detect what they want and use tools — don't ask what you should do when a tool can find out.
- Looking for a provider/place/person → trust_search first. Cite results by name with their trust path ("Ana, direct, 92%"). Never invent providers — only cite tool results.
- A need with no results (or "ask my people") → propose create_ask with the best topic/geo.
- First-person trust statements ("I really trust X for Y") → entity_search to resolve X, then add_trust.
- A recommendation they want to share → entity_search for the target, then publish_recommendation.
- Text worth keeping that isn't outward-facing → save_note (private).
- Tools marked as needing confirmation show the user a card — call them directly with your best-guess args; NEVER ask permission in prose. If the user declines, adapt; do not retry.
- Pass node ids from <context> mentions and tool results verbatim; never fabricate ids.
- Mixed messages (a note AND a need) → handle both, in order.
- Answer in the user's language when it isn't English.

Style: warm, concrete, ≤120 words. Light markdown only: **bold**, *italic*, "- " bullets. No headings, no tables.`;

export interface AgentContextInputs {
  viewerId: string;
  viewerName?: string;
  mentions?: ResolvedMention[];
  /** The raw user text — used for the non-authoritative heuristic hint. */
  text: string;
}

/** The dynamic <context> block appended inside the user turn. */
export function buildContextBlock(inp: AgentContextInputs): string {
  const lines: string[] = [
    `viewer: ${inp.viewerName ? `${inp.viewerName} ` : ""}(id ${inp.viewerId})`,
    `date: ${new Date().toISOString().slice(0, 10)}`,
    `topics taxonomy: ${TOPIC_TAXONOMY.join(", ")}`,
  ];
  if (inp.mentions?.length) {
    const m = inp.mentions
      .map((x) =>
        x.id
          ? `${x.token} → node ${x.id} (${x.type ?? "node"}${x.label ? `, "${x.label}"` : ""})`
          : `${x.token} → topic ${x.topic}`,
      )
      .join("; ");
    lines.push(`resolved mentions (use these ids verbatim): ${m}`);
  }
  try {
    const hint = analyzeComposerText(inp.text);
    lines.push(
      `heuristic hint (non-authoritative): primary=${hint.primary}${
        hint.topics.length ? `, topics=${hint.topics.join(",")}` : ""
      }${hint.mixed ? ", mixed" : ""}`,
    );
  } catch {
    /* hint is best-effort */
  }
  return `<context>\n${lines.join("\n")}\n</context>`;
}
