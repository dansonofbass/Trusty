import type { Metadata } from "next";
import Brand from "@/components/Brand";

/**
 * Public answer page — the shareable unit of Trusty.
 *
 * Someone pastes this link into a Telegram/WhatsApp group; the messenger
 * fetches it for a preview card (see generateMetadata), and anyone who taps it
 * READS the answer immediately — no wall, no signup, no app install. That
 * openness is the distribution strategy: help first, ask later.
 *
 * The ask comes after the value: doing anything MORE (asking a follow-up about
 * your own case, reading the rest of the circle, replying to the author) needs
 * an account, and the page says plainly why rather than just blocking.
 *
 * Only answers saved in OPEN circles resolve here (graph-service enforces it),
 * so a shared link can never leak a private room.
 */

const GRAPH = process.env.GRAPH_SERVICE_INTERNAL_URL ?? "http://graph-service:4001";

interface PublicAnswer {
  id: number;
  body: string;
  author: string;
  topics: string[];
  createdAt: string;
  app: string;
  circle: { id: string | null; label: string; roomId: string | null };
  moreInCircle: number;
}

async function fetchAnswer(id: string): Promise<PublicAnswer | null> {
  try {
    const r = await fetch(`${GRAPH}/public/answers/${encodeURIComponent(id)}`, { cache: "no-store" });
    if (!r.ok) return null;
    return (await r.json()) as PublicAnswer;
  } catch {
    return null;
  }
}

/** Trim to a clean sentence boundary for previews. */
function excerpt(text: string, max: number): string {
  const flat = text.replace(/\s+/g, " ").trim();
  if (flat.length <= max) return flat;
  const cut = flat.slice(0, max);
  const stop = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("، "), cut.lastIndexOf(" "));
  return `${cut.slice(0, stop > max * 0.5 ? stop : max)}…`;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const a = await fetchAnswer(id);
  if (!a) return { title: "Answer · Trusty" };

  // The preview card people see in Telegram: the circle as the "source", the
  // answer itself as the body — so the link is useful even unopened.
  const title = a.circle.label ? `${a.circle.label} · Trusty` : "Trusty";
  const description = excerpt(a.body, 200);
  return {
    title,
    description,
    openGraph: {
      title,
      description,
      siteName: "Trusty",
      type: "article",
      authors: [a.author],
    },
    twitter: { card: "summary", title, description },
  };
}

export default async function AnswerPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const a = await fetchAnswer(id);

  if (!a) {
    return (
      <main className="grid min-h-screen place-items-center bg-[#05060d] px-5 text-ink">
        <div className="max-w-sm text-center">
          <Brand size={24} />
          <p className="mt-6 text-[14px] text-[var(--color-dim)]">
            This answer isn&apos;t available — it may have been removed, or it lives in a private circle.
          </p>
          <a
            href="/"
            className="mt-5 inline-block rounded-xl px-5 py-2.5 text-[13.5px] font-bold text-space"
            style={{ background: "var(--color-accent)" }}
          >
            Explore Trusty
          </a>
        </div>
      </main>
    );
  }

  const when = new Date(a.createdAt).toLocaleDateString("en-US", { month: "long", year: "numeric" });
  const registerHref = `/api/auth/login?register=1&next=${encodeURIComponent(`/a/${a.id}`)}`;
  const signInHref = `/api/auth/login?next=${encodeURIComponent(
    a.circle.roomId ? `/messages?room=${a.circle.roomId}` : `/a/${a.id}`,
  )}`;

  return (
    <main className="min-h-screen bg-[#05060d] px-5 py-8 text-ink">
      <div className="mx-auto w-full max-w-[620px]">
        <a href="/" className="inline-block">
          <Brand size={22} />
        </a>

        {/* The answer — free, immediately, no wall. */}
        <article className="mt-6 rounded-3xl border border-line bg-[rgba(16,26,56,0.72)] p-5 shadow-2xl backdrop-blur-xl sm:p-7">
          {a.circle.label && (
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em]" style={{ color: "var(--color-accent)" }}>
              {a.circle.label}
            </p>
          )}
          <p dir="auto" className="mt-3 whitespace-pre-wrap text-[15.5px] leading-[1.75] text-ink">
            {a.body}
          </p>
          <p className="mt-4 border-t border-[var(--color-line)] pt-3 text-[12px] text-[var(--color-faint)]">
            Answered by <span className="font-semibold text-[var(--color-dim)]">{a.author}</span> · {when}
            {a.topics.length > 0 && (
              <> · {a.topics.slice(0, 3).map((t) => `#${t.replace(/_/g, " ")}`).join(" ")}</>
            )}
          </p>
        </article>

        {/* Why an account — stated as value, not as a gate. */}
        <section className="mt-4 rounded-3xl border border-line bg-[rgba(14,16,30,0.6)] p-5 backdrop-blur-xl sm:p-7">
          <h2 className="text-[16px] font-bold text-ink" style={{ fontFamily: "var(--font-display)" }}>
            Your situation isn&apos;t identical to theirs
          </h2>
          <p className="mt-2 text-[13.5px] leading-relaxed text-[var(--color-dim)]">
            Rules change month to month, and the right answer depends on where you are in the
            process. With a free account you can ask a follow-up about <em>your</em> case, read the{" "}
            {a.moreInCircle > 0 ? (
              <><b className="text-ink">{a.moreInCircle} other answers</b> this circle has kept</>
            ) : (
              <>rest of what this circle has kept</>
            )}
            , and reply to {a.author} directly.
          </p>
          <ul className="mt-3 space-y-1.5 text-[12.5px] text-[var(--color-dim)]">
            <li>✦ 30 free AI messages every month — no card, no trial countdown</li>
            <li>✦ Answers keep their author and date, so you know what&apos;s still current</li>
            <li>✦ Recommendations come with who vouches for them, not stars from strangers</li>
          </ul>
          <div className="mt-5 flex flex-col gap-2 sm:flex-row">
            <a
              href={registerHref}
              className="flex-1 rounded-xl py-3 text-center text-[14px] font-bold text-space"
              style={{ background: "var(--color-accent)" }}
            >
              Create a free account
            </a>
            <a
              href={signInHref}
              className="flex-1 rounded-xl border border-[var(--color-line)] py-3 text-center text-[13.5px] font-semibold text-[var(--color-dim)]"
            >
              I already have one
            </a>
          </div>
          <p dir="rtl" className="mt-3 text-center text-[12px] text-[var(--color-faint)]">
            رایگان ثبت‌نام کن و سوال خودت را بپرس
          </p>
        </section>

        <p className="mt-5 text-center text-[11.5px] text-[var(--color-faint)]">
          Trusty keeps a community&apos;s answers with the name and date attached — so nobody has to
          ask the same question twice.
        </p>
      </div>
    </main>
  );
}
