"use client";

import { useCallback, useEffect, useState } from "react";
import { Check, Loader2, Hourglass, Link2 } from "lucide-react";

interface WaitlistUser {
  userId: string;
  name?: string;
  email?: string;
  waitingSince: string;
  joinedWaitlist: boolean;
  referredCount: number;
  threshold: number;
}

export default function WaitlistAdminPage() {
  const [status, setStatus] = useState<"loading" | "ok" | "error">("loading");
  const [error, setError] = useState<string | null>(null);
  const [users, setUsers] = useState<WaitlistUser[]>([]);
  const [threshold, setThreshold] = useState(3);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/admin/waitlist", { cache: "no-store" });
      if (!r.ok) throw new Error(`waitlist fetch failed (${r.status})`);
      const data = (await r.json()) as { users: WaitlistUser[]; threshold: number };
      setUsers(data.users);
      setThreshold(data.threshold);
      setStatus("ok");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setStatus("error");
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const approve = async (userId: string) => {
    setBusy(userId);
    setUsers((xs) => xs.filter((x) => x.userId !== userId)); // optimistic
    try {
      const r = await fetch(`/api/admin/waitlist/${encodeURIComponent(userId)}/approve`, { method: "POST" });
      if (!r.ok) throw new Error();
    } catch {
      await load();
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="mx-auto max-w-3xl px-6 py-8">
      <header className="mb-6">
        <h1 className="text-2xl font-extrabold tracking-tight text-ink" style={{ fontFamily: "var(--font-display)" }}>Waitlist</h1>
        <p className="mt-1 text-sm text-dim">
          People held at the front door. Approving grants onboarding access — the same unlock a referral drive earns
          (threshold: {threshold} referrals). It never creates trust or graph connections.
        </p>
      </header>

      {status === "loading" && <div className="flex items-center gap-2 text-dim"><Loader2 className="animate-spin" size={16} /> Loading…</div>}
      {status === "error" && <div className="rounded-2xl border border-line bg-surface p-6 text-sm text-rose-300">{error}</div>}

      {status === "ok" && users.length === 0 && (
        <div className="rounded-2xl border border-line bg-surface p-10 text-center backdrop-blur-md">
          <Hourglass className="mx-auto mb-3 text-faint" size={28} />
          <p className="text-[14px] text-ink">No one is waiting</p>
          <p className="mt-1 text-[13px] text-faint">New sign-ups without an invite will appear here.</p>
        </div>
      )}

      {status === "ok" && users.length > 0 && (
        <ul className="space-y-3">
          {users.map((u) => (
            <li key={u.userId} className="flex flex-wrap items-center gap-3 rounded-2xl border border-line bg-surface p-4 backdrop-blur-md">
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13.5px] font-semibold text-ink">{u.name ?? u.userId}</div>
                <div className="truncate text-[12px] text-faint">{u.email ?? "no email"}</div>
                <div className="mt-1 flex items-center gap-3 text-[11px] text-faint">
                  <span>waiting since {new Date(u.waitingSince).toLocaleDateString()}</span>
                  {u.joinedWaitlist ? (
                    <span className="flex items-center gap-1 text-dim">
                      <Link2 size={11} /> {u.referredCount}/{u.threshold} referrals
                    </span>
                  ) : (
                    <span>hasn’t started a referral drive</span>
                  )}
                </div>
              </div>
              <button
                disabled={busy === u.userId}
                onClick={() => void approve(u.userId)}
                className="flex items-center gap-1.5 rounded-lg bg-gold px-4 py-1.5 text-[12.5px] font-semibold text-space disabled:opacity-50"
              >
                <Check size={14} /> Approve
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
