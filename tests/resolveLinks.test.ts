/**
 * Following the links that only redirect. One public list hands out shortened links, so until each
 * one is followed the tool cannot tell a Workday that wants an account from a Greenhouse it fills
 * in a minute. These tests use a stand-in for the following itself: what matters here is what the
 * tool makes of where a link lands, and that a posting's identity does not move when it does.
 */
import { describe, expect, it } from "vitest";
import { resolveRedirects } from "../src/discover.js";
import { preFilter } from "../src/jobs/hardFilters.js";
import { applyUrlFor, jobId, type Job } from "../src/jobs/normalize.js";
import { resolveUrl } from "../src/util/http.js";

const now = new Date("2026-10-02T12:00:00Z");
const job = (over: Partial<Job> = {}): Job => ({
  id: "j", source: "vansh-2027", company: "Acme", title: "Data Analyst Intern", url: "https://go.vansh.nyc/1aa?s=y", ats: "other",
  locations: ["Toronto, ON, Canada"], postedAt: "2026-10-01", terms: ["Summer 2027"], sponsorship: "unknown", degrees: [], category: null, ...over,
});

/** A stand-in for the web: it answers from a table and records what it was asked. */
const follower = (table: Record<string, string>) => {
  const asked: string[] = [];
  return {
    asked,
    follow: async (url: string) => {
      asked.push(url);
      return table[url] ?? url;
    },
  };
};

describe("following a shortened link", () => {
  it("reads the board from where the link lands, and leaves the posting's own link as its identity", async () => {
    const shortened = { url: "https://go.vansh.nyc/1aa?s=y", id: jobId("https://go.vansh.nyc/1aa?s=y") };
    const f = follower({
      "https://go.vansh.nyc/1aa?s=y": "https://caresource.wd1.myworkdayjobs.com/en-US/careers/job/Data-Analyst-Intern_R123",
      "https://go.vansh.nyc/1bb?s=y": "https://job-boards.greenhouse.io/acme/jobs/4752930005",
    });
    const [workday, greenhouse] = await resolveRedirects(
      [job(shortened), job({ url: "https://go.vansh.nyc/1bb?s=y", id: jobId("https://go.vansh.nyc/1bb?s=y") })],
      () => {},
      f.follow,
    );

    // The board is now known, so every rule that turns on the board can see it.
    expect(workday?.ats).toBe("workday");
    expect(greenhouse?.ats).toBe("greenhouse");
    expect(workday?.destination).toBe("https://caresource.wd1.myworkdayjobs.com/en-US/careers/job/Data-Analyst-Intern_R123");
    // Identity does not move: a job already applied to is still the same job the next time it is seen.
    expect(workday?.url).toBe(shortened.url);
    expect(workday?.id).toBe(shortened.id);
    expect(jobId(workday?.url ?? "")).toBe(shortened.id);
  });

  it("sends the run to the form itself, not back through the redirector", async () => {
    const f = follower({ "https://go.vansh.nyc/1bb?s=y": "https://job-boards.greenhouse.io/acme/jobs/4752930005" });
    const [j] = await resolveRedirects([job({ url: "https://go.vansh.nyc/1bb?s=y", source: "greenhouse:acme" })], () => {}, f.follow);
    // The board's own form page for that posting, worked out from where the link landed.
    expect(applyUrlFor(j as Job)).toBe("https://job-boards.greenhouse.io/embed/job_app?for=acme&token=4752930005");
  });

  it("hands an account board to the filter that already knows to skip it", async () => {
    const f = follower({ "https://go.vansh.nyc/1aa?s=y": "https://caresource.wd1.myworkdayjobs.com/en-US/careers/job/Data-Analyst-Intern_R123" });
    const before = job();
    // Unfollowed, nothing about it says Workday, so it would be rated and then tried for three minutes.
    expect(preFilter(before, now)).toBe(null);
    const [after] = await resolveRedirects([before], () => {}, f.follow);
    expect(preFilter(after as Job, now)).toBe("workday (needs an account per company)");
  });

  it("asks only about the links that are a redirector's, and only once each", async () => {
    const direct = job({ url: "https://jobs.lever.co/acme/8f14e45f-ceea-467a-9f1e-1f1f1f1f1f1f", ats: "lever" });
    const already = job({ url: "https://go.vansh.nyc/1cc?s=y", destination: "https://job-boards.greenhouse.io/acme/jobs/7", ats: "greenhouse" });
    const f = follower({ "https://go.vansh.nyc/1aa?s=y": "https://ats.rippling.com/acme/jobs/1" });
    const out = await resolveRedirects([direct, already, job()], () => {}, f.follow);

    expect(f.asked).toEqual(["https://go.vansh.nyc/1aa?s=y"]);
    expect(out[0]).toBe(direct);
    expect(out[1]).toBe(already);
    expect(out[2]?.ats).toBe("rippling");
  });

  it("leaves a posting exactly as it was when its link cannot be followed", async () => {
    // The stand-in answers with the link itself, which is what a redirector having a bad day gives.
    const f = follower({});
    const before = job();
    const [after] = await resolveRedirects([before], () => {}, f.follow);
    expect(after).toBe(before);
    expect(after?.ats).toBe("other");
    expect(after?.destination).toBeUndefined();
  });

  it("does not take one redirector's link for a destination", async () => {
    const f = follower({ "https://go.vansh.nyc/1aa?s=y": "https://simplify.jobs/p/abc" });
    const [after] = await resolveRedirects([job()], () => {}, f.follow);
    expect(after?.destination).toBeUndefined();
    expect(after?.ats).toBe("other");
  });

  it("says what the links led to", async () => {
    const lines: string[] = [];
    const f = follower({
      "https://go.vansh.nyc/1aa?s=y": "https://caresource.wd1.myworkdayjobs.com/en-US/careers/job/x_R1",
      "https://go.vansh.nyc/1bb?s=y": "https://zoetis.wd5.myworkdayjobs.com/en-US/careers/job/y_R2",
      "https://go.vansh.nyc/1cc?s=y": "https://job-boards.greenhouse.io/acme/jobs/3",
    });
    await resolveRedirects([job(), job({ url: "https://go.vansh.nyc/1bb?s=y" }), job({ url: "https://go.vansh.nyc/1cc?s=y" })], (s) => lines.push(s), f.follow);
    expect(lines[0]).toBe("[sources] following 3 shortened links");
    expect(lines[1]).toBe("[sources] 3 followed, which are: workday 2, greenhouse 1");
  });
});

