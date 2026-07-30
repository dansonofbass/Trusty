/**
 * Agent skills — capability packs the agent can wear (agentic-ux). Static v1;
 * becomes data-driven per ontology App when the second real event lands.
 *
 * Activation is layered: type `/` for the picker (zero graph dependency),
 * plain-text triggers auto-activate (e.g. "sss…"), and the active skill rides
 * the request as an explicit param the extractor honors.
 */
export interface Skill {
  slug: string;
  name: string;
  icon: string;
  description: string;
  /** Example prompts shown in the picker + guide. */
  examples: string[];
  /** Restrict to these Spaces (subdomains). Omit = everywhere. The neutral
   *  home shows unrestricted skills plus any listed with `alsoHome`. */
  spaces?: string[];
  alsoHome?: boolean;
}

export const SKILLS: Skill[] = [
  {
    slug: "summit",
    name: "Seaside Summit",
    icon: "🎪",
    description: "Event concierge: matches, squads, agenda, mentor notes.",
    examples: ["set me up", "who should I meet?", "what's on the agenda today?", "who's in my squad?"],
    spaces: ["summit"],
    alsoHome: true,
  },
  {
    slug: "find",
    name: "Find someone trusted",
    icon: "🔍",
    description: "Trust search across your network, with because-paths.",
    examples: ["a dentist in Yerevan", "who do my friends trust for immigration law?"],
  },
  {
    slug: "note",
    name: "Notes & memory",
    icon: "📝",
    description: "Private notes that link people, places and ideas.",
    examples: ["met Sara at pitch night, she needs a designer", "what did I write about restaurants?"],
  },
  {
    slug: "decide",
    name: "Decisions",
    icon: "⚖️",
    description: "Decision journeys: candidates, context, outcomes.",
    examples: ["help me choose between my two shortlisted lawyers"],
  },
  {
    slug: "ask",
    name: "Ask your network",
    icon: "📣",
    description: "Broadcast a need to people who listen to you.",
    examples: ["ask my network for a good accountant"],
  },
];

export const skillBySlug = (slug: string | null | undefined): Skill | undefined =>
  SKILLS.find((s) => s.slug === slug);

/** Skills visible in the current Space (space=null → the neutral home). */
export const skillsForSpace = (space: string | null): Skill[] =>
  SKILLS.filter((s) => !s.spaces || s.spaces.includes(space ?? "") || (space === null && s.alsoHome));

/** The active "/token" being typed at the START of the input, if any. */
export function parseSlashToken(text: string, caret: number): { query: string } | null {
  const head = text.slice(0, caret);
  const m = /^\/([\w-]*)$/.exec(head.trimStart());
  return m ? { query: m[1].toLowerCase() } : null;
}
