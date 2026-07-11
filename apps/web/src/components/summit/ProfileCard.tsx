"use client";

import { useState } from "react";
import { entityTypeById, activeRolesOf, type GNode } from "@constellation/graph-core";
import {
  saveContact, removeContact, requestMeeting, getLocations, getNotesAbout,
  CONTACT_LABELS, SUMMIT_APP, type MeetingNoteRecord, type EventLocation, type CommunityNote,
} from "@/lib/summitClient";
import { useEffect } from "react";
import { createAsk } from "@/lib/asksClient";
import MatchBar from "./MatchBar";
import NoteComposer from "./NoteComposer";
import { Bookmark, BookmarkCheck, X, ExternalLink, CalendarPlus, Check, Handshake, NotebookPen, Lock, Users, Globe, Pencil } from "lucide-react";

/**
 * Shared profile card (bottom sheet) — the one surface every person/org opens into,
 * with a consistent action row. Keeps 10 flows from feeling like 10 features.
 */
export default function ProfileCard({
  node,
  match,
  connect,
  saved,
  onClose,
  onChange,
}: {
  node: GNode;
  /** Match context when opened from a recommendation (pct + "recommended because"). */
  match?: { pct: number; reasons: string[] };
  /** Opened via QR/deep-link — offer the one-tap Connect (saves as "met"). */
  connect?: boolean;
  saved: boolean;
  onClose: () => void;
  onChange?: () => void;
}) {
  const [isSaved, setIsSaved] = useState(saved);
  const [busy, setBusy] = useState(false);
  const [labelOpen, setLabelOpen] = useState(false);
  const [picked, setPicked] = useState<string[]>([]);
  const def = node.entityType ? entityTypeById(node.entityType) : undefined;
  const props = node.properties ?? {};

  /** Save = bookmark with one or MORE reason tags (F3). Tap Save to open the
   *  chips, toggle any that apply, then Save. Saved again → unsave. */
  const toggleLabel = (id: string) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  const saveWithLabels = async () => {
    setBusy(true);
    try {
      await saveContact(node.id, picked.length ? picked : ["interesting"]);
      setIsSaved(true);
      setLabelOpen(false);
      onChange?.();
    } finally {
      setBusy(false);
    }
  };

  const unsave = async () => {
    setBusy(true);
    try {
      await removeContact(node.id);
      setIsSaved(false);
      onChange?.();
    } finally {
      setBusy(false);
    }
  };

  const isSpeaker = node.entityType === "speaker";
  const [meetOpen, setMeetOpen] = useState(false);
  const [slot, setSlot] = useState("");
  const [note, setNote] = useState("");
  const [meetSent, setMeetSent] = useState(false);
  const [sending, setSending] = useState(false);
  // Venue: pick a predefined location, or "__custom" → free-text description.
  const [venues, setVenues] = useState<EventLocation[]>([]);
  const [venue, setVenue] = useState("");
  const [customVenue, setCustomVenue] = useState("");
  const meetKind = isSpeaker
    ? "question"
    : node.entityType === "mentor" ? "mentor_1on1" : node.entityType === "investor" ? "investor" : "coffee";

  useEffect(() => {
    if (meetOpen && !isSpeaker && venues.length === 0) {
      getLocations().then(setVenues).catch(() => setVenues([]));
    }
  }, [meetOpen, isSpeaker, venues.length]);

  const sendMeeting = async () => {
    setSending(true);
    try {
      const location = venue === "__custom" ? customVenue.trim() : venue;
      await requestMeeting({
        targetId: node.id,
        kind: meetKind,
        slot: slot || undefined,
        location: location || undefined,
        note: note.trim() || undefined,
      });
      setMeetSent(true);
      setMeetOpen(false);
    } catch {
      /* best-effort */
    } finally {
      setSending(false);
    }
  };

  const [introSent, setIntroSent] = useState(false);
  const requestIntro = async () => {
    if (introSent) return;
    try {
      await createAsk({ topic: def?.topic ?? "intro", note: `Intro to ${node.label}` }, SUMMIT_APP);
      setIntroSent(true);
    } catch {
      /* best-effort — needs network reach */
    }
  };

  const [composerOpen, setComposerOpen] = useState(false);
  const [editNote, setEditNote] = useState<MeetingNoteRecord | undefined>(undefined);
  const [communityNotes, setCommunityNotes] = useState<CommunityNote[]>([]);
  const loadNotes = () => getNotesAbout(node.id).then(setCommunityNotes).catch(() => setCommunityNotes([]));
  useEffect(() => {
    if (node.type === "person") void loadNotes();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [node.id]);

  /** QR / deep-link Connect: save as "met" + jump straight into the quick note. */
  const doConnect = async () => {
    setBusy(true);
    try {
      await saveContact(node.id, "interesting", "met");
      setIsSaved(true);
      setComposerOpen(true);
      onChange?.();
    } finally {
      setBusy(false);
    }
  };

  const fields = (def?.fields ?? []).filter((f) => {
    const v = props[f.key];
    return v !== undefined && v !== null && v !== "" && !(Array.isArray(v) && v.length === 0) && f.key !== "links";
  });
  const links = String(props.links ?? props.website ?? "").trim();

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center" onClick={onClose}>
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />
      <div
        className="relative z-10 w-full max-w-md rounded-t-3xl border border-line bg-nebula/95 p-5 pb-8 shadow-2xl backdrop-blur-md"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-line" />
        <button type="button" onClick={onClose} className="absolute right-4 top-4 text-dim hover:text-ink">
          <X size={18} />
        </button>

        <div className="flex items-center gap-3">
          <div
            className="grid h-12 w-12 shrink-0 place-items-center rounded-full text-lg font-bold"
            style={{ background: "rgba(124,150,255,0.18)", color: "#a9bcff" }}
          >
            {node.label.charAt(0).toUpperCase()}
          </div>
          <div className="min-w-0">
            <h2 className="truncate text-lg font-bold text-ink" style={{ fontFamily: "var(--font-display)" }}>{node.label}</h2>
            {/* One person, many roles — every active role shows (primary first). */}
            {def && (
              <div className="mt-0.5 flex flex-wrap gap-1">
                {activeRolesOf(node).map((r, i) => {
                  const rd = entityTypeById(r);
                  return rd ? (
                    <span key={r} className="rounded-full px-1.5 py-px text-[10px] font-semibold uppercase tracking-wide"
                      style={i === 0
                        ? { background: "rgba(255,140,90,0.18)", color: "#ff8c5a" }
                        : { background: "rgba(124,150,255,0.14)", color: "#a9bcff" }}>
                      {rd.label}
                    </span>
                  ) : null;
                })}
              </div>
            )}
            {node.sub && <div className="truncate text-xs text-dim">{node.sub}</div>}
          </div>
        </div>

        {String(props.headline ?? props.one_liner ?? "").trim() && (
          <p className="mt-3 text-sm text-ink">{String(props.headline ?? props.one_liner)}</p>
        )}

        {match && <MatchBar pct={match.pct} reasons={match.reasons} />}

        {fields.length > 0 && (
          <div className="mt-3 space-y-2">
            {fields.map((f) => (
              <div key={f.key} className="text-sm">
                <span className="text-faint">{f.label}: </span>
                <span className="text-dim">
                  {Array.isArray(props[f.key])
                    ? (props[f.key] as string[]).map((x) => x.replace(/_/g, " ")).join(", ")
                    : String(props[f.key]).replace(/_/g, " ")}
                </span>
              </div>
            ))}
          </div>
        )}

        {links && (
          <a href={/^https?:\/\//.test(links) ? links : `https://${links}`} target="_blank" rel="noreferrer"
            className="mt-3 inline-flex items-center gap-1 text-sm text-[#a9bcff] hover:underline">
            <ExternalLink size={13} /> {links.replace(/^https?:\/\//, "")}
          </a>
        )}

        {/* QR / deep-link connect — the business-card moment (F4) */}
        {connect && !isSaved && (
          <button
            type="button"
            disabled={busy}
            onClick={() => void doConnect()}
            className="mt-5 w-full rounded-xl py-3 text-sm font-bold disabled:opacity-60"
            style={{ background: "#ff8c5a", color: "#04121a" }}
          >
            ✦ Connect — we just met
          </button>
        )}

        {/* action row — Save opens the label picker (bookmark labels, F3) */}
        <div className={connect && !isSaved ? "mt-2" : "mt-5"}>
          <button
            type="button"
            disabled={busy}
            onClick={() => (isSaved ? void unsave() : setLabelOpen((v) => !v))}
            className="flex w-full items-center justify-center gap-2 rounded-xl px-4 py-3 text-sm font-semibold disabled:opacity-60"
            style={isSaved
              ? { background: "rgba(154,240,200,0.16)", color: "#9af0c8" }
              : { background: "#9af0c8", color: "#04121a" }}
          >
            {isSaved ? <><BookmarkCheck size={16} /> Saved — tap to remove</> : <><Bookmark size={16} /> Save contact</>}
          </button>
          {labelOpen && !isSaved && (
            <div className="mt-2 rounded-xl border border-line p-2.5">
              <p className="mb-2 text-[11px] text-faint">Tag why (pick any that apply):</p>
              <div className="flex flex-wrap gap-1.5">
                {CONTACT_LABELS.map((l) => {
                  const on = picked.includes(l.id);
                  return (
                    <button
                      key={l.id}
                      type="button"
                      disabled={busy}
                      onClick={() => toggleLabel(l.id)}
                      className="rounded-full border px-2.5 py-1 text-[12px] transition"
                      style={on
                        ? { borderColor: "rgba(154,240,200,0.6)", color: "#9af0c8", background: "rgba(154,240,200,0.1)" }
                        : { borderColor: "var(--color-line)", color: "var(--color-dim)" }}
                    >
                      {l.label}
                    </button>
                  );
                })}
              </div>
              <button
                type="button"
                disabled={busy}
                onClick={() => void saveWithLabels()}
                className="mt-2.5 w-full rounded-lg py-2 text-[13px] font-semibold text-[#04121a] disabled:opacity-60"
                style={{ background: "#9af0c8" }}
              >
                {picked.length ? `Save with ${picked.length} tag${picked.length > 1 ? "s" : ""}` : "Save"}
              </button>
            </div>
          )}
        </div>

        {/* Request a 1:1, or ask the speaker a question */}
        {node.type === "person" && (
          <div className="mt-2">
            {meetSent ? (
              <p className="flex items-center justify-center gap-1.5 rounded-xl bg-[rgba(154,240,200,0.12)] py-2.5 text-sm text-[#9af0c8]">
                <Check size={15} /> {isSpeaker ? "Question submitted" : "Meeting requested"}
              </p>
            ) : !meetOpen ? (
              <button type="button" onClick={() => setMeetOpen(true)}
                className="flex w-full items-center justify-center gap-2 rounded-xl border border-line py-2.5 text-sm text-dim hover:text-ink">
                <CalendarPlus size={15} /> {isSpeaker ? "Ask a question" : "Request a 1:1"}
              </button>
            ) : (
              <div className="space-y-2 rounded-xl border border-line p-3">
                {!isSpeaker && (
                  <>
                    <label className="block">
                      <span className="mb-1 block text-[11px] font-medium text-dim">When</span>
                      <input
                        type="datetime-local"
                        value={slot}
                        onChange={(e) => setSlot(e.target.value)}
                        className="w-full rounded-lg border border-line bg-space/60 px-3 py-2 text-sm text-ink outline-none focus:border-gold/60 [color-scheme:dark]"
                      />
                    </label>
                    <label className="block">
                      <span className="mb-1 block text-[11px] font-medium text-dim">Where</span>
                      <select
                        value={venue}
                        onChange={(e) => setVenue(e.target.value)}
                        className="w-full rounded-lg border border-line bg-space/60 px-3 py-2 text-sm text-ink outline-none focus:border-gold/60"
                      >
                        <option value="">Pick a spot…</option>
                        {venues.map((v) => (
                          <option key={v.id} value={v.label}>{v.label}</option>
                        ))}
                        <option value="__custom">Somewhere else…</option>
                      </select>
                    </label>
                    {venue === "__custom" && (
                      <input
                        autoFocus
                        value={customVenue}
                        onChange={(e) => setCustomVenue(e.target.value)}
                        placeholder="Describe where (e.g. by the blue food truck)"
                        className="w-full rounded-lg border border-line bg-space/60 px-3 py-2 text-sm text-ink outline-none focus:border-gold/60"
                      />
                    )}
                  </>
                )}
                <input value={note} onChange={(e) => setNote(e.target.value)}
                  placeholder={isSpeaker ? "Your question for the talk…" : "Note (optional)"}
                  className="w-full rounded-lg border border-line bg-space/60 px-3 py-2 text-sm text-ink outline-none focus:border-gold/60" />
                <button
                  type="button"
                  disabled={sending || (isSpeaker ? !note.trim() : !slot || (venue === "__custom" && !customVenue.trim()))}
                  onClick={sendMeeting}
                  className="w-full rounded-lg bg-[#ff8c5a] py-2 text-sm font-semibold text-space disabled:opacity-50"
                >
                  {sending ? "Sending…" : isSpeaker ? "Submit question" : "Send request"}
                </button>
              </div>
            )}
          </div>
        )}

        {/* Meeting note — the post-style composer sheet (F5 v2) */}
        {node.type === "person" && (
          <div className="mt-2">
            <button
              type="button"
              onClick={() => { setEditNote(undefined); setComposerOpen(true); }}
              className="flex w-full items-center justify-center gap-2 rounded-xl border border-line py-2.5 text-sm text-dim hover:text-ink"
            >
              <NotebookPen size={15} /> Add a meeting note
            </button>

            {/* Community + your notes about this person (audience-filtered) */}
            {communityNotes.length > 0 && (
              <div className="mt-3 space-y-1.5">
                <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-faint">Notes</div>
                {communityNotes.slice(0, 5).map((n) => (
                  <div key={n.id} className="rounded-lg border border-line/60 bg-space/40 px-2.5 py-2">
                    <div className="flex items-center gap-1.5 text-[10.5px] text-faint">
                      {n.visibility === "public" ? <Globe size={10} /> : n.visibility === "connections" ? <Users size={10} /> : <Lock size={10} />}
                      <span className="font-semibold">{n.mine ? "You" : n.authorLabel}</span>
                      {n.mine && (
                        <button type="button" onClick={() => { setEditNote(n); setComposerOpen(true); }}
                          className="ml-auto inline-flex items-center gap-0.5 text-faint hover:text-ink">
                          <Pencil size={10} /> edit
                        </button>
                      )}
                    </div>
                    <p className="mt-0.5 text-[12px] leading-snug text-dim">{n.text}</p>
                    {n.photos && n.photos.length > 0 && (
                      <div className="mt-1.5 flex gap-1.5 overflow-x-auto">
                        {n.photos.map((u) => (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img key={u} src={u} alt="" className="h-14 w-14 shrink-0 rounded-md border border-line object-cover" />
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Ask your network for a warm intro */}
        <button type="button" onClick={requestIntro} disabled={introSent}
          className="mt-2 flex w-full items-center justify-center gap-1.5 py-2 text-xs text-faint hover:text-dim disabled:opacity-70">
          <Handshake size={14} /> {introSent ? "Intro requested from your network" : "Ask your network for an intro"}
        </button>

        {composerOpen && (
          <NoteComposer
            target={{ id: node.id, label: node.label }}
            edit={editNote}
            onClose={() => { setComposerOpen(false); setEditNote(undefined); }}
            onSaved={() => { onChange?.(); void loadNotes(); }}
          />
        )}
      </div>
    </div>
  );
}