describe("following a link over the web", () => {
  /** Responses carry the URL they ended at, which is the whole answer here, so the fake sets it. */
  const answer = (url: string, init: ResponseInit = {}) => {
    const res = new Response("", init);
    Object.defineProperty(res, "url", { value: url });
    return res;
  };

  const withFetch = async (fake: typeof fetch, run: () => Promise<void>) => {
    const real = globalThis.fetch;
    globalThis.fetch = fake;
    try {
      await run();
    } finally {
      globalThis.fetch = real;
    }
  };

  it("asks for the headers only, and takes the URL the answer ended at", async () => {
    const calls: { url: string; method: string }[] = [];
    const fake = (async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), method: init?.method ?? "GET" });
      return answer("https://ats.rippling.com/acme/jobs/1");
    }) as typeof fetch;
    await withFetch(fake, async () => {
      expect(await resolveUrl("https://go.vansh.nyc/1aa?s=y", { cacheMs: 0 })).toBe("https://ats.rippling.com/acme/jobs/1");
    });
    // Nothing is downloaded to find out where a link goes.
    expect(calls).toEqual([{ url: "https://go.vansh.nyc/1aa?s=y", method: "HEAD" }]);
  });

  it("asks again with a GET for a redirector that answers no HEAD", async () => {
    const methods: string[] = [];
    const fake = (async (_url: string | URL | Request, init?: RequestInit) => {
      methods.push(init?.method ?? "GET");
      return methods.length === 1 ? answer("", { status: 405 }) : answer("https://job-boards.greenhouse.io/acme/jobs/3");
    }) as typeof fetch;
    await withFetch(fake, async () => {
      expect(await resolveUrl("https://go.vansh.nyc/1bb?s=y", { cacheMs: 0 })).toBe("https://job-boards.greenhouse.io/acme/jobs/3");
    });
    expect(methods).toEqual(["HEAD", "GET"]);
  });

  it("gives the link back when it cannot be followed at all", async () => {
    const fake = (async () => {
      throw new Error("getaddrinfo ENOTFOUND");
    }) as typeof fetch;
    await withFetch(fake, async () => {
      expect(await resolveUrl("https://go.vansh.nyc/1cc?s=y", { cacheMs: 0 })).toBe("https://go.vansh.nyc/1cc?s=y");
    });
  });
});
