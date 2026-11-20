import { describe, expect, it } from "vitest";
import { CAUSE, cleanLine, NOISE, renderExcerpt, trimLog } from "../src/logs/trim.js";

// Synthetic logs in the GitHub Actions format (timestamp, then text). No real logs are stored here.
const ts = (i: number) => `2026-11-21T10:${String(Math.floor(i / 60) % 60).padStart(2, "0")}:${String(i % 60).padStart(2, "0")}.1234567Z`;
const log = (lines: string[]) => lines.map((l, i) => `${ts(i)} ${l}`).join("\n") + "\n";

const setup = [
  "##[group]Run actions/checkout@v4",
  "Syncing repository: o/r",
  "##[endgroup]",
  "##[group]Run npm ci",
  "added 900 packages in 20s",
  "##[endgroup]",
];

describe("cleanLine", () => {
  it("strips the timestamp and colour codes but keeps bracketed text", () => {
    expect(cleanLine("2026-11-21T10:00:00.1234567Z \u001b[31mFAIL\u001b[0m test.ts")).toBe("FAIL test.ts");
    expect(cleanLine("2026-11-21T10:00:00Z 20kB  [5312ms] - ncc")).toBe("20kB  [5312ms] - ncc");
    expect(cleanLine("no timestamp   ")).toBe("no timestamp");
  });
});

describe("trimLog", () => {
  it("keeps the failing step's command, the cause and the error, with original line numbers", () => {
    const filler = Array.from({ length: 300 }, (_, i) => `  ok test ${i}`);
    const text = log([
      ...setup,
      "##[group]Run npm test",
      "npm test",
      "##[endgroup]",
      ...filler,
      "FAIL src/api.test.ts",
      "  ✕ returns 200 (5003 ms)",
      "  Error: thrown: Exceeded timeout of 5000 ms for a test.",
      ...Array.from({ length: 60 }, (_, i) => `  ok later ${i}`),
      "Tests: 1 failed, 360 passed",
      "##[error]Process completed with exit code 1.",
      "##[group]Run actions/upload-artifact@v4",
      "Uploading report",
    ]);
    const ex = trimLog(text, { budget: 2000 });
    expect(ex.failingStep).toBe("npm test");
    expect(ex.hasErrorMarker).toBe(true);
    expect(ex.totalLines).toBe(6 + 3 + 300 + 3 + 60 + 4);
    const kept = ex.lines.map((l) => l.text);
    expect(kept).toContain("##[group]Run npm test");
    expect(kept).toContain("FAIL src/api.test.ts");
    expect(kept).toContain("  Error: thrown: Exceeded timeout of 5000 ms for a test.");
    expect(kept).toContain("##[error]Process completed with exit code 1.");
    expect(kept).not.toContain("Uploading report"); // after the failure, other step
    expect(kept).not.toContain("added 900 packages in 20s"); // earlier, passing step
    const fail = ex.lines.find((l) => l.text === "FAIL src/api.test.ts")!;
    expect(text.split("\n")[fail.n - 1]).toContain("FAIL src/api.test.ts"); // numbers point at the real line
    expect(ex.chars).toBeLessThanOrEqual(2000);
  });

  it("keeps details printed after the first error marker", () => {
    const text = log([
      "##[group]Run pnpm build",
      "##[error]command pnpm run build exited (1)",
      ...Array.from({ length: 200 }, (_, i) => `   Compiling crate-${i} v1.0.0`),
      "error[E0425]: cannot find value `x` in this scope",
      "##[error]Process completed with exit code 1.",
    ]);
    const kept = trimLog(text, { budget: 1500 }).lines.map((l) => l.text);
    expect(kept).toContain("error[E0425]: cannot find value `x` in this scope");
    expect(kept).toContain("##[error]command pnpm run build exited (1)");
  });

  it("does not spend the budget on progress lines that only look like errors", () => {
    const text = log([
      "##[group]Run cargo build",
      ...Array.from({ length: 100 }, (_, i) => `   Compiling proc-macro-error v1.0.${i}`),
      ...Array.from({ length: 100 }, (_, i) => `   Compiling crate-${i} v1.0.0`),
      "##[error]Process completed with exit code 101.",
    ]);
    const ex = trimLog(text, { budget: 100_000, tail: 5 });
    // The step's first lines (its command) are always kept; beyond them, no progress line is kept as a hit.
    expect(ex.lines.filter((l) => l.n > 4 && l.text.includes("proc-macro-error"))).toHaveLength(0);
    expect(NOISE.test("   Compiling proc-macro-error v1.0.4")).toBe(true);
    expect(CAUSE.test("   Compiling proc-macro-error v1.0.4")).toBe(true); // why the noise filter is needed
  });

  it("falls back to the end of the log when there is no error marker", () => {
    const text = log(Array.from({ length: 100 }, (_, i) => `line ${i}`));
    const ex = trimLog(text, { tail: 10 });
    expect(ex.failingStep).toBeNull();
    expect(ex.hasErrorMarker).toBe(false);
    expect(renderExcerpt(ex).split("\n")[0]).toMatch(/ends without an error marker/);
    expect(ex.lines.at(-1)!.text).toBe("line 99");
    expect(ex.lines.length).toBeGreaterThanOrEqual(10);
  });

  it("respects the budget on a huge log and cuts very long lines", () => {
    const text = log([
      "##[group]Run make",
      ...Array.from({ length: 50_000 }, (_, i) => (i % 100 === 0 ? `error: thing ${i} failed` : `noise ${i}`)),
      "x".repeat(5000),
      "##[error]Process completed with exit code 2.",
    ]);
    const ex = trimLog(text, { budget: 3000, maxLine: 200 });
    expect(ex.chars).toBeLessThanOrEqual(3000);
    expect(ex.lines.every((l) => l.text.length <= 201)).toBe(true);
    expect(ex.lines.at(-1)!.text).toBe("##[error]Process completed with exit code 2.");
    // keyword hits nearest the error win the budget
    const hits = ex.lines.filter((l) => l.n > 4 && l.text.startsWith("error: thing")).map((l) => l.n);
    expect(hits.length).toBeGreaterThan(0);
    expect(Math.min(...hits)).toBeGreaterThan(40_000);
  });

  it("handles an empty log", () => {
    expect(trimLog("")).toMatchObject({ totalLines: 0, lines: [], chars: 0, failingStep: null });
  });
});

describe("renderExcerpt", () => {
  it("prefixes line numbers and marks gaps", () => {
    const text = renderExcerpt({
      totalLines: 10, totalChars: 0, failingStep: null, hasErrorMarker: true, chars: 0,
      lines: [{ n: 1, text: "a" }, { n: 2, text: "b" }, { n: 7, text: "c" }],
    });
    expect(text).toBe("L1: a\nL2: b\n… 4 lines skipped\nL7: c");
  });
});

describe("trim CLI arguments", () => {
  it("takes a file and an optional budget", async () => {
    const { parseTrimArgs } = await import("../src/logs/cli.js");
    expect(parseTrimArgs(["job.log"])).toEqual({ file: "job.log", budget: 6000 });
    expect(parseTrimArgs(["--budget", "3000", "job.log"])).toEqual({ file: "job.log", budget: 3000 });
    expect(() => parseTrimArgs([])).toThrow(/usage/);
    expect(() => parseTrimArgs(["job.log", "--budget", "10"])).toThrow(/budget/);
  });
});
