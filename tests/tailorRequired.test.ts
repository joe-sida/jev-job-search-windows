import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ProfileSchema } from "../src/profile/schema.js";
import { FieldsDump, type DumpedField } from "../src/forms/fields.js";
import type { Job } from "../src/jobs/normalize.js";
import type { JevClient } from "../src/jev/client.js";

// The document writer is replaced: the policy is set by each test and the writer either hands back a resume or fails.
const state = vi.hoisted(() => ({
  policy: { resume: true, cover: false, resumeRequired: false },
  write: "fail" as "fail" | "ok",
}));
vi.mock("../src/documents/tailor.js", () => ({
  documentPolicy: () => state.policy,
  documentsFor: () => null,
  setDocumentPolicy: () => undefined,
  tailorJob: async () => {
    if (state.write === "fail") throw new Error("the draft claims something the profile does not say");
    return { dir: "d", resume: "/tmp/tailored/resume.pdf", cover: null, coverText: null, json: "d/tailored.json" };
  },
}));

// No plan cache: a plan from one test must not answer the next, and nothing is written into the real cache.
vi.mock("../src/config.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../src/config.js")>();
  return { ...original, CACHE: { ...original.CACHE, plans: false } };
});

// The job is in the queue, as it is in a real run, so the writer is called for it.
vi.mock("../src/jobs/queue.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/jobs/queue.js")>()),
  loadQueue: () => ({ entries: [{ job: { id: "tailor-required-test" } }] }),
}));

const { mapForm } = await import("../src/forms/mapForm.js");

const profile = ProfileSchema.parse(JSON.parse(readFileSync(new URL("../data/profile.example.json", import.meta.url), "utf8")));
const job: Job = { id: "tailor-required-test", source: "t", company: "Acme", title: "Data Analyst Intern", url: "https://x", ats: "greenhouse", locations: ["Austin, TX"], postedAt: null, terms: [], sponsorship: "unknown", degrees: [], category: null };
const resumeBox: DumpedField = { id: "f0", widget: "", selector: "#resume", kind: "file", name: "resume", label: "Resume/CV", hint: "", placeholder: "", required: true, value: "", options: [], accept: "", maxLength: null, autocomplete: "", buttonGroup: false, section: "" };
const dump = FieldsDump.parse({ url: "https://x", fields: [resumeBox] });
const jev = { decide: async () => ({}), usage: { costUsd: 0 } } as unknown as JevClient;

describe("a resume written for every job", () => {
  beforeEach(() => {
    state.policy = { resume: true, cover: false, resumeRequired: false };
    state.write = "fail";
  });

  it("attaches the resume written for the job", async () => {
    state.policy.resumeRequired = true;
    state.write = "ok";
    const plan = await mapForm(jev, profile, job, dump);
    const upload = plan.fields.find((f) => f.id === "f0");
    expect(upload?.action).toBe("upload");
    expect(upload?.value).toBe("/tmp/tailored/resume.pdf");
  });

  it("holds the form, and never sends the profile's own file, when the resume cannot be written", async () => {
    state.policy.resumeRequired = true;
    await expect(mapForm(jev, profile, job, dump)).rejects.toThrow(/profile's own resume is not sent/);
  });

  it("still falls back to the profile's resume when a tailored one was only asked for with --tailor", async () => {
    const plan = await mapForm(jev, profile, job, dump);
    expect(plan.fields.find((f) => f.id === "f0")?.value).toBe(profile.resume.path);
  });
});

describe("the tailorResume preference", () => {
  it("is optional, and accepts only never or always", () => {
    const base = JSON.parse(readFileSync(new URL("../data/profile.example.json", import.meta.url), "utf8"));
    expect(ProfileSchema.safeParse(base).success).toBe(true);
    expect(ProfileSchema.safeParse({ ...base, preferences: { ...base.preferences, tailorResume: "always" } }).success).toBe(true);
    expect(ProfileSchema.safeParse({ ...base, preferences: { ...base.preferences, tailorResume: "sometimes" } }).success).toBe(false);
  });
});
