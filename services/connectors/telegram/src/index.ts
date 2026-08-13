/**
 * connector-telegram — HTTP service.
 *
 *   POST /ingest/export   multipart-free: raw JSON body {sourceId, export}
 *   POST /run/:sourceId   re-run extraction over already-ingested messages
 *   GET  /health
 *
 * The connector holds no durable state: it parses, classifies, extracts, and
 * POSTs candidates to graph-service, which owns the review queue. That keeps the
 * admin UI talking to one backend and makes this service restartable at will.
 *
 * Env: GRAPH_URL, CONNECTOR_ADMIN_SECRET, TELEGRAM_BOT_TOKEN (optional live tail),
 *      TELEGRAM_POLL_MS, LITELLM_BASE_URL (optional refinement), TELEGRAM_LLM_MAX.
 */
import express from "express";
import { classifyAll } from "./classify";
import { extractOutcomes, extractProviders, extractQa } from "./extract";
import { llmConfigured, refineOutcome, refineQa } from "./llm";
import { botIdentity, pollUpdates } from "./sources/bot";
import { parseExport } from "./sources/export";
import type { Candidate, Classified, RunReport, TgSource } from "./types";

const PORT = Number(process.env.PORT ?? 4008);
const GRAPH = process.env.GRAPH_URL ?? "http://graph-service:4001";
const SECRET = process.env.CONNECTOR_ADMIN_SECRET ?? "";
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN ?? "";
const POLL_MS = Number(process.env.TELEGRAM_POLL_MS ?? 0);
/** Cap the LLM pass per run so one big export cannot spend the month's budget. */
const LLM_MAX = Number(process.env.TELEGRAM_LLM_MAX ?? 40);

const app = express();
app.use(express.json({ limit: "64mb" })); // a year of a busy group is ~15 MB

