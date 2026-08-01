"use client";

/**
 * Summit Home — the buttons-first summit front door (last-day usability fix).
 * Field testing showed strangers get lost in the chat-first flow; this screen
 * is the antidote: a 2-step tap-through setup and the whole summit in six big
 * buttons. Zero typing except your startup's name. The concierge chat stays
 * one tap away — depth, not the door.
 *
 * Everything here talks to endpoints that already existed (profile, squads,
 * who-to-meet, programme, contacts, rooms) — UI only.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  CalendarDays, Check, ChevronLeft, Loader2, MessageCircle, QrCode, ScanLine, Sparkles, UserPlus, Users, X,
} from "lucide-react";
import type { GNode } from "@constellation/graph-core";
import { QRShare, QRScan } from "@/components/summit/QRConnect";
import {
  confirmSquadmate, getMyProfile, getMySquad, getProgramme, getSquads, getWhoToMeet, joinSquad,
  saveContact, saveMyProfile, setAttending,
  type MeetCard, type ProgrammeItem, type SquadMember, type SquadRow,
} from "@/lib/summitClient";
import { fetchRooms } from "@/lib/socialClient";
import { useGraphData } from "@/lib/graph/GraphDataProvider";
import { useUI } from "@/lib/store";

const SKILL_CHIPS = [
  "product", "fundraising", "marketing", "sales", "tech", "design", "hr", "strategy", "investment", "co-founder",
];
const PROGRAMS = ["Starter", "Booster", "Talent", "FireCode"];

type Panel = null | "squad" | "meet" | "today";

function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-[70]">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} aria-hidden />
      <div className="absolute inset-x-0 bottom-0 max-h-[88dvh] overflow-y-auto rounded-t-[20px] border border-line bg-[var(--color-card)] p-4 pb-[max(env(safe-area-inset-bottom),16px)] md:inset-x-auto md:left-1/2 md:top-1/2 md:bottom-auto md:w-[460px] md:-translate-x-1/2 md:-translate-y-1/2 md:rounded-2xl md:pb-4">
        <div className="mb-3 flex items-center justify-between">
          <span className="text-[14px] font-bold text-ink" style={{ fontFamily: "var(--font-display)" }}>{title}</span>
          <button type="button" onClick={onClose} aria-label="Close" className="grid h-8 w-8 place-items-center">
            <X size={16} className="text-[var(--color-faint)]" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function ChipGroup({ label, all, picked, onToggle }: {
  label: string; all: string[]; picked: string[]; onToggle: (v: string) => void;
}) {
  return (
    <div className="mb-3">
      <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--color-faint)]">{label}</div>
      <div className="flex flex-wrap gap-1.5">
        {all.map((v) => {
          const on = picked.includes(v);
          return (
            <button
              key={v}
              type="button"
              onClick={() => onToggle(v)}
              className="rounded-full border px-3 py-1.5 text-[12.5px] font-medium transition"
              style={on
                ? { borderColor: "var(--color-accent-line)", background: "var(--color-accent-soft)", color: "var(--color-accent)" }
                : { borderColor: "var(--color-line)", color: "var(--color-dim)" }}
            >
              {v.replace(/_/g, " ")}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export default function SummitHome() {
  const router = useRouter();
  const { data } = useGraphData();
  const select = useUI((s) => s.select);
  const setChatPrefill = useUI((s) => s.setChatPrefill);

  const meId = data?.meId ?? null;
  const meLabel = useMemo(
    () => data?.nodes.find((n) => n.id === meId)?.label ?? "You",
    [data, meId],
  );

  // Setup state
  const [profile, setProfile] = useState<GNode | null | undefined>(undefined); // undefined = loading
  const [mySquad, setMySquad] = useState<{ id: string; label: string } | null | undefined>(undefined);
  const [sheet, setSheet] = useState<null | "profile" | "squad">(null);
  const [panel, setPanel] = useState<Panel>(null);
  const [qr, setQr] = useState<null | "share" | "scan">(null);
  const [toast, setToast] = useState<string | null>(null);
  const flash = (m: string) => { setToast(m); setTimeout(() => setToast(null), 3200); };

  const refresh = useCallback(() => {
    getMyProfile().then(setProfile).catch(() => setProfile(null));
    getMySquad().then((r) => setMySquad(r.squad)).catch(() => setMySquad(null));
  }, []);
  useEffect(() => { refresh(); }, [refresh]);

  const profileDone = !!profile && !!(profile.properties as { startup?: unknown } | undefined)?.startup;
  const squadDone = !!mySquad;
  const loading = profile === undefined || mySquad === undefined;
  const setupDone = profileDone && squadDone;

  /* ---------------- Step 1: who you are ---------------- */
  const p = (profile?.properties ?? {}) as Record<string, unknown>;
  const [startup, setStartup] = useState("");
  const [offered, setOffered] = useState<string[]>([]);
  const [needed, setNeeded] = useState<string[]>([]);
  const [program, setProgram] = useState<string>("");
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (!profile) return;
    setStartup(String(p.startup ?? ""));
    setOffered(Array.isArray(p.skills_offered) ? p.skills_offered.map(String) : []);
    setNeeded(Array.isArray(p.skills_needed) ? p.skills_needed.map(String) : []);
    setProgram(String(p.program ?? ""));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile]);

  const toggle = (list: string[], set: (v: string[]) => void) => (v: string) =>
    set(list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

  const saveProfile = async () => {
    if (saving) return;
    setSaving(true);
    try {
      await saveMyProfile({
        roles: ["founder"],
        entityType: "founder",
        properties: {
          startup: startup.trim(),
          skills_offered: offered,
          skills_needed: needed,
          ...(program ? { program } : {}),
        },
      });
      setSheet(squadDone ? null : "squad"); // flow straight into step 2
      refresh();
      flash("Profile saved ✓");
    } catch (e) {
      flash(e instanceof Error ? e.message : "couldn't save — try again");
    } finally {
      setSaving(false);
    }
  };

  /* ---------------- Step 2: squad ---------------- */
  const [squads, setSquads] = useState<SquadRow[] | null>(null);
  const [joining, setJoining] = useState<string | null>(null);
  useEffect(() => {
    if (sheet === "squad" && !squads) getSquads().then((r) => setSquads(r.squads)).catch(() => setSquads([]));
  }, [sheet, squads]);

  const doJoin = async (sq: SquadRow) => {
    setJoining(sq.id);
    try {
      const r = await joinSquad(sq.id);
      setSheet(null);
      refresh();
      flash(r.autoConnected > 0
        ? `You're in ${sq.label} — ${r.autoConnected} squadmate${r.autoConnected === 1 ? "" : "s"} saved to your contacts ✓`
        : `You're in ${sq.label} ✓`);
    } catch (e) {
      flash(e instanceof Error ? e.message : "couldn't join — try again");
    } finally {
      setJoining(null);
    }
  };

  /* ---------------- Panels ---------------- */
  const [members, setMembers] = useState<SquadMember[] | null>(null);
  const [squadRoomId, setSquadRoomId] = useState<string | null>(null);
  useEffect(() => {
    if (panel !== "squad") return;
    getMySquad().then((r) => setMembers(r.members)).catch(() => setMembers([]));
    fetchRooms().then((r) => {
      const sq = r.rooms.find((x) => x.kind === "squad");
      if (sq) setSquadRoomId(sq.id);
    }).catch(() => {});
  }, [panel]);

  const [meet, setMeet] = useState<MeetCard[] | null>(null);
  const [savedMeet, setSavedMeet] = useState<Set<string>>(new Set());
  useEffect(() => {
    if (panel !== "meet") return;
    getWhoToMeet(undefined, undefined, { includeCold: true, limit: 8 })
      .then(setMeet)
      .catch(() => setMeet([]));
  }, [panel]);

  const [agenda, setAgenda] = useState<ProgrammeItem[] | null>(null);
  useEffect(() => {
    if (panel !== "today") return;
    getProgramme().then((items) => {
      const today = new Date().toLocaleDateString("en-US", { month: "short", day: "numeric" });
      const todays = items.filter((i) => String((i.node.properties as { day?: unknown } | undefined)?.day ?? "") === today);
      setAgenda(todays.length ? todays : items.slice(0, 12));
    }).catch(() => setAgenda([]));
  }, [panel]);

  /* ---------------- Render ---------------- */
  const bigBtn = (icon: React.ReactNode, label: string, sub: string, onClick: () => void, accent = false) => (
    <button
      type="button"
      onClick={onClick}
      className="flex min-h-[86px] flex-col items-start justify-between rounded-2xl border p-3.5 text-left transition active:scale-[0.98]"
      style={accent
        ? { borderColor: "var(--color-accent-line)", background: "var(--color-accent-soft)" }
        : { borderColor: "var(--color-line)", background: "var(--color-surface)" }}
    >
      <span style={{ color: accent ? "var(--color-accent)" : "var(--color-dim)" }}>{icon}</span>
      <span>
        <span className="block text-[13.5px] font-bold leading-tight text-ink">{label}</span>
        <span className="block text-[10.5px] leading-tight text-[var(--color-faint)]">{sub}</span>
      </span>
    </button>
  );

  return (
    <div className="mx-auto w-full max-w-[560px]">
      <h1 className="text-center text-[22px] font-bold leading-tight text-ink md:text-[26px]" style={{ fontFamily: "var(--font-display)" }}>
        🎪 Seaside Startup Summit
      </h1>
      <p className="mb-4 mt-1 text-center text-[12.5px] text-[var(--color-dim)]">
        Everyone you met leaves today — Trusty keeps them.
      </p>

      {/* Setup checklist — visible until both steps done */}
      {!loading && !setupDone && (
        <div className="mb-4 rounded-2xl border p-3.5" style={{ borderColor: "var(--color-accent-line)", background: "var(--color-accent-soft)" }}>
          <div className="mb-2 text-[12.5px] font-bold text-ink">Get set up — 2 taps, ~1 minute</div>
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => setSheet("profile")}
              className="flex items-center gap-2 rounded-xl border border-[var(--color-line)] bg-[var(--color-card)] px-3 py-2.5 text-left"
            >
              <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full text-[11px] font-bold" style={profileDone ? { background: "#54d26e33", color: "#54d26e" } : { background: "var(--color-tint)", color: "var(--color-dim)" }}>
                {profileDone ? <Check size={13} /> : "1"}
              </span>
              <span className="text-[12px] font-semibold text-ink">Who you are</span>
            </button>
            <button
              type="button"
              onClick={() => setSheet("squad")}
              className="flex items-center gap-2 rounded-xl border border-[var(--color-line)] bg-[var(--color-card)] px-3 py-2.5 text-left"
            >
              <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full text-[11px] font-bold" style={squadDone ? { background: "#54d26e33", color: "#54d26e" } : { background: "var(--color-tint)", color: "var(--color-dim)" }}>
                {squadDone ? <Check size={13} /> : "2"}
              </span>
              <span className="text-[12px] font-semibold text-ink">Your squad</span>
            </button>
          </div>
        </div>
      )}

      {/* The whole summit in six buttons */}
      <div className="grid grid-cols-2 gap-2">
        {bigBtn(<QrCode size={20} />, "My QR", "They scan → you're connected", () => setQr("share"), true)}
        {bigBtn(<ScanLine size={20} />, "Scan someone", "Save who you just met", () => setQr("scan"))}
        {bigBtn(<Users size={20} />, mySquad ? mySquad.label : "My squad", mySquad ? "Members & squad chat" : "Join first (step 2)", () => (mySquad ? setPanel(panel === "squad" ? null : "squad") : setSheet("squad")))}
        {bigBtn(<Sparkles size={20} />, "Who to meet", "Matches, with reasons", () => setPanel(panel === "meet" ? null : "meet"))}
        {bigBtn(<CalendarDays size={20} />, "Today", "Sessions you can join", () => setPanel(panel === "today" ? null : "today"))}
        {bigBtn(<MessageCircle size={20} />, "Ask anything", "The concierge — type below", () => {
          setChatPrefill("/summit ");
        })}
      </div>

      {/* Inline panels (accordion under the grid) */}
      {panel === "squad" && (
        <div className="mt-3 rounded-2xl border border-line bg-[var(--color-surface)] p-3">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-[12px] font-bold uppercase tracking-[0.12em] text-[var(--color-faint)]">
              {mySquad?.label} · {members?.length ?? "…"} members
            </span>
            {squadRoomId && (
              <button
                type="button"
                onClick={() => router.push(`/messages?room=${encodeURIComponent(squadRoomId)}`)}
                className="rounded-full px-3 py-1 text-[11.5px] font-bold text-space"
                style={{ background: "var(--color-accent)" }}
              >
                Open squad chat
              </button>
            )}
          </div>
          {!members ? (
            <p className="py-2 text-center text-[12px] text-[var(--color-faint)]"><Loader2 size={13} className="inline animate-spin" /></p>
          ) : (
            <ul className="space-y-0.5">
              {members.map((m) => (
                <li key={m.id} className="flex items-center gap-2 rounded-lg px-1.5 py-1.5">
                  <button type="button" onClick={() => select(m.id)} className="min-w-0 flex-1 truncate text-left text-[13px] text-ink">
                    {m.label}{m.me && <span className="ml-1 text-[10px] text-[var(--color-faint)]">(you)</span>}
                  </button>
                  {m.confirmations > 0 && (
                    <span className="text-[10px] text-[#54d26e]">✓{m.confirmations}</span>
                  )}
                  {!m.me && !m.confirmedByMe && (
                    <button
                      type="button"
                      onClick={() => void confirmSquadmate(m.id).then(() => setMembers((prev) => prev?.map((x) => x.id === m.id ? { ...x, confirmedByMe: true, confirmations: x.confirmations + 1 } : x) ?? null))}
                      className="rounded-full border border-[var(--color-line)] px-2 py-0.5 text-[10.5px] text-[var(--color-dim)]"
                      title="Confirm they're really in your squad"
                    >
                      Confirm
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {panel === "meet" && (
        <div className="mt-3 rounded-2xl border border-line bg-[var(--color-surface)] p-3">
          <div className="mb-2 text-[12px] font-bold uppercase tracking-[0.12em] text-[var(--color-faint)]">People you should meet</div>
          {!meet ? (
            <p className="py-2 text-center text-[12px] text-[var(--color-faint)]"><Loader2 size={13} className="inline animate-spin" /></p>
          ) : meet.length === 0 ? (
            <p className="py-2 text-[12px] text-[var(--color-dim)]">Finish step 1 (your skills) and matches appear here.</p>
          ) : (
            <ul className="space-y-1.5">
              {meet.map((c) => (
                <li key={c.nodeId} className="flex items-center gap-2.5 rounded-xl border border-line px-2.5 py-2">
                  <button type="button" onClick={() => select(c.nodeId)} className="min-w-0 flex-1 text-left">
                    <span className="flex items-center gap-2">
                      <span className="truncate text-[13px] font-semibold text-ink">{c.node.label}</span>
                      {c.matchPct > 0 && <span className="text-[10px] font-bold" style={{ color: "var(--color-accent)" }}>{c.matchPct}%</span>}
                    </span>
                    {c.reasons?.[0] && <span className="block truncate text-[11px] text-[var(--color-faint)]">{c.reasons[0]}</span>}
                  </button>
                  {savedMeet.has(c.nodeId) ? (
                    <Check size={14} className="shrink-0 text-[#54d26e]" />
                  ) : (
                    <button
                      type="button"
                      aria-label={`Save ${c.node.label}`}
                      onClick={() => void saveContact(c.nodeId, "interesting").then(() => setSavedMeet((s) => new Set(s).add(c.nodeId))).catch(() => {})}
                      className="shrink-0 rounded-full border border-[var(--color-line)] p-1.5 text-[var(--color-dim)]"
                    >
                      <UserPlus size={13} />
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {panel === "today" && (
        <div className="mt-3 rounded-2xl border border-line bg-[var(--color-surface)] p-3">
          <div className="mb-2 text-[12px] font-bold uppercase tracking-[0.12em] text-[var(--color-faint)]">Today's sessions</div>
          {!agenda ? (
            <p className="py-2 text-center text-[12px] text-[var(--color-faint)]"><Loader2 size={13} className="inline animate-spin" /></p>
          ) : agenda.length === 0 ? (
            <p className="py-2 text-[12px] text-[var(--color-dim)]">No sessions listed for today.</p>
          ) : (
            <ul className="space-y-1.5">
              {agenda.map((i) => {
                const props = (i.node.properties ?? {}) as { time?: string; stream?: string; venue?: string };
                return (
                  <li key={i.node.id} className="flex items-center gap-2.5 rounded-xl border border-line px-2.5 py-2">
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[12.5px] font-semibold text-ink">{i.node.label}</span>
                      <span className="block text-[10.5px] text-[var(--color-faint)]">
                        {[props.time, props.stream, props.venue].filter(Boolean).join(" · ")}
                        {i.attendees > 0 && ` · ${i.attendees} going`}
                      </span>
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        void setAttending(i.node.id, i.attending);
                        setAgenda((prev) => prev?.map((x) => x.node.id === i.node.id ? { ...x, attending: !x.attending, attendees: x.attendees + (x.attending ? -1 : 1) } : x) ?? null);
                      }}
                      className="shrink-0 rounded-full border px-2.5 py-1 text-[10.5px] font-bold"
                      style={i.attending
                        ? { borderColor: "var(--color-accent-line)", background: "var(--color-accent-soft)", color: "var(--color-accent)" }
                        : { borderColor: "var(--color-line)", color: "var(--color-dim)" }}
                    >
                      {i.attending ? "Going ✓" : "I'll go"}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}

      {toast && (
        <div className="mt-3 rounded-xl bg-[rgba(84,210,110,0.12)] px-3 py-2 text-center text-[12px] font-medium text-[#54d26e]">
          {toast}
        </div>
      )}

      <p className="mt-4 text-center text-[11px] text-[var(--color-faint)]">
        Or just type below — the concierge understands plain language.
      </p>

      {/* Setup sheets */}
      {sheet === "profile" && (
        <Sheet title="Who you are — 30 seconds" onClose={() => setSheet(null)}>
          <p className="mb-2 text-[11.5px] text-[var(--color-dim)]">Hi {meLabel.split(" ")[0]} — this powers your matches. Tap what fits.</p>
          <input
            dir="auto"
            value={startup}
            onChange={(e) => setStartup(e.target.value)}
            placeholder="Your startup's name"
            maxLength={80}
            className="mb-3 w-full rounded-xl border border-[var(--color-line)] bg-transparent px-3 py-2.5 text-[16px] text-ink outline-none placeholder:text-[var(--color-faint)] focus:border-[var(--color-accent-line)] md:text-[13.5px]"
          />
          <ChipGroup label="I can help with" all={SKILL_CHIPS} picked={offered} onToggle={toggle(offered, setOffered)} />
          <ChipGroup label="I'm looking for" all={SKILL_CHIPS} picked={needed} onToggle={toggle(needed, setNeeded)} />
          <ChipGroup label="My program (optional)" all={PROGRAMS} picked={program ? [program] : []} onToggle={(v) => setProgram(program === v ? "" : v)} />
          <button
            type="button"
            onClick={() => void saveProfile()}
            disabled={saving || !startup.trim()}
            className="mt-1 w-full rounded-xl py-3 text-[13.5px] font-bold text-space disabled:opacity-40"
            style={{ background: "var(--color-accent)" }}
          >
            {saving ? "Saving…" : squadDone ? "Save" : "Save → pick your squad"}
          </button>
        </Sheet>
      )}

      {sheet === "squad" && (
        <Sheet title="Which squad are you in?" onClose={() => setSheet(null)}>
          {!profileDone && (
            <button type="button" onClick={() => setSheet("profile")} className="mb-2 flex items-center gap-1 text-[11.5px] font-semibold" style={{ color: "var(--color-accent)" }}>
              <ChevronLeft size={12} /> Step 1 first: who you are
            </button>
          )}
          {!squads ? (
            <p className="py-6 text-center text-[12px] text-[var(--color-faint)]"><Loader2 size={15} className="inline animate-spin" /></p>
          ) : (
            <div className="grid grid-cols-4 gap-1.5">
              {squads.map((sq) => (
                <button
                  key={sq.id}
                  type="button"
                  disabled={joining !== null}
                  onClick={() => void doJoin(sq)}
                  className="flex flex-col items-center rounded-xl border border-[var(--color-line)] py-2.5 transition active:scale-95 disabled:opacity-50"
                >
                  <span className="text-[15px] font-bold text-ink">{joining === sq.id ? <Loader2 size={14} className="animate-spin" /> : sq.number}</span>
                  <span className="text-[9.5px] text-[var(--color-faint)]">{sq.memberCount} in</span>
                </button>
              ))}
            </div>
          )}
          <p className="mt-2.5 text-[10.5px] leading-snug text-[var(--color-faint)]">
            Joining auto-saves your squadmates to your contacts — and they can confirm you're really in.
          </p>
        </Sheet>
      )}

      {/* QR overlays */}
      {qr === "share" && meId && <QRShare nodeId={meId} label={meLabel} onClose={() => setQr(null)} path="/" brand="Trusty" />}
      {qr === "scan" && (
        <QRScan
          onFound={(id) => {
            setQr(null);
            select(id);
          }}
          onClose={() => setQr(null)}
        />
      )}
    </div>
  );
}
