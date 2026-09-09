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
- **`setAbilityScore` silently no-ops for `type: 1` ("standard array")** — found live 2026-09-06 while
  probing for `docs/plans/2026-09-05-character-fixes-integration-plan.md`. The endpoint returns
  `200 "Ability score type successfully updated."` but never writes to `stats[].value`; `type: 3`
  ("point buy") through the same endpoint/params shape does persist correctly. Distinct from item 3 in
  that plan (which is about `set`-type *modifiers* being ignored, not the base value write itself for
  one specific input mode). Not yet triaged for a fix.

## Read-tool correctness

- **`findCharacterByName`'s Levenshtein fallback has no maximum-distance/similarity-ratio guard** —
  found live 2026-09-09 while gathering v0.9.0 fixtures: searching `characterName: "Niko"` against an
  account with no character named Niko silently returned an unrelated character ("Duo", edit distance 3)
  instead of "not found." Worse than item 7's campaign-less-characters gap (`docs/plans/2026-09-05-
  character-fixes-integration-plan.md`, v0.10.0) — that one is *silent absence*, this is *silent wrong
  answer* with no error a caller could detect. The `<= 3` absolute-distance threshold in
  `findCharacterByName`/`getCharacter` (`src/tools/character.ts`) needs a length-relative cutoff (e.g. a
  maximum distance-to-length ratio) so a short query can't fuzzy-match an unrelated short name. Worth
  fixing alongside v0.10.0's item 7 rework, which touches the same function. Not fixed this session.

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
retry → fetch), good test discipline, and the fork's own thoughtful additions (edition-aware `isLegacy`
lookups, real `check_auth` liveness probe, shared `character-calculations.ts`). The "graceful degradation
on DDB's decommissioned write APIs" this review praised turned out to be five dead tools with an
apologetic error message, not a decommissioned API — see `v0.8.0` below.*

## Resolved in v0.8.0

- **The five "decommissioned write API" tools weren't decommissioned — they were on stale endpoint
  paths/payload shapes.** `update_spell_slots`, `update_death_saves`, `update_currency`,
  `update_pact_magic`, and `cast_spell`'s slot path are restored and live-verified; see
  `docs/plans/2026-09-05-character-fixes-integration-plan.md`.
- **`long_rest`/`short_rest` were a silent false success** — the GET-with-query call returned 200 with
  plausible text but never persisted the reset. Now POST-with-body, confirmed by independent read-back.
- **Condition ID 15 was mislabeled Exhaustion; it's actually ID 4** — corrected and live-verified.
- **`updateHp` 400s if `tempHp` is omitted** (found live while verifying the above) — now always sends
  `temporaryHitPoints`, defaulting to the character's current value.
- **`currencies`, `deathSaves`, and `conditions` were absent from `get_character`'s output at every detail
  level**, despite all three having correct write paths — found by tier-3 behavioral testing. Added
  `formatCurrencies`/`formatDeathSaves`/`formatConditions` to the sheet formatter.
- **Pact Magic never displayed for a single-class Warlock** — the display logic returned early whenever
  regular spell slots were empty, which is always true for a single-class Warlock. Now computed unconditionally.
- **`add_condition` with no explicit `level` silently cleared an existing leveled condition** instead of
  adding/defaulting one, because D&D Beyond's API treats a bare `null` level as "remove." Now defaults to
  level 1 for a leveled condition when the caller omits `level`.
- **`long_rest` did not clear death saves**, despite its own code comment claiming the server-side reset
  handled it atomically — live-verified the rest endpoint's response carries no `deathSaves` field, and
  death saves survived a long rest that fully restored HP. `long_rest` now explicitly clears them when
  nonzero, after the rest itself succeeds; `short_rest` is confirmed (not assumed) to leave them untouched.

## v0.9.0 — character-sheet correctness (implemented and unit-tested 2026-09-09; not yet released)

Items 1, 3, 2, 10, 12, 8 of `docs/plans/2026-09-05-character-fixes-integration-plan.md`. Item 4 (hybrid
2024-background ASI double-counting) is **deferred** — its fixture (M3) wasn't built this session; pick
it up alongside PR 9 once M3 exists. All fixes below are confirmed against real live payloads (not just
mocks) captured 2026-09-09 — see the plan's "v0.9.0 progress" section for the worked comparisons.

- **`calculateMaxHp` ignored Constitution entirely** — `baseHitPoints` is pre-CON; every character above
  level 1 with a nonzero CON mod got the wrong max HP (confirmed live: one character was undercounted by
  24 HP). Now adds `conMod * level` plus flat/per-level HP modifiers (e.g. the Tough feat).
- **`set`-type ability-score modifiers were invisible** (Belt of Hill Giant Strength and similar) —
  `computeFinalAbilityScore` only ever summed `type: "bonus"` modifiers. Confirmed live: a character
  wearing the belt displayed STR 12 (her unmodified score), not 21. New `computeCharacterAbilityScore`
  takes the max of the natural score and any matching `set` modifier.
- **AC: three independent bugs.** (1) Shield/armor detection was string-only; every shield on every real
  character examined had an empty `type` string and was silently skipped (shield bonus never applied) —
  now prefers the numeric `armorTypeId`. (2) Unarmored AC hardcoded barbarian/monk by class name and
  missed everything else (natural armor, homebrew formulas); now builds a candidate list from any `set`-
  type `unarmored-armor-class` modifier and takes the max, honoring `ignore: unarmored-dex-ac-bonus` and
  `ac-max-dex-modifier`. (3) `armored-armor-class`/`unarmored-armor-class` *bonus* modifiers applied
  unconditionally regardless of armor state; now gated correctly. A weapon literally named "Crossbow,
  Light" was also found to false-match a naive `.includes("light")` fallback and get misclassified as
  light armor — fixed by gating the string fallback on the item plausibly being armor at all.
- **Saves/skills/spell DC skipped generic bonus subtypes** — confirmed live: a Luckstone's `ability-checks
  +1` was excluded from every skill total. Now includes `saving-throws`/`ability-checks`/`spell-save-dc`
  (plus their per-ability/skill/class variants).
- **Speed was hardcoded to 30 ft; no initiative, passives, or senses** — now reads
  `race.weightSpeeds.normal` for real per-race speed, and adds Initiative, three passive scores, and
  nonzero senses (darkvision confirmed live via a `set-base` modifier).
- **Spells with `prepared: false` were silently dropped** — confirmed live on a real Warlock: racial
  at-will cantrips, a feat's 1/long-rest spell, and most invocation-granted spells (including the
  warlock's own Eldritch Blast) were completely invisible. New `getCharacterSpellEntries` merges all five
  `spells.*` collections plus the previously-unmodeled `classSpells`, surfacing every spell with its
  source(s) and casting mode. Header renamed "Prepared Spells" → "Spells".

**Unplanned finding, fixed alongside the above:** `sumModifierBonuses` only read `mod.value`, but some
modifiers (confirmed live: an item's flat HP bonus) carry the real number in `fixedValue` with `value:
null`. Now falls back to `fixedValue`.

**Not fixed this session, found while capturing v0.9.0 fixtures:** see "Read-tool correctness" above for
the Levenshtein fuzzy-match false-positive.
