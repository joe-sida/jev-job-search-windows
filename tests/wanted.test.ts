/**
 * What kind of work, and at what level. Both come from the profile, so these tests hand it
 * several different people's answers and read what the tool makes of the same postings.
 */
import { describe, expect, it } from "vitest";
import { levelFit, levelsWanted, roleQuestion, wantsLevelByTitle, wantsTitle } from "../src/jobs/wanted.js";

describe("the kind of work", () => {
  it("is every kind until the profile names one", () => {
    for (const title of ["Software Engineer Intern", "Registered Nurse", "Line Cook", "Staff Accountant"]) {
      expect(wantsTitle(title), title).toBe(true);
      expect(wantsTitle(title, []), title).toBe(true);
    }
  });

  it("matches a word where a reader would, and not inside another word", () => {
    expect(wantsTitle("Data Analyst", ["data"])).toBe(true);
    expect(wantsTitle("DATA ENGINEER", ["data"])).toBe(true);
    expect(wantsTitle("Validation Engineer", ["data"])).toBe(false);
    expect(wantsTitle("Metadata Specialist", ["data"])).toBe(false);
    // A phrase is matched as written.
    expect(wantsTitle("IT Support Technician", ["IT support"])).toBe(true);
    expect(wantsTitle("Support Technician", ["IT support"])).toBe(false);
  });

  it("serves a trade that has nothing to do with software", () => {
    const nursing = ["nurse", "nursing", "clinical"];
    expect(wantsTitle("Registered Nurse, ICU", nursing)).toBe(true);
    expect(wantsTitle("Clinical Nurse Specialist", nursing)).toBe(true);
    expect(wantsTitle("Software Engineer", nursing)).toBe(false);

    const trades = ["electrician", "plumber", "HVAC"];
    expect(wantsTitle("Apprentice Electrician", trades)).toBe(true);
    expect(wantsTitle("HVAC Technician", trades)).toBe(true);
    expect(wantsTitle("Data Analyst", trades)).toBe(false);
  });

  it("ignores a blank word rather than matching everything with it", () => {
    expect(wantsTitle("Registered Nurse", ["   "])).toBe(false);
    expect(wantsTitle("Registered Nurse", ["", "nurse"])).toBe(true);
  });
});

describe("the level", () => {
  it("is all three until the profile names some", () => {
    expect(levelsWanted()).toEqual(["internship", "new_grad", "experienced"]);
    expect(levelsWanted([])).toEqual(["internship", "new_grad", "experienced"]);
    expect(levelsWanted(["internship"])).toEqual(["internship"]);
  });

  it("gives a board's whole listing to a search that wants experienced roles", () => {
    // A title says "intern" or "new grad" when it is one, and says nothing when it is neither, so
    // an experienced search cannot be gated on the title at all.
    expect(wantsLevelByTitle("Senior Data Engineer", ["experienced"])).toBe(true);
    expect(wantsLevelByTitle("Senior Data Engineer", [])).toBe(true);
    expect(wantsLevelByTitle("Senior Data Engineer", ["internship", "new_grad"])).toBe(false);
  });

  it("keeps the early-career titles for a search that asks only for those", () => {
    const early = ["internship", "new_grad"];
    for (const title of ["Data Analyst Intern", "Software Engineer, New Grad", "Junior Developer", "2027 Summer Co-op"]) {
      expect(wantsLevelByTitle(title, early), title).toBe(true);
    }
    expect(wantsLevelByTitle("Data Analyst", early)).toBe(false);
    // A title naming the person's graduation year is early career even without the words.
    expect(wantsLevelByTitle("Analyst Programme 2028", early, 2028)).toBe(true);
    expect(wantsLevelByTitle("Analyst Programme 2028", early, 2031)).toBe(false);
  });

  it("scores a wanted level full and an unwanted one barely", () => {
    expect(levelFit("internship", ["internship", "new_grad"])).toBe(1);
    expect(levelFit("experienced", ["internship", "new_grad"])).toBe(0.1);
    // Naming nothing wants everything, so nothing is penalised for its level.
    expect(levelFit("experienced", [])).toBe(1);
    expect(levelFit("internship", [])).toBe(1);
    // "other" is not a level: it means the page was not a job posting.
    expect(levelFit("other", [])).toBe(0.3);
  });
});

describe("the question JEV is asked about a posting's kind of work", () => {
  it("reads out the profile's own words", () => {
    const q = roleQuestion(["software", "data", "IT support"]);
    expect(q.question).toBe("Is this posting for work of this kind: software, data or IT support?");
    expect(q.yes).toContain("software, data or IT support");
  });

  it("prefers the sentence a profile wrote for it", () => {
    const q = roleQuestion(["nurse", "nursing", "clinical", "RN"], "bedside nursing in a hospital or clinic");
    expect(q.question).toBe("Is this posting for work of this kind: bedside nursing in a hospital or clinic?");
    expect(q.question).not.toContain("RN");
  });

  it("reads naturally with one word", () => {
    expect(roleQuestion(["nursing"]).question).toBe("Is this posting for work of this kind: nursing?");
  });
});
