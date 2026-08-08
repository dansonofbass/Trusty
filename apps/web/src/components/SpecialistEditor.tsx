"use client";

/**
 * Provider-controlled profile editor (#39) — managers only.
 *
 * Edits the provider-editable layers ONLY (taxonomy, operational,
 * communication, content). Every saved field is source-stamped
 * `specialist_provided` server-side; the credential layer and the
 * independent-evidence section are not reachable from here by design.
 */
import { useCallback, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Loader2, PencilLine, X, Check } from "lucide-react";
import { SPECIALIST_TAXONOMIES, type SpecialistTaxonomy } from "@constellation/graph-core";

interface Field { value: unknown; source: string; updatedAt: string }
type Layers = Partial<Record<string, Record<string, Field>>>;

const s = (layers: Layers, layer: string, key: string): string => {
  const v = layers[layer]?.[key]?.value;
  return typeof v === "string" ? v : "";
};
const list = (layers: Layers, layer: string, key: string): string[] => {
  const v = layers[layer]?.[key]?.value;
  return Array.isArray(v) ? (v as unknown[]).filter((x): x is string => typeof x === "string") : [];
};

export default function SpecialistEditor({ nodeId, nodeType, layers, onSaved }: {
  nodeId: string;
  nodeType: string;
  layers: Layers;
  onSaved: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const taxonomy: SpecialistTaxonomy | undefined =
    SPECIALIST_TAXONOMIES[nodeType as keyof typeof SPECIALIST_TAXONOMIES];

  const [bio, setBio] = useState(() => s(layers, "content", "biography"));
  const [website, setWebsite] = useState(() => s(layers, "content", "website"));
  const [faq, setFaq] = useState(() => s(layers, "content", "faq"));
  const [officeAddress, setOfficeAddress] = useState(() => s(layers, "operational", "officeAddress"));
  const [bookingUrl, setBookingUrl] = useState(() => s(layers, "operational", "bookingUrl"));
  const [telegramHandle, setTelegramHandle] = useState(() => s(layers, "operational", "telegramHandle"));
  const [languages, setLanguages] = useState(() => list(layers, "communication", "languages").join(", "));
  const [services, setServices] = useState<string[]>(() => list(layers, "taxonomy", "services"));
  const [contexts, setContexts] = useState<string[]>(() => list(layers, "taxonomy", "clientContexts"));

  const toggle = (xs: string[], set: (v: string[]) => void, item: string) =>
    set(xs.includes(item) ? xs.filter((x) => x !== item) : [...xs, item]);

  const dirtyPatches = useMemo(() => {
    const patches: { layer: string; fields: Record<string, unknown> }[] = [];
    patches.push({
      layer: "content",
      fields: { biography: bio.trim(), website: website.trim(), faq: faq.trim() },
    });
    patches.push({
      layer: "operational",
      fields: {
        officeAddress: officeAddress.trim(),
        bookingUrl: bookingUrl.trim(),
        telegramHandle: telegramHandle.trim().replace(/^@/, ""),
      },
    });
    patches.push({
      layer: "communication",
      fields: { languages: languages.split(",").map((x) => x.trim()).filter(Boolean) },
    });
    patches.push({ layer: "taxonomy", fields: { services, clientContexts: contexts } });
    return patches;
  }, [bio, website, faq, officeAddress, bookingUrl, telegramHandle, languages, services, contexts]);

  const save = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      for (const patch of dirtyPatches) {
        const r = await fetch(`/api/specialists/${encodeURIComponent(nodeId)}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(patch),
        });
        if (!r.ok) throw new Error((await r.json().catch(() => null))?.error ?? `save failed (${r.status})`);
      }
      setOpen(false);
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [dirtyPatches, nodeId, onSaved]);

  const input = (value: string, set: (v: string) => void, placeholder: string) => (
    <input
      value={value}
      onChange={(e) => set(e.target.value)}
      placeholder={placeholder}
      className="w-full rounded-lg border border-line bg-transparent px-3 py-2 text-[13px] text-ink outline-none placeholder:text-faint focus:border-[var(--color-accent-line)]"
    />
  );

  const chipPicker = (title: string, options: readonly string[], selected: string[], set: (v: string[]) => void) => (
    <div>
      <div className="mb-1.5 text-[11.5px] font-semibold text-dim">{title}</div>
      <div className="flex max-h-36 flex-wrap gap-1.5 overflow-y-auto">
        {options.map((o) => {
          const on = selected.includes(o);
          return (
            <button
              key={o}
              type="button"
              onClick={() => toggle(selected, set, o)}
              className="flex items-center gap-1 rounded-full border px-2.5 py-1 text-[12px] transition"
              style={on
                ? { borderColor: "var(--color-accent-line)", background: "var(--color-accent-soft)", color: "var(--color-accent)" }
                : { borderColor: "var(--color-line)", color: "var(--color-dim)" }}
            >
              {on && <Check size={11} />} {o}
            </button>
          );
        })}
      </div>
    </div>
  );

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex items-center gap-1.5 rounded-xl border border-line px-3.5 py-2 text-[13px] font-semibold text-dim hover:text-ink"
      >
        <PencilLine size={14} /> Edit profile
      </button>
      {open && typeof document !== "undefined" &&
        createPortal(
          <div className="fixed inset-0 z-[60] grid place-items-center bg-black/50 p-4" onClick={() => !busy && setOpen(false)}>
            <div
              className="panel flex max-h-[88dvh] w-full max-w-lg flex-col rounded-2xl"
              onClick={(e) => e.stopPropagation()}
              role="dialog"
              aria-label="Edit specialist profile"
            >
              <div className="flex items-center gap-2 border-b border-line px-5 py-3.5">
                <PencilLine size={15} style={{ color: "var(--color-accent)" }} />
                <h2 className="text-[15px] font-extrabold text-ink" style={{ fontFamily: "var(--font-display)" }}>Edit profile</h2>
                <button onClick={() => setOpen(false)} aria-label="Close" className="ml-auto text-faint hover:text-ink"><X size={16} /></button>
              </div>
              <div className="scroll-quiet min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">
                <p className="text-[11.5px] leading-relaxed text-faint">
                  Everything here is published as <b className="text-dim">provider-supplied</b> information.
                  It helps people understand your services — it never changes trust, which comes only from
                  independent recommendations and outcomes.
                </p>
                <div>
                  <div className="mb-1.5 text-[11.5px] font-semibold text-dim">Professional biography</div>
                  <textarea
                    value={bio}
                    onChange={(e) => setBio(e.target.value)}
                    rows={3}
                    placeholder="Who you serve, what you do, how you work…"
                    className="w-full resize-none rounded-lg border border-line bg-transparent px-3 py-2 text-[13px] text-ink outline-none placeholder:text-faint focus:border-[var(--color-accent-line)]"
                  />
                </div>
                {taxonomy && chipPicker("Services", taxonomy.services, services, setServices)}
                {taxonomy && chipPicker("Client contexts you have real experience with", taxonomy.clientContexts, contexts, setContexts)}
                {input(languages, setLanguages, "Languages (comma-separated: Armenian, English, Farsi)")}
                {input(officeAddress, setOfficeAddress, "Office address")}
                {input(website, setWebsite, "Website (https://…)")}
                {input(bookingUrl, setBookingUrl, "Booking link (https://…)")}
                {input(telegramHandle, setTelegramHandle, "Telegram username (without @)")}
                <div>
                  <div className="mb-1.5 text-[11.5px] font-semibold text-dim">FAQ</div>
                  <textarea
                    value={faq}
                    onChange={(e) => setFaq(e.target.value)}
                    rows={4}
                    placeholder={"What should clients prepare before the first consultation?\nWhich services are offered remotely?"}
                    className="w-full resize-none rounded-lg border border-line bg-transparent px-3 py-2 text-[13px] text-ink outline-none placeholder:text-faint focus:border-[var(--color-accent-line)]"
                  />
                </div>
                {error && <p className="text-[12px] text-rose-300">{error}</p>}
              </div>
              <div className="border-t border-line px-5 py-3.5">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void save()}
                  className="flex w-full items-center justify-center gap-2 rounded-xl py-2.5 text-[13.5px] font-bold text-space disabled:opacity-60"
                  style={{ background: "var(--color-accent)", fontFamily: "var(--font-display)" }}
                >
                  {busy && <Loader2 size={14} className="animate-spin" />} Save profile
                </button>
              </div>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
