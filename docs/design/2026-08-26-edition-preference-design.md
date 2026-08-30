# Edition Preference Configuration — Design Discussion

> Date: 2026-08-26
> Status: Draft — for discussion with dmjohnston89, not slated for `#12`
> **Update 2026-08-28:** dmjohnston89 endorsed this doc's #2+#7+#4 recommendation and the `preferences.edition`
> shape below directly, but asked that implementation be deferred to its own follow-up PR rather than riding on
> `#12` — see D7b in the review-response plan. The analysis and recommendation below are otherwise unchanged.

## Overview

`#12` makes classes, subclasses, species, backgrounds, feats, items, and (via `2026-08-26-pr12-review-response.md`'s
Part D) spells and conditions edition-aware. Doing that for spells and conditions — the two entities
dmjohnston89 himself had already hand-built edition logic for (`439caeb`, `0af0478`) — surfaced a design
question that predates this PR but was previously invisible, because only one person's defaults existed:

**"No `edition` passed" currently means a different, hardcoded thing per tool** — 2024 for every entity except
`get_condition`, which defaults to 2014 (`server.ts:899`, `reference.ts:1424`, a deliberate v0.2.0 choice).
Once *every* compendium entity is edition-aware, that stops being one maintainer's quirk and becomes a real
design question: **whose preference wins, and can it vary by entity?**

This doc is scoped narrowly: it does not propose building anything in `#12`. It exists so dmjohnston89 and
the fork maintainer(s) can discuss the tradeoffs with a concrete recommendation in hand, and so the one or two
paving-the-way changes that *do* make sense inside `#12`'s current diff are visible and reviewable on their own
terms.

## Problem statement

