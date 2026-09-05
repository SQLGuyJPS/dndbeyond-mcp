# Handoff: Default Campaign ID — Scope Evaluation (PR #12)
**dndbeyond-mcp**

Prepared for: future Claude Code sessions working on `add-legacy-sensing-for-more-entities` / PR #12
Prepared by: Claude (chat), narrative session summary
Date of session: 2026-08-28

---

## 1. Purpose

PR #12 threads an optional `campaignId` through 15 character-independent compendium tools, unlocking
D&D Beyond content shared into an account via a campaign the account doesn't own outright. Reviewer
dmjohnston89 raised, among other things, a design critique: there's no server-level default, so an
assistant must remember to pass `campaignId` on every call or shared content silently isn't considered.

This session had two jobs: (1) decide whether that campaignId threading belongs in this PR at all, and
(2) if a "default campaign" fallback should be built, decide its shape without over-building it. The
full step-by-step implementation plan lives in `docs/plans/2026-08-26-pr12-review-response.md`, section
B3 — this document is the narrative "why," for a reader who doesn't want to replay that section's full
revision history (three rewrites across this session and the one before it).

## 2. Two scope questions — kept deliberately separate

The session's for/against reasoning spans two different decisions. They get conflated easily because
they're both "is this campaignId-related change too much for this PR," so they're pulled apart here on
purpose.

### Decision 1 — Does the *already-implemented* campaignId threading belong in this PR, or should it
split out into its own PR, separate from the edition-awareness work?

**Resolved (earlier session): no split. Keep it in this PR.**

Arguments for keeping it in:
1. Mechanically entangled with the other changes this PR already had to make.
2. The reviewer flagged campaignId's *design shape* as a discussion item, but never asked for the
   threading itself to be pulled out of this PR.
3. It landed as a single, self-contained commit (`f6f7597`) — low-cost to isolate or revert later if
   that ever becomes necessary, so keeping it in now isn't a one-way door.

Argument against:
1. It's a categorically different *kind* of change from edition-awareness. Edition-awareness adds
   labeling/filtering over data the tools could already reach. CampaignId threading *expands what data
   is reachable* — it unlocks campaign-shared content that character-independent tools genuinely
   couldn't see before. Different risk profile; arguably deserves its own review pass.

