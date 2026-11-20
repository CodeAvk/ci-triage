/**
 * Print the trimmed excerpt of a saved job log.
 *
 * Usage: npm run trim -- path/to/job.log [--budget 6000]
 */
import { readFileSync } from "node:fs";
import { renderExcerpt, trimLog } from "./trim.js";

export function parseTrimArgs(argv: string[]): { file: string; budget: number } {
  const file = argv.find((a, i) => !a.startsWith("--") && argv[i - 1] !== "--budget");
  if (!file) throw new Error("usage: npm run trim -- path/to/job.log [--budget 6000]");
  const i = argv.indexOf("--budget");
  const budget = i === -1 ? 6000 : Number(argv[i + 1]);
  if (!Number.isInteger(budget) || budget < 200) throw new Error(`bad --budget: ${argv[i + 1]}`);
  return { file, budget };
}

if (/logs[\\/]cli\.ts$/.test(process.argv[1] ?? "")) {
  try {
    const { file, budget } = parseTrimArgs(process.argv.slice(2));
    const ex = trimLog(readFileSync(file, "utf8"), { budget });
    console.log(`${ex.totalLines} lines, ${ex.totalChars} chars -> ${ex.lines.length} lines, ${ex.chars} chars` +
      `; failing step: ${ex.failingStep ?? "not found"}\n`);
    console.log(renderExcerpt(ex));
  } catch (err) {
    console.error(String(err));
    process.exit(1);
  }
}
