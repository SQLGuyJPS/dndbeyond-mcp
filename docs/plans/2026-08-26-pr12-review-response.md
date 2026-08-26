# PR #12 Review Response — Implementation Plan

## Context

`dmjohnston89/dndbeyond-mcp#12` (branch `add-legacy-sensing-for-more-entities`, base `d31a0d0`) adds edition-aware
reference lookups, character-independent subclass lookups, a rebuilt `search_class_features`, and `campaignId`
threading across 15 tools. The maintainer is inclined to merge but raised three pre-merge blockers, three
discussion items, and four housekeeping items.

I verified every claim against the code rather than taking it at face value. **All three blockers are real
bugs**, and two of them are *broader* than the reviewer described. Build is clean (`tsc --noEmit`, exit 0) and
**344 tests pass across 32 files** — the reviewer's numbers are exact.

Goal of this work: land the three blockers, answer the two direction questions, clear housekeeping, and finish
the edition-awareness feature **uniformly across every compendium entity** — including spells and conditions,
whose earlier implementations diverge from the pattern this PR establishes and which the PR's own README now
makes claims about (see Part D). Target release: **v0.7.0**.

One decision is deferred to the maintainer rather than taken unilaterally: `get_condition`'s 2014 default
(**D2b**). One step is blocked on the author's machine: the live items probe (**A1**), which needs auth this
planning session doesn't have.

### PR scope reference

| Commit | Content |
|---|---|
| `b4864d9` | edition-aware lookups (classes, species, backgrounds, feats, items) + `reference-editions.test.ts` |
| `1c0225e` | `getGameConfigSafe` graceful degradation + `reference-config-resilience.test.ts` |
| `2fef826` | live test coverage |
| `54eefa8` | subclass independence + `search_class_features` 404 fix + handoff doc |
| `f6f7597` | all `campaignId` work |
| `e706e39` | README campaignId opt-in note |

Everything at or below `d31a0d0` is pre-existing and **not** this PR's.

---

## Part A — Pre-merge blockers

### A1. `edition` on `search_items` / `get_item` may be a silent no-op

