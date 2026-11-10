/**
 * Indeed, read through the tool's own Chrome, as a place to find postings and not as a place to
 * apply from.
 *
 * Why the browser: Indeed answers a plain request with a challenge page, 401 to a browser's user
 * agent and 403 to an honest one, and the RSS feed it used to publish is gone. Its own search
 * pages render fine in a real browser, which the tool already runs, so that is what reads them.
 *
 * Why not apply from here: on a posting's page the only control is a button labelled "Apply on
 * company site" with no link in it, which opens the employer's site in a window of its own. The
 * employer's URL is not on the page at all, so the tool cannot be sent to the form. An "Easily
 * apply" posting is Indeed's own form and wants an Indeed account. Either way these are postings
 * for the person to apply to themselves, so they are recorded as such and listed in the to-do
 * rather than filling the apply queue with jobs that would each cost three minutes and fail.
 *
 * Nothing here signs in, and no account of the person's is used or needed.
 */
import { DISCOVER } from "../config.js";
import { closeTab, newTab, Page, sleep } from "../browser/cdp.js";
import { settle } from "../browser/session.js";
import { jobId, type Job } from "../jobs/normalize.js";
import type { Profile } from "../profile/schema.js";

/** One record per card on a results page, as the page itself reports them. */
export type IndeedCard = {
  jk: string;
  title: string;
  company: string;
  location: string;
  pay: string;
  easyApply: boolean;
};

/** The posting's page on Indeed, which is where a person reads it and finds the employer's own form. */
export const indeedJobUrl = (jk: string): string => `https://www.indeed.com/viewjob?jk=${encodeURIComponent(jk)}`;

export function indeedSearchUrl(what: string, where: string, o: { maxAgeDays?: number; start?: number } = {}): string {
  const u = new URL("https://www.indeed.com/jobs");
  u.searchParams.set("q", what);
  u.searchParams.set("l", where);
  if (o.maxAgeDays) u.searchParams.set("fromage", String(o.maxAgeDays));
  if (o.start) u.searchParams.set("start", String(o.start));
  return u.toString();
}

/**
 * Read inside the page: every card, by the one attribute Indeed has kept stable (data-jk), with
 * the rest taken from the test ids beside it. Plain JavaScript, no imports and no timers, like the
 * other scripts that run in a page. A card it cannot read comes back with empty fields rather than
 * throwing, and is dropped afterwards.
 */
export const CARDS_EXPR = `(() => {
  var out = [];
  var seen = {};
  var found = document.querySelectorAll("[data-jk]");
  for (var i = 0; i < found.length; i++) {
    var a = found[i];
    var jk = a.getAttribute("data-jk");
    if (!jk || seen[jk]) continue;
    seen[jk] = 1;
    var card = a.closest("li") || a.parentElement;
    var pick = function (sel) {
      var e = card ? card.querySelector(sel) : null;
      return e && e.textContent ? e.textContent.replace(/\\s+/g, " ").trim() : "";
    };
    var titleEl = a.querySelector("span[title]") || a;
    var title = (titleEl.getAttribute ? titleEl.getAttribute("title") : "") || (titleEl.textContent || "");
    out.push({
      jk: jk,
      title: title.replace(/\\s+/g, " ").trim(),
      company: pick("[data-testid='company-name']"),
      location: pick("[data-testid='text-location']"),
      pay: pick("[data-testid*='salary-snippet-container']"),
      easyApply: /easily apply/i.test(card ? (card.innerText || "") : "")
    });
  }
  return out;
})()`;

/** "Raft Company Website" is Raft: Indeed puts the words of the link into the name. */
const companyName = (raw: string): string => raw.replace(/\s+company website$/i, "").replace(/\s+-\s*$/, "").trim();