Ownership on D&D Beyond is not the source of ambiguity — it's the *cause* of it. If an account owns only the
2024 PHB, every tool already returns unambiguous results regardless of `edition`. The ambiguity only exists for
accounts that own **both** a 2014 and a 2024 source for the same content (e.g. both Player's Handbooks) — common
for anyone who owned 2014-era books and upgraded, or for a DM who owns everything. For those accounts:

1. **Cross-tool incoherence.** Omitting `edition` means 2024 on `get_class`/`get_race`/`get_spell`/etc., but
   2014 on `get_condition`. A model reasoning across several tool calls in one conversation gets two different
   rule sets without asking for either.
2. **No durable preference.** `edition` is a stateless, per-call, optional parameter (`server.ts:685-688`).
   Nothing remembers "this user plays 2024 rules" (or 2014, or "2024 except conditions") across turns or across
   sessions — every call starts from the same hardcoded constant. This is the same structural gap as B3's
   `campaignId` default in the review-response plan, just for a different parameter.
3. **The calling model's own inconsistency.** Even with a correct, coherent default, nothing stops an assistant
   driving this MCP from passing `edition: "2014"` on one turn and omitting it on the next, if the user mentioned
   a preference earlier in the conversation and the model doesn't carry it forward. This is a property of
   conversational tool-calling, not something a server-side default alone can fully close — the mitigation is
   making the *fallback* correct and the *output* always labelled (see Part D of the review-response plan), so a
   wrong guess is visible and cheap to correct rather than silent.
4. **Collapse-by-default is not even uniform in kind, separately from *which* edition wins.** Per D1's finding,
   `search_spells` (and `get_condition`, structurally) always collapse to a single row even with no `edition`
   requested. Every other search tool instead returns *both* rows, tagged `*(Legacy)*`/un-tagged, and only
   collapses when `edition` is explicitly given (`editionSuffix`'s doc comment, `reference.ts:551-557`). So two
   axes are conflated today: **which edition wins by default**, and **whether "no preference stated" collapses
   to one answer at all, or shows both and lets the reader pick**. A full design should treat these as separate
   questions, even though this doc's recommendation (below) only tackles the first.

None of this is non-determinism in the sense of randomness — `pickByEdition`/`collapseByEdition` are pure
functions of their inputs (`reference.ts:482-517`). It is **incoherence**: multiple hardcoded opinions, no way
for a user to state one preference and have it apply everywhere they'd expect it to.

## Options considered

All options are rated 1 (low) – 10 (high). "Best fit" measures how well the option models the actual spread of
preferences described: dmjohnston89 wants 2024-by-default-except-conditions-2014; the PR author (SQLguyJPS)
wants 2024 everywhere; other users may want yet another split.

| # | Option | Effort/complexity | Best fit for use case | Ease of use |
|---|---|---|---|---|
| 1 | **Global config default** — one `edition` field in `~/.dndbeyond-mcp/config.json`, used as the fallback wherever `edition` is omitted. | 3 | 5 — fine for "one edition everywhere," can't express dmjohnston89's own split. | 7 — one JSON edit, already a file every user has from `setup_auth`. |
| 2 | **Per-entity-type override map** — global default plus optional per-entity overrides (`{"default":"2024","overrides":{"conditions":"2014"}}`). | 5 | 9 — the only option that models mixed preferences directly; reproduces dmjohnston89's own split as one config, not a code branch. | 6 — still hand-edited JSON, but the shape matches how a person would state the preference in words. |
| 3 | **Conversational setter tool** (`set_edition_preference`) — writes through to #2's config when the user states a preference in chat. | 6 | 8 — same coverage as #2. | 9 — no file editing at all. |
| 4 | **Resource/prompt nudge** — expose the standing preference as an MCP resource or fold it into `src/prompts/`, so the calling assistant is more likely to pass `edition` consistently (or trust a correct default and stop passing it at all). | 3 | 6 — mitigates the "model forgets" failure mode; the calling client still decides whether to read it, so it's a nudge, not a guarantee. | 8 — invisible once set up. |
| 5 | **Mandatory setup-time wizard** — force an edition choice during `npm run setup` or as a required build/CLI flag. | 4 | 2 — forces every zero-config user through a decision most don't have an opinion on; doesn't help per-entity nuance without #2 anyway. | 3 — friction before first use. |
| 6 | **Build-time compendium snapshots per edition** — pre-bake 2014/2024 snapshots, select one via env var at deploy time. | 8 — there is no snapshot/export pipeline today; everything is live-fetched through `DdbClient` + `TtlCache` (see root `CLAUDE.md`'s request-flow diagram). | 2 — doesn't fit the live-API architecture and doesn't solve mixed per-entity preference any better than #2, at much higher cost. | 4 — trivial once built, but the build cost dominates. |
| 7 | **Status quo, but always label** (this is what Part D of the review-response plan already delivers via B2/D1/D2a/D3/D4) — no config; every response states which edition it returned; the human corrects it next message if wrong. | 1 | 4 — fine for occasional lookups, a real tax for someone running a standing 2014 (or 2024) table who doesn't want to restate it every message. | 5 — zero setup, ongoing correction cost. |

## Recommendation

Layer **#2 + #7 + #4**, with **#3** as a fast-follow once #2's schema exists:

- **#2** is the actual fix: a `preferences.edition` block in `~/.dndbeyond-mcp/config.json`, same file and same
  pattern already agreed for `defaultCampaignId` in B3 of the review-response plan — one "user preferences"
  mechanism, not two ad hoc ones. Precedence, mirroring B3's `per-call > env > config > unset` chain: **explicit
  per-call `edition` param → env override (`DDB_EDITION_OVERRIDES` for the per-entity map, `DDB_EDITION_DEFAULT`
  for the global default) → config per-entity override → config global default → hardcoded `"2024"`.**
- **#7** is the safety net for the failure mode #2 can't close (the calling model's own inconsistency) — already
  landing via the review-response plan's B2/D1/D2a/D3/D4, so this doc doesn't ask for new work there, only notes
  that it's load-bearing for this design too.
- **#4** is cheap insurance that reduces how often the calling model needs to guess in the first place.
- **#3** is the highest-leverage next step for ease of use, but should wait until #2's schema is stable so it has
  a well-defined place to write to.

Explicitly **not** recommended: **#5** (fights the zero-config spirit — auth setup is already the one required
step; don't add a second) and **#6** (would require building infrastructure this codebase doesn't have, to solve
a problem #2 already solves far more cheaply).

### Proposed schema (for a future PR, not `#12`)

```json
{
  "cobaltSession": "...",
  "cookies": [...],
  "savedAt": "...",
  "defaultCampaignId": 1234567,
  "preferences": {
    "edition": {
      "default": "2024",
      "overrides": {
        "conditions": "2014"
      }
    }
  }
}
```

Note `defaultCampaignId` stays exactly where the B3 handoff doc already places it — a top-level, numeric
`AuthConfig` field, not nested under `preferences`. dmjohnston89's endorsement ("`preferences.edition` living in
the same `config.json` as `defaultCampaignId`") means the same *file*, not the same *object* — `preferences` is
new and scoped to `edition` alone here; it doesn't relocate a field another decision already settled.

Optional env var overrides for CI/containerized deployments, mirroring the `defaultCampaignId` follow-up already
proposed in B3: `DDB_EDITION_DEFAULT`, and a single JSON blob (`DDB_EDITION_OVERRIDES`) for the per-entity map,
rather than one env var per entity type. Matches the repo's `DDB_` prefix convention (`DDB_CAMPAIGN_ID`,
`DDB_CHARACTER_SERVICE`, `DDB_MONSTER_SERVICE`, `DDB_WATERDEEP`) — the same convention B3's own follow-up decision
#1 chose over a `DNDBEYOND_` prefix, for the same reason.

Granularity is deliberately **per entity type** (spells, conditions, classes, …), not per source book. The
existing `isLegacyBySource`/`pickByEdition`/`collapseByEdition` contract is already a binary legacy/current
classification per entity, not a book-priority ranking — matching that grain keeps this a config change, not a
rework of the classification logic. Per-book prioritization (e.g. "prefer *Tasha's* over *Xanathar's* when both
apply") is a materially different and larger feature, and nothing in this PR or its review motivates it.

## Phasing

**In `#12`'s current scope (small, paving, zero behavior change):** extract the repeated `"2024"` fallback
literal (D1's `params.edition ?? "2024"` call sites, once D1 lands) into a single named constant —
`DEFAULT_EDITION` — instead of the string appearing at each call site. This changes nothing about behavior
today; it exists purely so a future config-driven default (`resolveDefaultEdition(entityType)`) has exactly one
place to intercept instead of a grep-and-replace across the file. Tracked as **D7a** in the review-response plan.

**Deliberately out of `#12`:** the config schema, precedence resolution, `preferences` block, and any
conversational setter tool. This is a cross-cutting design decision affecting every edition-aware tool, not a
bug in this PR's diff, and — per dmjohnston89's own `get_condition` default — one where reasonable people
(himself, the PR author, and other users) land differently. Building it unilaterally inside a PR under review
risks exactly the scope-creep the maintainer would be right to push back on. Tracked as **D7b**, reply-only, in
the review-response plan.

## Out of scope

- Per-source-book (rather than per-edition) preference ranking.
- Any change to how D&D Beyond scopes ownership/visibility — that's entirely account-side and untouched by any
  option above.
- The `campaignId` default-config mechanism itself (B3) — referenced here as prior art / the file this reuses,
  not re-litigated.
