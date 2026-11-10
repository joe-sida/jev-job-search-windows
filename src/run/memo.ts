/**
 * The note a run leaves behind: everything the tool could not finish, in one file a person can
 * read away from the terminal, with the link to each form and the one command to run after.
 *
 * A run already leaves a stuck form open in its own tab and says so as it goes, but a terminal
 * scrolls and a notification is gone in seconds. This is the list that is still there tomorrow.
 * It is written from `buildNeeds`, the same thing the dashboard reads, so there is one answer to
 * what waits for the person and not two.
 */
import { PATHS } from "../config.js";
import { loadQueue } from "../jobs/queue.js";
import { buildNeeds, type Needs } from "../report/needs.js";
import { writeAtomic } from "../util/store.js";
import path from "node:path";

export const memoFile = (): string => path.join(path.dirname(PATHS.manual), "to-do.md");

const when = (at: Date) => at.toISOString().slice(0, 16).replace("T", " ");

/** One line per job, as a checkbox, so the list can be worked through and ticked off. */
const item = (company: string, title: string, what: string, link: string | null): string[] => [
  `- [ ] **${company}** - ${title}`,
  `      ${what}`,
  ...(link ? [`      ${link}`] : []),
];

/** A posting the tool cannot fill, so it is the person's to apply to: found on Indeed, say. */
export type ByHand = { company: string; title: string; where: string; link: string; why: string };

export function memoText(needs: Needs, at = new Date(), byHand: readonly ByHand[] = [], more = 0): string {
  const out: string[] = [`# To do`, ``, `From the run that finished at ${when(at)}. Tick each one off as you go.`, ``];
  const total = needs.waiting.length + needs.questions.length + needs.unconfirmed.length + needs.mail.length + byHand.length;
  if (total === 0) {
    out.push(`Nothing is waiting for you. Every form the run reached was either sent or set aside with its reason in \`applications/manual.csv\`.`, ``);
    return out.join("\n");
  }

  if (needs.waiting.length) {
    out.push(`## Forms that are filled and open, waiting for you (${needs.waiting.length})`, ``);
    out.push(`Each is in a tab of the tool's own Chrome window. Do the one thing it asks, click Submit, and the tool records it.`, ``);
    for (const w of needs.waiting) {
      out.push(...item(w.company, w.title, `${w.todo}${w.open ? "" : " (its tab has since been closed, so open the posting yourself)"}`, w.mail));
    }
    out.push(``, `When they are done: \`npx jev resume\``, ``);
  }

  if (needs.questions.length) {
    out.push(`## Questions only you can answer (${needs.questions.length})`, ``);
    for (const q of needs.questions) {
      const asks = q.items.map((i) => `        - ${i.question}${i.kind === "profile" ? " (belongs in your profile, not this form)" : i.kind === "sign" ? " (yours to do on the form itself)" : ""}`);
      out.push(...item(q.company, q.title, q.reason || "a question the profile could not answer", q.link), ...asks);
    }
    out.push(``, `Answer them in the dashboard, which saves them back: \`npx jev report\``, ``);
  }

  if (needs.unconfirmed.length) {
    out.push(`## Sent, but no confirmation was seen (${needs.unconfirmed.length})`, ``);
    out.push(`Submit was clicked and the page that followed did not say so. None of these will be sent again until you settle them.`, ``);
    for (const u of needs.unconfirmed) out.push(...item(u.company, u.title, `check whether it arrived`, u.link));
    out.push(``, `Then: \`npx jev reconcile\``, ``);
  }

  if (needs.mail.length) {
    out.push(`## Emails the tool could not place (${needs.mail.length})`, ``);
    for (const m of needs.mail) out.push(`- [ ] **${m.from}** - ${m.subject}`, `      ${m.why}`);
    out.push(``);
  }

  if (byHand.length) {
    out.push(`## Postings to apply to yourself (${more > 0 ? `${byHand.length} of ${byHand.length + more}` : byHand.length})`, ``);
    out.push(`${byHand[0]?.why ?? "The tool cannot reach the employer's form from these."} Each link opens the posting; apply from there.`, ``);
    for (const b of byHand) out.push(`- [ ] **${b.company}** - ${b.title}${b.where ? ` - ${b.where}` : ""}`, `      ${b.link}`);
    if (more > 0) out.push(``, `${more} more are in \`applications/all.csv\`.`);
    out.push(``);
  }

  return out.join("\n");
}

/** Writes the note and returns where it is, or null when there is nothing to say. */
export function writeMemo(o: { always?: boolean; at?: Date; byHandMax?: number } = {}): string | null {
  const entries = loadQueue().entries;
  const needs = buildNeeds(entries);
  // Postings the tool was never going to fill: found on a site that does not show it the form.
  const all: ByHand[] = entries
    .filter((e) => e.job.ats === "indeed" && e.status !== "applied")
    .map((e) => ({ company: e.job.company, title: e.job.title, where: e.job.locations[0] ?? "", link: e.job.url, why: "Found on Indeed, which does not show the employer's own form to the tool." }));
  all.sort((a, b) => a.company.localeCompare(b.company) || a.title.localeCompare(b.title));
  const byHand = all.slice(0, o.byHandMax ?? 30);
  const total = needs.waiting.length + needs.questions.length + needs.unconfirmed.length + needs.mail.length + byHand.length;
  if (total === 0 && !o.always) return null;
  const file = memoFile();
  writeAtomic(file, memoText(needs, o.at ?? new Date(), byHand, all.length - byHand.length));
  return file;
}
