import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { GitHub, GitHubError, loadToken, RequestBudgetError } from "../src/github/client.js";

interface Call { url: string; headers: Record<string, string>; redirect?: string }

/** A fake fetch that answers from a list of handlers and records every call. */
function fakeFetch(handler: (url: string, n: number) => Response) {
  const calls: Call[] = [];
  const impl = (async (url: string | URL, init?: RequestInit) => {
    calls.push({ url: String(url), headers: (init?.headers ?? {}) as Record<string, string>, redirect: init?.redirect });
    return handler(String(url), calls.length);
  }) as typeof fetch;
  return { impl, calls };
}
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const noSleep = async () => undefined;

describe("GitHub client", () => {
  it("retries transient 502s, then succeeds, counting every request", async () => {
    const f = fakeFetch((_u, n) => (n < 3 ? new Response("bad gateway", { status: 502 }) : json({ ok: true })));
    const gh = new GitHub({ token: "t", fetchImpl: f.impl, sleep: noSleep });
    expect(await gh.json("/x")).toEqual({ ok: true });
    expect(gh.requests).toBe(3);
    expect(f.calls[0]!.headers.Authorization).toBe("Bearer t");
  });

  it("gives up after the retries and reports the status", async () => {
    const f = fakeFetch(() => new Response("down", { status: 503 }));
    const gh = new GitHub({ token: "t", fetchImpl: f.impl, sleep: noSleep, retries: 1 });
    await expect(gh.json("/x")).rejects.toThrow(GitHubError);
    expect(gh.requests).toBe(2);
  });

  it("does not retry client errors", async () => {
    const f = fakeFetch(() => json({ message: "Not Found" }, 404));
    const gh = new GitHub({ token: "t", fetchImpl: f.impl, sleep: noSleep });
    await expect(gh.json("/x")).rejects.toThrow(/404/);
    expect(gh.requests).toBe(1);
  });

  it("stops before exceeding the request budget", async () => {
    const f = fakeFetch(() => json({}));
    const gh = new GitHub({ token: "t", fetchImpl: f.impl, maxRequests: 2 });
    await gh.json("/a");
    await gh.json("/b");
    await expect(gh.json("/c")).rejects.toThrow(RequestBudgetError);
    expect(f.calls).toHaveLength(2);
  });

  it("pages through a list until a short page", async () => {
    const f = fakeFetch((url) => {
      const page = Number(new URL(url).searchParams.get("page"));
      return json({ jobs: page < 3 ? [{ id: page * 10 }, { id: page * 10 + 1 }] : [{ id: 99 }] });
    });
    const gh = new GitHub({ token: "t", fetchImpl: f.impl });
    expect((await gh.all<{ id: number }>("/runs/1/jobs?filter=all", "jobs", 2)).map((j) => j.id)).toEqual([10, 11, 20, 21, 99]);
    expect(f.calls[0]!.url).toContain("/runs/1/jobs?filter=all&per_page=2&page=1");
  });

  it("follows a log redirect without sending the token to the other host", async () => {
    const f = fakeFetch((url) =>
      url.startsWith("https://api.github.com")
        ? new Response(null, { status: 302, headers: { location: "https://blob.example.net/log?sig=abc" } })
        : new Response("2026-11-19T10:00:00Z ##[error]Process completed with exit code 1."));
    const gh = new GitHub({ token: "secret", fetchImpl: f.impl });
    expect(await gh.jobLog("o/r", 5)).toContain("##[error]");
    expect(f.calls[0]!.redirect).toBe("manual");
    expect(f.calls[1]!.url).toBe("https://blob.example.net/log?sig=abc");
    expect(JSON.stringify(f.calls[1]!.headers)).not.toContain("secret");
  });
});

describe("loadToken", () => {
  it("reads GITHUB_TOKEN from the environment first, then from .env", () => {
    expect(loadToken("nope.env", { GITHUB_TOKEN: " abc " })).toBe("abc");
    const dir = mkdtempSync(join(tmpdir(), "ci-triage-"));
    try {
      const env = join(dir, ".env");
      writeFileSync(env, "# comment\nOTHER=1\nGITHUB_TOKEN=\"xyz\"\n");
      expect(loadToken(env, {})).toBe("xyz");
      writeFileSync(env, "OTHER=1\n");
      expect(() => loadToken(env, {})).toThrow(/No GitHub token/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
