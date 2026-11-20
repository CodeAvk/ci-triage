/**
 * Cuts a GitHub Actions job log down to the lines that explain the failure, deterministically.
 *
 * Job logs run from a few KB to over 2 MB (measured on pytorch/pytorch, 2026-11-21), far too much to
 * send to a free-tier model or to read by eye. The trimmer:
 *   1. strips timestamps and colour codes, keeping each line's original number;
 *   2. finds the failing step: the last `##[group]Run ...` line before the first `##[error]`
 *      (a log with no error marker, e.g. cut off when a runner was lost, is flagged as such);
 *   3. keeps, from that step: the error lines, lines that look like a cause (keywords below) with a
 *      little context, the step's first lines (the command), and the last lines before the error;
 *   4. stays within a character budget, dropping the keyword hits furthest from the error first.
 * Line numbers survive, so a model's quoted evidence can be checked against the real log.
 */

export interface LogLine {
  n: number; // 1-based line number in the original log
  text: string;
}

export interface Excerpt {
  totalLines: number;
  totalChars: number;
  failingStep: string | null; // the `Run ...` title of the failing step
  hasErrorMarker: boolean; // false when the log stops without any `##[error]` (cut off, runner lost)
  lines: LogLine[]; // kept lines, in log order
  chars: number; // characters kept
}

export interface TrimOptions {
  budget?: number; // max characters kept (default 6,000: about 1,500 tokens)
  tail?: number; // lines kept just before the first error
  head?: number; // lines kept at the start of the failing step
  context?: number; // lines kept around each keyword hit
  maxLine?: number; // longer lines are cut to this many characters
}

const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z ?/;
// Colour codes always start with ESC in these logs; a looser pattern would eat text like "[5312ms]".
const ANSI = /\u001b\[[0-9;]*[A-Za-z]/g;
const ERROR = /##\[error\]/;
const STEP = /^##\[group\]Run (.*)$/;

/**
 * Lines that often carry the cause. Deliberately broad: this only chooses what to keep, it does not
 * decide flaky or real.
 */
export const CAUSE = new RegExp(
  [
    "\\berror\\b", "\\bfail(?:ed|ure|ing)?\\b", "\\bexception\\b", "traceback", "panicked", "assert",
    "timed? ?out", "timeout", "\\bkilled\\b", "out of memory", "\\boom\\b", "segmentation fault",
    "econnreset", "econnrefused", "etimedout", "enotfound", "rate limit", "\\b5\\d\\d\\b.*(?:error|gateway|unavailable)",
    "could not resolve", "no space left", "permission denied", "not found", "exit(?:ed)? (?:with )?code",
    "✕", "●", "^FAIL\\b", "^E\\s{2,}",
  ].join("|"),
  "i",
);

/**
 * Progress lines that match a cause keyword only by name (crates such as `proc-macro-error` or
 * `static_assertions`) or are routine warnings. They are never kept as keyword hits.
 */
export const NOISE = new RegExp(
  [
    "^\\s*(?:Compiling|Checking|Downloading|Downloaded|Fresh|Building|Installing|Collecting|Requirement already satisfied)\\b",
    "DeprecationWarning",
    "^\\s*(?:Using|Successfully installed)\\b",
  ].join("|"),
);

/** Timestamp and colour codes removed. */
export function cleanLine(raw: string): string {
  return raw.replace(TIMESTAMP, "").replace(ANSI, "").replace(/\s+$/, "");
}

export function trimLog(log: string, opts: TrimOptions = {}): Excerpt {
  const budget = opts.budget ?? 6000;
  const tail = opts.tail ?? 40;
  const head = opts.head ?? 3;
  const context = opts.context ?? 2;
  const maxLine = opts.maxLine ?? 300;

  const raw = log.split(/\r?\n/);
  if (raw.length > 0 && raw[raw.length - 1] === "") raw.pop();
  const lines: LogLine[] = raw.map((r, i) => {
    const text = cleanLine(r);
    return { n: i + 1, text: text.length > maxLine ? `${text.slice(0, maxLine)}…` : text };
  });

  const firstError = lines.findIndex((l) => ERROR.test(l.text));
  const errorAt = firstError === -1 ? lines.length - 1 : firstError;
  let stepStart = 0;
  let failingStep: string | null = null;
  for (let i = errorAt; i >= 0; i--) {
    const m = lines[i]!.text.match(STEP);
    if (m) { stepStart = i; failingStep = m[1]!.trim(); break; }
  }
  // Error lines anywhere after the step start belong to the failure (some steps report twice).
  const errorIdx = lines.map((l, i) => (i >= stepStart && ERROR.test(l.text) ? i : -1)).filter((i) => i !== -1);
  const end = errorIdx.length ? errorIdx[errorIdx.length - 1]! : lines.length - 1;

  // Priority: lower is kept first. Errors 0, tail 1, step head 2, keyword hits by distance from the error.
  const priority = new Map<number, number>();
  const want = (i: number, p: number) => {
    if (i < stepStart || i > end || i < 0) return;
    const cur = priority.get(i);
    if (cur === undefined || p < cur) priority.set(i, p);
  };
  // Some tools print the `##[error]` marker first and their details after it, so the lines just
  // after an error matter too, and cause lines are searched up to the last error.
  for (const i of errorIdx) {
    want(i, 0);
    for (let k = i + 1; k <= i + 3; k++) want(k, 0.5);
  }
  if (errorIdx.length === 0) want(end, 0); // no error marker: the last line is the best clue
  for (let i = Math.max(stepStart, errorAt - tail); i < errorAt; i++) want(i, 1);
  for (let i = stepStart; i < stepStart + head; i++) want(i, 2);
  const span = Math.max(1, end - stepStart);
  const anchors = errorIdx.length ? errorIdx : [end];
  for (let i = stepStart; i <= end; i++) {
    if (!CAUSE.test(lines[i]!.text) || NOISE.test(lines[i]!.text)) continue;
    const distance = Math.min(...anchors.map((e) => Math.abs(e - i)));
    const p = 3 + distance / span; // nearer an error -> kept first
    for (let k = i - context; k <= i + context; k++) want(k, p);
  }

  const ranked = [...priority.entries()]
    .filter(([i]) => lines[i]!.text.trim() !== "")
    .sort((a, b) => a[1] - b[1] || b[0] - a[0]);
  const kept = new Set<number>();
  let chars = 0;
  for (const [i] of ranked) {
    const len = lines[i]!.text.length + 1;
    if (chars + len > budget) continue;
    kept.add(i);
    chars += len;
  }
  return {
    totalLines: lines.length,
    totalChars: log.length,
    failingStep,
    hasErrorMarker: firstError !== -1,
    lines: [...kept].sort((a, b) => a - b).map((i) => lines[i]!),
    chars,
  };
}

/** The excerpt as text, one `L<n>: ` prefixed line each, with a marker where lines were skipped. */
export function renderExcerpt(ex: Excerpt): string {
  const out: string[] = [];
  if (!ex.hasErrorMarker && ex.totalLines > 0) out.push("(the log ends without an error marker: it may have been cut off)");
  let prev = 0;
  for (const l of ex.lines) {
    if (prev && l.n > prev + 1) out.push(`… ${l.n - prev - 1} lines skipped`);
    out.push(`L${l.n}: ${l.text}`);
    prev = l.n;
  }
  return out.join("\n");
}
