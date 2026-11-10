/**
 * Narrowing a search to the places a person will actually work in. The list is the profile's, so
 * these tests use lists of their own and nothing here names a place as the tool's own idea.
 */
import { describe, expect, it } from "vitest";
import { areaMatches, inAreas } from "../src/jobs/areas.js";
import { preFilter } from "../src/jobs/hardFilters.js";
import type { Job } from "../src/jobs/normalize.js";

const now = new Date("2026-10-02T12:00:00Z");
const job = (over: Partial<Job> = {}): Job => ({
  id: "j", source: "t", company: "Acme", title: "Data Analyst Intern", url: "https://job-boards.greenhouse.io/acme/jobs/1", ats: "greenhouse",
  locations: ["Arlington, VA"], postedAt: "2026-10-01", terms: ["Summer 2027"], sponsorship: "unknown", degrees: [], category: null, ...over,
});

describe("whether one area covers a place", () => {
  it("takes a state by its code in capitals, or by its name in any case", () => {
    expect(areaMatches("Virginia", "Arlington, VA")).toBe(true);
    expect(areaMatches("VA", "Arlington, VA")).toBe(true);
    expect(areaMatches("va", "Arlington, VA")).toBe(true);
    expect(areaMatches("Maryland", "Bethesda, maryland")).toBe(true);
    // A lower-case code inside a word is not a state: nothing here is in Virginia or Maryland.
    expect(areaMatches("Virginia", "Las Vegas, NV")).toBe(false);
    expect(areaMatches("Maryland", "Portland, OR")).toBe(false);
    expect(areaMatches("Virginia", "West Virginia")).toBe(false);
  });

  it("keeps the District and the state of Washington apart", () => {
    expect(areaMatches("DC", "Washington, DC")).toBe(true);
    expect(areaMatches("DC", "Washington D.C., United States")).toBe(true);
    expect(areaMatches("District of Columbia", "Washington, DC")).toBe(true);
    expect(areaMatches("DC", "Seattle, WA")).toBe(false);
    // The other way round is the mistake that matters: a Seattle job is not a DC job.
    expect(areaMatches("Washington", "Seattle, WA")).toBe(true);
    expect(areaMatches("Washington", "Washington, DC")).toBe(false);
  });

  it("takes a city or a metro area as the words it is, and remote as remote", () => {
    expect(areaMatches("Reston", "Reston, Virginia")).toBe(true);
    expect(areaMatches("Research Triangle", "Research Triangle Park, NC")).toBe(true);
    expect(areaMatches("Reston", "Boston, MA")).toBe(false);
    expect(areaMatches("Remote", "Remote in USA")).toBe(true);
    expect(areaMatches("Remote", "Hybrid, Austin, TX")).toBe(false);
  });
});

describe("whether a posting is somewhere the person works", () => {
  const dmv = ["DC", "Maryland", "Virginia", "Remote"];

  it("keeps what is in the list and drops what is not", () => {
    expect(inAreas(["Arlington, VA"], dmv)).toBe(true);
    expect(inAreas(["Washington, DC"], dmv)).toBe(true);
    expect(inAreas(["Baltimore, MD"], dmv)).toBe(true);
    expect(inAreas(["Remote in USA"], dmv)).toBe(true);
    expect(inAreas(["San Francisco, CA"], dmv)).toBe(false);
    expect(inAreas(["New York, NY", "Seattle, WA"], dmv)).toBe(false);
    // One place in the list is enough, because that is the one they would take.
    expect(inAreas(["New York, NY", "McLean, VA"], dmv)).toBe(true);
  });

  it("narrows nothing when the person named no places", () => {
    expect(inAreas(["San Francisco, CA"], [])).toBe(true);
    expect(inAreas(["San Francisco, CA"])).toBe(true);
  });

  it("keeps a posting that says nowhere at all, because where it is cannot be told", () => {
    expect(inAreas([], dmv)).toBe(true);
    expect(inAreas(["", "  "], dmv)).toBe(true);
  });
});

describe("the filter that uses it", () => {
  const dmv = ["DC", "Maryland", "Virginia", "Remote"];
  const us = { authorized: true, citizen: false };

  it("skips a posting outside those places, and says so", () => {
    expect(preFilter(job(), now, () => false, us, 60, () => false, dmv)).toBe(null);
    expect(preFilter(job({ locations: ["Austin, TX"] }), now, () => false, us, 60, () => false, dmv)).toBe("not in the places you work in");
    // With no places named, the same posting passes: this narrows only for someone who asked.
    expect(preFilter(job({ locations: ["Austin, TX"] }), now, () => false, us, 60, () => false)).toBe(null);
  });

  it("still skips for the older reasons first, so the reason a person reads is the real one", () => {
    const old = job({ locations: ["Austin, TX"], postedAt: "2026-01-01" });
    expect(preFilter(old, now, () => false, us, 60, () => false, dmv)).toBe("not in the places you work in");
    const walled = job({ locations: ["Austin, TX"], ats: "icims" });
    expect(preFilter(walled, now, () => false, us, 60, () => false, dmv)).toBe("icims (needs an account)");
  });
});