/** "Hybrid work in Arlington, VA 22209 (Radnor-Ft Myer Heights area)" is Arlington, VA. */
const place = (raw: string): string =>
  raw
    .replace(/^(hybrid work|remote work|work) in\s+/i, "")
    .replace(/\s*\([^)]*\)\s*$/, "")
    .replace(/\s+\d{5}(-\d{4})?\b/, "")
    .trim();

/**
 * Cards into postings. A card with no company is dropped: Indeed shows a few without one, and a
 * record that cannot name the employer is no use in a job record a person reads.
 */
export function jobsFromIndeedCards(cards: readonly IndeedCard[], o: { source?: string } = {}): Job[] {
  const source = o.source ?? "indeed";
  const jobs: Job[] = [];
  const seen = new Set<string>();
  for (const c of cards) {
    const company = companyName(c.company ?? "");
    const title = (c.title ?? "").trim();
    if (!company || !title || !c.jk || seen.has(c.jk)) continue;
    seen.add(c.jk);
    const url = indeedJobUrl(c.jk);
    const where = place(c.location ?? "");
    jobs.push({
      id: jobId(url),
      source: c.easyApply ? `${source}:easy-apply` : source,
      company,
      title,
      url,
      ats: "indeed",
      locations: where ? [where] : [],
      postedAt: null,
      terms: [],
      sponsorship: "unknown",
      degrees: [],
      category: null,
    });
  }
  return jobs;
}

/**
 * Opens each search in a tab of the tool's own Chrome, reads the cards, and closes it again.
 * The browser must already be running: `discover` starts it when it is asked for Indeed.
 */
export async function fetchIndeed(
  searches: readonly { what: string; where: string }[],
  o: { maxAgeDays?: number; log?: (s: string) => void; read?: (url: string) => Promise<IndeedCard[]> } = {},
): Promise<Job[]> {
  const log = o.log ?? (() => {});
  const read = o.read ?? readCards;
  const jobs: Job[] = [];
  for (const s of searches) {
    const url = indeedSearchUrl(s.what, s.where, { ...(o.maxAgeDays !== undefined ? { maxAgeDays: o.maxAgeDays } : {}) });
    try {
      const cards = await read(url);
      const found = jobsFromIndeedCards(cards);
      log(`[sources] indeed "${s.what}" in ${s.where}: ${found.length} postings`);
      jobs.push(...found);
    } catch (err) {
      log(`[sources] indeed "${s.what}" in ${s.where} failed: ${err instanceof Error ? err.message : String(err)}`);
    }
    // One search at a time, with a pause between them. Indeed answers a burst with a challenge.
    await sleep(DISCOVER.indeedGapMs);
  }
  return jobs;
}

/** One search page, in a tab that is closed again whatever happens. */
async function readCards(url: string): Promise<IndeedCard[]> {
  const target = await newTab(url);
  const page = await Page.attach(target);
  try {
    await settle(page);
    return await page.evaluate<IndeedCard[]>(CARDS_EXPR);
  } finally {
    page.close();
    await closeTab(target.id);
  }
}

/**
 * What to search for: the profile's own terms in the profile's own places, one search each, capped
 * so that asking for Indeed does not turn one search into fifty. "Remote" is not a place Indeed
 * takes in its location box, so it is left out here; a remote posting still arrives through the
 * other sources. With no places named, nothing is searched and the caller says so.
 */
export function indeedSearches(profile: Profile, max: number = DISCOVER.indeedMaxSearches): { what: string; where: string }[] {
  const terms = profile.preferences.searchTerms?.length ? profile.preferences.searchTerms : [...DISCOVER.indeedTerms];
  const places = (profile.preferences.areas ?? []).filter((a) => !/^remote$/i.test(a.trim()));
  const out: { what: string; where: string }[] = [];
  // Place by place, so a cap still covers everywhere the person works rather than one city's worth.
  for (const where of places) for (const what of terms) out.push({ what, where });
  out.sort((a, b) => terms.indexOf(a.what) - terms.indexOf(b.what));
  return out.slice(0, max);
}