**Accurate?** **Yes, and the reviewer understated the reach.**
- `DdbItem.isLegacy` was indeed introduced by this PR (`src/tools/reference.ts:901`; the `+  isLegacy: boolean;`
  line is in `b4864d9`'s diff). `sources` at `:897` pre-dated it.
- The only assertion is a unit test with a hand-built mock that *sets* the field:
  `tests/tools/reference-editions.test.ts:229-238`. Live item coverage
  (`tests/live/read-reference.test.ts:101-118`) passes no `edition` and asserts no tag. Grep for
  `isLegacy`/`sources`/`sourceId` across `tests/live/` returns **zero** hits.
- The failure mode is exactly as described: `collapseByEdition` → `pickByEdition`
  (`reference.ts:470-516`) tests `Boolean(c.isLegacy) === wantLegacy`, and `Boolean(undefined) === false`,
  so a missing field classifies every item as 2024. `get_item { edition: "2014" }` would then always return the
  2024 item.

**Gap in the reviewer's framing (worth saying in the reply):** "every other edition-aware entity in this PR got
live coverage" is **not true**. Classes, subclasses, races and backgrounds have live edition assertions
(`read-reference.test.ts:149-191`, `:200-215`, `:331-350`, `:362-382`), but **feats, class features and racial
traits do not** — feats' live tests (`:120-138`) only check the name and length, and `searchRacialTraits` has no
live test at all. Items are the highest-risk case because the flag is *assumed present in the payload* rather
than *derived*, but the coverage hole is wider than one entity.

**Also true and unmentioned:** `getItem` emits no edition marker of any kind
(`reference.ts:1002-1029`), so even with a working flag the caller can't tell which variant they got. That
overlaps Part D2.

**Actionable?** Yes, but **the live probe cannot run in this session** — there is no
`~/.dndbeyond-mcp/config.json` here, and `tests/live/setup.ts:30-33` throws without it. The live assertion must
be run by the user locally via `npm run test:live`. The derivation fallback needs no auth and can be built and
unit-tested immediately.

**Important?** **High.** This is the reviewer's own stated bar — confidently wrong output beats an error — and
it's the one item where the tool schema advertises a capability that may not exist. It also blocks the README's
claim at line 5 that items resolve "via D&D Beyond's `isLegacy` flag where present, or derived from the entity's
source book otherwise" — items currently have **no** derivation path, so the README overclaims today regardless
of what the probe finds.

**Effort: 4/10.** Small diff; the cost is the round-trip through a machine with live auth.

**Decision (user):** live assertion **and** `sources` fallback. Belt-and-braces — the param works either way.

**Steps**
1. Add to `tests/live/read-reference.test.ts` in the item `describe` block: fetch
   `ENDPOINTS.gameData.items()` raw via `client.get<DdbItem[]>` and assert the payload carries `isLegacy`
   (`expect(items.some(i => typeof i.isLegacy === "boolean")).toBe(true)`), plus that at least one item has
   `isLegacy === true`. Mirror the shape of the existing raw-`client.get` calls at `:262`/`:290`.
2. Add live `edition` assertions for `search_items` and `get_item` alongside it (a known cross-edition item —
   e.g. a reprinted magic item — collapsed to one row).
3. Make `DdbItem.isLegacy` **optional** (`isLegacy?: boolean`) at `reference.ts:901`, since the payload contract
   is unverified and a non-optional type is a lie TypeScript can't check.
4. Route items through the existing derivation: in `searchItems` (`reference.ts:911-916`) and `getItem`
   (`~:1006`), fetch config via `getGameConfigSafe` and apply
   `withLegacyFlag` (`reference.ts:539-549`) **only when the payload field is absent** — i.e. a small
   `isLegacy ?? isLegacyBySource(config, sources)` resolution, not a blanket overwrite (the native flag is
   authoritative where present, as it is for races and monsters).
5. Unit test in `tests/tools/reference-editions.test.ts`: items **without** `isLegacy` but **with** a legacy
   `sources[0].sourceId` still collapse correctly under `edition: "2014"`.
6. While here, close the sibling holes the reviewer's framing implied: add live edition assertions for
   `search_feats`/`get_feat` (`read-reference.test.ts:120-138`).
7. **User runs `npm run test:live` locally** and reports the item-payload result. If `isLegacy` is present, the
   fallback is defensive and stays. If absent, the fallback is now load-bearing and the README's items claim is
   already accurate.

**Files:** `src/tools/reference.ts`, `tests/live/read-reference.test.ts`, `tests/tools/reference-editions.test.ts`

---

### A2. `subclassOnlyFeatures` inverts when the base class has no features

**Accurate?** **Yes — and this is the most serious of the three.** Confirmed verbatim at
`src/tools/reference.ts:1653-1664`:

```ts
const baseIds = new Set((baseClass.classFeatures ?? []).map((f) => f.id));
return (subclass.classFeatures ?? []).filter((f) => !baseIds.has(f.id));
```

`DdbClass.classFeatures` is optional (`reference.ts:1480`). When it is empty or missing, `baseIds` is an empty
`Set`, nothing is excluded, and the function returns the subclass's **merged** base+subclass list — i.e. the
entire Paladin chassis reported as Oath of Glory features. The reviewer's example is precisely right.

The "graceful fallback" they refer to is `getSubclass` at `reference.ts:1881-1893`, and they're correct that it
covers the *opposite* case (zero features after the diff → "*No subclass-specific features returned…*"), not the
inverted one.

**Broader than stated:** the reviewer only named `get_subclass`. The same call sits inside `loadAllClassFeatures`
(`reference.ts:2205`), so `search_class_features` silently emits every base-class feature a second time,
attributed to `"Paladin (Oath of Glory)"` (the composite `className` built at `:2208`) — duplicated rows across
*every* subclass of the affected class, and then truncated to 30 (`:2273-2274`), so the real matches can get
pushed out of the result entirely. Both call sites need the guard.

**Actionable?** Yes, fully, with no external dependency. The guard is local and unit-testable with mocks.

**Important?** **Critical, and now rather than later.** Empty `baseClass.classFeatures` is not hypothetical — the
reviewer names two live triggers (unowned source, campaign-scoped narrowing), and this PR's own `campaignId`
work makes narrowed responses *more* likely. The output is confidently wrong and plausible-looking.

**Effort: 3/10.** Small, well-understood, no API dependency.

**Steps**
1. In `subclassOnlyFeatures` (`reference.ts:1653-1664`), change the signature to return a discriminated result —
   e.g. `{ features: DdbSubclassFeature[]; baseUnavailable: boolean }` — setting `baseUnavailable` when
   `(baseClass.classFeatures ?? []).length === 0` **and** the subclass has features. Do not silently return `[]`:
   that would trade a wrong answer for a missing one without explanation.
2. `getSubclass` (`reference.ts:1881-1893`): when `baseUnavailable`, suppress the feature list and emit an
   explicit note — "*Base-class feature list unavailable, so subclass-only features can't be isolated; the
   source may be unowned or campaign-narrowed. Try passing `campaignId`.*" Keep the existing zero-features
   fallback text for the genuine empty case; they are different conditions and deserve different messages.
3. `loadAllClassFeatures` (`reference.ts:2205`): when `baseUnavailable`, contribute **no** subclass rows for that
   class and record it so `searchClassFeatures` can surface it (fold into the A3 notice — same output line).
4. Unit tests in `tests/tools/reference-subclasses.test.ts`: base class with `classFeatures: []` and with
   `classFeatures: undefined`, asserting the Paladin chassis does **not** leak into `get_subclass` output and
   that `search_class_features` emits no duplicated base rows.
5. Keep the existing live anti-leak assertion (`read-reference.test.ts:214`,
   `expect(text).not.toContain("Lay On Hands")`) green.

**Files:** `src/tools/reference.ts`, `tests/tools/reference-subclasses.test.ts`

---

### A3. `Promise.allSettled` swallows per-class failures silently

**Accurate?** **Yes, on all three functions named.** Confirmed:

| Function | Location | Rejection handling |
|---|---|---|
| `loadAllClassFeatures` | `reference.ts:2160-2217` | `if (result.status !== "fulfilled") continue;` at `:2199` |
| `findSubclassMatches` | `reference.ts:1704-1739` | `continue` at `:1728` |
| `searchSubclasses` | `reference.ts:1741-1818` | `continue` at `:1773` |

None tracks a failure count. `searchSubclasses`'s terminal message (`:1806-1808`) is the same
"No subclasses found matching the search criteria." whether zero matched or all 24 fetches failed.

Two amplifiers the reviewer didn't mention, both of which make this more likely than it looks:
- The circuit breaker is `(5 failures, 30s)` (`server.ts:76`) and the limiter is 2 req/s, so a cold ~24-class
  fan-out takes ~12s — long enough for a mid-scan trip to reject *the entire remaining tail* at once.
- `DdbClient.get` caches on success only, so failed classes re-hit the network on every subsequent call for the
  next 24h while successful ones serve from cache — the incomplete result is *sticky and asymmetric*.

Also note `findSubclassMatches`'s own doc comment (`:1704-1710`) frames the skip as intentional for "a class with
no subclass content reachable for this account" — that's an **empty result**, but the code skips **rejections**
too. The comment documents a different behaviour than the code implements.

**Gap in the reviewer's suggestion:** `loadSpellCompendium` (`reference.ts:149-238`) does track `failureCount`
(`:156`) and throws on total failure (`:233-237`) — but it does **not** surface *partial* failures anywhere.
Mirroring it exactly would leave the reviewer's actual scenario (auth expires mid-scan, 5 of 24 classes fail)
just as silent as it is now. Worth flagging in the reply: the convention as written doesn't solve the problem
it's being cited for.

**Actionable?** Yes, fully. No external dependency.

**Important?** **High.** It is the reviewer's stated bar again, and unlike A1 it needs no live verification.

**Effort: 5/10.** Three call sites plus a shared helper plus output plumbing; mechanical but touches several
result paths.

**Decision (user):** surface partial failures too — go beyond the `loadSpellCompendium` convention.
`loadSpellCompendium` itself is **not** being retrofitted (keeps the diff out of pre-existing code); note the
inconsistency in the reply instead.

**Steps**
1. Add a small shared helper in `reference.ts` near the other fan-out utilities:
   `settleAll<T>(results: PromiseSettledResult<T>[]): { values: T[]; failureCount: number; total: number }`.
   One place to change, and it makes the three call sites read identically.
2. Rewrite the three `continue` loops (`:1728`, `:1773`, `:2199`) to use it.
3. **Throw on total failure**, matching the existing convention:
   `if (failureCount === total && total > 0) throw new Error("Failed to load subclasses: all requests failed. Check your authentication or try again later.")`.
   Catch at each tool boundary and return it as text, exactly as `searchSpells` does at `:249-255`.
4. **Surface partial failure** in tool output: when `0 < failureCount < total`, append a note —
   `*Note: 3 of 24 classes could not be loaded; these results may be incomplete.*` Thread the count out of
   `loadAllClassFeatures` (change its return to `{ rows, failureCount, total }`), `searchSubclasses`, and
   `findSubclassMatches` → `getSubclass`.
5. Make `getSubclass`'s not-found message (`reference.ts:1845-1853`) condition on the count: if any fetch failed,
   say so rather than asserting the subclass may not exist.
6. Fold A2's `baseUnavailable` classes into the same notice line so the user gets one honest completeness
   statement, not two.
7. Fix the stale doc comment at `reference.ts:1704-1710` to describe rejection handling as well as empty results.
8. Unit tests in `tests/tools/reference-subclasses.test.ts`: a mock client rejecting *some* classes (assert the
   note appears and the successful classes still render) and rejecting *all* (assert the thrown message reaches
   the tool result).

**Files:** `src/tools/reference.ts`, `tests/tools/reference-subclasses.test.ts`

---

## Part B — Discussion items

### B1. Cold-cache cost on `search_class_features`

**Accurate?** **Yes, exactly.** `loadAllClassFeatures(client, campaignId)` (`reference.ts:2172`) takes neither
`className` nor `edition`; both are applied post-hoc as string filters at `reference.ts:2231-2240`, after the
full corpus is built. `resolveCandidateClasses` (`reference.ts:1669-1696`) — which `searchSubclasses` (`:1758`)
and `getSubclass` (`:1838`) both call *before* their fan-out — is never reached from this path. At 2 req/s
(`server.ts:76`) with ~24 classes across both editions, the reviewer's 10-13s cold figure is right.

Two additional facts: the assembled corpus is **not** cached (only the underlying HTTP responses are, 24h each),
so every call re-walks every class and re-runs `subclassOnlyFeatures`; and `search_class_features`'s tool
description (`server.ts:1048`) carries **no** cost warning, unlike `search_subclasses`/`get_subclass`, whose
`className` descriptions do (`server.ts:949`, `:967`).

**Actionable?** Yes, and cheaply — the helper already exists and is already used by two sibling tools.

**Careful — one behavioural subtlety.** The post-hoc filter at `:2237` matches against `ClassFeatureRow.className`,
which for subclass rows is the composite `` `${cls.name} (${sub.name})` `` (`:2208`). So today
`className: "Glory"` matches `"Paladin (Oath of Glory)"`. Narrowing before the fan-out with
`resolveCandidateClasses` would **break that**, because it resolves against base-class names only. Preserve the
behaviour: pre-filter only when `resolveCandidateClasses` returns a non-error match, and fall back to the full
fan-out when it doesn't, rather than erroring out.

**Important?** Medium. It's a latency and quota problem, not a correctness one — but it's cheap and the reviewer
explicitly offered the fix. Doing it now is better value than deferring.

**Effort: 4/10.** Mostly plumbing; the subtlety above is the only real thought required.

**Steps**
1. Change `loadAllClassFeatures`'s signature to accept `className?: string` and `edition?: Edition`.
2. Inside, after `withLegacyFlag`, call `resolveCandidateClasses(classes, className, edition)`. On a non-error
   result, fan out over those classes only; on `{ error }`, fan out over all (preserving composite-name matching).
3. Keep the existing post-hoc filters at `:2231-2240` untouched — they still do the subclass-name matching.
4. Add a cost note to the `search_class_features` `className` description in `server.ts:1052`, matching the
   wording already used at `server.ts:949`.
5. Unit test: `search_class_features({ className: "Paladin" })` issues subclass fetches for the Paladin classes
   only (assert on the mock's call count); `{ className: "Glory" }` still returns the Oath of Glory rows.

**Files:** `src/tools/reference.ts`, `src/server.ts`, `tests/tools/reference-subclasses.test.ts`

---

### B2. The edition heuristic degrades silently

**Accurate?** **Yes, and the silence is worse than the reviewer realised.** Traced end to end:

1. `getGameConfigSafe` (`reference.ts:74-77`) swallows the error with a bare `catch` and returns `undefined`.
   Nothing logged, nothing in the tool result.
2. `isLegacyBySource(undefined, …)` (`reference.ts:529-536`) → `config?.sources?.find(...)` is `undefined` →
   returns `false` for **every** entity. Whole corpus flagged 2024.
3. `pickByEdition` with `wantLegacy = true` finds nothing → `?? candidates[0]` returns the row anyway.
4. `editionSuffix(false, "2014")` (`reference.ts:551-563`) → `false !== true` → returns `" [2024]"`.

So the degraded path doesn't merely drop the tag — **it emits a confident `[2024]` mismatch tag on every row**,
which reads as "you asked for 2014, here's the 2024 one" when in fact nothing was determined at all. The `get_*`
detail paths are worse still: `getFeat:1153`, `getClass:1569`, `getSubclass:1864`, `getRace:2004`,
`getBackground:2123` each emit an unconditional `*(2024)*` header. That's an assertion, not a degradation.

The hardcoded set is confirmed: `LEGACY_SOURCE_CATEGORY_IDS = new Set([1, 23, 26])` (`reference.ts:527`), and
`sources?.[0]?.sourceId` (`:530`) confirms the primary-source assumption. The 2024 counterparts (24, 38) are
named in the comment but never checked — so there is **no tri-state**: "unknown edition" and "confirmed 2024" are
the same value. `GameConfig.sources` and `sourceCategoryId` are both optional (`reference.ts:20`), so a config
that fetches fine but omits categories degrades identically to a total outage.

Existing coverage confirms the gap: `tests/tools/reference-config-resilience.test.ts:24-45` only asserts the
*absence* of `*(Legacy)*` in the no-`edition` case. **No test passes `edition` while config is failing.**

**Actionable?** Yes. The reviewer's one-line note is the minimum; the tri-state is the real fix.

**Important?** Medium-high. Config outages are rare, but when one happens every edition-tagged answer is
confidently wrong, and the misleading-tag behaviour makes it worse than no tagging.

**Effort: 5/10** for the tri-state, **2/10** for the note alone. Recommend the tri-state — the note alone leaves
the wrong `[2024]` tag in place, which is the actual defect.

**Steps**
1. Change `isLegacyBySource` to return `boolean | undefined`: `undefined` when config is unavailable, when
   `config.sources` is missing, or when the `sourceId` isn't found. Keep `false` only for a *recognised* source
   outside the legacy set. Add category IDs 24 and 38 as the positive-2024 set so the distinction is real.
2. `withLegacyFlag` (`:539-549`) propagates `isLegacy?: boolean | undefined`.
3. `editionSuffix` (`:551-563`): when `isLegacy === undefined`, emit `" [edition unknown]"` rather than a
   confident `[2014]`/`[2024]`.
4. The five `get_*` detail headers (`:1153`, `:1569`, `:1864`, `:2004`, `:2123`): emit
   `*(edition undetermined)*` instead of `*(2024)*` when the flag is `undefined`.
5. Add a single result-level note when config was unavailable: "*Edition could not be determined — D&D Beyond's
   config endpoint was unreachable, so edition filtering was not applied.*" This is the reviewer's asked-for
   one-liner, now backed by real state.
6. Confirm `pickByEdition`/`collapseByEdition` still behave sanely with `undefined` (they already coerce via
   `Boolean()`; make the coercion explicit rather than incidental).
7. Extend `tests/tools/reference-config-resilience.test.ts` with the **missing** case: config failing **and**
   `edition: "2014"` passed — assert no `[2024]` tag and that the note appears.

**Files:** `src/tools/reference.ts`, `tests/tools/reference-config-resilience.test.ts`

---

### B3. `campaignId` shape — per-call vs. server-level default

**Accurate?** Yes as a design critique. Confirmed there is **no** server-level default: `AuthConfig`
(`src/api/auth.ts:13-17`) has exactly `cobaltSession`, `cookies`, `savedAt`; repo-wide grep for
`defaultCampaign` / `DEFAULT_CAMPAIGN` / `DNDBEYOND_CAMPAIGN` returns zero hits. 15 tools take it as an optional
per-call param (`server.ts:695-698` shared `campaignIdParam`). The README (`:105`) is explicit that it's opt-in
and that retry behaviour is the calling assistant's judgment — which is exactly the burden the reviewer objects
to.

Their reasoning is sound: an assistant that gets "not found" has no signal that ownership was the cause, and
will usually just report not-found. Note this is now **partly mitigated by A3** — once fetch failures are
surfaced, at least the *failure* case stops masquerading as not-found, though the *unowned* case still does.

**Actionable?** Yes, but it's a public-API decision, not a bug fix, and the reviewer explicitly isn't asking for
it in this PR.

**Important?** Low urgency, high leverage — the cost of deciding later is that the per-call-only shape has
already shipped as the public API.

**Effort: 6/10** if built (config schema + loader + fallback threading through 15 tools + precedence tests).
**1/10** to agree the direction and defer.

**Decision (user):** agree the direction, defer the build.

**Steps**
1. Reply agreeing that a server-level default (config file and/or env var) with the per-call param as override is
   the right long-term shape, and that the per-call param stays as the override either way — so nothing in this
   PR becomes wrong, it just gains a default later.
2. Note the mitigation A3 provides (failures stop being indistinguishable from not-found).
3. Open a follow-up issue on the upstream repo capturing the design: `defaultCampaignId` in
   `~/.dndbeyond-mcp/config.json` (`src/api/auth.ts:13-17`), optional `DNDBEYOND_CAMPAIGN_ID` env override,
   precedence = per-call param > env > config > undefined.
4. **Do not build it in this PR.**

**Files:** none (reply + follow-up issue)

---

## Part C — Housekeeping

### C1. Dangling doc filename in three comments

**Accurate?** **Yes, exactly as listed.** All three cite `dndbeyond-mcp-class-feature-handoff.md`, which exists
nowhere in the repo:
- `src/api/endpoints.ts:91`
- `src/tools/reference.ts:2166`
- `tests/live/read-reference.test.ts:196`

The real file is `docs/plans/2026-08-24-subclass-feature-independence-handoff.md`.

**Actionable / Important / Effort:** Trivially yes / low but free / **1/10**.

**Steps:** replace all three with the repo-relative path `docs/plans/2026-08-24-subclass-feature-independence-handoff.md`.

---

### C2. No version bump, no `v0.7.0` README entry

**Accurate?** **Yes.** `package.json:3` is `"version": "0.6.0"` and unchanged across all six PR commits (last
bump was `d31a0d0`, pre-PR). README "Fork changes" (`:146-155`) stops at `v0.6.0`, which describes only the
monster-resistances work. README `:5` says "current: `v0.6.0`" and `:25` instructs `git checkout v0.6.0`. So none
of this PR's surface — edition awareness, `get_class`/`get_race`/`get_background`/`get_feat`,
`search_subclasses`/`get_subclass`, the `search_class_features` fix, `campaignId` on 15 tools — is releasable by
dndtools.

**One discrepancy to flag, not to fix:** `git tag -l` and `git ls-remote --tags origin` are both **empty** on the
`SQLGuyJPS` fork, despite the README claiming "Released as annotated tags." The tags presumably live on
`dmjohnston89`. Tagging is the maintainer's call on merge — write the README/`package.json` entry, don't create
the tag.

**Actionable / Important / Effort:** Yes / high (it's what makes the work consumable) / **2/10**.

**Steps**
1. `package.json:3` → `"version": "0.7.0"`.
2. README `:5` → current `v0.7.0`; README `:25` → `git checkout v0.7.0`.
3. Add a `v0.7.0` bullet to "Fork changes" (`:155`). Lead with the real headline the reviewer identified —
   **`search_class_features` was dead since v0.5.0** (`class-feature/collection` 404s on every input) and is now
   rebuilt from `classes()` + `subclasses()` — then edition-aware lookups, the new detail tools,
   `search_subclasses`/`get_subclass`, the cross-class feature collapse fix, and `campaignId`.
4. Update README `:5`'s items claim to match whatever A1 lands.
5. Leave tag creation to the maintainer; mention it in the reply.

---

### C3. Handoff doc: stale §4 and personal details

**Accurate?** **Yes on both counts.**
- §4 "What currently works (do not regress)" (`docs/plans/2026-08-24-subclass-feature-independence-handoff.md:26-35`)
  lists `get_class` at lines 31-32 and `get_feat` at line 33 — but those tools were added by `b4864d9`, *inside
  this PR*. The doc was committed by `54eefa8`, after. It genuinely reads as if it predates work it postdates.
- Personal details, all in this one file (repo-wide grep for `Eledar` / `Veterans United` / `C:\` / `conta`
  returns exactly these):
  - line 16 — `C:\git\dndbeyond-mcp`
  - line 17 — `C:\Users\conta\.dndbeyond-mcp\config.json` (**includes the OS username**)
  - line 20 — character **Eledar Avestan**, campaign **"Veterans United"**
  - line 30 — `characterName="Eledar Avestan"` in the §4 table

No secrets, as the reviewer says — but the username and campaign name are gratuitous in an upstream repo.

**Actionable / Important / Effort:** Yes / low-medium (courtesy + future confusion) / **2/10**.

**Decision (user):** scrub.

**Steps**
1. Line 16 → `<repo root>`; line 17 → `~/.dndbeyond-mcp/config.json` (matches README `:40`).
2. Line 20 → a generic description: "a level-9 Aasimar Paladin (Oath of Glory) in a shared campaign."
3. Line 30 → `characterName="<test character>"`.
4. Rewrite §4's preamble to date-stamp it: "as of 2026-08-24, before the work described below" — and move the
   `get_class`/`get_feat` rows into a clearly labelled "added by this work" note, or drop them, so a later reader
   isn't misled about what pre-existed.
5. Leave line 18 (`%APPDATA%\Claude\...`) alone — it's a generic env var and matches README `:70`.

---

### C4. `search_racial_traits` gains a dead `edition` param

**Accurate?** **Yes, and correctly characterised as harmless.** `search_racial_traits` does take `edition`
(`server.ts:1074`, `src/types/reference.ts:81`), and the README (`:159`) correctly documents the tool as erroring
against the live API — `racial-trait/collection` nests its list under `data.definitionData`, which returns empty.
The README also correctly labels that a **pre-existing** defect, not introduced by this PR.

**Actionable?** Yes, but the right action is *nothing*. Removing the param would have to be re-added when the
endpoint is fixed, and it's consistent with every other search tool.

**Important?** Very low. Zero user-visible impact — the tool errors before the param is ever consulted.

**Effort: 1/10** (a one-line reply).

**Steps:** acknowledge in the reply; keep the param for consistency; note it's covered by the existing Known
issues entry. No code change.

---

## Part D — Adjacent issues in pre-existing code

> **Note on provenance.** D1 and D2 below were originally filed as minor "other findings." On closer inspection
> they are not incidental: they are **dmjohnston89's own earlier edition-awareness implementations**, which
> diverge from the pattern this PR establishes for every other entity. Confirmed by blame:
> - `search_spells` collapse (`reference.ts:291-299`) and `getSpell`'s edition pick (`:368`) →
>   **`439caeb`, dmjohnston89, 2026-06-27**, "feat(spell): edition-aware get_spell + broader coverage (#5)"
> - `get_condition`'s edition switch (`:1424`) →
>   **`0af0478`, dmjohnston89, 2026-06-27**, "feat(conditions): edition-aware get_condition with 2024 (SRD 5.2) set"
>   (the formatter it calls, `:1446-1462`, is Alex Worland's original from `6a60c2c`)
>
> **The decisive fact:** README lines 5 and 13 — both written by **this PR** (`b4864d9`) — claim edition
> awareness "**across all of them**", explicitly listing spells and conditions, and promise you can "pin a lookup
> to a specific ruleset." `search_spells` cannot honour that (no `edition` param exists), and `get_condition`
> honours it *backwards* (defaults to 2014, not current). So these stopped being someone else's pre-existing code
> the moment the PR made a blanket claim over them. That is the same failure mode as **A1** — a documented
> capability that doesn't exist — which is precisely the bar the reviewer used to gate his blockers.
>
> **Scope verdict:** in scope, with one carve-out. The code changes are small (~60 lines across two files against
> a PR already at +2198/-111), they close a hole the PR itself opened, and "mirroring the existing convention for
> consistency" is the reviewer's own stated argument from blocker 3 — applied here in the other direction.
> The carve-out is `get_condition`'s **default**, which is a deliberate design decision of his and a breaking
> change for dndtools; that one gets proposed, not pushed. See D2.

### D1. `search_spells` has no `edition` param — **IN SCOPE**

**The issue.** `search_spells` (`server.ts:701-724`) is the **only** search tool without an `edition` param —
`search_monsters`, `search_items`, `search_feats`, `search_classes`, `search_subclasses`, `search_races`,
`search_backgrounds`, `search_class_features` and `search_racial_traits` all have one. Instead it hardcodes a
prefer-2024 collapse at `reference.ts:291-299`:

```ts
// Collapse 2014/2024 duplicates to one row per name (prefer the 2024 variant).
const byName = new Map<string, DdbSpell>();
for (const s of matchedSpells) {
  const existing = byName.get(s.definition.name);
  if (!existing || (existing.definition.isLegacy && !s.definition.isLegacy)) {
    byName.set(s.definition.name, s);
  }
}
```

Consequences, all three of which the PR's README now denies:
1. **You cannot search for 2014 spells at all.** `search_spells({ name: "Hunter's Mark" })` always returns the
   2024 variant. There is no parameter that changes this.
2. **No tag, so no way to detect it.** Unlike every other search tool, rows carry neither `*(Legacy)*` nor
   `[2014]`/`[2024]`. A 2014-only spell is returned indistinguishably from a 2024 one.
3. **Duplicated logic.** The collapse above re-implements `collapseByEdition` (`:497-516`), and `getSpell:368`
   re-implements `pickByEdition` (`:480-489`) — the two helpers this PR generalised for exactly this purpose.

Note `loadSpellCompendium` already keys its dedupe map by `` `${name}|${isLegacy ? "L" : "N"}` `` (`:169`,
`:187`, `:205`, `:223`), so **both editions are already in memory**. The data is there; only the selector is
missing. That makes this a genuinely cheap fix.

**Accurate / actionable / important?** Yes; yes, with no live dependency; **high** — this is the same
silently-wrong-output class as A1, and it's the entity a D&D assistant queries most.

**Effort: 3/10.**

**One design decision to get right.** `collapseByEdition(x, undefined)` returns the input **unchanged** — no
collapse. Swapping the hand-rolled loop for a bare `collapseByEdition(matchedSpells, params.edition)` would
therefore make duplicate spell rows appear when `edition` is omitted, a regression. Pass
**`params.edition ?? "2024"`** instead: identical default behaviour to today (collapse, prefer 2024), and now
expressible as `"2014"`.

**Steps**
1. Add `edition?: Edition` to `SpellSearchParams` (`src/types/reference.ts:13-20`) and wire `editionParam` into
   `search_spells` (`server.ts:713`) using the shared definition at `server.ts:683-688`.
2. Replace `reference.ts:291-299` with `collapseByEdition(matchedSpells, params.edition ?? "2024")`.
3. Add `editionSuffix(Boolean(spell.definition.isLegacy), params.edition ?? "2024")` to the row renderer at
   `~:314-320`. **Call this out in the reply:** with no `edition` passed, a 2014-only spell now renders `[2014]`
   where it previously rendered nothing. That is strictly more information, not a regression — but it is a
   visible output change.
4. Replace `getSpell`'s hand-rolled pick at `reference.ts:366-369` with `pickByEdition(candidates, params.edition)`.
   Verify the semantics match first — both are `find(...) ?? candidates[0]`, so they should be identical; the
   only wrinkle is that `pickByEdition` reads `.isLegacy` off the top level while spells nest it under
   `.definition`, so this needs a small projection or a `.map` to the `EditionRanked` shape.
5. Update README `:13`'s "pin a lookup to a specific ruleset" claim — it becomes true rather than aspirational.
6. Unit tests: `search_spells` with `edition: "2014"` returns the legacy variant; with no `edition` still
   collapses preferring 2024 (regression guard for step 2); a 2014-only spell renders with a `[2014]` tag.

**Files:** `src/tools/reference.ts`, `src/server.ts`, `src/types/reference.ts`, `README.md`,
`tests/tools/reference-editions.test.ts`

---

### D2. `get_condition` diverges twice — **label IN SCOPE, default PROPOSED ONLY**

`get_condition` is not API-backed: it selects between two hardcoded tables
(`reference.ts:1424`, `CONDITIONS` / `CONDITIONS_2024`). So `collapseByEdition`/`pickByEdition`/`isLegacyBySource`
genuinely **do not apply** here, and nothing about the compendium machinery should be forced onto it. There is
also no `search_conditions` tool, so D1's missing-param issue has no analogue. Two narrower divergences remain:

**D2a — no edition marker in the output. IN SCOPE.**
`formatConditionDetails` (`:1446-1462`) emits only `# ${condition.name}`. Combined with D2b's 2014 default, a
caller asking for "grappled" gets **legacy text, unlabelled**, and has no way to tell. This is purely additive —
no behaviour change, no breaking change — and it is the same fix as D4 below. Take it.
**Effort: 1/10.** Add `*(2014)*` / `*(2024)*` to the header, matching the five `get_*` handlers at `:1153`,
`:1569`, `:1864`, `:2004`, `:2123`. Pass the resolved edition into the formatter.

**D2b — it defaults to 2014, everything else defaults to current. PROPOSE, DO NOT PUSH.**
`server.ts:899` says "Defaults to 2014", and `:1424`'s `params.edition === "2024" ? CONDITIONS_2024 : CONDITIONS`
implements it. Every other edition-aware tool defaults to current — the shared `editionParam`
(`server.ts:683-688`) reads "2024 (current)". So `get_condition("grappled")` returns 2014 rules while
`get_class("Fighter")` in the same conversation returns 2024. That is a real trap for a model reasoning across
tools, and the PR's README `:13` now implies uniform behaviour.

**But this is dmjohnston89's deliberate v0.2.0 design decision, and dndtools pins this server by tag.** Flipping
a default silently changes answers for an existing consumer. Changing it unilaterally in a PR he is reviewing is
the wrong move — and it would hand him a legitimate objection on a PR he has already said he's inclined to take.

**Steps:** raise it in the reply as a cross-tool inconsistency, note it's a one-line change
(`server.ts:899` description + `reference.ts:1424` ternary) plus a `v0.7.0` breaking-change note, offer to
include it if he wants, and **leave the code alone unless he says yes.** If he declines, D2a's label still fixes
the "unlabelled legacy text" half of the problem.

**Files (D2a only):** `src/tools/reference.ts`, `tests/tools/conditions.test.ts`

---

### D3. `search_monsters` inlines its own edition tag — **IN SCOPE**

`searchMonsters` (`reference.ts:685-688`) hand-rolls the edition ternary instead of calling `editionSuffix`
(`:551-563`). It is logically identical for the `edition`-supplied branch but **omits the no-`edition`
`*(Legacy)*` branch entirely** — so `search_monsters` with no `edition` renders two same-name Goblin rows with no
way to tell them apart, unlike every other search tool.

Pre-existing since `v0.3.0`, but this PR built the shared helper it should be using, so folding it in is
justified rather than scope creep.

**Effort: 2/10.** Replace `:685-688` with `editionSuffix(Boolean(m.isLegacy), params.edition)`; add a unit test
asserting two same-name monsters render distinguishably with no `edition` passed. Note this is a deliberate
output change for the no-`edition` case — call it out in the reply so it isn't mistaken for a regression.

### D4. `get_*` detail output carries no edition label — **IN SCOPE**

`getItem` (`reference.ts:1002-1029`), `getMonster`, and `getSpell`/`formatSpellDetails` print no edition marker,
so a caller can't tell which variant `pickByEdition` handed them — even though all three accept `edition`.
`getItem`'s `edition` param is PR-era; the other two pre-date it. Directly compounds A1: an items fix is only
half useful if the answer is unlabelled.

**Effort: 3/10.** Add the same `*(2014)*`/`*(2024)*` header treatment the other five `get_*` handlers already use
(`:1153`, `:1569`, `:1864`, `:2004`, `:2123`), honouring B2's `undefined` tri-state. Unit tests per handler.

### D5. Module-level config cache never invalidated — **DEFERRED** (user declined)

`cachedConfig` (`reference.ts:55`) is process-global, never invalidated, not resettable, and survives a
`setup_auth` account switch. Already tracked at `BACKLOG.md:41`. Interacts with B2's heuristic. Mention in the
reply as known and tracked. **Effort if done: 3/10.**

### D6. Other findings — **DEFERRED**, reply-only

- `searchRacialTraits` uses a fixed non-campaign cache key `"game-data:racial-traits"` (`reference.ts:2317`)
  while every sibling uses `campaignCacheKey` — latent, but moot while the endpoint is broken.
- `TtlCache` (`src/cache/lru.ts:27-30`) evicts in insertion order, not LRU, despite the filename.
- `searchSubclasses` (`:1764-1780`) duplicates the fan-out/collect loop `findSubclassMatches` (`:1718-1737`)
  already implements. A3's `settleAll` helper partly converges them; full dedupe is optional.
- `campaign:${campaignId}:characters` cache-key collision between `src/tools/campaign.ts:82` and
  `src/resources/campaign.ts:106` — already flagged in `AUDIT.md:38-55`.

---

## Implementation order

Ordered so correctness lands before polish, and so shared helpers exist before their consumers need them.

1. **C1** — doc filename (3 lines, zero risk, unblocks nothing but gets it done).
2. **A2** — `subclassOnlyFeatures` guard. Most serious bug; self-contained.
3. **A3** — `settleAll` helper + partial-failure surfacing. Builds on A2's notice plumbing (share one output line).
4. **B2** — tri-state edition heuristic. Changes `editionSuffix` and the five `get_*` headers, which **D4 and
   D2a extend** — so it must land before them.
5. **A1** — items: optional `isLegacy` + `sources` fallback + live assertions. Depends on B2's tri-state for
   correct "unknown" handling. **Blocked on the user running `npm run test:live` locally.**
6. **D1** — `search_spells` gains `edition`; spells move onto `collapseByEdition`/`pickByEdition`/`editionSuffix`.
   Do this **after** B2 so the tri-state is already in `editionSuffix`, and after A1 so the collapse/pick helpers
   have settled.
7. **D4** — edition labels on `getItem`/`getMonster`/`getSpell`, honouring B2's tri-state. Folds naturally into
   D1's `getSpell` change — do them together.
8. **D2a** — edition label on `get_condition` output. Independent of everything else; 1 line plus a test.
9. **D3** — `search_monsters` uses `editionSuffix`.
10. **B1** — pre-fan-out narrowing in `loadAllClassFeatures` + cost note in the tool description.
11. **C3** — scrub and date-stamp the handoff doc.
12. **C2** — version bump to v0.7.0 across `package.json` and README (last, so the changelog entry is accurate).
    Update README `:13`'s "across all of them" claim to match what D1/D2a actually deliver.
13. **B3 / C4 / D2b** — reply to the reviewer; open the `campaignId` follow-up issue; propose the
    `get_condition` default flip and **wait for his answer** before touching it. No code.

Steps 1-4 and 6-12 need no live auth and can be completed in one pass. Step 5 pauses for the live run; step 13's
D2b half pauses for the reviewer.

---

## Verification

**Every step:**
```bash
npm ci
npx tsc --noEmit          # currently exit 0 — keep it there
npm test                  # currently 344 passed / 32 files — must not regress
```
Expect the count to rise; every new test file and case below adds to it.

**Targeted:**
```bash
npx vitest tests/tools/reference-subclasses.test.ts        # A2, A3, B1
npx vitest tests/tools/reference-config-resilience.test.ts # B2
npx vitest tests/tools/reference-editions.test.ts          # A1, D1, D3, D4
npx vitest tests/tools/conditions.test.ts                  # D2a
npx vitest tests/api/endpoints.test.ts                     # unchanged
```

**Live (user's machine only — requires `~/.dndbeyond-mcp/config.json`):**
```bash
npm run setup       # if the session has expired
npm run test:live   # A1's item-payload probe is the gating result
```
Live tests are correctly excluded from `npm test` (separate `vitest.live.config.ts`) — keep it that way.

**Manual MCP smoke tests** (build, point a client at `build/src/index.js`):
- `get_subclass("Oath of Glory")` — Paladin chassis must **not** appear (A2).
- `get_subclass` with an unowned/campaign-narrowed source — expect the explicit "base-class features
  unavailable" note, not a wrong list (A2).
- `search_class_features({ className: "Paladin" })` — time it cold; should be ~1-2 requests' worth, not ~12s (B1).
  Then `{ className: "Glory" }` — must still return Oath of Glory rows (B1's subtlety).
- `search_items({ name: "...", edition: "2014" })` — assert the returned variant is genuinely the 2014 one (A1).
- `search_monsters({ name: "goblin" })` with **no** `edition` — the two rows must be distinguishable (D3).
- `search_spells({ name: "hunter's mark", edition: "2014" })` — must return the **legacy** text, which is
  impossible today. Then the same call with no `edition` — must still return one row, preferring 2024 (D1's
  regression guard).
- `get_condition("grappled")` — output must state which edition's text it returned (D2a).
- Simulate a config outage (block `/api/config/json`) with `edition: "2014"` — expect
  "edition could not be determined", **not** a `[2024]` tag (B2).

---

## Reply to the reviewer — points to make

1. **Taking all three blockers.** All confirmed against the code.
2. **A1 is wider than described:** feats, class features and racial traits also lack live edition coverage — not
   just items. Items were the highest risk because the flag is *assumed present* rather than derived; fixed by
   making `isLegacy` optional **and** adding a `sources`-based fallback (the same `withLegacyFlag` path classes
   and feats already use), so the param works whichever way the payload goes. Live assertions added for items and
   feats.
3. **A2 also affects `search_class_features`,** not only `get_subclass` — `loadAllClassFeatures` calls
   `subclassOnlyFeatures` too, so the inversion duplicated every base feature under each subclass and could push
   real matches past the 30-row cap.
4. **On mirroring `loadSpellCompendium` for A3:** that convention tracks `failureCount` but only throws on
   *total* failure — it never surfaces partial ones, so mirroring it exactly wouldn't fix the scenario described
   (auth expiring mid-scan). Went further: throw on total failure *and* emit a visible completeness note on
   partial. Left `loadSpellCompendium` itself alone to keep the diff out of pre-existing code — happy to
   retrofit it if preferred.
5. **B2's silence is worse than "no tag":** the degraded path emits a confident `[2024]` *mismatch* tag on every
   row, and the `get_*` headers assert `*(2024)*` unconditionally. Made the flag tri-state so "unknown" is a real
   value, and added the requested note.
6. **B1 taken,** with one wrinkle: the current post-hoc filter matches the composite `"Paladin (Oath of Glory)"`
   name, so `className: "Glory"` works today. Pre-filtering falls back to the full fan-out when
   `resolveCandidateClasses` doesn't match, to preserve that.
7. **B3: agreed on direction.** A server-level default with the per-call param as override is the better shape;
   the per-call param survives as the override either way, so nothing here becomes wrong. Not building it in this
   PR; follow-up issue opened. Note A3 partly mitigates the concern — fetch failures no longer masquerade as
   not-found.
8. **Housekeeping done:** doc filename fixed in all three places; handoff doc scrubbed and §4 date-stamped;
   v0.7.0 bump with a Fork-changes entry leading on the dead-`search_class_features` fix. Tag creation left to
   you — worth noting the fork carries no tags at all, so the annotated tags live only on your side.
9. **`search_racial_traits`'s `edition`:** keeping it for consistency; it's inert behind the existing Known
   issues entry and will be live when the endpoint is fixed.
10. **Aligned spells and conditions with the pattern this PR establishes.** Raising this explicitly because it
    touches your earlier work (`439caeb` for spells, `0af0478` for conditions) rather than mine, and because I'd
    rather flag it than have it look like quiet scope creep:
    - This PR's README (lines 5 and 13) claims edition awareness "across all of them" and promises you can pin a
      lookup to a specific ruleset. `search_spells` couldn't honour that — it was the only search tool with no
      `edition` param, hardcoding a prefer-2024 collapse at `reference.ts:291-299` with no tag on the rows, so
      2014 spells were unreachable *and* undetectable. Since I wrote the claim, fixing it felt like my job.
      It now uses `collapseByEdition`/`pickByEdition`/`editionSuffix` like every other entity. Default behaviour
      is preserved by passing `edition ?? "2024"` — note that a 2014-only spell now renders a `[2014]` tag where
      it previously rendered nothing. More information, but a visible change.
    - `get_condition` now states which edition's text it returned; it previously returned unlabelled rules text.
      Left it on the hardcoded tables — the compendium machinery genuinely doesn't apply there.
    - **One thing I did *not* change, deliberately:** `get_condition` defaults to 2014 while every other
      edition-aware tool defaults to current. That's a cross-tool inconsistency a model will trip on, but it's
      your v0.2.0 design decision and dndtools pins by tag, so flipping it is a breaking change that's yours to
      make, not mine to slip into a PR you're reviewing. One-line change if you want it
      (`server.ts:899` + `reference.ts:1424`) plus a breaking-change note in the v0.7.0 entry — say the word.
11. **Two more pre-existing items folded in** because they're adjacent: `search_monsters` now uses the shared
    `editionSuffix` (it previously omitted the `*(Legacy)*` branch, so same-name monsters were indistinguishable —
    a deliberate output change, not a regression), and `getItem`/`getMonster`/`getSpell` now label the edition
    they returned.
12. **Identified but deliberately left alone:** the module-level `cachedConfig` staleness after an account switch
    (already at `BACKLOG.md:41`) and `searchRacialTraits`'s non-campaign cache key. Happy to take either in a
    follow-up.