**Net call:** keep it in this PR. Flag the isolability to the maintainer as an option (it's a clean,
single commit if he'd rather review it separately), but don't force a split unprompted.

Before this decision, we verified via `git show`/`git log -p` on the threading commit — not by
assumption — exactly what was novel: **before this PR, shared source material was reachable, but only
through a character attached to a sharing-enabled campaign.** Character-scoped tools already exposed it.
This PR's actual contribution is unlocking that same shared content for *character-independent*
compendium tools (search/get for spells, items, feats, classes, subclasses, races, backgrounds — 15
tools total) via an optional `campaignId` parameter. Genuinely novel, narrowly scoped to compendium
tools, confirmed by reading the diff.

### Decision 2 — Should this PR *additionally* build a new default-campaign-ID fallback, so callers
don't have to pass `campaignId` on every call?

**Resolved (this session): yes, but narrower than originally scoped.** See sections 3–6.

The argument that nearly kept this deferred: the user had already signaled an intent to defer this
exact feature, and building it risked delaying the correctness fixes (A1–A3) the reviewer was actually
blocking approval on. That tension is why this got explicit, deliberate re-litigation rather than just
being built on request — and why, once revived, it stayed on a tight leash (see section 3).

## 3. Default-campaign design options considered

Explored several ways to auto-populate a "default campaign" so compendium tools always have something
to draw on:

- **A — Explicit config field + env var.** User sets `defaultCampaignId` in `~/.dndbeyond-mcp/config.json`
  or `DDB_CAMPAIGN_ID` in the environment. Fully manual, fully predictable.
- **B — Auto-detect when the account has exactly one campaign.** Looked appealing ("just works" for the
  common case) but **rejected on design-philosophy grounds**, not just narrow scope: it fails the bar
  the user set explicitly —
  > "features should either require explicit configuration or they should just work — no 'gotchas' that
  > require the user to be aware of during normal use."

  Auto-selecting on "exactly one campaign" *looks* like "just works" right up until the account joins a
  second campaign, at which point the default silently stops applying with zero signal to the user that
  anything changed. That's precisely the kind of gotcha the bar rules out.
- **C — Heuristic: pick the campaign with the most shared source books.** Rejected as infeasible-cheap:
  `DdbCampaign` (what `list_campaigns` returns) carries no field for sharing settings or shared-book
  counts. Computing this would mean a baseline call plus one campaign-scoped call per candidate campaign
  per entity type, through the rate limiter, just to produce a value once — and "most extra content" is
  a weak proxy for "the campaign this person actually plays in" even if computed.
- **D — Probe-based selection.** Same rejection as C — expensive fan-out for a weak signal.
- **E — A conversational `set_default_campaign` tool** letting the assistant persist a default
  mid-session. Not rejected, but explicitly deferred as a separate future UX layer on top of the same
  config field — building it now would widen this PR past "add a config knob."

**Decision: Option A only.** Explicit `defaultCampaignId` config field, `DDB_CAMPAIGN_ID` env override,
precedence per-call param > env > config > unset (today's behavior, unchanged for anyone who doesn't
opt in).

## 4. Four follow-up decisions (2026-08-27), and what became of each

1. **Env var name: `DDB_CAMPAIGN_ID`, not `DNDBEYOND_CAMPAIGN_ID`.** Matches the repo's existing `DDB_`
   prefix convention (`DDB_CHARACTER_SERVICE`, `DDB_MONSTER_SERVICE`, `DDB_WATERDEEP`). **Stands.**
2. **[Original] Raise a descriptive error if the default campaign ID doesn't exist / isn't accessible.**
   **Superseded on 2026-08-28** — see section 5. This is the one decision that actually changed shape.
3. **The compendium downloader (`npm run compendium:download`) must never use the default campaign,
   permanently** — not merely "unwired for now." Rationale is legal/IP caution, not scope: a snapshot
   persists to disk after the session ends, so if it ever pulled in a campaign-DM's shared sourcebook
   content, a user could end up holding an offline copy of paid content they don't own, with no clear
   guarantee that's fine once campaign access or sharing is revoked. Live tool calls don't have this
   problem — nothing persists beyond the existing TTL cache. **Stands.**
4. No changes to the reviewer-reply framing. **Stands.**

## 5. The validation refactor: built the case for it, tested the premise, then dropped it

Follow-up decision #2 sounded like a small addition — "raise a descriptive error on a bad default" — but
implementing it turned out to force a real structural change. Validating "does this campaign ID exist"
means calling `list_campaigns` through a `DdbClient`. `src/api/client.ts` already imports from
`src/api/auth.ts`, so `resolveCampaignId` couldn't gain a `DdbClient` dependency and stay in `auth.ts`
without creating a circular import — it would have had to move to `src/tools/campaign.ts`, grow a
discriminated-union return type (`{ok:true,...} | {ok:false,error}`), and get threaded through a new
wrapper at all 15 `server.ts` tool-registration sites.

That's a real amount of surface area for a case that might not matter. Before building it, we asked the
obvious question first: **what does D&D Beyond's own API actually do with an invalid campaignId?** If it
already degrades gracefully on its own, the validation refactor buys nothing but a nicer error message
for an already-harmless case.

Tested it directly with a throwaway live test (`tests/live/probe-invalid-campaign-id.test.ts` — written,
run once against the real API on the user's machine, then deleted; never part of the permanent suite).
It called `game-data/classes` twice: once unscoped, once with an obviously-bogus
`campaignId=999999999`. Result: **identical** — 25 classes both times, no error, no HTTP status
indicating a problem. D&D Beyond's game-data endpoints silently ignore a `campaignId` they can't
resolve, rather than erroring or returning a truncated/incomplete set.

**What actually got dropped is the validation refactor — not the default-campaign feature.** Worth
stating precisely, since it's easy to conflate: Option A (explicit `defaultCampaignId` config field +
`DDB_CAMPAIGN_ID` env var, per-call > env > config > unset precedence) is unchanged by this finding.
*(Superseded 2026-08-29: "this PR" below meant PR #12 at the time this was written; per §7, the whole
feature — Option A included — has since moved to a follow-up PR. The design itself, and this section's
reasoning about it, still stands as written.)* What changed here is only how a *stale or invalid*
default behaves. Instead of a validated,
error-raising resolver living in `campaign.ts` with a `DdbClient` dependency, it's now a pure,
network-free merge function —

```ts
export async function resolveCampaignId(paramCampaignId?: number): Promise<number | undefined> {
  if (paramCampaignId != null) return paramCampaignId;
  const envRaw = process.env.DDB_CAMPAIGN_ID;
  const envId = envRaw ? Number(envRaw) : undefined;
  if (envId !== undefined && !Number.isNaN(envId)) return envId;
  return (await getDefaultCampaignId()) ?? undefined;
}
```

— that stays in `auth.ts` next to `getCobaltSession`, with no circular-import problem to solve because
it never needs a `DdbClient`. A stale default just quietly acts as if unset, which matches its own
already-existing "no default configured" behavior — there's no new failure mode being papered over by
skipping validation.

**Net effect on scope:** B3's effort estimate dropped from 4/10 back to 3/10. Files touched dropped from
eight to five — `src/tools/campaign.ts` and `tests/tools/campaign.test.ts` are no longer touched by this
decision at all.

## 6. Why this is a template worth reusing

The general move here — before building defensive/validating code for a failure mode, empirically check
whether the underlying dependency (in this case, D&D Beyond's API) actually exhibits that failure mode —
is generally worth doing before adding error-handling machinery on spec. It's cheap (one throwaway live
test, run once, deleted immediately after) and it turned a 4/10-effort, 8-file, circular-import-dodging
refactor into a 3/10-effort, 5-file change with no structural workaround needed at all. Worth reaching
for again whenever a "handle the bad case explicitly" decision is about to drive a disproportionate
amount of the implementation cost.

## 7. Current state

- **Superseded 2026-08-29: this feature does not land in PR #12.** dmjohnston89 asked (2026-08-28 review
  comment) for the PR to split — `defaultCampaignId`/`DDB_CAMPAIGN_ID` moves to a follow-up PR, separate
  from the correctness fixes and edition-consistency pass PR #12 is actually shipping. Plan doc §B3 has
  been updated accordingly (2026-08-28 review-response revision, consolidated by the 2026-08-29 session's
  squash). This design work is
  **not abandoned** — it's fully decided and simply waiting for its own PR, on a fresh branch off
  `main` once #12 merges, not a continuation of `add-legacy-sensing-for-more-entities`.
