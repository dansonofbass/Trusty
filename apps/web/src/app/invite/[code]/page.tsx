import type { Metadata } from "next";
import Brand from "@/components/Brand";

/**
 * Public invite landing page (logged-out visitors welcome — excluded from the
 * proxy gate). Server component: resolves the inviter server-side (which also
 * records the visit for the funnel), then presents a warm, trust-framed welcome
 * with a single obvious CTA into the auth flow, carrying the invite code.
 *
 * Mobile-first — the phone is where invite links are opened.
 */

const GRAPH = process.env.GRAPH_SERVICE_INTERNAL_URL ?? "http://graph-service:4001";

type InviteMeta = { ok: boolean; code?: string; inviter?: { name?: string } };

async function fetchMeta(code: string): Promise<InviteMeta> {
  try {
    const r = await fetch(`${GRAPH}/public/invites/${encodeURIComponent(code)}`, {
      cache: "no-store",
    });
    if (!r.ok) return { ok: false };
    return (await r.json()) as InviteMeta;
  } catch {
    return { ok: false };
  }
}

export const metadata: Metadata = {
  title: "You're invited · Trusty",
  description: "Find people your friends actually trust.",
};

export default async function InvitePage({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const { code } = await params;
  const meta = await fetchMeta(code);
  const inviter = meta.ok ? meta.inviter?.name ?? "A friend" : null;
  const joinHref = `/api/auth/login?invite=${encodeURIComponent(code)}&register=1`;
  const signInHref = `/api/auth/login?invite=${encodeURIComponent(code)}`;

  return (
    <main className="relative flex min-h-screen w-full items-center justify-center overflow-hidden bg-[#05060d] px-5 py-10 text-ink">
      <Starfield />

      <section className="relative z-10 w-full max-w-md">
        <div className="rounded-3xl border border-line bg-[rgba(14,16,30,0.72)] p-7 shadow-2xl backdrop-blur-xl sm:p-9">
          <Brand size={26} />

          {inviter ? (
            <>
              <p className="mt-7 text-[13px] font-medium uppercase tracking-[0.18em] text-faint">
                You're invited
              </p>
              <h1
                className="mt-2 text-[26px] font-extrabold leading-tight text-ink sm:text-[30px]"
                style={{ fontFamily: "var(--font-display)" }}
              >
                <span className="text-gold">{inviter}</span> wants you on their
                constellation
              </h1>
              <p className="mt-3 text-[15px] leading-relaxed text-dim">
                Trusty helps you find the dentist, lawyer, or mechanic your
                network actually trusts — with the reason shown, never a stranger's
                star rating.
              </p>

              <ul className="mt-6 space-y-3">
                <Perk emoji="🤝">
                  You'll start connected to <b className="text-ink">{inviter}</b>
                </Perk>
                <Perk emoji="✦">
                  Search your network for who they trust — and why
                </Perk>
                <Perk emoji="🌱">
                  Vouch for people you rely on; your taste helps your friends back
                </Perk>
              </ul>

              <a
                href={joinHref}
                className="mt-8 flex w-full items-center justify-center rounded-xl px-4 py-3.5 text-[15px] font-bold text-[#05060d] transition hover:brightness-110"
                style={{
                  fontFamily: "var(--font-display)",
                  background: "linear-gradient(180deg,#ffe08a,#ffc24d)",
                }}
              >
                Accept invite &amp; join
              </a>
              <a
                href={signInHref}
                className="mt-3 block text-center text-[13px] text-dim underline-offset-4 hover:text-ink hover:underline"
              >
                Already have an account? Sign in
              </a>
            </>
          ) : (
            <>
              <h1
                className="mt-7 text-[24px] font-extrabold leading-tight text-ink"
                style={{ fontFamily: "var(--font-display)" }}
              >
                This invite link isn't active
              </h1>
              <p className="mt-3 text-[15px] leading-relaxed text-dim">
                It may have been fully used or revoked. Trusty is invite-only, but
                you can join the waitlist — refer a few friends and your access
                unlocks automatically.
              </p>
              <a
                href="/api/auth/login?waitlist=1&register=1"
                className="mt-7 flex w-full items-center justify-center rounded-xl px-4 py-3.5 text-[15px] font-bold text-[#05060d] transition hover:brightness-110"
                style={{
                  fontFamily: "var(--font-display)",
                  background: "linear-gradient(180deg,#ffe08a,#ffc24d)",
                }}
              >
                Join the waitlist
              </a>
              <a
                href="/api/auth/login"
                className="mt-3 block text-center text-[13px] text-dim underline-offset-4 hover:text-ink hover:underline"
              >
                Already have an account? Sign in
              </a>
            </>
          )}
        </div>

        <p className="mt-5 text-center text-[11.5px] text-faint">
          Trust-powered recommendations · your connections stay private
        </p>
      </section>
    </main>
  );
}

function Perk({ emoji, children }: { emoji: string; children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-3 text-[14px] text-dim">
      <span className="mt-0.5 text-[15px]" aria-hidden>
        {emoji}
      </span>
      <span>{children}</span>
    </li>
  );
}


/** Cheap decorative starfield — pure CSS radial-gradient dots, no JS. */
function Starfield() {
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-0 opacity-70"
      style={{
        backgroundImage:
          "radial-gradient(1.5px 1.5px at 20% 30%, rgba(255,255,255,0.7), transparent)," +
          "radial-gradient(1.5px 1.5px at 70% 20%, rgba(146,166,255,0.6), transparent)," +
          "radial-gradient(1px 1px at 40% 70%, rgba(255,255,255,0.5), transparent)," +
          "radial-gradient(1.5px 1.5px at 85% 65%, rgba(255,217,122,0.5), transparent)," +
          "radial-gradient(1px 1px at 55% 45%, rgba(255,255,255,0.4), transparent)," +
          "radial-gradient(1px 1px at 15% 80%, rgba(46,230,202,0.5), transparent)," +
          "radial-gradient(circle at 50% 0%, rgba(124,150,255,0.10), transparent 60%)",
      }}
    />
  );
}
