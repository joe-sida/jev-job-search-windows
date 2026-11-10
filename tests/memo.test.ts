/**
 * The note a run leaves behind. The text is built from what the dashboard already calls "needs
 * you", so these tests hand it that shape and read what a person would be given.
 */
import { describe, expect, it } from "vitest";
import { memoText } from "../src/run/memo.js";
import type { Needs } from "../src/report/needs.js";

const at = new Date("2026-11-10T21:30:00Z");
const empty: Needs = { waiting: [], questions: [], unconfirmed: [], mail: [] };

describe("the to-do a run leaves", () => {
  it("says so plainly when nothing waits", () => {
    const text = memoText(empty, at);
    expect(text).toContain("Nothing is waiting for you");
    expect(text).not.toContain("- [ ]");
  });

  it("lists each open form with what it asks and the command that records it", () => {
    const text = memoText(
      {
        ...empty,
        waiting: [
          { id: "a", company: "Acme", title: "Data Analyst Intern", todo: "pass the robot check, then click Submit", reason: "", mail: null, open: true },
          { id: "b", company: "Globex", title: "ML Intern", todo: "type the code it emailed you", reason: "", mail: "https://mail.google.com/mail/u/0/#search/globex", open: false },
        ],
      },
      at,
    );
    expect(text).toContain("## Forms that are filled and open, waiting for you (2)");
    expect(text).toContain("- [ ] **Acme** - Data Analyst Intern");
    expect(text).toContain("pass the robot check, then click Submit");
    // A tab that is gone is said to be gone, so nobody hunts for it in the window.
    expect(text).toContain("its tab has since been closed");
    expect(text).toContain("https://mail.google.com/mail/u/0/#search/globex");
    expect(text).toContain("npx jev resume");
  });

  it("separates a question the form asked from one that belongs in the profile or on the form itself", () => {
    const text = memoText(
      {
        ...empty,
        questions: [
          {
            id: "c", company: "Initech", title: "IT Intern", link: "https://example.invalid/apply", reason: "two questions the profile could not answer",
            items: [
              { question: "Favourite article, and why?", kind: "ask", options: [], canRemember: true, note: "" },
              { question: "Are you authorized to work in Canada?", kind: "profile", options: [], canRemember: false, note: "" },
              { question: "Type your name to agree", kind: "sign", options: [], canRemember: false, note: "" },
            ],
          },
        ],
      },
      at,
    );
    expect(text).toContain("## Questions only you can answer (1)");
    expect(text).toContain("- Favourite article, and why?");
    expect(text).toContain("(belongs in your profile, not this form)");
    expect(text).toContain("(yours to do on the form itself)");
    expect(text).toContain("npx jev report");
  });

  it("names what was clicked without a confirmation, and what it will not do about it", () => {
    const text = memoText({ ...empty, unconfirmed: [{ id: "d", company: "Umbrella", title: "Analyst Intern", link: "https://example.invalid/job" }] }, at);
    expect(text).toContain("## Sent, but no confirmation was seen (1)");
    expect(text).toContain("will be sent again until you settle them");
    expect(text).toContain("npx jev reconcile");
  });

  it("stamps when the run finished, so an old list is not read as today's", () => {
    expect(memoText(empty, at)).toContain("2026-11-10 21:30");
  });
});