- Design history (superseded but preserved for context): `f1771ff` (initial Option-A-only decision),
  `4047e56` (four follow-up decisions), `86f7fb2`/`dcab636` (probe test added and removed after use),
  `19b0511` (B3 simplified post-finding). These planning-doc commits were squashed to one during the
  2026-08-29 session at dmjohnston89's request (see the plan doc's "Reviewer communication" log, 2026-08-28
  entry) — the decisions they recorded are unchanged, only the intermediate-state commit history was
  consolidated.
- **No production source code has changed for the default-campaign feature** — only planning documents.
  Implementation hasn't started, and per the split above, it won't start on this branch.
- The probe test is gone; its finding is preserved here and in the plan doc's B3 section, and remains
  valid input for whoever picks up the follow-up PR.

## 8. Next step for whoever picks this up

**This is now follow-up-PR work, not part of `add-legacy-sensing-for-more-entities` / PR #12.** Branch
fresh (off `main`, after #12 merges) and implement B3 per `docs/plans/2026-08-26-pr12-review-response.md`'s
numbered steps under that section:

1. `src/api/auth.ts` — add `defaultCampaignId?: number` to `AuthConfig`, add `getDefaultCampaignId()`
   (mirrors `getCobaltSession`), add `resolveCampaignId()` (shown above).
2. `src/server.ts` — swap `campaignId: params.campaignId` for
   `campaignId: await resolveCampaignId(params.campaignId)` at the 15 identified call sites. **Do not
   touch `:679`** — `get_campaign_characters`'s required, unrelated `campaignId`.
3. `README.md` — document the config field, env var, precedence, and the "stale default silently acts
   as unset" behavior (with the live-tested rationale, not just an assertion).
4. `src/compendium/downloader.ts` — add a short comment near the `ENDPOINTS.gameData.*()` calls stating
   the campaignId exclusion is deliberate and permanent (section 4, point 3), not an oversight.
5. `tests/api/auth.test.ts` — add `describe` blocks for `getDefaultCampaignId` and `resolveCampaignId`
   covering the precedence chain. No `DdbClient` mocking needed anywhere in these new tests.
6. Fold the feature into **the follow-up PR's own changelog entry** when it ships — not PR #12's `v0.7.0`
   entry, which explicitly excludes it per the plan doc's C2 steps (`defaultCampaignId` was never
   implemented in #12, so it has nothing to bump there).

No changes needed to `src/tools/campaign.ts`, `tests/tools/campaign.test.ts`, or
`tests/tools/reference-campaign-id.test.ts` — none of them are touched by this decision.
