# dndbeyond-mcp — Known Issues & Backlog

**Last updated:** 2026-07-02
**Source:** findings from the dndtools full-project review (2026-07-01), which included this fork.
Roughly priority-ordered. This is the current tracking doc — `AUDIT.md` (2026-02-14) is stale
(several of its issues are already fixed).

## Security & auth (do first)

- **`npm audit fix`** — high-severity advisories in `@hono/node-server` (static-path auth bypass),
  `express-rate-limit` (IPv4-mapped IPv6 bypass), and `fast-uri` (path traversal). All fixable with a
  plain `npm audit fix` (no breaking changes). Also **drop the unused `undici` dependency** (declared,
  never imported).
- **Cookie-file hardening** (`src/api/auth.ts`, `setup/auth-flow.ts`) — `~/.dndbeyond-mcp/config.json`
  holds the `CobaltSession` (full account access) but is written with default perms. Write it `0600`
  (dir `0700`), and store **only the auth cookies**, not the whole dndbeyond.com cookie jar.
- **Token invalidation on 401** (`src/api/auth.ts`, `src/api/client.ts`) — a 401 never clears the
  cached bearer token, and `setup_auth` doesn't either, so the server keeps using a stale (or
  previous-account) token until TTL expiry. Add an exported `invalidateCobaltToken()`, call it on 401
  (and retry once) and after a successful `setup_auth`; clear the cache on re-auth.
- **`getCobaltToken` hardening** (`src/api/auth.ts`) — validate `ttl` (`typeof === "number" && > 60`)
  before trusting it (a missing/0 ttl currently re-exchanges every request); add
  `signal: AbortSignal.timeout(...)`; single-flight concurrent cold-start exchanges.

## Resilience correctness

- **Rate limiter concurrency bug** (`src/resilience/rate-limiter.ts`) — `acquire()` waits once then
  decrements unconditionally, so N concurrent callers all wake and fire at once (tokens go negative;
  the 2 req/s cap becomes an N-burst). `list_characters` / campaign fetches do exactly this via
  `Promise.all`. Loop until a token is actually available, or use a waiter queue.
- **Retry storm** (`src/api/client.ts`, `src/resilience/retry.ts`) — the rate-limit token is acquired
  once, but `withRetry` can fire up to 4 fetches (incl. on 429) with no per-attempt rate limiting and
  no `Retry-After`/jitter. Acquire a token per attempt; special-case 429.
- **Circuit breaker half-open** (`src/resilience/circuit-breaker.ts`) — admits unlimited concurrent
  probes when half-open. Gate to a single in-flight probe.
- **Cache is FIFO, not LRU** (`src/cache/lru.ts`) — `get()` doesn't refresh recency and `set()` on an
  existing key still evicts the oldest. One-shot cache-busting keys (rest/resolveChoices) can evict hot
  long-lived entries (e.g. the 24h spell compendium). Re-insert on `get`; skip eviction on key replace;
  guard `ttl <= 0` writes.
- **Cache/token not auth-scoped** (`src/cache/lru.ts`, `src/api/auth.ts`, `src/tools/reference.ts`
  `cachedConfig`) — after `setup_auth` switches accounts, previous-account campaigns/characters keep
  serving until TTL. Clear the cache + reset the token/config singletons on `setup_auth`.
- **Waterdeep envelope error returned as data** (`src/api/client.ts`) — a `{ status: "error" }` envelope
  is cast to `T` and handed to callers (→ `TypeError`/garbage). Throw an `HttpError` on non-`success`.

## Write-tool safety

- **Stale read-modify-write** (`src/tools/character.ts` `updateHp`/`updateCurrency`/`castSpell`) —
  compute deltas from a up-to-60s-cached sheet, so a concurrent browser-side change is overwritten.
  Bypass the cache (ttl 0) for the pre-write read.
- **`delete_character` has no safeguards** (`src/tools/character.ts`) — one-shot irreversible DDB delete
  with no name/ownership confirmation. Require a matching character **name** before deleting (or an
  `DDB_MCP_ALLOW_DESTRUCTIVE` opt-in). D&D Beyond has no undo.
- **`cast_spell` accepts nonsensical levels** — no check that `level >= spell.level` / `<= 9`.

## Low / cleanup

- **`setup/auth-flow.ts`** — the 5-min timeout `reject`s but never `clearInterval`; the async poll keeps
  calling `context.cookies()` on a possibly-closed browser (unhandled rejections). Clear the interval;
  wrap the callback in try/catch.
- **`check_auth` mislabels failures** (`src/tools/auth.ts`) — a network/500 error is reported as
  "Session expired (401)"; distinguish "not authenticated" vs "couldn't verify".
- **Committed `.mcp.json`** contains the upstream author's machine path (`cwd`); remove or make relative.
- **Windows-hostile `process.env.HOME`** in dev scripts (`setup/capture-builder.ts`,
  `explore-endpoints.ts`, `scripts/extract-*.mjs`) — use `os.homedir()` (the fork is maintained on
  Windows).
- **Loose zod on write tools** (`src/server.ts`) — `z.coerce.number()` without `.int().min()/.max()`
  for ids/levels; malformed values flow into PUT bodies.
- **`playwright` as a prod dependency** — intentional (the `setup_auth` tool launches Chrome), but an
  LLM tool-call popping a browser is surprising attack surface; consider gating behind an env flag for
  headless deploys.

## Docs

- **Refresh or delete `AUDIT.md`** (2026-02-14) — it still reports issues that are fixed
  (campaign-party cache-key collision, resource AC/ability bugs, exact-only name match, `update_hp`
  404), so it misleads triage.

---

*Strengths noted in the review (for context): clean layered client (cache → rate-limit → breaker →
retry → fetch), graceful degradation on DDB's decommissioned write APIs, good test discipline, and the
fork's own thoughtful additions (edition-aware `isLegacy` lookups, real `check_auth` liveness probe,
shared `character-calculations.ts`).*
