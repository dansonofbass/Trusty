"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { appBySlug, DEFAULT_NOTE_KINDS, type NotePrivacy } from "@constellation/graph-core";
import { streamExtract } from "@/lib/extractClient";
import {
  saveNote, updateNoteApi, uploadImage, SUMMIT_APP,
  type NoteEntity, type NoteRelation, type NoteVisibility, type MeetingNoteRecord,
} from "@/lib/summitClient";
import {
  Sparkles, Loader2, X, Plus, Trash2, Mic, MicOff, Lock, Users, Globe,
  ShieldCheck, ShieldAlert, RefreshCw, ImagePlus, ArrowRight,
} from "lucide-react";

/**
 * Meeting-note composer v2 (F5) — a post-style bottom sheet: room to write,
 * template starters, voice dictation, photo attachments, streamed AI extraction
 * with FULLY EDITABLE entities AND relations (they become labeled graph edges),
 * a visibility control (private · connections · public) and an AI privacy check
 * (warn + confirm). The entity-kind taxonomy is admin-managed (app config
 * `noteKinds` in /admin/apps) with a sensible default.
 */

export const NOTE_KIND_COLOR: Record<string, string> = {
  need: "#ffb347",
  api: "#ff8c5a",
  technology: "#9af0c8",
  skill: "#9af0c8",
  market: "#e3c84b",
  country: "#e3c84b",
  investor: "#a578ff",
  mentor: "#a578ff",
  startup: "#7c96ff",
  organization: "#7c96ff",
  person: "#7c96ff",
  idea: "#ff8c5a",
  concept: "#8e97bd",
};
const kindColor = (k: string) => NOTE_KIND_COLOR[k] ?? "#8e97bd";

const TEMPLATES = ["Needs ", "Offers ", "Building ", "Follow up on ", "Intro'd by "];

const VISIBILITIES: { id: NoteVisibility; label: string; icon: typeof Lock }[] = [
  { id: "private", label: "Private", icon: Lock },
  { id: "connections", label: "Connections", icon: Users },
  { id: "public", label: "Public", icon: Globe },
];

type Phase = "write" | "extracting" | "review" | "saving";

interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((ev: { resultIndex: number; results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void) | null;
  onerror: ((ev: { error?: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
}

export default function NoteComposer({
  target,
  edit,
  onClose,
  onSaved,
}: {
  target: { id: string; label: string };
  /** When set, the sheet edits this existing note (PUT) instead of creating. */
  edit?: MeetingNoteRecord;
  onClose: () => void;
  onSaved?: () => void;
}) {
  const draftKey = `sevan_note_draft_${target.id}`;
  const [phase, setPhase] = useState<Phase>("write");
  const [text, setText] = useState(edit?.text ?? "");
  const [status, setStatus] = useState("");
  const [entities, setEntities] = useState<NoteEntity[]>(edit?.extraction?.entities ?? []);
  const [relations, setRelations] = useState<NoteRelation[]>(edit?.extraction?.relations ?? []);
  const [photos, setPhotos] = useState<string[]>(edit?.photos ?? []);
  const [uploading, setUploading] = useState(false);
  const [reviewed, setReviewed] = useState(!!edit); // edit mode starts in review
  const [visibility, setVisibility] = useState<NoteVisibility>(edit?.visibility ?? "private");
  const [privacy, setPrivacy] = useState<NotePrivacy | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const textRef = useRef<HTMLTextAreaElement | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  /* Admin-managed extraction taxonomy: app config.noteKinds, else the default. */
  const KINDS = useMemo(() => {
    const cfg = appBySlug(SUMMIT_APP)?.config?.noteKinds;
    return Array.isArray(cfg) && cfg.length ? cfg.map(String) : [...DEFAULT_NOTE_KINDS];
  }, []);
  const usingCustomKinds = KINDS.join(",") !== DEFAULT_NOTE_KINDS.join(",");

  /* ---- draft autosave (create mode only) ---- */
  useEffect(() => {
    if (edit) return;
    const saved = window.localStorage.getItem(draftKey);
    if (saved && !text) setText(saved);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (edit) return;
    const t = setTimeout(() => {
      if (text.trim()) window.localStorage.setItem(draftKey, text);
      else window.localStorage.removeItem(draftKey);
    }, 400);
    return () => clearTimeout(t);
  }, [text, draftKey, edit]);

  /* ---- voice dictation (Web Speech API) ---- */
  const [voiceOn, setVoiceOn] = useState(false);
  const [voiceErr, setVoiceErr] = useState<string | null>(null);
  const recRef = useRef<SpeechRecognitionLike | null>(null);
  const SpeechRec =
    typeof window !== "undefined"
      ? ((window as unknown as Record<string, unknown>).SpeechRecognition ??
        (window as unknown as Record<string, unknown>).webkitSpeechRecognition)
      : undefined;

  const toggleVoice = () => {
    setVoiceErr(null);
    if (voiceOn) {
      recRef.current?.stop();
      setVoiceOn(false);
      return;
    }
    if (!SpeechRec) return;
    try {
      const rec = new (SpeechRec as new () => SpeechRecognitionLike)();
      rec.lang = navigator.language || "en-US";
      rec.continuous = true;
      rec.interimResults = false;
      rec.onresult = (ev) => {
        let final = "";
        for (let i = ev.resultIndex; i < ev.results.length; i++) {
          if (ev.results[i].isFinal) final += ev.results[i][0].transcript;
        }
        if (final) setText((t) => (t ? `${t.replace(/\s+$/, "")} ${final.trim()}` : final.trim()));
      };
      rec.onerror = (ev) => {
        const code = ev?.error ?? "unknown";
        setVoiceErr(
          code === "not-allowed" || code === "service-not-allowed"
            ? "Microphone blocked — allow mic access for this site."
            : code === "network"
              ? "Speech service unreachable (dictation needs internet)."
              : code === "no-speech"
                ? "Didn't catch that — try speaking again."
                : `Dictation error: ${code}`,
        );
        setVoiceOn(false);
      };
      rec.onend = () => setVoiceOn(false);
      recRef.current = rec;
      rec.start();
      setVoiceOn(true);
    } catch {
      setVoiceErr("Dictation isn't available in this browser.");
    }
  };
  useEffect(() => () => recRef.current?.stop(), []);

  /* ---- photos ---- */
  const attachPhotos = async (files: FileList | null) => {
    if (!files?.length) return;
    setUploading(true);
    setErr(null);
    try {
      for (const f of Array.from(files).slice(0, 6 - photos.length)) {
        const url = await uploadImage(f, "notes");
        setPhotos((p) => [...p, url]);
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  /* ---- extraction ---- */
  const extract = useCallback(async () => {
    setPhase("extracting");
    setErr(null);
    setStatus("Reading your note…");
    try {
      const r = await streamExtract(
        text,
        { onEvent: (ev) => { if (ev.type === "phase") setStatus(ev.label); } },
        { domain: "summit", kinds: usingCustomKinds ? KINDS : undefined },
      );
      const es = r.extraction.entities.map((e) => ({ name: e.name, kind: String(e.kind) }));
      setEntities(es);
      // Keep only relations whose endpoints resolve to an entity or the person.
      const names = new Set([...es.map((e) => e.name.toLowerCase()), target.label.toLowerCase()]);
      setRelations(
        (r.extraction.relations ?? [])
          .filter((rel) => names.has(rel.source.toLowerCase()) && names.has(rel.target.toLowerCase()))
          .map((rel) => ({ source: rel.source, target: rel.target, label: rel.label })),
      );
      setPrivacy(r.privacy ?? null);
      setReviewed(true);
      setPhase("review");
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setPhase(reviewed ? "review" : "write");
    }
  }, [text, reviewed, KINDS, usingCustomKinds, target.label]);

  /* ---- entity + relation editing (the headline) ---- */
  const editEntity = (i: number, patch: Partial<NoteEntity>) => {
    const before = entities[i];
    setEntities((es) => es.map((e, j) => (j === i ? { ...e, ...patch } : e)));
    // Renames follow through into relations.
    if (patch.name && before) {
      setRelations((rs) => rs.map((r) => ({
        ...r,
        source: r.source === before.name ? patch.name! : r.source,
        target: r.target === before.name ? patch.name! : r.target,
      })));
    }
  };
  const removeEntity = (i: number) => {
    const gone = entities[i];
    setEntities((es) => es.filter((_, j) => j !== i));
    if (gone) setRelations((rs) => rs.filter((r) => r.source !== gone.name && r.target !== gone.name));
  };
  const addEntity = () => setEntities((es) => [...es, { name: "", kind: KINDS[KINDS.length - 1] ?? "concept" }]);

  const relOptions = useMemo(
    () => [target.label, ...entities.map((e) => e.name).filter(Boolean)],
    [entities, target.label],
  );
  const editRelation = (i: number, patch: Partial<NoteRelation>) =>
    setRelations((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const removeRelation = (i: number) => setRelations((rs) => rs.filter((_, j) => j !== i));
  const addRelation = () =>
    setRelations((rs) => [...rs, { source: target.label, label: "needs", target: entities[0]?.name ?? "" }]);

  /* ---- save / post ---- */
  const save = async () => {
    setPhase("saving");
    setErr(null);
    const cleanE = entities.map((e) => ({ name: e.name.trim(), kind: e.kind })).filter((e) => e.name);
    const names = new Set([...cleanE.map((e) => e.name.toLowerCase()), target.label.toLowerCase()]);
    const cleanR = relations
      .map((r) => ({ source: r.source.trim(), target: r.target.trim(), label: r.label.trim() }))
      .filter((r) => r.source && r.target && r.label && r.source !== r.target)
      .filter((r) => names.has(r.source.toLowerCase()) && names.has(r.target.toLowerCase()));
    try {
      if (edit) await updateNoteApi(edit.id, { text: text.trim(), entities: cleanE, relations: cleanR, visibility, photos });
      else await saveNote(target.id, text.trim(), cleanE, visibility, cleanR, photos);
      window.localStorage.removeItem(draftKey);
      onSaved?.();
      onClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setPhase("review");
    }
  };

  const saveLabel =
    visibility === "public" ? "Post publicly" : visibility === "connections" ? "Share with connections" : "Save privately";
  const showPrivacy = reviewed && visibility !== "private";
  const busy = phase === "extracting" || phase === "saving";
  const connectionCount = entities.filter((e) => e.name.trim()).length + relations.filter((r) => r.label.trim()).length;

  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end">
      <div className="sheet-backdrop" onClick={onClose} />
      <div className="sheet-panel border border-line bg-nebula/95 backdrop-blur-md" style={{ maxHeight: "92dvh" }}>
        {/* header */}
        <div className="flex items-center justify-between border-b border-line px-5 py-3.5">
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[#ff8c5a]">
              {edit ? "Edit note" : "Meeting note"}
            </div>
            <h2 className="text-[15px] font-bold text-ink" style={{ fontFamily: "var(--font-display)" }}>
              About {target.label}
            </h2>
          </div>
          <button type="button" onClick={onClose} className="rounded-full p-1.5 text-dim hover:text-ink"><X size={18} /></button>
        </div>

        {/* body */}
        <div className="scroll-quiet min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {/* template starters */}
          <div className="mb-2 flex flex-wrap items-center gap-1.5">
            {TEMPLATES.map((t) => (
              <button key={t} type="button" disabled={busy}
                onClick={() => { setText((v) => (v && !/\s$/.test(v) ? `${v}\n${t}` : v + t)); textRef.current?.focus(); }}
                className="rounded-full border border-line px-2.5 py-1 text-[11px] text-dim hover:border-gold/50 hover:text-ink">
                {t.trim()}…
              </button>
            ))}
          </div>

          <textarea
            ref={textRef}
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={7}
            disabled={busy}
            placeholder={`What happened with ${target.label}?\n\ne.g. "Met at the pitch tent — building fintech for Armenia, needs a React dev and seed funding…"`}
            className="min-h-[8rem] w-full resize-y rounded-xl border border-line bg-space/60 px-3.5 py-3 text-[15px] leading-relaxed text-ink outline-none focus:border-gold/60"
          />

          {/* dictate + photos — prominent, side by side */}
          <div className="mt-2 grid grid-cols-2 gap-2">
            {SpeechRec ? (
              <button type="button" onClick={toggleVoice} disabled={busy}
                className="flex items-center justify-center gap-1.5 rounded-xl border py-2.5 text-[13px] font-semibold"
                style={voiceOn
                  ? { borderColor: "rgba(255,140,90,0.7)", background: "rgba(255,140,90,0.12)", color: "#ff8c5a" }
                  : { borderColor: "var(--color-line)", color: "var(--color-dim)" }}>
                {voiceOn
                  ? <><span className="pulse-dot" /> <MicOff size={15} /> Listening… tap to stop</>
                  : <><Mic size={15} /> Dictate</>}
              </button>
            ) : (
              <div className="grid place-items-center rounded-xl border border-line/50 py-2.5 text-[11px] text-faint">
                Dictation not supported here
              </div>
            )}
            <button type="button" onClick={() => fileRef.current?.click()} disabled={busy || uploading || photos.length >= 6}
              className="flex items-center justify-center gap-1.5 rounded-xl border border-line py-2.5 text-[13px] font-semibold text-dim hover:text-ink disabled:opacity-50">
              {uploading ? <Loader2 className="animate-spin" size={15} /> : <ImagePlus size={15} />} Add photo
            </button>
            <input ref={fileRef} type="file" accept="image/*" multiple hidden onChange={(e) => void attachPhotos(e.target.files)} />
          </div>
          {voiceErr && <p className="mt-1 text-[11.5px] text-amber-300">{voiceErr}</p>}

          {photos.length > 0 && (
            <div className="mt-2 flex gap-2 overflow-x-auto">
              {photos.map((u) => (
                <div key={u} className="relative shrink-0">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={u} alt="attachment" className="h-16 w-16 rounded-lg border border-line object-cover" />
                  <button type="button" onClick={() => setPhotos((p) => p.filter((x) => x !== u))}
                    className="absolute -right-1.5 -top-1.5 grid h-4 w-4 place-items-center rounded-full bg-space text-faint hover:text-rose-300">
                    <X size={10} />
                  </button>
                </div>
              ))}
            </div>
          )}

          {phase === "extracting" && (
            <p className="mt-2 flex items-center gap-2 text-xs text-dim"><Loader2 className="animate-spin" size={13} /> {status}</p>
          )}

          {/* editable entities + relations */}
          {reviewed && phase !== "extracting" && (
            <>
              <div className="mt-4">
                <div className="mb-1.5 flex items-center justify-between">
                  <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-faint">
                    Entities — edit freely
                  </span>
                  <button type="button" onClick={() => void extract()} disabled={busy || text.trim().length < 12}
                    className="inline-flex items-center gap-1 text-[11px] text-dim hover:text-ink disabled:opacity-40">
                    <RefreshCw size={11} /> Re-extract
                  </button>
                </div>
                <div className="space-y-1.5">
                  {entities.map((e, i) => (
                    <div key={i} className="flex items-center gap-1.5">
                      <select
                        value={e.kind}
                        onChange={(ev) => editEntity(i, { kind: ev.target.value })}
                        className="w-28 shrink-0 rounded-lg border border-line bg-space/60 px-1.5 py-1.5 text-[12px] outline-none"
                        style={{ color: kindColor(e.kind) }}
                      >
                        {[...new Set([...KINDS, e.kind])].map((k) => <option key={k} value={k}>{k}</option>)}
                      </select>
                      <input
                        value={e.name}
                        onChange={(ev) => editEntity(i, { name: ev.target.value })}
                        placeholder="entity name"
                        className="min-w-0 flex-1 rounded-lg border border-line bg-space/60 px-2.5 py-1.5 text-[13px] text-ink outline-none focus:border-gold/60"
                      />
                      <button type="button" onClick={() => removeEntity(i)} className="p-1 text-faint hover:text-rose-300">
                        <Trash2 size={14} />
                      </button>
                    </div>
                  ))}
                  <button type="button" onClick={addEntity}
                    className="inline-flex items-center gap-1 py-1 text-[12px] text-dim hover:text-ink">
                    <Plus size={12} /> Add entity
                  </button>
                </div>
              </div>

              {/* relations — become labeled edges on the graph */}
              <div className="mt-4">
                <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-faint">
                  Relations — drawn as edges on the graph
                </div>
                <div className="space-y-1.5">
                  {relations.map((r, i) => (
                    <div key={i} className="flex items-center gap-1">
                      <select value={r.source} onChange={(ev) => editRelation(i, { source: ev.target.value })}
                        className="min-w-0 flex-1 rounded-lg border border-line bg-space/60 px-1.5 py-1.5 text-[12px] text-ink outline-none">
                        {[...new Set([r.source, ...relOptions])].filter(Boolean).map((o) => <option key={o} value={o}>{o}</option>)}
                      </select>
                      <input value={r.label} onChange={(ev) => editRelation(i, { label: ev.target.value })}
                        placeholder="needs / uses / targets"
                        className="w-24 shrink-0 rounded-lg border border-[#ff8c5a]/30 bg-space/60 px-1.5 py-1.5 text-center text-[11px] text-[#ff8c5a] outline-none" />
                      <ArrowRight size={11} className="shrink-0 text-faint" />
                      <select value={r.target} onChange={(ev) => editRelation(i, { target: ev.target.value })}
                        className="min-w-0 flex-1 rounded-lg border border-line bg-space/60 px-1.5 py-1.5 text-[12px] text-ink outline-none">
                        {[...new Set([r.target, ...relOptions])].filter(Boolean).map((o) => <option key={o} value={o}>{o}</option>)}
                      </select>
                      <button type="button" onClick={() => removeRelation(i)} className="p-1 text-faint hover:text-rose-300">
                        <Trash2 size={13} />
                      </button>
                    </div>
                  ))}
                  <button type="button" onClick={addRelation} disabled={relOptions.length < 2}
                    className="inline-flex items-center gap-1 py-1 text-[12px] text-dim hover:text-ink disabled:opacity-40">
                    <Plus size={12} /> Add relation
                  </button>
                </div>
              </div>
            </>
          )}

          {err && <p className="mt-2 text-xs text-rose-300">{err}</p>}
        </div>

        {/* footer: visibility + privacy banner + action */}
        <div className="space-y-2.5 border-t border-line px-5 py-3.5 pb-[max(0.875rem,env(safe-area-inset-bottom))]">
          <div className="flex rounded-full border border-line bg-space/50 p-1">
            {VISIBILITIES.map((v) => {
              const Icon = v.icon;
              const active = visibility === v.id;
              return (
                <button key={v.id} type="button" onClick={() => setVisibility(v.id)}
                  className="flex flex-1 items-center justify-center gap-1.5 rounded-full py-1.5 text-[12px] font-semibold transition"
                  style={active ? { background: "rgba(255,140,90,0.16)", color: "var(--color-ink)" } : { color: "var(--color-faint)" }}>
                  <Icon size={13} /> {v.label}
                </button>
              );
            })}
          </div>

          {showPrivacy && privacy && (
            privacy.public_ok ? (
              <p className="flex items-center gap-1.5 rounded-lg bg-[rgba(154,240,200,0.1)] px-3 py-2 text-[12px] text-[#9af0c8]">
                <ShieldCheck size={13} /> AI check: looks safe to share
              </p>
            ) : (
              <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2">
                <p className="flex items-center gap-1.5 text-[12px] font-semibold text-amber-200">
                  <ShieldAlert size={13} /> AI check — think twice before sharing:
                </p>
                <ul className="mt-0.5 list-inside list-disc text-[11.5px] text-amber-200/80">
                  {privacy.reasons.map((r) => <li key={r}>{r}</li>)}
                </ul>
                <button type="button" onClick={() => setVisibility("private")}
                  className="mt-1.5 rounded-lg border border-line px-2.5 py-1 text-[11px] text-dim hover:text-ink">
                  Keep private instead
                </button>
              </div>
            )
          )}

          {!reviewed ? (
            <button type="button" disabled={text.trim().length < 12 || busy} onClick={() => void extract()}
              className="flex w-full items-center justify-center gap-1.5 rounded-xl bg-[#ff8c5a] py-3 text-sm font-bold text-space disabled:opacity-50">
              <Sparkles size={15} /> Extract & review
            </button>
          ) : (
            <button type="button" disabled={busy || text.trim().length < 12} onClick={() => void save()}
              className="w-full rounded-xl py-3 text-sm font-bold disabled:opacity-50"
              style={{ background: "#9af0c8", color: "#04121a" }}>
              {phase === "saving" ? "Saving…" : saveLabel}
              {connectionCount > 0 && phase !== "saving" ? ` · ${connectionCount} connections` : ""}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
