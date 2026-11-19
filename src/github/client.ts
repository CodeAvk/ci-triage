/**
 * A small GitHub REST client for public Actions data: JSON requests with pagination, retries on
 * transient server errors, a hard request budget, and job-log downloads.
 *
 * Job logs redirect to blob storage on another host. The token is sent to api.github.com only;
 * the redirect is followed by hand without it (forwarding it there fails, and leaks it).
 */
import { existsSync, readFileSync } from "node:fs";

export const API = "https://api.github.com";

export class GitHubError extends Error {
  constructor(readonly status: number, readonly path: string, detail: string) {
    super(`GitHub HTTP ${status} on ${path}: ${detail}`);
  }
}

/** Thrown before a request that would exceed the budget, so a run stops cleanly. */
export class RequestBudgetError extends Error {}

export interface GitHubOptions {
  token: string;
  maxRequests?: number;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  retries?: number; // extra attempts on 502, 503 and 504
}

const TRANSIENT = new Set([502, 503, 504]);

export class GitHub {
  requests = 0;
  private readonly fetchImpl: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(private readonly opts: GitHubOptions) {
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  }

  private async send(url: string, init: RequestInit, label: string): Promise<Response> {
    const retries = this.opts.retries ?? 3;
    for (let attempt = 0; ; attempt++) {
      if (this.opts.maxRequests !== undefined && this.requests >= this.opts.maxRequests) {
        throw new RequestBudgetError(`request budget of ${this.opts.maxRequests} reached`);
      }
      this.requests++;
      const res = await this.fetchImpl(url, init);
      if (TRANSIENT.has(res.status) && attempt < retries) {
        await this.sleep(2000 * 2 ** attempt);
        continue;
      }
      if (res.status >= 400) {
        const detail = (await res.text()).replace(/\s+/g, " ").slice(0, 300);
        throw new GitHubError(res.status, label, detail);
      }
      return res;
    }
  }

  private headers(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.opts.token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "ci-triage",
    };
  }

  /** GET a JSON resource; `path` starts with "/". */
  async json<T>(path: string): Promise<T> {
    const res = await this.send(`${API}${path}`, { headers: this.headers() }, path);
    return (await res.json()) as T;
  }

  /**
   * Every item of a paginated list. `key` names the array in the response (e.g. "jobs").
   * Small pages are the default: job lists with many steps fail with 502 at 100 per page.
   */
  async all<T>(path: string, key: string, perPage = 50, maxPages = 40): Promise<T[]> {
    const out: T[] = [];
    const sep = path.includes("?") ? "&" : "?";
    for (let page = 1; page <= maxPages; page++) {
      const body = await this.json<Record<string, unknown>>(`${path}${sep}per_page=${perPage}&page=${page}`);
      const items = (body[key] ?? []) as T[];
      out.push(...items);
      if (items.length < perPage) break;
    }
    return out;
  }

  /** A job's plain-text log. */
  async jobLog(repo: string, jobId: number): Promise<string> {
    const path = `/repos/${repo}/actions/jobs/${jobId}/logs`;
    const first = await this.send(`${API}${path}`, { headers: this.headers(), redirect: "manual" }, path);
    const location = first.headers.get("location");
    if (first.status >= 300 && first.status < 400 && location) {
      const blob = await this.send(location, { headers: { "User-Agent": "ci-triage" } }, `${path} (redirect)`);
      return blob.text();
    }
    return first.text();
  }
}

/**
 * The GitHub token from GITHUB_TOKEN, or from a `GITHUB_TOKEN=...` line in a .env file.
 * The token is never logged.
 */
export function loadToken(envPath = ".env", env: NodeJS.ProcessEnv = process.env): string {
  const fromEnv = env.GITHUB_TOKEN?.trim();
  if (fromEnv) return fromEnv;
  if (existsSync(envPath)) {
    for (const raw of readFileSync(envPath, "utf8").split(/\r?\n/)) {
      const m = raw.trim().match(/^GITHUB_TOKEN\s*=\s*["']?([^"'\s]+)["']?$/);
      if (m) return m[1]!;
    }
  }
  throw new Error("No GitHub token found. Set GITHUB_TOKEN or add it to .env");
}
