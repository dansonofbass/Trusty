"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard, Utensils, ShieldCheck, Link2, Cpu, ArrowLeft, Menu, X, Loader2, Boxes, Users,
} from "lucide-react";

interface NavItem { href: string; label: string; icon: typeof LayoutDashboard; exact?: boolean }
const NAV: NavItem[] = [
  { href: "/admin", label: "Overview", icon: LayoutDashboard, exact: true },
  { href: "/admin/apps", label: "Apps & Entities", icon: Boxes },
  { href: "/admin/entities", label: "Directory", icon: Users },
  { href: "/admin/places", label: "Places", icon: Utensils },
  { href: "/admin/moderation", label: "Moderation", icon: ShieldCheck },
  { href: "/admin/import", label: "Import by link", icon: Link2 },
  { href: "/admin/extraction", label: "Extraction model", icon: Cpu },
];

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [state, setState] = useState<"loading" | "ok" | "forbidden">("loading");
  const [me, setMe] = useState<{ name?: string | null; email?: string | null }>({});
  const [open, setOpen] = useState(false); // mobile drawer

  useEffect(() => {
    (async () => {
      const r = await fetch("/api/admin/whoami", { cache: "no-store" });
      if (r.ok) { setMe(await r.json()); setState("ok"); }
      else setState("forbidden");
    })();
  }, []);

  useEffect(() => { setOpen(false); }, [pathname]);

  const isActive = (n: NavItem) => (n.exact ? pathname === n.href : pathname.startsWith(n.href));

  if (state === "loading") {
    return (
      <div className="relative z-10 flex h-dvh items-center justify-center text-dim">
        <Loader2 className="animate-spin" size={20} />
      </div>
    );
  }
  if (state === "forbidden") {
    return (
      <div className="relative z-10 flex h-dvh items-center justify-center p-6">
        <div className="rounded-2xl border border-line bg-surface p-8 text-center backdrop-blur-md">
          <ShieldCheck className="mx-auto mb-3 text-faint" size={28} />
          <h1 className="text-lg font-semibold text-ink" style={{ fontFamily: "var(--font-display)" }}>Admins only</h1>
          <p className="mt-2 text-sm text-dim">
            This area requires the <code className="text-gold">admin</code> role (or your email in <code className="text-gold">ADMIN_EMAILS</code>).
          </p>
          <Link href="/" className="mt-4 inline-block rounded-lg border border-line px-4 py-2 text-sm text-ink hover:border-gold/60">← Back to Trusty</Link>
        </div>
      </div>
    );
  }

  const Sidebar = (
    <aside className="flex h-full w-60 shrink-0 flex-col border-r border-line bg-[rgba(9,13,25,0.85)] backdrop-blur-md">
      <div className="flex items-center gap-2 border-b border-line px-5 py-4">
        <span className="grid h-8 w-8 place-items-center rounded-lg" style={{ background: "rgba(255,140,90,0.14)", color: "#ff8c5a" }}>✦</span>
        <div className="leading-tight">
          <div className="text-[14px] font-bold text-ink" style={{ fontFamily: "var(--font-display)" }}>Trusty</div>
          <div className="text-[10px] uppercase tracking-[0.18em] text-faint">Admin</div>
        </div>
      </div>

      <nav className="flex-1 space-y-1 p-3">
        {NAV.map((n) => {
          const active = isActive(n);
          const Icon = n.icon;
          return (
            <Link key={n.href} href={n.href}
              className="flex items-center gap-3 rounded-lg px-3 py-2 text-[13.5px] transition"
              style={active
                ? { background: "rgba(255,140,90,0.12)", color: "#ff8c5a" }
                : { color: "var(--color-dim)" }}
            >
              <Icon size={17} className="shrink-0" />
              <span className={active ? "font-semibold" : ""}>{n.label}</span>
            </Link>
          );
        })}
      </nav>

      <div className="border-t border-line p-3">
        <Link href="/" className="flex items-center gap-2 rounded-lg px-3 py-2 text-[13px] text-dim hover:text-ink">
          <ArrowLeft size={16} /> Back to app
        </Link>
        {(me.name || me.email) && (
          <div className="mt-2 truncate px-3 text-[11px] text-faint" title={me.email ?? undefined}>{me.name ?? me.email}</div>
        )}
      </div>
    </aside>
  );

  return (
    <div className="relative z-10 flex h-dvh overflow-hidden">
      {/* desktop sidebar */}
      <div className="hidden md:block">{Sidebar}</div>

      {/* mobile drawer */}
      {open && (
        <div className="fixed inset-0 z-40 md:hidden">
          <div className="absolute inset-0 bg-black/50" onClick={() => setOpen(false)} />
          <div className="absolute inset-y-0 left-0">{Sidebar}</div>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center gap-3 border-b border-line px-4 py-3 md:hidden">
          <button onClick={() => setOpen(true)} aria-label="Menu" className="rounded-lg p-1.5 text-dim hover:text-ink">
            {open ? <X size={20} /> : <Menu size={20} />}
          </button>
          <span className="text-[14px] font-semibold text-ink" style={{ fontFamily: "var(--font-display)" }}>Admin</span>
        </header>
        <main className="min-w-0 flex-1 overflow-y-auto scroll-quiet">{children}</main>
      </div>
    </div>
  );
}
