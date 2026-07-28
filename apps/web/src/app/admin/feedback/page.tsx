"use client";

import { useEffect, useState } from "react";
import { Loader2, MessageSquarePlus } from "lucide-react";

interface Row {
  id: string;
  userId: string;
  userLabel: string;
  text: string;
  screen: string | null;
  app: string;
  createdAt: string;
}

export default function FeedbackAdminPage() {
  const [status, setStatus] = useState<"loading" | "ok" | "error">("loading");
  const [rows, setRows] = useState<Row[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/admin/feedback", { cache: "no-store" })
      .then(async (r) => {
        if (!r.ok) throw new Error(`feedback fetch failed (${r.status})`);
        setRows(((await r.json()) as { feedback: Row[] }).feedback);
        setStatus("ok");
      })
      .catch((e) => {
        setError(e instanceof Error ? e.message : String(e));
        setStatus("error");
      });
  }, []);

  return (
    <div className="mx-auto max-w-3xl px-6 py-8">
      <header className="mb-6">
        <h1 className="text-2xl font-extrabold tracking-tight text-ink" style={{ fontFamily: "var(--font-display)" }}>
          Feedback
        </h1>
        <p className="mt-1 text-sm text-dim">Everything sent through the in-app feedback button, newest first.</p>
      </header>

      {status === "loading" && <div className="flex items-center gap-2 text-dim"><Loader2 className="animate-spin" size={16} /> Loading…</div>}
      {status === "error" && <div className="rounded-2xl border border-line bg-surface p-6 text-sm text-rose-300">{error}</div>}

      {status === "ok" && rows.length === 0 && (
        <div className="rounded-2xl border border-line bg-surface p-10 text-center backdrop-blur-md">
          <MessageSquarePlus className="mx-auto mb-3 text-faint" size={28} />
          <p className="text-[14px] text-ink">No feedback yet</p>
        </div>
      )}

      {status === "ok" && rows.length > 0 && (
        <ul className="space-y-3">
          {rows.map((r) => (
            <li key={r.id} className="rounded-2xl border border-line bg-surface p-4 backdrop-blur-md">
              <div className="flex flex-wrap items-center gap-2 text-[11px] text-faint">
                <span className="font-semibold text-dim">{r.userLabel}</span>
                <span>{new Date(r.createdAt).toLocaleString()}</span>
                {r.screen && <span className="rounded-full bg-[var(--color-tint)] px-2 py-0.5">{r.screen}</span>}
              </div>
              <p className="mt-1.5 whitespace-pre-line text-[13.5px] leading-relaxed text-ink">{r.text}</p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