const graph = async (method: string, path: string, body?: unknown) => {
  const r = await fetch(`${GRAPH}${path}`, {
    method,
    headers: {
      "content-type": "application/json",
      "x-user-id": "telegram-connector",
      "x-user-admin": "1",
      ...(SECRET ? { "x-admin-secret": SECRET } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`${method} ${path} → ${r.status}: ${text.slice(0, 200)}`);
  return text ? JSON.parse(text) : {};
};

/** The whole pipeline for one batch of messages. */
async function runPipeline(source: TgSource, messages: Classified[]): Promise<{
  candidates: Candidate[];
  byClass: Record<string, number>;
  warnings: string[];
}> {
  const warnings: string[] = [];
  const byClass: Record<string, number> = {};
  for (const m of messages) byClass[m.cls] = (byClass[m.cls] ?? 0) + 1;

  let qa = extractQa(messages, { circle: source.defaultCircle });
  let outcomes = extractOutcomes(messages);
  const providers = extractProviders(messages);

  if (llmConfigured()) {
    const byId = new Map(messages.map((m) => [m.id, m]));
    // Spend the budget where it changes a publish decision: the most confident
    // Q&A that still lack a hard specific are the ones worth a rewrite.
    const targets = [...qa]
      .sort((a, b) => Number(a.hasHardSpecific) - Number(b.hasHardSpecific) || b.confidence - a.confidence)
      .slice(0, LLM_MAX);
    const refined = new Map<string, (typeof qa)[number]>();
    for (const c of targets) refined.set(c.key, await refineQa(c));
    qa = qa.map((c) => refined.get(c.key) ?? c);

    const oTargets = outcomes.slice(0, Math.max(0, LLM_MAX - targets.length));
    const oRefined = new Map<string, (typeof outcomes)[number]>();
    for (const c of oTargets) {
      const src = byId.get(c.evidence[0]);
      if (src) oRefined.set(c.key, await refineOutcome(c, src.text));
    }
    outcomes = outcomes.map((c) => oRefined.get(c.key) ?? c);
  } else {
    warnings.push("LITELLM_BASE_URL not set — heuristics only, no refinement pass");
  }

  // Anything the LLM explicitly rejected is not worth an admin's attention.
  const candidates: Candidate[] = [
    ...qa.filter((c) => c.stage !== "llm-rejected"),
    ...outcomes.filter((c) => c.stage !== "llm-rejected"),
    ...providers,
  ];
  return { candidates, byClass, warnings };
}

/* ------------------------------ ingest ---------------------------------- */

app.post("/ingest/export", async (req, res) => {
  const started = new Date().toISOString();
  try {
    const sourceId = String(req.body?.sourceId ?? "");
    const raw = req.body?.export;
    if (!sourceId) return res.status(400).json({ error: "sourceId required" });
    if (typeof raw !== "string") {
      return res.status(400).json({ error: "export must be the raw JSON file as a string" });
    }

    const { sources } = (await graph("GET", "/api/admin/telegram/sources")) as { sources: TgSource[] };
    const source = sources.find((s) => s.id === sourceId);
    if (!source) return res.status(404).json({ error: `unknown source "${sourceId}"` });

    const parsed = parseExport(raw, source);
    const classified = classifyAll(parsed.messages);
    const stored = (await graph("POST", "/api/admin/telegram/messages", {
      sourceId,
      title: parsed.title,
      chatId: parsed.chatId,
      messages: classified,
    })) as { inserted: number; seen: number };

    const { candidates, byClass, warnings } = await runPipeline(source, classified);
    await graph("POST", "/api/admin/telegram/candidates", { sourceId, candidates });

    const report: RunReport = {
      sourceId,
      startedAt: started,
      finishedAt: new Date().toISOString(),
      messagesSeen: stored.seen,
      messagesNew: stored.inserted,
      byClass,
      candidates: {
        qa: candidates.filter((c) => c.kind === "qa").length,
        outcome: candidates.filter((c) => c.kind === "outcome").length,
        provider: candidates.filter((c) => c.kind === "provider").length,
      },
      warnings: [...parsed.warnings, ...warnings],
    };
    await graph("POST", "/api/admin/telegram/runs", report);
    res.json(report);
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

/** Re-extract from stored messages — use after tuning thresholds or adding a lexicon. */
app.post("/run/:sourceId", async (req, res) => {
  const started = new Date().toISOString();
  try {
    const sourceId = String(req.params.sourceId);
    const { sources } = (await graph("GET", "/api/admin/telegram/sources")) as { sources: TgSource[] };
    const source = sources.find((s) => s.id === sourceId);
    if (!source) return res.status(404).json({ error: `unknown source "${sourceId}"` });

    const { messages } = (await graph(
      "GET",
      `/api/admin/telegram/messages?sourceId=${encodeURIComponent(sourceId)}`,
    )) as { messages: Classified[] };
    if (messages.length === 0) return res.status(400).json({ error: "no stored messages — ingest an export first" });

    const { candidates, byClass, warnings } = await runPipeline(source, messages);
    await graph("POST", "/api/admin/telegram/candidates", { sourceId, candidates });

    const report: RunReport = {
      sourceId,
      startedAt: started,
      finishedAt: new Date().toISOString(),
      messagesSeen: messages.length,
      messagesNew: 0,
      byClass,
      candidates: {
        qa: candidates.filter((c) => c.kind === "qa").length,
        outcome: candidates.filter((c) => c.kind === "outcome").length,
        provider: candidates.filter((c) => c.kind === "provider").length,
      },
      warnings,
    };
    await graph("POST", "/api/admin/telegram/runs", report);
    res.json(report);
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

app.get("/health", (_req, res) =>
  res.json({ ok: true, llm: llmConfigured(), bot: Boolean(BOT_TOKEN), pollMs: POLL_MS }),
);

/* ---------------------------- live tail loop ----------------------------- */

async function tailLoop() {
  if (!BOT_TOKEN || POLL_MS <= 0) return;
  try {
    console.log(`[telegram] live tail as @${await botIdentity(BOT_TOKEN)}`);
  } catch (e) {
    console.error(`[telegram] bot disabled: ${e instanceof Error ? e.message : e}`);
    return;
  }
  let offset = 0;
  for (;;) {
    try {
      const { sources } = (await graph("GET", "/api/admin/telegram/sources")) as { sources: TgSource[] };
      const watch = new Map<string, string>();
      for (const s of sources) if (s.enabled && s.kind === "bot" && s.chatId) watch.set(s.chatId, s.id);

      if (watch.size > 0) {
        const { messages, nextOffset } = await pollUpdates({ token: BOT_TOKEN, offset, chatIds: watch });
        offset = nextOffset;
        if (messages.length) {
          const classified = classifyAll(messages);
          await graph("POST", "/api/admin/telegram/messages", {
            sourceId: classified[0].sourceId,
            messages: classified,
          });
          // Live messages are extracted in the same pass; a group's newest
          // rejection is the one worth surfacing fastest.
          for (const s of new Set(classified.map((m) => m.sourceId))) {
            const source = sources.find((x) => x.id === s);
            if (!source) continue;
            const batch = classified.filter((m) => m.sourceId === s);
            const { candidates } = await runPipeline(source, batch);
            if (candidates.length) {
              await graph("POST", "/api/admin/telegram/candidates", { sourceId: s, candidates });
            }
          }
        }
      }
    } catch (e) {
      console.error(`[telegram] tail error: ${e instanceof Error ? e.message : e}`);
    }
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
}

app.listen(PORT, () => {
  console.log(`connector-telegram on :${PORT} → graph ${GRAPH}${llmConfigured() ? " (llm on)" : ""}`);
  void tailLoop();
});
