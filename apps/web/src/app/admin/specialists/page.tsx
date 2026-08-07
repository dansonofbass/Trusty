"use client";

import { useCallback, useEffect, useState } from "react";
import { BadgeCheck, Check, Loader2, X, Mail, Phone, FileBadge, Globe, Building2, MessageSquareQuote, Search, Tags } from "lucide-react";
import { TOPIC_TAXONOMY } from "@constellation/graph-core";

interface Claim {
  id: string;
  nodeId: string;
  nodeLabel: string;
  userId: string;
  userLabel: string;
  evidence: {
    professionalEmail?: string;
    phone?: string;
    licenseNumber?: string;
    licenseAuthority?: string;
    website?: string;
    organization?: string;
    statement?: string;
  };
  status: "pending" | "approved" | "rejected";
  reason: string | null;
  createdAt: string;
  decidedBy: string | null;
  decidedAt: string | null;
}

const TABS = ["pending", "approved", "rejected"] as const;

export default function SpecialistsAdminPage() {
  const [tab, setTab] = useState<(typeof TABS)[number]>("pending");
  const [status, setStatus] = useState<"loading" | "ok" | "error">("loading");
  const [error, setError] = useState<string | null>(null);
  const [claims, setClaims] = useState<Claim[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [verifying, setVerifying] = useState<string | null>(null);
  const [vForm, setVForm] = useState({ type: "license", what: "", source: "", expiresAt: "" });
  const [vDone, setVDone] = useState<string | null>(null);

  const load = useCallback(async () => {
    setStatus("loading");
    try {
      const r = await fetch(`/api/admin/specialists/claims?status=${tab}`, { cache: "no-store" });
      if (!r.ok) throw new Error(`claims fetch failed (${r.status})`);
      setClaims(((await r.json()) as { claims: Claim[] }).claims);
      setStatus("ok");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setStatus("error");
    }
  }, [tab]);
  useEffect(() => { void load(); }, [load]);

  const grantVerification = async (nodeId: string) => {
    setBusy(nodeId);
    try {
      const r = await fetch(`/api/admin/specialists/${encodeURIComponent(nodeId)}/verifications`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          type: vForm.type,
          what: vForm.what,
          source: vForm.source,
          expiresAt: vForm.expiresAt || undefined,
        }),
      });
      if (!r.ok) throw new Error((await r.json().catch(() => null))?.error ?? `verification failed (${r.status})`);
      setVDone(nodeId);
      setVerifying(null);
      setVForm({ type: "license", what: "", source: "", expiresAt: "" });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const review = async (id: string, approve: boolean, rejectReason?: string) => {
    setBusy(id);
    try {
      const r = await fetch(`/api/admin/specialists/claims/${encodeURIComponent(id)}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ approve, reason: rejectReason || undefined }),
      });
      if (!r.ok) throw new Error((await r.json().catch(() => null))?.error ?? `review failed (${r.status})`);
      setClaims((xs) => xs.filter((x) => x.id !== id));
      setRejecting(null);
      setReason("");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="mx-auto max-w-3xl px-6 py-8">
      <header className="mb-6">
        <h1 className="text-2xl font-extrabold tracking-tight text-ink" style={{ fontFamily: "var(--font-display)" }}>Specialists</h1>
        <p className="mt-1 text-sm text-dim">
          Profile claims awaiting review. Approving grants <b>management authority only</b> — the first approved
          claimant becomes owner. It never verifies every profile claim and never creates trust.
        </p>
      </header>

      <TopicTagEditor />

      <div className="mb-5 flex gap-1 rounded-full border border-line bg-surface p-1 text-[12.5px]">
        {TABS.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`flex-1 rounded-full py-1.5 font-semibold capitalize transition ${
              tab === t ? "bg-[var(--color-accent-soft)] text-[var(--color-accent)]" : "text-faint hover:text-ink"
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {status === "loading" && <div className="flex items-center gap-2 text-dim"><Loader2 className="animate-spin" size={16} /> Loading…</div>}
      {status === "error" && <div className="rounded-2xl border border-line bg-surface p-6 text-sm text-rose-300">{error}</div>}

      {status === "ok" && claims.length === 0 && (
        <div className="rounded-2xl border border-line bg-surface p-10 text-center backdrop-blur-md">
          <BadgeCheck className="mx-auto mb-3 text-faint" size={28} />
          <p className="text-[14px] text-ink">No {tab} claims</p>
          {tab === "pending" && (
            <p className="mt-1 text-[13px] text-faint">
              When a professional claims their profile (&ldquo;Is this you?&rdquo;), the request lands here.
            </p>
          )}
        </div>
      )}

      {status === "ok" && claims.length > 0 && (
        <ul className="space-y-3">
          {claims.map((c) => (
            <li key={c.id} className="rounded-2xl border border-line bg-surface p-4 backdrop-blur-md">
              <div className="flex flex-wrap items-center gap-2">
                <div className="min-w-0 flex-1">
                  <div className="text-[13.5px] font-semibold text-ink">
                    {c.userLabel} <span className="font-normal text-faint">claims</span> {c.nodeLabel}
                  </div>
                  <div className="mt-0.5 text-[11px] text-faint">
                    {new Date(c.createdAt).toLocaleString()} · claim #{c.id}
                    {c.decidedBy && <> · decided by {c.decidedBy}</>}
                    {c.reason && <> · “{c.reason}”</>}
                  </div>
                </div>
                {tab === "approved" && (
                  <div className="flex shrink-0 items-center gap-2">
                    {vDone === c.nodeId && <span className="flex items-center gap-1 text-[11.5px] text-emerald-400"><Check size={12} /> granted</span>}
                    <a href={`/s/${encodeURIComponent(c.nodeId)}`} target="_blank" rel="noreferrer"
                      className="rounded-lg border border-line px-3 py-1.5 text-[12.5px] font-semibold text-dim hover:text-ink">
                      Profile
                    </a>
                    <button
                      onClick={() => setVerifying(verifying === c.nodeId ? null : c.nodeId)}
                      className="flex items-center gap-1.5 rounded-lg border border-line px-3 py-1.5 text-[12.5px] font-semibold text-dim hover:text-ink"
                    >
                      <BadgeCheck size={13} /> Verify…
                    </button>
                  </div>
                )}
                {tab === "pending" && (
                  <div className="flex shrink-0 items-center gap-2">
                    <button
                      disabled={busy === c.id}
                      onClick={() => void review(c.id, true)}
                      className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12.5px] font-bold text-space disabled:opacity-50"
                      style={{ background: "var(--color-accent)" }}
                    >
                      {busy === c.id ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />} Approve
                    </button>
                    <button
                      disabled={busy === c.id}
                      onClick={() => setRejecting(rejecting === c.id ? null : c.id)}
                      className="flex items-center gap-1.5 rounded-lg border border-line px-3 py-1.5 text-[12.5px] font-semibold text-dim hover:text-ink disabled:opacity-50"
                    >
                      <X size={13} /> Reject
                    </button>
                  </div>
                )}
              </div>

              {/* evidence */}
              <div className="mt-3 grid gap-1.5 text-[12.5px] text-dim sm:grid-cols-2">
                {c.evidence.professionalEmail && <span className="flex items-center gap-1.5"><Mail size={12} className="text-faint" /> {c.evidence.professionalEmail}</span>}
                {c.evidence.phone && <span className="flex items-center gap-1.5"><Phone size={12} className="text-faint" /> {c.evidence.phone}</span>}
                {c.evidence.licenseNumber && (
                  <span className="flex items-center gap-1.5">
                    <FileBadge size={12} className="text-faint" /> {c.evidence.licenseNumber}
                    {c.evidence.licenseAuthority && <span className="text-faint">({c.evidence.licenseAuthority})</span>}
                  </span>
                )}
                {c.evidence.website && <span className="flex items-center gap-1.5"><Globe size={12} className="text-faint" /> {c.evidence.website}</span>}
                {c.evidence.organization && <span className="flex items-center gap-1.5"><Building2 size={12} className="text-faint" /> {c.evidence.organization}</span>}
              </div>
              {c.evidence.statement && (
                <p className="mt-2 flex gap-1.5 rounded-lg bg-[var(--color-tint)] px-3 py-2 text-[12.5px] italic text-dim">
                  <MessageSquareQuote size={13} className="mt-0.5 shrink-0 text-faint" /> {c.evidence.statement}
                </p>
              )}

              {verifying === c.nodeId && (
                <div className="mt-3 space-y-2 rounded-xl border border-line p-3">
                  <div className="flex flex-wrap gap-2">
                    <select
                      value={vForm.type}
                      onChange={(e) => setVForm((f) => ({ ...f, type: e.target.value }))}
                      className="rounded-lg border border-line bg-transparent px-2 py-1.5 text-[12.5px] text-ink outline-none"
                    >
                      {["license", "identity", "professional_email", "organization_affiliation", "office_location", "website_ownership", "phone", "credential"].map((t) => (
                        <option key={t} value={t} className="bg-[#111827]">{t.replace(/_/g, " ")}</option>
                      ))}
                    </select>
                    <input
                      value={vForm.expiresAt}
                      onChange={(e) => setVForm((f) => ({ ...f, expiresAt: e.target.value }))}
                      placeholder="Expires (YYYY-MM-DD, optional)"
                      className="w-52 rounded-lg border border-line bg-transparent px-3 py-1.5 text-[12.5px] text-ink outline-none placeholder:text-faint"
                    />
                  </div>
                  <input
                    value={vForm.what}
                    onChange={(e) => setVForm((f) => ({ ...f, what: e.target.value }))}
                    placeholder="Exactly what was checked (e.g. license AM-4471 active)"
                    className="w-full rounded-lg border border-line bg-transparent px-3 py-1.5 text-[12.5px] text-ink outline-none placeholder:text-faint"
                  />
                  <div className="flex gap-2">
                    <input
                      value={vForm.source}
                      onChange={(e) => setVForm((f) => ({ ...f, source: e.target.value }))}
                      placeholder="Source (e.g. RA Chamber of Advocates registry)"
                      className="min-w-0 flex-1 rounded-lg border border-line bg-transparent px-3 py-1.5 text-[12.5px] text-ink outline-none placeholder:text-faint"
                    />
                    <button
                      disabled={busy === c.nodeId || !vForm.what.trim() || !vForm.source.trim()}
                      onClick={() => void grantVerification(c.nodeId)}
                      className="rounded-lg px-3 py-1.5 text-[12.5px] font-bold text-space disabled:opacity-50"
                      style={{ background: "var(--color-accent)" }}
                    >
                      Grant
                    </button>
                  </div>
                </div>
              )}

              {rejecting === c.id && (
                <div className="mt-3 flex gap-2">
                  <input
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    placeholder="Reason shown to the claimant (optional)"
                    className="min-w-0 flex-1 rounded-lg border border-line bg-transparent px-3 py-1.5 text-[12.5px] text-ink outline-none placeholder:text-faint"
                  />
                  <button
                    disabled={busy === c.id}
                    onClick={() => void review(c.id, false, reason)}
                    className="rounded-lg border border-rose-400/40 px-3 py-1.5 text-[12.5px] font-semibold text-rose-300 disabled:opacity-50"
                  >
                    Confirm reject
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

interface SpecialistSearchHit {
  nodeId: string;
  label: string;
  nodeType: string;
}

/** Admin-only topic tagging — separate from claim review. Most specialists
 *  are unclaimed catalog entries, so this searches ALL specialist-type nodes,
 *  not just claimed ones. Tags feed the market-test survey's "best experts
 *  for this need" matches and in-app topic search; a specialist can never
 *  set these on their own profile. */
function TopicTagEditor() {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<SpecialistSearchHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [selected, setSelected] = useState<SpecialistSearchHit | null>(null);
  const [tags, setTags] = useState<string[]>([]);
  const [loadingTags, setLoadingTags] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    const t = setTimeout(async () => {
      if (q.trim().length < 2) {
        setResults([]);
        return;
      }
      setSearching(true);
      try {
        const r = await fetch(`/api/admin/specialists/search?q=${encodeURIComponent(q.trim())}`, { cache: "no-store" });
        const data = (await r.json()) as { nodes: SpecialistSearchHit[] };
        setResults(data.nodes ?? []);
      } catch {
        setResults([]);
      } finally {
        setSearching(false);
      }
    }, 250);
    return () => clearTimeout(t);
  }, [q]);

  const select = async (hit: SpecialistSearchHit) => {
    setSelected(hit);
    setSaved(false);
    setLoadingTags(true);
    try {
      const r = await fetch(`/api/specialists/${encodeURIComponent(hit.nodeId)}`, { cache: "no-store" });
      const data = (await r.json()) as { topicTags?: string[] };
      setTags(data.topicTags ?? []);
    } catch {
      setTags([]);
    } finally {
      setLoadingTags(false);
    }
  };

  const toggle = (t: string) => setTags((xs) => (xs.includes(t) ? xs.filter((x) => x !== t) : [...xs, t]));

  const save = async () => {
    if (!selected) return;
    setSaving(true);
    try {
      const r = await fetch(`/api/admin/specialists/${encodeURIComponent(selected.nodeId)}/topic-tags`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ tags }),
      });
      if (!r.ok) throw new Error((await r.json().catch(() => null))?.error ?? `save failed (${r.status})`);
      setSaved(true);
    } catch {
      setSaved(false);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mb-6 rounded-2xl border border-line bg-surface p-4 backdrop-blur-md">
      <div className="flex items-center gap-2">
        <Tags size={15} className="text-faint" />
        <h2 className="text-[14px] font-bold text-ink">Topic tags</h2>
      </div>
      <p className="mt-1 text-[12.5px] text-dim">
        Tag a specialist with the topics they cover. This is what the market-test survey and in-app topic search use
        to find &ldquo;the best expert for this need&rdquo; — a specialist can never set this themselves.
      </p>

      <div className="relative mt-3">
        <Search size={13} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-faint" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search specialists by name…"
          className="w-full rounded-lg border border-line bg-transparent py-2 pl-8 pr-3 text-[12.5px] text-ink outline-none placeholder:text-faint"
        />
      </div>

      {searching && <div className="mt-2 flex items-center gap-1.5 text-[12px] text-faint"><Loader2 size={12} className="animate-spin" /> Searching…</div>}

      {!selected && results.length > 0 && (
        <ul className="mt-2 divide-y divide-line overflow-hidden rounded-lg border border-line">
          {results.map((r) => (
            <li key={r.nodeId}>
              <button
                onClick={() => void select(r)}
                className="flex w-full items-center justify-between px-3 py-2 text-left text-[12.5px] text-ink hover:bg-[var(--color-tint)]"
              >
                <span>{r.label}</span>
                <span className="text-[11px] capitalize text-faint">{r.nodeType.replace(/_/g, " ")}</span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {selected && (
        <div className="mt-3 rounded-lg border border-line p-3">
          <div className="flex items-center justify-between">
            <div className="text-[13px] font-semibold text-ink">
              {selected.label} <span className="font-normal capitalize text-faint">· {selected.nodeType.replace(/_/g, " ")}</span>
            </div>
            <button onClick={() => setSelected(null)} className="text-[11.5px] text-faint hover:text-ink">
              Change
            </button>
          </div>

          {loadingTags ? (
            <div className="mt-3 flex items-center gap-1.5 text-[12px] text-faint"><Loader2 size={12} className="animate-spin" /> Loading current tags…</div>
          ) : (
            <>
              <div className="mt-3 flex flex-wrap gap-1.5">
                {TOPIC_TAXONOMY.map((t) => {
                  const on = tags.includes(t);
                  return (
                    <button
                      key={t}
                      onClick={() => toggle(t)}
                      className={`rounded-full border px-2.5 py-1 text-[11.5px] font-medium capitalize transition ${
                        on
                          ? "border-transparent bg-[var(--color-accent)] text-space"
                          : "border-line text-dim hover:border-[var(--color-accent)]/60"
                      }`}
                    >
                      {t.replace(/_/g, " ")}
                    </button>
                  );
                })}
              </div>
              <div className="mt-3 flex items-center gap-2">
                <button
                  disabled={saving}
                  onClick={() => void save()}
                  className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12.5px] font-bold text-space disabled:opacity-50"
                  style={{ background: "var(--color-accent)" }}
                >
                  {saving ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />} Save tags
                </button>
                {saved && <span className="text-[11.5px] text-emerald-400">Saved</span>}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
