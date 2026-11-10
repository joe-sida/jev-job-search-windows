/**
 * Printing a PDF with the real Chrome, twice at once.
 *
 * A run prints the next job's documents while this one is being filled, so two prints overlap.
 * Chrome will not let two of its processes share a profile folder, and on Windows it will not
 * even start against one that is held, so a shared folder turned the second print into
 * "printing failed". With `tailorResume: "always"` that holds the job and the person is told to
 * apply by hand, for nothing. Each print gets a folder of its own, which this proves.
 *
 * The folder itself is removed on the way out when Windows has let go of it, and left in the
 * temporary folder when it has not, so that is not something to assert on.
 */
import { describe, expect, it } from "vitest";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pdfPages, printPdf } from "../src/documents/render.js";

const page = (n: number) => `<!doctype html><html><body><h1>Page ${n}</h1><p>Something to print.</p></body></html>`;

describe("printing with a real Chrome", () => {
  it("prints two documents at the same time", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "jev-prints-at-once-"));
    try {
      const out = [1, 2].map((n) => path.join(dir, `${n}.pdf`));
      const pages = await Promise.all(out.map((file, i) => printPdf(page(i + 1), file)));

      expect(pages).toEqual([1, 1]);
      // A real PDF, not an empty file a failed Chrome left: its own page count reads back as one.
      for (const file of out) expect(pdfPages(readFileSync(file))).toBe(1);
      // The HTML each print writes beside its PDF is taken away again.
      expect(readdirSync(dir).sort()).toEqual(["1.pdf", "2.pdf"]);
    } finally {
      rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    }
  }, 120_000);
});
