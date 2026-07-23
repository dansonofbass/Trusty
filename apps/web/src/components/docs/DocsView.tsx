"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, BookMarked, FileText, Loader2, Plus, Trash2 } from "lucide-react";
import {
  deleteWorkspaceDoc,
  fetchWorkspace,
  fetchWriting,
  saveDraft,
  updateWorkspaceDoc,
  type WritingSummary,
} from "@/lib/writings";
import { useUI } from "@/lib/store";
import { GOLD } from "@/lib/palette";

/**
 * The docs center view (P1): the private workspace as a first-class
 * directory — flat list + search + collection chips, with a plain editor.
 * Phase 3 turns this into folders + the TipTap wikilink editor.
 */
export default function DocsView() {
  const router = useRouter();
  const params = useSearchParams();
  const bumpDocs = useUI((s) => s.bumpDocs);
  const docsNonce = useUI((s) => s.docsNonce);

  const [docs, setDocs] = useState<WritingSummary[]>([]);
  const [collections, setCollections] = useState<string[]>([]);
  const [q, setQ] = useState("");
  const [activeCollection, setActiveCollection] = useState<string | null>(null);

  // Editor state: null = list; "new" = fresh doc; otherwise the open doc id.
  const [openId, setOpenId] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const load = useCallback(async () => {
    const w = await fetchWorkspace({ q: q || undefined, collection: activeCollection ?? undefined });
    setDocs(w.writings);
    setCollections(w.collections);
  }, [q, activeCollection]);

  useEffect(() => {
    void load();
  }, [load, docsNonce]);

  // Deep links from the sidebar / palette: /docs?open=<id> · /docs?new=1
  const openParam = params.get("open");
  const newParam = params.get("new");
  useEffect(() => {
    if (newParam) {
      setOpenId("new");
      setTitle("");
      setBody("");
    } else if (openParam) {
      void openDoc(openParam);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openParam, newParam]);

  const openDoc = async (id: string) => {
    const d = await fetchWriting(id);
    if (!d) return;
    setOpenId(id);
    setTitle(d.title ?? "");
    setBody(d.body);
  };

  const closeEditor = () => {
    setOpenId(null);
    setTitle("");
    setBody("");
    router.replace("/docs");
  };

  const flash = (m: string) => {
    setToast(m);
    setTimeout(() => setToast(null), 2400);
  };

  const save = async () => {
    if (!body.trim() && !title.trim()) return;
    setBusy(true);
    try {
      const t = title.trim() || body.trim().split("\n")[0].slice(0, 60);
      if (openId && openId !== "new") {
        await updateWorkspaceDoc(openId, { title: t, body });
      } else {
        const id = `ws_${Date.now().toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`;
        await saveDraft({
          id,
          title: t,
          body,
          extraction: { entities: [], relations: [] },
          kind: "note",
          collections: [],
        });
        setOpenId(id);
      }
      bumpDocs();
      await load();
      flash("Saved 🔒");
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: string) => {
    await deleteWorkspaceDoc(id);
    if (openId === id) closeEditor();
    bumpDocs();
    await load();
  };

  /* ------------------------------ editor ------------------------------ */

  if (openId) {
    return (
      <div className="flex h-full flex-col">
        <div className="flex items-center gap-2 border-b border-line px-5 py-2.5">
          <button
            type="button"
            onClick={closeEditor}
            className="flex items-center gap-1 text-[11.5px] text-[var(--color-faint)] transition hover:text-ink"
          >
            <ArrowLeft size={13} /> Docs
          </button>
          <span className="text-[var(--color-faint)]">/</span>
          <span className="min-w-0 flex-1 truncate text-[12.5px] font-semibold text-ink">
            {title || "Untitled"}
          </span>
          {toast && <span className="text-[11px] text-[#54d26e]">{toast}</span>}
          {openId !== "new" && (
            <button
              type="button"
              onClick={() => void remove(openId)}
              title="Delete"
              className="rounded p-1 text-[var(--color-faint)] transition hover:text-rose-300"
            >
              <Trash2 size={14} />
            </button>
          )}
          <button
            type="button"
            onClick={() => void save()}
            disabled={busy}
            className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12px] font-bold text-space disabled:opacity-50"
            style={{ background: GOLD }}
          >
            {busy ? <Loader2 className="animate-spin" size={13} /> : null} Save
          </button>
        </div>
        <div className="scroll-quiet min-h-0 flex-1 overflow-y-auto px-5 py-4">
          <div className="mx-auto w-full max-w-[760px]">
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Untitled"
              className="mb-3 w-full bg-transparent text-[24px] font-bold text-ink outline-none placeholder:text-[var(--color-faint)]"
              style={{ fontFamily: "var(--font-display)" }}
            />
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="Write… (the TipTap editor with [[wikilinks]] lands in Phase 3)"
              className="min-h-[50vh] w-full resize-none bg-transparent text-[13.5px] leading-relaxed text-ink outline-none placeholder:text-[var(--color-faint)]"
            />
          </div>
        </div>
      </div>
    );
  }

  /* ------------------------------- list ------------------------------- */

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-line px-5 py-2.5">
        <BookMarked size={13} style={{ color: "var(--color-accent)" }} />
        <span className="text-[12.5px] font-semibold text-ink" style={{ fontFamily: "var(--font-display)" }}>
          My workspace
        </span>
        <span className="text-[10.5px] text-[var(--color-faint)]">only you can see this</span>
        <button
          type="button"
          onClick={() => {
            setOpenId("new");
            setTitle("");
            setBody("");
          }}
          className="ml-auto flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12px] font-bold text-space"
          style={{ background: GOLD }}
        >
          <Plus size={13} /> New doc
        </button>
      </div>

      <div className="scroll-quiet min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-[720px] px-4 py-4">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search your notes…"
            className="mb-2 w-full rounded-lg border border-[var(--color-line)] bg-[rgba(146,166,255,0.06)] px-2.5 py-2 text-[12.5px] text-ink outline-none placeholder:text-[var(--color-faint)]"
          />
          {collections.length > 0 && (
            <div className="mb-3 flex flex-wrap gap-1">
              {collections.map((c) => (
                <button
                  key={c}
                  onClick={() => setActiveCollection(activeCollection === c ? null : c)}
                  className="rounded-full border px-2 py-0.5 text-[10.5px]"
                  style={{
                    borderColor: activeCollection === c ? "rgba(255,140,90,0.6)" : "var(--color-line)",
                    color: activeCollection === c ? GOLD : "var(--color-faint)",
                  }}
                >
                  {c.replace(/_/g, " ")}
                </button>
              ))}
            </div>
          )}

          {docs.length === 0 ? (
            <p className="flex items-center gap-2 py-6 text-[12px] text-[var(--color-faint)]">
              <FileText size={14} /> Nothing here yet — whatever you write in the chat&apos;s
              &quot;Save&quot; (or here) lands here: private, searchable, versioned.
            </p>
          ) : (
            <ul className="space-y-1.5">
              {docs.map((d) => (
                <li
                  key={d.id}
                  className="group flex items-start gap-2 rounded-xl border border-[var(--color-line)] p-3 transition hover:border-[rgba(255,140,90,0.35)]"
                >
                  <button onClick={() => void openDoc(d.id)} className="min-w-0 flex-1 text-left">
                    <div className="flex items-center gap-1.5">
                      <span className="truncate text-[13px] font-medium text-ink">{d.title || "Untitled"}</span>
                      <span className="shrink-0 rounded-full bg-[rgba(146,166,255,0.1)] px-1.5 py-0.5 text-[9.5px] uppercase tracking-wide text-[var(--color-faint)]">
                        {(d.kind ?? "note").replace(/_/g, " ")}
                      </span>
                      {d.status === "published" && (
                        <span className="shrink-0 rounded-full bg-[rgba(255,140,90,0.12)] px-1.5 py-0.5 text-[9.5px]" style={{ color: GOLD }}>
                          published
                        </span>
                      )}
                    </div>
                    {d.snippet && (
                      <div className="mt-0.5 line-clamp-2 text-[11.5px] leading-snug text-[var(--color-faint)]">{d.snippet}</div>
                    )}
                    <div className="mt-0.5 text-[10px] text-[var(--color-faint)]">
                      {new Date(d.updated_at).toLocaleDateString()}
                    </div>
                  </button>
                  <button
                    onClick={() => void remove(d.id)}
                    aria-label="Delete"
                    className="rounded p-1 text-[var(--color-faint)] opacity-0 transition hover:text-rose-300 group-hover:opacity-100"
                  >
                    <Trash2 size={13} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
