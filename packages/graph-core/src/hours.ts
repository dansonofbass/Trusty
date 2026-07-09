/**
 * Best-effort OSM `opening_hours` → "open now?" — handles the common subset
 * (24/7, "Mo-Su 09:00-23:00", ";"-separated rules, ","-separated ranges,
 * "Su off", "…-24:00"). Returns null when it can't decide (rich rules like
 * PH/months/weeks are out of scope). Pure so it's tested; the client calls it
 * with the viewer's local `now` (≈ the venue's local time for "near me").
 */
const ORDER = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"]; // Monday-indexed for ranges
const JS_DAY_TO_CODE = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"]; // Date.getDay() 0=Su

const cap = (s: string): string => s.slice(0, 1).toUpperCase() + s.slice(1, 2).toLowerCase();

function dayMatches(todayCode: string, spec: string): boolean {
  const myIdx = ORDER.indexOf(todayCode);
  for (const part of spec.split(",").map((s) => s.trim()).filter(Boolean)) {
    const range = part.match(/^([A-Za-z]{2})\s*-\s*([A-Za-z]{2})$/);
    if (range) {
      const a = ORDER.indexOf(cap(range[1]));
      const b = ORDER.indexOf(cap(range[2]));
      if (a < 0 || b < 0) continue;
      if (a <= b ? myIdx >= a && myIdx <= b : myIdx >= a || myIdx <= b) return true;
    } else if (cap(part) === todayCode) {
      return true;
    }
  }
  return false;
}

const DAY_LABEL: Record<string, string> = {
  Mo: "Monday", Tu: "Tuesday", We: "Wednesday", Th: "Thursday",
  Fr: "Friday", Sa: "Saturday", Su: "Sunday",
};

/** Minutes-from-midnight → "8:30 AM" (1440 / 0 both render "12:00 AM"). */
function fmtTime(mins: number): string {
  const t = (((mins % (24 * 60)) + 24 * 60) % (24 * 60));
  const h = Math.floor(t / 60);
  const m = t % 60;
  const period = h < 12 ? "AM" : "PM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, "0")} ${period}`;
}

export interface DayHours {
  /** Two-letter code (Mo…Su). */
  code: string;
  /** Full day name ("Monday"). */
  label: string;
  /** Human ranges ("8:30 AM - 12:00 AM"), or "Open 24 hours"; empty ⇒ closed. */
  ranges: string[];
}

/**
 * Parse an OSM `opening_hours` string into a Monday-first weekly schedule, for
 * the "Hours" section. Same tokenizer as {@link isOpenNow}. Returns an empty
 * array when nothing parses (caller falls back to the raw string).
 */
export function weeklyHours(hours: string | undefined): DayHours[] {
  const h = (hours ?? "").trim();
  if (!h) return [];
  const is247 = /24\s*\/\s*7|24 hours/i.test(h);
  const rules = h.split(";").map((s) => s.trim()).filter(Boolean);
  let any = false;

  const out: DayHours[] = ORDER.map((code) => {
    if (is247) {
      any = true;
      return { code, label: DAY_LABEL[code], ranges: ["Open 24 hours"] };
    }
    const ranges: string[] = [];
    for (const rule of rules) {
      const m = rule.match(/^([A-Za-z][A-Za-z,\- ]*?)\s+(.+)$/);
      const daysSpec = m ? m[1] : "Mo-Su";
      const timesSpec = (m ? m[2] : rule).trim();
      if (!dayMatches(code, daysSpec)) continue;
      any = true;
      if (/off|closed/i.test(timesSpec)) continue; // closed ⇒ leave ranges empty
      for (const range of timesSpec.split(",")) {
        const rm = range.trim().match(/(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})/);
        if (!rm) continue;
        const start = Number(rm[1]) * 60 + Number(rm[2]);
        let end = Number(rm[3]) * 60 + Number(rm[4]);
        if (end === 0) end = 24 * 60; // "…-24:00" / "…-00:00"
        ranges.push(`${fmtTime(start)} - ${fmtTime(end)}`);
      }
    }
    return { code, label: DAY_LABEL[code], ranges };
  });

  return any ? out : [];
}

export function isOpenNow(hours: string | undefined, now: Date): boolean | null {
  const h = (hours ?? "").trim();
  if (!h) return null;
  if (/24\s*\/\s*7|24 hours/i.test(h)) return true;

  const todayCode = JS_DAY_TO_CODE[now.getDay()];
  const minsNow = now.getHours() * 60 + now.getMinutes();
  let matchedToday = false;

  for (const rule of h.split(";").map((s) => s.trim()).filter(Boolean)) {
    const m = rule.match(/^([A-Za-z][A-Za-z,\- ]*?)\s+(.+)$/);
    const daysSpec = m ? m[1] : "Mo-Su";
    const timesSpec = (m ? m[2] : rule).trim();
    if (!dayMatches(todayCode, daysSpec)) continue;
    matchedToday = true;
    if (/off|closed/i.test(timesSpec)) return false;
    for (const range of timesSpec.split(",")) {
      const rm = range.trim().match(/(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})/);
      if (!rm) continue;
      const start = Number(rm[1]) * 60 + Number(rm[2]);
      let end = Number(rm[3]) * 60 + Number(rm[4]);
      if (end === 0 || end <= start) end = 24 * 60; // "24:00" / rolls past midnight
      if (minsNow >= start && minsNow < end) return true;
    }
  }
  return matchedToday ? false : null;
}
