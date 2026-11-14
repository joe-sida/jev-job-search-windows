/**
 * What kind of work, and at what level, this person is looking for.
 *
 * Both come from the profile and never from this file. With nothing said, every kind of job at
 * every level is in scope: the tool is for a job search, not for one trade. A person who wants to
 * narrow it says so in `preferences.roleWords` and `preferences.levels`, and then a posting that
 * does not match is set aside before it is rated, with that as its reason.
 */

/** The levels a posting can be at. A profile that names none of them wants all of them. */
export const LEVELS = ["internship", "new_grad", "experienced"] as const;
export type Level = (typeof LEVELS)[number];

/** Titles that say early career in their own words, used only when a profile asks for those levels. */
export const EARLY_CAREER_TITLE =
  /\b(intern|internship|co-?op|new grad|new graduate|early career|early-career|entry[- ]level|junior|graduate|university|student|campus|associate software|software engineer i\b|engineer i\b|swe i\b)\b/i;

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Whether a title is the kind of work the person is after.
 *
 * A word matches where a reader would say it does: at a word boundary, in any case, so "data"
 * matches "Data Analyst" and not "Validation". A word of two or more words is matched as written.
 * With no words given every title is in scope, which is the answer for a person who has not said
 * what they want.
 */
export function wantsTitle(title: string, roleWords: readonly string[] = []): boolean {
  if (roleWords.length === 0) return true;
  return roleWords.some((raw) => {
    const word = raw.trim();
    if (word === "") return false;
    return new RegExp(`\\b${escape(word)}\\b`, "i").test(title);
  });
}

/** The levels a profile asks for, or all of them when it asks for none. */
export const levelsWanted = (levels: readonly string[] = []): readonly Level[] =>
  levels.length === 0 ? LEVELS : LEVELS.filter((l) => levels.includes(l));

/**
 * Whether a title looks like one of the levels the person wants, which is all a title can say.
 *
 * A board's own listing has no description yet, so this is the only gate it passes through. A
 * person who wants experienced roles is given every title, because an experienced posting says
 * nothing in its title: it is the absence of "intern" and "new grad" that marks it, and a title
 * like "Data Engineer" would otherwise be dropped. A person who wants only early-career roles
 * gets the titles that say so, or that name their graduation year.
 */
export function wantsLevelByTitle(title: string, levels: readonly string[] = [], gradYear?: number): boolean {
  const wanted = levelsWanted(levels);
  if (wanted.includes("experienced")) return true;
  return EARLY_CAREER_TITLE.test(title) || (gradYear !== undefined && new RegExp(`\\b${gradYear}\\b`).test(title));
}

/** How well a posting's level suits the person: what they asked for scores full, the rest barely. */
export function levelFit(level: string, levels: readonly string[] = []): number {
  if (level === "other") return 0.3;
  const wanted = levelsWanted(levels);
  return (wanted as readonly string[]).includes(level) ? 1 : 0.1;
}

/**
 * The question JEV is asked about a posting's kind of work, in the profile's own words. A profile
 * that describes the work in a sentence gets that sentence; one that only lists title words has
 * them read out instead, which reads well enough when the words are trades.
 */
export function roleQuestion(roleWords: readonly string[], description?: string): { question: string; yes: string; no: string } {
  const words = roleWords.map((w) => w.trim()).filter((w) => w !== "");
  const said = (description ?? "").trim();
  const list = said !== "" ? said : words.length > 1 ? `${words.slice(0, -1).join(", ")} or ${words[words.length - 1]}` : (words[0] ?? "");
  return {
    question: `Is this posting for work of this kind: ${list}?`,
    yes: `The day-to-day work is ${list} work`,
    no: `The day-to-day work is something else`,
  };
}
