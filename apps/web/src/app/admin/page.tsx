"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  Utensils, Coffee, ImageIcon, AlertTriangle, ShieldCheck, Link2, Cpu, ArrowRight, Loader2,
} from "lucide-react";
import { adminListPlaces, adminListSuggestions, adminListLinks, type AdminPlace } from "@/lib/placesClient";

const detailCount = (p: AdminPlace) => Object.keys(p.properties ?? {}).filter((k) => k !== "geo" && k !== "source").length;

function Stat({ icon, value, label, tone }: { icon: React.ReactNode; value: number | string; label: string; tone?: string }) {
  return (
    <div className="rounded-2xl border border-line bg-surface p-4 backdrop-blur-md">
      <div className="mb-2 flex h-8 w-8 items-center justify-center rounded-lg" style={{ background: `${tone ?? "#8e97bd"}18`, color: tone ?? "#8e97bd" }}>{icon}</div>
      <div className="text-[22px] font-bold text-ink" style={{ fontFamily: "var(--font-display)" }}>{value}</div>
      <div className="text-[12px] text-faint">{label}</div>
    </div>
  );
}

export default function OverviewPage() {
  const [loading, setLoading] = useState(true);
  const [places, setPlaces] = useState<AdminPlace[]>([]);
  const [pending, setPending] = useState(0);
  const [imports, setImports] = useState({ total: 0, failed: 0 });

  useEffect(() => {
    (async () => {
      try {
        const [ps, sg, lk] = await Promise.all([
          adminListPlaces().catch(() => []),
          adminListSuggestions("pending").catch(() => []),
          adminListLinks().catch(() => []),
        ]);
        setPlaces(ps); setPending(sg.length);
        setImports({ total: lk.length, failed: lk.filter((l) => l.status === "failed").length });
      } finally { setLoading(false); }
    })();
  }, []);

  const restaurants = places.filter((p) => p.entityType === "restaurant").length;
  const cafes = places.filter((p) => p.entityType === "cafe").length;
  const withPhotos = places.filter((p) => p.photoCount > 0).length;
  const needsDetails = places.filter((p) => detailCount(p) === 0).length;

  const links: { href: string; icon: React.ReactNode; title: string; desc: string; badge?: number }[] = [
    { href: "/admin/places", icon: <Utensils size={18} />, title: "Manage places", desc: "Edit details, photos, menus, delete" },
    { href: "/admin/moderation", icon: <ShieldCheck size={18} />, title: "Moderation", desc: "Review community submissions", badge: pending },
    { href: "/admin/import", icon: <Link2 size={18} />, title: "Import by link", desc: "Add places from Google / Yandex" },
    { href: "/admin/extraction", icon: <Cpu size={18} />, title: "Extraction model", desc: "Model routing & A/B testing" },
  ];

  return (
    <div className="mx-auto max-w-5xl px-6 py-8">
      <header className="mb-6">
        <h1 className="text-2xl font-extrabold tracking-tight text-ink" style={{ fontFamily: "var(--font-display)" }}>Overview</h1>
        <p className="mt-1 text-sm text-dim">Catalog health at a glance.</p>
      </header>

      {loading ? (
        <div className="flex items-center gap-2 text-dim"><Loader2 className="animate-spin" size={16} /> Loading…</div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            <Stat icon={<Utensils size={16} />} value={restaurants} label="Restaurants" tone="#ff8c5a" />
            <Stat icon={<Coffee size={16} />} value={cafes} label="Cafés" tone="#e3c84b" />
            <Stat icon={<ImageIcon size={16} />} value={withPhotos} label="With photos" tone="#3fc6f4" />
            <Stat icon={<AlertTriangle size={16} />} value={needsDetails} label="Need details" tone="#f0a04b" />
            <Stat icon={<ShieldCheck size={16} />} value={pending} label="Pending review" tone="#54d26e" />
            <Stat icon={<Link2 size={16} />} value={imports.total} label={`Imports${imports.failed ? ` · ${imports.failed} failed` : ""}`} tone="#a578ff" />
          </div>

          <h2 className="mb-3 mt-8 text-[11px] font-semibold uppercase tracking-[0.16em] text-faint">Manage</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            {links.map((l) => (
              <Link key={l.href} href={l.href}
                className="group flex items-center gap-4 rounded-2xl border border-line bg-surface p-4 backdrop-blur-md transition hover:border-gold/40">
                <div className="flex h-11 w-11 items-center justify-center rounded-xl" style={{ background: "rgba(255,140,90,0.1)", color: "#ff8c5a" }}>{l.icon}</div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 text-[14px] font-semibold text-ink">{l.title}{l.badge ? <span className="rounded-full bg-gold px-1.5 text-[11px] font-bold text-space">{l.badge}</span> : null}</div>
                  <div className="text-[12.5px] text-faint">{l.desc}</div>
                </div>
                <ArrowRight size={16} className="text-faint transition group-hover:translate-x-0.5 group-hover:text-ink" />
              </Link>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
