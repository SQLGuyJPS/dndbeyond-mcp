# Character Accuracy & Write-Path Restoration — Integration Plan (v0.8.0 → v0.10.0)

## Context

[`docs/fork-comparison-2026-09-05-grahamethompson.md`](../fork-comparison-2026-09-05-grahamethompson.md)
diffed [grahamethompson/dndbeyond-mcp](https://github.com/grahamethompson/dndbeyond-mcp) against this fork.
Both forks descend from `61d6f3c` and diverged almost completely: this fork went deep on edition-awareness,
campaign scoping, monster data and the compendium downloader; his went deep on **character-sheet accuracy and
the character write path** — the exact areas this fork has left untouched since the common ancestor.

That comparison identified 15 items his fork has that this one lacks. This plan sequences them into three
releases, defines the PR boundaries, and specifies a test plan per item across all three test tiers.

**The single most important finding it produced:** five advertised MCP tools in this fork are dead.
`src/api/endpoints.ts:18` says so in this repo's own words — *"Deprecated v5 endpoints (return 404, kept for
reference)"* — and `update_spell_slots`, `update_death_saves`, `update_currency`, `update_pact_magic` and
`cast_spell`'s slot-consumption path all catch the resulting 404 and return an apology. Graham's fork found the
corrected contract. Restoring it is release 0.8.0 and everything else waits behind it.

### Provenance and attribution

Every fix below is **reimplemented** to fit this fork's conventions, not cherry-picked — `character.ts`,
`types/character.ts` and `endpoints.ts` have diverged too far for his commits to apply cleanly, and this fork's
edition-awareness work must survive contact with them. Attribution is nonetheless required:

- Each commit that ports one of his findings carries a trailer:
  `Ported-From: grahamethompson/dndbeyond-mcp` plus the specific insight in the body.
- The README gains an acknowledgment section crediting his fork for the API-contract discoveries.
- His `docs/api/*.md` notes (`character-v5.md`, `spells-and-slots.md`, `inventory-and-customization.md`,
  `normalization-contract.md`, `response-envelopes.md`) are **reference material to read while implementing**,
  not files to merge.

### Decisions taken before writing this plan

| Decision | Choice | Rationale |
|---|---|---|
| Fixture sourcing | Automate what's provable; specify the rest as manual build sheets | The MCP has no equip tool, so armored AC cannot be staged programmatically (see §3.2) |
| Ground truth | The D&D Beyond web sheet is the authority; each fixture names its own source | Rules reasoning cannot settle an API-semantics question like "is `baseHitPoints` pre- or post-CON" |
| Release split | Three releases, with #9 moved into 0.8.0 | #9 is a hard dependency of #5's pact write path (see §2.1); risk profiles otherwise differ sharply |
| Output format | Free to change, prefer accuracy | Output is consumed by LLMs; a wrong label ("Prepared Spells" over a list containing unprepared spells) is worse than a changed one |
| Attribution | Reimplement + credit in commits and README | See above |

---

## 1. The 15 items, mapped to releases

Numbering matches the fork-comparison document so the two can be read side by side.

### v0.8.0 — Restore the write path *(live-API-contract risk)*

| # | Item | Why it's here |
|---|---|---|
| 5 | Write endpoints: spell slots, death saves, currency, pact magic, `cast_spell` | Five dead tools |
| 9 | Pact-magic normalization (`getPactMagicState`) | Hard dependency of #5's pact path |
| 6 | `long_rest`/`short_rest` — POST with body, hit-dice state | Same contract surface |
| 13 | Condition ID mapping (Exhaustion 15 vs 4) | `add_condition`/`remove_condition` are write tools |
| 14 | `resetType` mapping (1=Short/2=Long/3=Dawn/4=Other) | Rest-adjacent; decided by the same probe |

**Unifying property: none of these can be proven by a unit test.** A mock only proves we send what we decided
to send — never that D&D Beyond accepts it. Every item here needs live verification, and can silently break
again when DDB changes its contract. That is why they are quarantined in their own release.

### v0.9.0 — Character sheet correctness *(deterministic, pure-function risk)*

| # | Item | Symptom today |
|---|---|---|
| 1 | Max HP ignores Constitution | Wrong max HP for essentially every character above level 1 |
| 3 | Ability-score `set` modifiers ignored | Belt of Giant Strength and similar do nothing |
| 2 | AC: `armorTypeId` detection, natural armor, best-of unarmored formulas | Wrong AC for armored characters with unclean item strings, natural-armor species, and any barbarian/monk whose alternate formula should win |
| 4 | 2024 background + legacy species double-counts ASIs | Inflated ability scores on hybrid characters |
| 10 | Saves/skills/spell DC skip generic bonus subtypes | Understated totals wherever such a modifier exists |
| 12 | Speeds hardcoded to 30 ft; no initiative, passives, or senses | Wrong speed for every 25 ft and 35 ft species; three passive scores and all special senses simply absent |
| 8 | Spells with `prepared: false` silently dropped | Feat/item/race-granted spells missing from the sheet |

**Unifying property: every one of these is a pure function over a character payload.** They are fully provable
by unit tests against frozen fixtures, and once correct they stay correct. A red suite here means *our formula
is wrong* — never *the API moved* — which is precisely the triage property that mixing them with 0.8.0 would
destroy.

### v0.10.0 — Sheet completeness *(additive)*

| # | Item | Gap |
|---|---|---|
| 7 | `list_characters` uses the owned-character endpoint | Campaign-less characters invisible to listing *and* to every `characterName` lookup |
| 11 | Custom proficiencies, custom items, renamed items | Player customization invisible; also a perf win (no N+1 detail fetch) |
| 15 | Selected options (Fighting Style, Metamagic, Invocations) | Never surfaced anywhere |

> #7 may be pulled forward into 0.8.0 if the Phase 0 probe (§3.1, P8) confirms the list endpoint's shape
> cheaply — it is a live-contract item wearing an enhancement's clothes. Decide at the end of Phase 0.

### Dependency graph

```
Phase 0 probe ──┬──> #5 ──> #9 (pact path)          [0.8.0]
                ├──> #6                              [0.8.0]
                └──> #13, #14                        [0.8.0]

#3 (computeCharacterAbilityScore) ──┬──> #2 (AC)     [0.9.0]
                                    └──> #4 (hybrid ASI)
#10 (getSkillTotal) ──> #12 (passives)               [0.9.0]
#1, #8 independent                                   [0.9.0]
#7, #11, #15 independent                             [0.10.0]
```

`#3` introduces `computeCharacterAbilityScore(char, id)` as the context-aware replacement for
`computeFinalAbilityScore(stats, bonusStats, overrideStats, modifiers, id)`. Land it first — `#2` and `#4` both
build on it, and it touches every call site in `character.ts` and `resources/character.ts`.

---

## 2. PR breakdown

Releases group by risk profile and user-facing narrative. **PRs are the bisection unit** — one item (or one
tightly coupled pair) per PR, so a `git bisect` lands on a single behavioral change even inside a large release.

### 2.1 — v0.8.0

| PR | Title | Items | Notes |
|---|---|---|---|
| P0 | *(no PR — probe session)* | — | §3.1. Produces the facts the rest of 0.8.0 depends on |
| 1 | `fix(character): restore v5 write endpoints` | 5 (core) | Spell slots, death saves, currency. Endpoint builders + payload shapes |
| 2 | `fix(character): normalize pact magic across payload shapes` | 9, 5 (pact) | Depends on PR 1. Adds `src/utils/character-spell-slots.ts` |
| 3 | `fix(character): rest via POST with hit-dice state` | 6 | Adds `DdbClass.hitDiceUsed` |
| 4 | `fix(character): correct condition IDs and reset types` | 13, 14 | **Gated on P0 findings — do not write until the probe answers** |
| 5 | `chore(release): 0.8.0` | — | Version, README known-issues removal, changelog, attribution section |

The `characterId`-in-body shape PR 1 adopts is **already the established pattern in this fork** for the write
endpoints that still work (`updateHp`, `updateLimitedUse`, `setInspiration`, `condition` — all take no path
parameter). The dead endpoints are the ones that never made the migration. That consistency is the strongest
a-priori evidence graham's contract is right, but it is not proof; P0 supplies the proof.

### 2.2 — v0.9.0

| PR | Title | Items |
|---|---|---|
| 6 | `fix(character): apply Constitution modifier to max HP` | 1 |
| 7 | `fix(character): honor set-type ability score modifiers` | 3 |
| 8 | `fix(character): correct AC for armor type, natural armor, and stacking` | 2 |
| 9 | `fix(character): ignore legacy species ASIs under 2024 backgrounds` | 4 |
| 10 | `fix(character): include modifier bonuses in saves, skills, and spell DC` | 10 |
| 11 | `fix(character): real species speeds, initiative, passives, and senses` | 12 |
| 12 | `fix(character): surface all available spells with provenance` | 8 |
| 13 | `chore(release): 0.9.0` | — |

PR 12 is the one with real output-format consequence: the `Prepared Spells` header becomes `Spells`, with each
entry annotated `[<sources>; <casting modes>]`. Per the format decision, this is intended — but PR 12's
description must carry a before/after output sample, and the release notes must reproduce it.

### 2.3 — v0.10.0

| PR | Title | Items |
|---|---|---|
| 14 | `feat(character): list all owned characters, not just campaign members` | 7 |
| 15 | `feat(character): custom proficiencies, custom items, and renamed items` | 11 |
| 16 | `feat(character): surface selected character options` | 15 |
| 17 | `chore(release): 0.10.0` | — |

---

## 3. Test architecture

### 3.0 — Three tiers, and who pays for each

`vitest.config.ts` already excludes `tests/live/**` from the default run; `npm run test:live` is a separate
opt-in config. That tiering is the backbone of this plan:

| Tier | Command | Account needed | Runs | Proves |
|---|---|---|---|---|
| **1 — Unit (mocked)** | `npm test` | No | Every PR, any clone, CI | Formula correctness, regression protection |
| **2 — Live integration** | `npm run test:live` | Yes | Release time, maintainer | The API accepts what we send |
| **3 — Behavioral agent** | Manual dispatch to isolated subagents | Yes + entitlements | Release time, maintainer | The output is usable by a model at a table |

#### The capture → freeze rule

**Manual and generated characters are used once, to capture a real payload and establish ground truth. That
payload is then scrubbed and committed, and the regression protection lives in tier 1 forever after.**

This is what keeps the manual fixture burden a one-time release-time cost rather than a permanent tax on the
repo. A contributor who clones this repo in a year runs `npm ci && npm test` and gets full coverage of armored
AC, hybrid-2024 ASI handling, custom item names and Warlock pact magic — without owning a Tortle, a legacy
species, or any character at all.

Each fixture is committed as a pair under `tests/fixtures/characters/`:

```
<name>.json           — the scrubbed raw character-service v5 payload
<name>.expected.json  — ground truth read off the D&D Beyond web sheet:
                        { ac, maxHp, initiative, passivePerception, passiveInsight,
                          passiveInvestigation, speeds: {...}, saves: {...},
                          abilityScores: {...}, spellCount, notes }
```

Tier-1 tests assert `formatCharacterSheet(<name>.json)` agrees with `<name>.expected.json`. Ground truth comes
from the sheet, not from our own code's output — capturing our output as "expected" would freeze the bug.

#### Scrubbing is mandatory before committing any fixture

Real payloads carry character names, campaign IDs, user IDs and entitlement fingerprints. The 0.7.0 test plan
already kept transcripts out of this repo for exactly this reason (§6: *"it captured this account's real
campaign IDs and entitlements, which must not be committed"*). A `scripts/scrub-fixture.ts` helper must:

- replace `name`, `campaign.name`, and any player-facing free text with stable placeholders
- zero `id`, `userId`, `campaign.id`, `characterId` to fixed synthetic values
- preserve everything mechanically relevant: `modifiers`, `actions`, `stats`, `bonusStats`, `overrideStats`,
  `inventory`, `classes`, `race`, `feats`, `options`, `characterValues`, `customItems`, `spells`, `classSpells`
- fail loudly if the output still matches a name/ID denylist

Per this repo's conventions (CLAUDE.md), captured fixtures must retain `modifiers` and `actions` — the scrubber
must never strip them.

#### Mock drift, stated rather than hidden

Frozen fixtures keep passing if D&D Beyond changes its payload shape. Mitigations:

- a small opt-in live suite that asserts payload **shape** (field presence and type), not values, so a contract
  change fails loudly at tier 2 even when tier 1 is green
- a documented refresh procedure (§3.4) so re-capturing is routine, not archaeology
- the shape suite runs against whatever character `DDB_TEST_CHARACTER_ID` names, so it needs no special build

### 3.1 — Phase 0: the probe session *(prerequisite for all of 0.8.0)*

One session, before any code is written. Each probe converts an assumption into a recorded fact. **PRs 1–4 must
not be written until their probes return.**

| ID | Question | Method | Blocks |
|---|---|---|---|
| P1 | Does `set_class_level` work past level 1? | Create fixture, set a class to level 3, read back | F2, F3 fixtures |
| P2 | 2024 class IDs for Warlock, Barbarian, Monk | `search_classes` / `get_class` — **do not hardcode**; the lifecycle test's `2190879` Fighter ID is illustrative, not a pattern to copy | F2, F3, F4 |
| P3 | Does `resolve_choices` complete a Warlock, and does it pick invocations? | Build F2, inspect `options.class` | F2, item 15 |
| P4 | Which legacy species and which natural-armor species does this account own? | `search_races` with `edition: "2014"`; search Tortle / Lizardfolk / Warforged | M2, M3 — **may cancel them** |
| P5 | Is `pactMagic` an array or an object on this account's Warlock? | Read F2's raw payload | Item 9 |
| P6 | **Actual condition ID mapping** | `add_condition` with `conditionId: 4` on a disposable fixture, then read back: does Exhaustion or Deafened appear? | Item 13 |
| P7 | Do the four corrected write endpoints accept graham's payload shapes? | Direct probe of each: `spell/slots`, `life/death-saves`, `spell/pact-magic`, `inventory/currency/{denom}` | PRs 1, 2 |
| P8 | Does `characters/list?userId=` return the `DdbCharacterListData` shape? | Direct probe, compare to `src/types/api.ts` addition | Item 7 (and whether to pull it into 0.8.0) |
| P9 | Does rest work as POST-with-body? Does the current GET still work? | Probe both against a fixture; check hit-dice state after | Item 6 |
| P10 | What `resetType` integers appear in a real payload, against their `resetTypeDescription` strings? | Read any character with limited-use actions | Item 14 |

**P6 and P10 are adjudications, not confirmations.** Two independent forks disagree on both. This fork's
`CONDITION_NAMES` says Exhaustion is 15; graham's says 4. This fork's type comment says `1 = Long Rest`;
graham's says `1 = Short Rest`. One of each pair is wrong and the live API is the only authority. Record the
observed result verbatim in the Phase 0 results section below, then fix whichever table is wrong — including
the possibility that it is graham's.

> Note on P10's current stakes: `formatLimitedUseResources` (`src/tools/character.ts:374`) reads only
> `resetTypeDescription`, never the integer, so the stale comment is dead documentation today rather than a
> live bug. It becomes a real bug the moment PR 4 adds the numeric fallback table. Probe first, then add.

**Phase 0 deliverable:** a `## Phase 0 results` section appended to this document, one row per probe, with the
verbatim observation. Findings that contradict this plan amend the plan before implementation starts.

### 3.2 — Fixture catalog

#### Automated — `tests/live/fixtures.ts`

Built from the proven `character-lifecycle.test.ts` spine (`standard-build` → `add_class` → `set_background` →
`set_race` → `set_ability_score` ×6 → `update_name` → `delete`), extended with `set_class_level` and
`resolve_choices` once P1/P3 confirm them.

| ID | Build | Serves |
|---|---|---|
| F1 | `standard-build` + `resolve_choices`, level 1 | All write tests (5, 6, 13), no specific build needed |
| F2 | Warlock 3, known CHA | 9, 5 (pact path), 15 |
| F3 | Barbarian 3, known CON/DEX, unarmored | 1, 2 (unarmored branch), 10 |
| F4 | Monk 3, known WIS/DEX, unarmored | 2 (monk formula — verifies best-of, not first-match) |
| F5 | Any created character (campaign-less by default) | 7 |
| F6 | Two-class multiclass, level 5 total | 1 (level summation), 12 |

**Naming and safety rule:** every generated fixture's name is prefixed `MCPTEST-`. Write tests may only target
a character whose name carries that prefix. `DDB_TEST_CHARACTER_ID` must never be pointed at a real character
for write tests — the plan adds an assertion enforcing this at fixture setup, not just a convention.

Cleanup: `afterAll` deletes, mirroring `character-lifecycle.test.ts`. A `npm run test:live:sweep` helper lists
owned characters and deletes any `MCPTEST-` leftovers from crashed runs. Note that DDB enforces a
`characterSlotLimit` (visible in the list payload per P8) — the sweep is not optional hygiene, it is what keeps
the account from filling up.

#### Manual — build sheets you create once

| ID | Build | Serves | Conditional on |
|---|---|---|---|
| M1 | Medium armor (Scale Mail or Half Plate) **equipped** + shield **equipped**, DEX 16 | 2 (armored branch, dex cap, `armorTypeId` shield detection) | — |
| M2 | Natural-armor species (Tortle / Lizardfolk / Warforged) | 2 (natural armor branch) | P4 — skip if unowned |
| M3 | Legacy species + 2024 background granting ASIs | 4 | P4 — skip if unowned |
| M4 | One renamed item, one homebrew custom item, one custom proficiency, one custom language | 11 | — |
| M5 | Attuned item granting a `set` ability modifier (Belt of Giant Strength) or a `+X` AC item | 3 | ownership |
| M6 | Character with Fighting Style / Metamagic / Invocations selected | 15 | may be satisfied by F2 per P3 |

**Why these cannot be automated:** there is no equip tool or endpoint in this codebase — `add_inventory_items`
accepts only `{entityId, entityTypeId, quantity}` and nothing sets `equipped: true`, while `calculateAc`
inspects only equipped items. Renamed items write `characterValues` typeId 8, which has no tool at all. M2/M3
additionally depend on content ownership that no amount of automation can conjure.

For each manual fixture: build it, capture the payload, **read the AC / max HP / initiative / passives / speeds
/ save totals off the D&D Beyond web sheet into `<name>.expected.json`**, scrub, commit. The character can be
deleted afterward — the fixture outlives it.

### 3.3 — Behavioral agent testing (tier 3)

#### Two new agent definitions

`.claude/agents/ddb-tester.md` is reference-only — it has no character tools at all. Two siblings are needed:

**`ddb-character-reader`** — `check_auth`, `list_characters`, `get_character`, `get_definition`,
`get_campaign_characters`, `list_campaigns`. No write tools, no web, no shell. Grades sheet legibility.

**`ddb-character-writer`** — the reader set plus `update_hp`, `update_spell_slots`, `update_death_saves`,
`update_currency`, `update_pact_magic`, `cast_spell`, `short_rest`, `long_rest`, `add_condition`,
`remove_condition`, `use_ability`. **Every prompt using this agent names an `MCPTEST-` fixture ID explicitly**,
and the agent's system prompt forbids acting on any character it was not given.

Both inherit `ddb-tester`'s structural web denial, its "the tools are your only source of truth" framing, and
its required `TOOL CALL LOG` + `GROUNDING STATEMENT` output block.

#### The threat model here is different from 0.7.0 — and the rubric must change

The 0.7.0 suite defended against **training-data contamination**: a model reciting the PHB instead of calling a
tool. That threat largely evaporates here — no model has your character's stats in its weights. Two different
failure modes replace it:

**Threat A — arithmetic substitution.** Asked "what's my AC?", a capable model may read the *item list* and
compute AC itself rather than reading the AC line — producing a correct-looking answer that never exercises
`calculateAc` at all, and masking a broken formula completely. This is the character-suite equivalent of
contamination, and it is harder to spot because the reasoning is visible and looks diligent.

*Detection:* prompts must require the tool's own line quoted verbatim, and the grounding statement must state
whether any number was recomputed. Any answer whose number was derived rather than read is graded **INVALID**
and re-run with a tighter prompt — never PASS, even when the number is right.

**Threat B — plausible-but-wrong passthrough.** If `calculateAc` returns 15 and the truth is 17, the subject
has no way to know. It reports 15, cites the tool honestly, and looks perfectly grounded. **No behavioral test
can catch this.**

*Consequence, stated plainly:* **tier 3 cannot validate arithmetic correctness for this work.** Its job here is
to grade whether the output is *usable and legible* — whether a DM can answer a real table question from it,
whether labels are unambiguous, whether gaps are reported honestly. Correctness is tier 1's job, asserted
against sheet-derived `expected.json` values. This is the analogue of the 0.7.0 plan's §4, and it must not be
quietly forgotten when results come back green.

**Threat C — write-path false success.** A write that returns 200 but does not persist looks identical to a
successful write. The current live tests are vulnerable to exactly this: they assert on the *response text*
(`tests/live/write-character.test.ts:43` checks `text.includes("temporarily unavailable")`).

*Detection:* **every write test asserts persistence through an independent read-back.** Never the write's own
return message. This applies at tier 2 and tier 3 alike, and it is the single most important testing change in
this plan.

#### Grading layers (replaces 0.7.0's three layers for character tests)

| Layer | Checks |
|---|---|
| **A — Verbatim grounding** | Does the answer quote the tool's own line rather than paraphrasing a recomputed value? |
| **B — Round-trip persistence** | *(write tests)* Does an independent read confirm the mutation landed? |
| **C — Discrepancy honesty** | When the sheet is internally inconsistent or a tool errors, does the subject say so rather than smoothing it over? |
| **D — Declared tool calls** | The `TOOL CALL LOG`; self-report, never sufficient alone |

A test passes only if the answer is correct **and** Layer A (or Layer B for writes) independently confirms the
value came from the tool. Zero `mcp__dndbeyond__*` calls ⇒ INCONCLUSIVE, re-run.

#### Result record

Reuse the 0.7.0 format, with the fixture named:

```
### <ID> — <item #> / <naturalistic|directed>
Fixture:            <F1..F6 | M1..M6>
Prompt:             <verbatim>
Tool calls made:    <from the agent's log>
Response:           <verbatim>
Grade:              PASS | FAIL | PARTIAL | INVALID | INCONCLUSIVE
Evidence:           <which layer confirmed grounding>
PR linkage:         <PR number>
Code change needed: <none | description with file:line>
```

Full transcripts stay in a private working file — they contain real character and campaign data. Only a
scrubbed summary is committed, as in 0.7.0 §6.

### 3.4 — Fixture refresh procedure

When a tier-2 shape test fails or DDB is known to have changed:

1. Rebuild or re-open the affected fixture character.
2. Re-capture the raw payload; diff against the committed `<name>.json` to see what moved.
3. Re-read ground truth from the web sheet into `<name>.expected.json` (values may have changed too).
4. Re-scrub, re-commit, and note the refresh date in the fixture's `notes` field.

---

## 4. Per-item implementation and test plans

Each item lists: the change, tier-1 unit tests, tier-2 live verification, and tier-3 behavioral prompts.
Behavioral prompts are paired **naturalistic** (no cue — tests tool selection and defaults) and **directed**
(explicit — isolates capability from judgment), per the 0.7.0 convention.

---

### v0.8.0

#### Item 5 — Restore write endpoints *(PR 1)*

**Change.** `endpoints.ts`: `updateSpellSlots()`, `updateDeathSaves()`, `updatePactMagic()` lose their path
parameter and move to `/character/v5/spell/slots`, `/character/v5/life/death-saves`,
`/character/v5/spell/pact-magic`; `updateCurrency(id)` is replaced by
`inventory.setCurrency(denomination)` → `/character/v5/inventory/currency/{copper|silver|electrum|gold|platinum}`.
Payloads gain `characterId` and switch to level-indexed fields (`{ characterId, level3: 2 }`, not
`{ level: 3, used: 2 }`). `updateDeathSaves` reads the character first and sends **both** counts, since the old
single-field body may have been silently zeroing the other. Delete the five "temporarily unavailable /
deprecated" canned messages; replace with honest 404 reporting that names the endpoint.

**Tier 1.** Mocked `client.put` assertions on exact URL and body shape for each of the four endpoints, plus
`cast_spell`'s slot path; a test that `updateDeathSaves` preserves the untouched count (fixture with
`failCount: 2`, set successes to 1, assert `failCount: 2` still in the body); a test that a 404 surfaces the
endpoint name rather than the old deprecation copy.

**Tier 2** *(F1)*. For each: read state → write → **independent read-back asserting the new value** → restore
original. Rewrite `tests/live/write-character.test.ts` to drop its `if (text.includes("temporarily
unavailable"))` branches entirely — after this PR, a deprecation message is a **failure**, not an accepted
outcome.

**Tier 3** *(`ddb-character-writer`, F1)*.
- **W1a** *(naturalistic)* — "My character just took a level 3 spell slot's worth of magic — I cast Fireball.
  Update the sheet, then tell me what I have left." Expect a successful write and a read-back count. **Fail:
  any 'unavailable' language.**
- **W1b** *(directed, round-trip)* — "Set character `<F1 id>`'s gold to 250, then read the sheet back and tell
  me what it says the gold is. Quote the line." Layer B: the read-back must show 250.
- **W1c** *(death-save merge)* — "My character failed a death save — that's their second failure. Record it,
  then tell me the full death save state." Expect `2 failures / N successes` with successes unchanged. This is
  the merge-behavior test; a subject reporting successes reset to 0 is a **FAIL**.

#### Item 9 — Pact-magic normalization *(PR 2)*

**Change.** New `src/utils/character-spell-slots.ts` exporting `getPactMagicState(char)`, handling both the
object shape and the per-level-row array shape, deriving slot level (`min(ceil(warlockLevel/2), 5)`) and
backfilling `available` from Warlock progression (1 / 2 / 3 / 4 at levels 1 / 2–10 / 11–16 / 17+) when the API
returns 0. `DdbCharacter.pactMagic` widens to `Obj | Array | null`. `formatSpellSlots`, `castSpell` and
`updatePactMagic` all route through it.

**Tier 1.** Pure-function table tests: object shape passes through; array shape with `available: 0` derives
correctly at warlock levels 1/2/5/11/17; multiclass warlock sums only warlock levels; non-warlock returns
`null`; empty array returns `null`. Plus `formatSpellSlots` rendering with clamped filled/empty pips (the old
code could emit a negative repeat count).

**Tier 2** *(F2)*. Assert the live payload's actual shape (P5's answer) is handled; write a pact slot and
read back.

**Tier 3** *(`ddb-character-writer`, F2)*.
- **W2a** *(naturalistic)* — "My warlock just cast Hex. How many pact slots are left?" Expect a correct
  level-and-count statement. **Fail: 'no pact magic', `NaN`, or `undefined` in the answer** — the signature of
  the object-shape access hitting an array.
- **W2b** *(directed)* — "Read character `<F2 id>`'s spell slots and quote the Pact Magic line verbatim."
  Layer A: the line must be quoted, not summarized.

#### Item 6 — Rest via POST *(PR 3)*

**Change.** `rest.short()` / `rest.long()` drop their query parameter; both become `client.post` with a body.
Long rest: `{ characterId, resetMaxHpModifier: true, adjustConditionLevel: false }`. Short rest: read the
character first and send `{ characterId, classHitDiceUsed: { <classId>: <used> }, resetMaxHpModifier: false }`.
Adds `DdbClass.hitDiceUsed`. **Gated on P9** — if GET still works and POST does not, this PR is cancelled and
the finding recorded.

**Tier 1.** Mocked assertions on verb, URL and body; `classHitDiceUsed` built from a multiclass fixture; cache
invalidation still fires.

**Tier 2** *(F1, F2)*. Spend a resource → short rest → read back and assert restoration. Long rest on a damaged
character → assert HP restored. This is the clearest round-trip in the suite.

**Tier 3** *(`ddb-character-writer`, F2)*.
- **W3a** *(naturalistic)* — "The party is taking a short rest. My warlock wants to spend a hit die and get
  their pact slots back. Handle it and tell me the result." Expect pact slots restored, confirmed by read-back.
- **W3b** *(directed)* — "Long rest character `<F1 id>`, then quote the HP line." Layer B.

#### Items 13, 14 — Condition IDs and reset types *(PR 4, gated on P6/P10)*

**Change.** Whichever of the two tables the probe proves wrong. If graham is right: `CONDITION_NAMES` and both
tool descriptions in `server.ts` shift Exhaustion to 4 and slide Frightened→Unconscious up one. If this fork is
right: no code change, and a comment recording the adjudication so nobody re-opens it. Same for `resetType`,
plus the `resetNames` numeric fallback and `useProficiencyBonus` handling in `formatLimitedUseResources`
(max uses = `maxUses + proficiencyBonus` when the flag is set; `remaining` clamped at 0).

**Tier 1.** Condition ID → name mapping table matching the adjudicated truth; limited-use rendering with
`useProficiencyBonus: true` at several proficiency bonuses; `numberUsed > maxUses` renders `0`, not negative.

**Tier 2** *(F1).* Apply each condition ID 1–15, read back, assert the name the sheet reports matches our
table. This single test settles item 13 permanently and guards it forever.

**Tier 3** *(`ddb-character-writer`, F1)*.
- **W4a** *(naturalistic)* — "My character just gained two levels of exhaustion from the forced march. Apply it
  and confirm what's on the sheet now." Expect Exhaustion at level 2. **Fail: Deafened, or any other condition
  name appearing** — the off-by-eleven signature.
- **W4b** *(directed)* — "Apply condition ID 4 to character `<F1 id>`, read the sheet, and tell me exactly
  which condition appeared." Deliberately mechanical: this is the adjudication, in the subject's own words.

---

### v0.9.0

#### Item 1 — Max HP includes Constitution *(PR 6)*

**Change.** `calculateMaxHp`: override wins outright; otherwise `base + bonus + (conMod × level) +
sumModifierBonuses("hit-points") + sumModifierBonuses("hit-points-per-level") × level`.

**Ground truth: the web sheet, mandatory.** Whether `baseHitPoints` is pre- or post-CON is an API-semantics
question; no rules argument settles it and a wrong assumption here silently doubles or erases the CON term.

**Tier 1** *(F3, F6, M1)*. Assert computed max HP equals `expected.json` for each fixture; a level-1 CON 14
case, a level-5 case, a multiclass case, an `overrideHitPoints` case (override must ignore everything else),
and a negative-CON case.

**Tier 2.** Compare against the same characters live to confirm the frozen payloads still represent reality.

**Tier 3** *(`ddb-character-reader`, F3)*.
- **C1a** *(naturalistic)* — "A hobgoblin crit my character for 14. Are they down? What's their HP situation?"
  Expect current/max quoted from the tool. Layer A is critical here: a subject that adds up hit dice itself is
  INVALID regardless of the answer.
- **C1b** *(directed)* — "What does the sheet say this character's maximum HP is? Quote the line exactly."

#### Item 3 — `set`-type ability modifiers *(PR 7)*

**Change.** `computeFinalAbilityScore` takes `Math.max(score, value)` over matching `type: "set"` modifiers.
Introduce `computeCharacterAbilityScore(char, id)` and migrate every call site in `character.ts` and
`resources/character.ts`.

**Tier 1** *(M5)*. `set` below the natural score does not lower it; `set` above raises it; multiple `set`s take
the highest; no `set` behaves exactly as before (regression guard on the existing suite).

**Tier 3** *(`ddb-character-reader`, M5)*.
- **C2a** *(naturalistic)* — "I'm wearing my Belt of Giant Strength. What's my Strength and my athletics
  check?" Expect the set value, not the base.

#### Item 2 — AC *(PR 8)*

**Change.** Prefer numeric `armorTypeId` (1/2/3 = light/medium/heavy, 4 = shield) with the existing string
matching as fallback; unarmored builds a candidate list (base, barbarian, monk, natural armor) and takes the
**max**, honoring `unarmored-armor-class` `set` values plus `ignore: unarmored-dex-ac-bonus` and
`ac-max-dex-modifier`; `armored-armor-class` vs `unarmored-armor-class` bonuses apply only in their respective
states.

**Tier 1** *(M1, M2, F3, F4)*. Medium armor caps DEX at +2; heavy ignores DEX; shield adds its own AC;
barbarian with high CON *and* high DEX takes the better formula, not the first match; monk likewise; natural
armor honors the `set` + dex-cap rules; a shield with a missing `type` string but `armorTypeId: 4` is still
detected (the fallback-path regression); an unarmored character with `armored-armor-class` bonuses does not
receive them.

**Tier 3** *(`ddb-character-reader`, M1 and F3)*.
- **C3a** *(naturalistic)* — "The goblin rolled a 15 to hit me. Does that connect?" Requires reading AC.
- **C3b** *(directed)* — "What's my AC, and what's contributing to it? Quote what the tool reports."
  Layer A; also grades whether the sheet's AC line is legible enough to explain.

#### Item 4 — Hybrid 2024 ASI *(PR 9, conditional on P4)*

**Change.** `uses2024BackgroundAbilityScores(char)` detects a feat named `ability score improvements` or
`<background> ability score improvements`; when present, filter `bonus`-type ability-score modifiers out of
`modifiers.race` before computing.

**Tier 1** *(M3)*. Hybrid fixture's scores match `expected.json`; a pure-2014 character is unaffected (the
filter must not fire); a pure-2024 character is unaffected; the background-name variant of the feat name is
matched case- and whitespace-insensitively.

**Tier 3** *(`ddb-character-reader`, M3)*.
- **C4a** *(directed)* — "What are this character's ability scores? Quote them." Compare against the web sheet
  by hand. This is one of the few tier-3 tests that can catch a math bug, because the double-count is large
  enough (+2/+1) to be obvious against a sheet you are holding.

> If P4 finds the account cannot build a legacy-species + 2024-background hybrid, **this item is deferred**,
> not guessed at. Record the deferral; do not ship an unverifiable heuristic that silently strips racial ASIs.

#### Item 10 — Saves, skills, spell DC *(PR 10)*

**Change.** Saves add `sumModifierBonuses("saving-throws")` plus the per-ability subtype. Extract
`getSkillTotal(char, abilityId, subType)` adding `ability-checks` plus the per-skill subtype. Spell save DC adds
`spell-save-dc` plus `${classSlug}-spell-save-dc`.

**Tier 1** *(F3, M1)*. Each bonus source in isolation and combined; expertise still doubles; a character with no
such modifiers produces byte-identical output to before (regression guard).

**Tier 3** *(`ddb-character-reader`)*.
- **C5a** *(naturalistic)* — "The DM called for a Wisdom save against the dragon's frightful presence. What do
  I roll?"

#### Item 12 — Speeds, initiative, passives, senses *(PR 11)*

**Change.** Read `race.weightSpeeds.normal` for real base speeds; report every nonzero movement type; add
initiative (DEX + `initiative` bonuses), three passive scores (10 + `getSkillTotal`), and nonzero senses
(darkvision/blindsight/tremorsense/truesight, `set`/`set-base` max plus `bonus` sum).

**Tier 1** *(F3, F6, M2)*. A 25 ft species reports 25, not 30; a 35 ft species reports 35; a flying species
reports both walk and fly; unarmored movement adds to walk; passive Perception reflects proficiency and
expertise; darkvision from a race plus an item sums correctly; a character with no special senses emits no
Senses line.

**Tier 3** *(`ddb-character-reader`, M2 or F3)*.
- **C6a** *(naturalistic)* — "Can my character outrun the wolves? They move 40." Requires the real speed.
- **C6b** *(naturalistic)* — "The DM is rolling a stealth check against my passive Perception. What is it?"
- **C6c** *(naturalistic)* — "It's pitch dark in the cavern. What can my character see?" Grades whether senses
  are present *and* legible.

#### Item 8 — Spell provenance *(PR 12)*

**Change.** New `src/utils/character-spells.ts`: `getCharacterSpellEntries` merges `classSpells` (a collection
this fork's type does not yet model) plus all five `spells.*` collections, de-duplicating by definition ID while
OR-ing `prepared` / `alwaysPrepared` / `usesSpellSlot` and recording sources and casting modes.
`formatCharacterSpellAccess` renders `[Item; 1/Long Rest]`-style annotations. Header becomes `Spells`.

**Tier 1** *(F2, M6)*. A `prepared: false` feat-granted spell still appears; the same spell from two sources
appears once with both sources; casting modes de-duplicate; a limited-use spell renders its uses and reset; a
`useProficiencyBonus` spell renders `PB/<reset>`; a character with no spells emits nothing.

**Tier 3** *(`ddb-character-reader`, F2)*.
- **C7a** *(naturalistic)* — "What can my warlock cast right now, and what does each one cost me?" Grades
  whether provenance/casting-mode labels are *usable*, which is the whole point of the format change.
- **C7b** *(directed)* — "Does this character have any spells they can cast without spending a slot? Quote the
  relevant lines."

---

### v0.10.0

#### Item 7 — Owned-character listing *(PR 14)*

**Change.** `getOwnedCharacters(client)` calls `ENDPOINTS.character.list(await getUserId())` — `getUserId`
already exists in this fork's `auth.ts` and is already used by `campaign.ts`. Add `DdbCharacterListItem` /
`DdbCharacterListData` to `types/api.ts`. `listCharacters` and `findCharacterByName` both route through it,
dropping the per-campaign fan-out **and** the N+1 full-character fetch. Update the tool description, which
currently promises only "across all campaigns."

**Tier 1** *(F5)*. Campaign-less characters appear; `campaignName: null` renders "No campaign"; fuzzy name
matching still resolves exact / substring / Levenshtein cases; a null `userId` produces the "run setup_auth
again" error rather than a crash.

**Tier 2.** Assert the live shape matches P8; assert a known campaign-less character appears.

**Tier 3** *(`ddb-character-reader`, F5)*.
- **C8a** *(naturalistic)* — "List all my characters." Expect the campaign-less fixture present.
- **C8b** *(naturalistic, name resolution)* — "Tell me about `<F5 partial name>`." Expect resolution without a
  numeric ID — the path that silently fails today for campaign-less characters.

#### Item 11 — Custom proficiencies, items, names *(PR 15)*

**Change.** Add `customItems`, `customProficiencies`, `characterValues` to the type. New
`src/utils/character-inventory.ts` with `getInventoryDisplayName` (typeId 8 override) and
`formatInventoryItemLabel` (quantity + attunement). Custom skills fold into `formatSkills` using DDB's
1=None/2=Half/3=Proficient/4=Expertise enum; custom languages into `formatProficiencies`, alongside
`type: "language"` modifiers which are currently skipped entirely. Custom items get their own sheet section.
`search_definitions` matches on both the custom and the definition name.

**Tier 1** *(M4)*. Renamed item displays the custom name and cross-references the original; attunement renders;
a half-proficiency custom skill computes `floor(pb/2)`; custom languages appear; searching either name finds the
item.

**Tier 3** *(`ddb-character-reader`, M4)*.
- **C9a** *(naturalistic)* — "What's my character carrying, and what are they attuned to?"
- **C9b** *(naturalistic)* — "What languages does my character speak?" Catches the `type: "language"` modifier
  gap independently of the custom-proficiency path.

#### Item 15 — Selected options *(PR 16)*

**Change.** Add `options?: Record<string, DdbCharacterOption[] | null>`. `getSelectedOptionGroups` /
`formatSelectedOptions` add a sheet section; class-sourced options merge into class-feature names; option
definitions become searchable and appear in `full` detail.

**Tier 1** *(F2, M6)*. Options render grouped by source with title-cased labels; duplicates within a group
collapse; an empty/absent `options` renders "None"; a class option appears in the class-feature list without
duplicating a real feature.

**Tier 3** *(`ddb-character-reader`, F2 or M6)*.
- **C10a** *(naturalistic)* — "What Eldritch Invocations does my warlock have and what do they do?" Requires
  both the listing and the definition text.

---

## 5. Release checklist (applies to each of 0.8.0, 0.9.0, 0.10.0)

1. All tier-1 tests green: `npm test` (currently 374 tests — the number only goes up).
2. `npm run build` clean.
3. Tier 2 green: `npm run test:live`, with **no** "deprecation accepted" branches remaining for 0.8.0.
4. Tier 3 suite dispatched, results recorded, scrubbed summary appended to this document.
5. `npm run test:live:sweep` — no orphaned `MCPTEST-` characters.
6. README updated: known-issues entries removed for anything fixed; output-format changes documented for
   0.9.0's spell section; attribution section added in 0.8.0.
7. `BACKLOG.md` updated — items closed, deferrals recorded with their reason.
8. Version bumped in `package.json` **and** `src/server.ts` (`McpServer({ version })` — currently `0.1.0`,
   already stale against `package.json`'s `0.7.0`; fix this in 0.8.0 and keep them in lockstep thereafter).
9. Tag and release notes summarizing user-visible changes.

---

## 6. Risks and mitigations

| Risk | Mitigation |
|---|---|
| **Write endpoints break again when DDB changes its contract** | Inherent and unpreventable. Mitigated by honest 404 messages naming the endpoint, tier-2 round-trip tests that fail loudly, and keeping 0.8.0 revertable as a unit |
| **Orphaned test characters accumulate against `characterSlotLimit`** | `afterAll` cleanup, `MCPTEST-` prefix convention, `test:live:sweep` helper |
| **A write test targets a real character** | Fixture setup asserts the target's name starts with `MCPTEST-`; enforced in code, not by convention |
| **Frozen fixtures drift from reality** | Opt-in live shape suite (field presence/type, not values); documented refresh procedure (§3.4) |
| **Tier 3 comes back green while a formula is wrong** | Explicitly accepted and documented (Threat B, §3.3). Correctness lives in tier 1 against sheet-derived ground truth |
| **P4 finds the account cannot build M2/M3** | Those items defer rather than ship unverified. A heuristic that strips racial ASIs must never ship on an assumption |
| **Committed fixtures leak account data** | Mandatory scrubber with a denylist that fails the commit |
| **0.9.0's spell-section rename breaks someone's saved prompts** | Documented in release notes with a before/after sample, per the output-format decision |
| **Graham's contract turns out to be wrong somewhere** | Every 0.8.0 item is probe-gated in Phase 0. Nothing in this plan trusts his fork over the live API |

---

## 7. Open questions

1. **Should #7 move into 0.8.0?** Decide once P8 returns. It is a live-contract item and would benefit from
   sharing 0.8.0's verification session, but it also changes name resolution for every character tool — which
   argues for keeping it away from the write-path release.
2. **Is there an equip endpoint?** Not in this codebase, and finding one is out of scope here — but if one
   surfaces during P7's probing, M1's manual build could become automatable, which would materially shrink the
   manual surface for future refreshes. Record it if seen; do not go looking.
3. **`resolve_choices` picks the first option for every choice.** Good enough for fixtures, but F2's
   invocations will be arbitrary. If item 15's tests need specific invocations, they need a manual fixture (M6)
   instead — P3 answers this.
4. **`search_racial_traits` remains broken** (0.7.0 finding 4, fix reverted as out of scope). Unrelated to this
   plan, but it is the obvious candidate for a small 0.8.1 alongside this work, since the fix already exists in
   history at `7756cc2`.

---

## Phase 0 results

Run 2026-09-06 against a live `MCPTEST-F2-Warlock` fixture (character ID `170754982`, Warlock 2024,
levels 3→5) built via the running MCP server's own tools, plus a standalone probe script (not committed)
that reused `~/.dndbeyond-mcp/config.json` to hit endpoints the tools don't cover yet. All write findings
were confirmed via an **independent read-back**, per §3.3's Threat C.

| Probe | Question | Observed | Consequence |
|---|---|---|---|
| P1 | Does `set_class_level` work past level 1? | Yes. `set_class_level` moved the fixture's Warlock from level 3 to level 5 cleanly (`classId: 2190885`, `classMappingId` read from `classes[].id`). | F2/F3/F4 fixtures can be built past level 1 as planned. |
| P2 | 2024 class IDs for Warlock, Barbarian, Monk | Live `game-data/classes`: **Warlock 2190885, Barbarian 2190875, Monk 2190880** (2024); legacy equivalents **7, 9, 11** also present. Matches the MCP tool descriptions' own hint text. | Use these IDs for F2 (Warlock), F3 (Barbarian), F4 (Monk) fixture builds. Not hardcoded blind — confirmed live. |
| P3 | Does `resolve_choices` complete a Warlock, and pick invocations? | Yes. Auto-resolved 20 choices in one call, including two Level-2 Eldritch Invocation picks — both landed on "Agonizing Blast" (first-available, repeatable option chosen twice). `options.class` on the read-back character shows the picks with full definitions. 2 choices remained unresolved (not investigated further — non-blocking). | Confirms item 15's data source and Open Question 3: `resolve_choices` picking the same repeatable option twice is expected "first-available" behavior, not a bug — item 15 tests needing a *specific* invocation still need manual fixture M6. |
| P4 | Which legacy and natural-armor species does this account own? | `game-data/races` returns 33 races. **Tortle, Lizardfolk, Warforged: none found** — this account owns no natural-armor species. Legacy (`isLegacy:true`) species available: Human, Half-Orc, Tiefling, Dragonborn, Half-Elf, Aarakocra, Goliath, plus several legacy subraces. | **M2 (natural-armor fixture) is cancelled** — item 2's natural-armor branch ships with unit-test-only coverage against a synthetic/hand-built fixture rather than a captured real payload; document this gap in PR 8's description. **M3 remains buildable** — Half-Elf (legacy) + a 2024 background is available for the hybrid-ASI fixture. |
| P5 | Is `pactMagic` an array or object on this account's Warlock? | **Array** of per-level rows: `[{level:1..5, used, available}]`. `available` was **0 for every row** at both Warlock level 3 and level 5 — the API never populates it. | Confirms item 9 is not optional: without `getPactMagicState`'s Warlock-progression backfill, every pact-magic display and write on this account's Warlock is reading `available: 0` today, which is why `cast_spell`'s pact path could never have worked even if the endpoint weren't 404ing. |
| P6 | Actual condition ID mapping | Applying `id:4` with a numeric `level` persisted that level; applying `id:15` with a numeric `level` silently dropped it back to `null`. Exhaustion is the only leveled condition among the 15 — this proves **`id:4` is Exhaustion**, not `id:15`. | **Graham's table is correct; this fork's is wrong.** Corrected mapping: `1=Blinded, 2=Charmed, 3=Deafened, 4=Exhaustion, 5=Frightened, 6=Grappled, 7=Incapacitated, 8=Invisible, 9=Paralyzed, 10=Petrified, 11=Poisoned, 12=Prone, 13=Restrained, 14=Stunned, 15=Unconscious`. PR 4 updates `CONDITION_NAMES` and both tool descriptions in `server.ts` to this table. |
| P7 | Do the four corrected write endpoints accept graham's payload shapes? | All four confirmed live with a **200 + independent read-back**: `PUT spell/slots {characterId, level<N>: used}`; `PUT life/death-saves {characterId, failCount, successCount}`; `PUT spell/pact-magic {characterId, level<N>: used}`; `PUT inventory/currency/{copper\|silver\|electrum\|gold\|platinum} {characterId, amount}` (this last shape was already live and proven — it's this fork's existing working `setGold` tool, generalized to the other four denominations and confirmed live for all of them). | PRs 1 and 2 can proceed exactly as specified. `updateCurrency` becomes a thin wrapper choosing the right denomination path, matching the already-working `setGold` pattern rather than inventing a new one. |
| P8 | Does `characters/list?userId=` return the expected shape? | Yes: `{characterSlotLimit, canUnlockCharacters, characters: [{id, level, name, status, statusSlug, isAssigned, classDescription, raceName, avatarUrl, backdropUrl, coverImageUrl, characterSecondaryInfo, campaignId, campaignName, createdDate, lastModifiedDate, isReady}]}`. Cheap — no per-character detail fetch needed. `characterSlotLimit` was `null` for this account (unlimited/unenforced). | Confirms item 7's approach and perf win. **Decision on Open Question 1: keep item 7 in v0.10.0.** 0.8.0 is already large and item 7 isn't a dependency of the write-path work; pulling it forward would only share a verification session, which isn't worth mixing a name-resolution change into the write-path release. `test:live:sweep` (§3.2) must treat a `null` `characterSlotLimit` as "don't warn," not zero. |
| P9 | Does rest work as POST-with-body? Does the current GET still work? | **The current GET-based short rest is a false success in production today.** `GET rest/short?characterId=` returned `200 "Successfully received short rest text"` with descriptive data (`"2 Pact Magic Slots"`) but an independent read-back showed pact magic `used` counts **unchanged** — it never actually reset anything. `POST rest/short` with `{characterId, classHitDiceUsed: {<classMappingId>: n}, resetMaxHpModifier: false}` and `POST rest/long` with `{characterId, resetMaxHpModifier: true, adjustConditionLevel: false}` both worked correctly, confirmed two ways: the response body itself echoes the full updated state (`spellSlots`, `pactMagic`, `classes[].hitDiceUsed`, `removedHitPoints`), and a separate independent read-back matched it. | **This elevates PR 3 from "verify, maybe skip" to confirmed-necessary.** Today's `short_rest`/`long_rest` tools report success and silently do nothing — exactly the Threat C failure mode §3.3 warns about, and it's live in production right now, not hypothetical. PR 3 proceeds as specified; its tier-2 test must assert on the read-back, never the rest call's own response text (though in this case the response text is also trustworthy for POST, unlike GET). |
| P10 | What `resetType` integers appear against their real-world reset behavior? | Warlock's **Magical Cunning** (PHB text: *"you can't do so again until you finish a Long Rest"*) carries `resetType: 2`. A homebrew feat action ("Algiz: Activate Runestone") carries `resetType: 3`. | Confirms graham's corrected mapping (`1=Short Rest, 2=Long Rest, 3=Dawn, 4=Other`); this fork's stale type comment (`1=Long Rest, 2=Short Rest`) is backwards — a long-rest-only feature could not carry `resetType: 2` under this fork's own comment. PR 4 fixes the `DdbLimitedUse.resetType` comment and adds the `resetNames` fallback table using the corrected ordering. |

### Unplanned findings (recorded, not in original probe list)

- **`setAbilityScore` with `type: 1` ("standard array") silently no-ops.** The live endpoint returns
  `200 "Ability score type successfully updated."` but never writes to `stats[].value` — the character keeps
  `null` ability scores. `type: 3` ("point buy") through the *same* endpoint and params shape does persist the
  value correctly. This is a real, pre-existing bug distinct from anything in this plan's 15 items (ability
  score *values* being ignored for one specific input mode, not the `set`-modifier issue item 3 covers). Out of
  scope for 0.8.0 (ability scores are item 3, v0.9.0) — recorded in `BACKLOG.md` for a future fix, likely
  alongside PR 7.
- **`updateHp` 400s when `tempHp` is omitted.** The current code
  (`src/tools/character.ts` — `updateHp`) only includes `temporaryHitPoints` in the PUT body when
  `params.tempHp !== undefined`, but the live `life/hp/damage-taken` endpoint requires the field unconditionally
  and returns `400 "Missing required field: temporaryHitPoints"` without it. This is a currently-shipping bug in
  a tool this fork's own docs list as already working (not one of the five dead tools) — the same "always send
  every field the endpoint expects" lesson as the death-saves finding in item 5. **Fixed alongside PR 1** since
  it's a one-line change to a sibling write path already under test in this release; see PR 1's commit.

---

## v0.8.0 completion report (2026-09-06)

All of §2.1's substantive PRs (1–5, items 5, 6, 9, 13, 14) are implemented, tested, and committed on
`feat/0.8.0-write-path` (branched from `main`). Every write path was verified against the live API, not
just mocked — the same fixture-and-read-back discipline the plan specifies.

### What shipped

- **PR 1** — `updateSpellSlots`, `updateDeathSaves`, `updateCurrency` restored to graham's confirmed
  endpoint/payload shapes; the five "temporarily unavailable" canned messages replaced with honest 404
  reporting (`reportEndpointFailure`); `updateDeathSaves` now reads-then-merges both counts.
  Additionally fixed the live `updateHp` 400 found during Phase 0 (missing `temporaryHitPoints`).
- **PR 2** — new `src/utils/character-spell-slots.ts` (`getPactMagicState`, `buildPactMagicUpdateBody`,
  `warlockSlotLevel`, `warlockSlotCount`); `updatePactMagic`, `castSpell`'s pact path, and
  `formatSpellSlots` all route through it; `DdbCharacter.pactMagic` widened to the object-or-array union.
- **PR 3** — `long_rest`/`short_rest` switched to `client.post` with graham's body shapes;
  `DdbClass.hitDiceUsed` added to the type; `shortRest` now reads the character first to build
  `classHitDiceUsed` keyed by `classes[].id` (confirmed live to be the mapping ID, not `definition.id`
  — the plan's own wording was ambiguous on this point).
- **PR 4** — `CONDITION_NAMES` corrected (Exhaustion → 4) in `character.ts` and both tool descriptions in
  `server.ts`; `DdbLimitedUse.resetType` comment corrected, `RESET_TYPE_NAMES` fallback table added,
  `useProficiencyBonus` handling and a `Math.max(0, ...)` clamp added to `formatLimitedUseResources`.
- **PR 5** — `package.json` and `src/server.ts`'s `McpServer` version both bumped to `0.8.0` (were
  stale/mismatched at `0.7.0`/`0.1.0`); README gained a v0.8.0 changelog entry, documentation for six
  previously-undocumented tools, and an Acknowledgments section; `BACKLOG.md` updated (stale
  "decommissioned write APIs" framing corrected, four items marked resolved, the new `setAbilityScore`
  finding added).
- **Test infrastructure**: `tests/live/setup.ts` gained `setupWriteTestCharacter()` /
  `assertIsTestCharacter()` (backed by new `src/utils/test-fixtures.ts`, shared with the also-new
  `src/scripts/sweep-test-characters.ts` → `npm run test:live:sweep[:dry-run]`). `write-character.test.ts`
  was rewritten from scratch: it now builds fresh `MCPTEST-`-prefixed fixtures instead of resolving to
  whatever real character `setupLiveCharacter()` finds first, and every assertion is against an
  independent read-back — no test accepts a "temporarily unavailable" response as passing anymore.

### Test results

- **Tier 1 (`npm test`):** 402 passed (was 374 at the start of this session; new coverage: 19 tests for
  `character-spell-slots.ts`, 6 for the corrected condition/resetType behavior, plus rewrites of the
  three existing suites the endpoint-shape changes touched). `npm run build` clean.
- **Tier 2 (`npm run test:live`):** 59 passed, including the 9 rewritten/new write-path tests — every one
  of them backed by an independent read-back per the plan's Threat C requirement. Ran twice (once
  standalone, once as part of the full live suite) with identical results. `npm run test:live:sweep`
  confirms zero orphaned `MCPTEST-` characters after both runs.
- **Tier 3 (behavioral agent):** **Not run this session** — see Next steps.

### Deviations from the plan (none change 0.8.0/0.9.0/0.10.0 scope)

1. **Commit granularity.** §2.1 specifies one PR per item. This environment's `Bash` tool has no
   interactive `git add -p`/`git add -i`, so splitting the already-written, heavily interleaved changes
   to `character.ts`/`endpoints.ts`/`types/character.ts` into four true partial-file commits wasn't
   practical after the fact. Landed as two commits instead: one covering PRs 1–4's substantive code
   (still organized internally by item, with `Ported-From` attribution and per-item code comments citing
   the relevant Phase 0 probe), and one for PR 5's release chore. Each item remains independently
   reviewable by section/comment even though `git bisect` would land on "all of PRs 1–4" rather than a
   single item. If true per-item history matters, it can still be reconstructed by hand from this report
   before opening PRs against upstream.
2. **Item 7 stays in v0.10.0** (Open Question 1, resolved via P8 — see the Phase 0 table). Confirmed
   cheap to build, but not pulled forward since it isn't a dependency of the write-path work.
3. **M2 (natural-armor fixture) is cancelled** (P4) — this account owns no Tortle/Lizardfolk/Warforged.
   Affects v0.9.0 PR 8's test coverage (item 2's natural-armor AC branch ships unit-tested against a
   synthetic fixture only, not a captured real payload) — flag this explicitly in that PR's description
   per §3.2's mitigation. M3 (hybrid 2024-background ASI) remains buildable (Half-Elf is owned as legacy).
4. **`updateHp`'s live 400 bug** (found during Phase 0, not one of the plan's 15 items) was fixed inline
   in PR 1 rather than deferred, since it's a one-line change to a sibling write path already under test.

### Next steps

1. ~~**Tier 3 behavioral testing (§3.3) is now done — see the results section below.**~~ **Done, and the
   display gap it surfaced is now fixed (2026-09-06, commit `25482eb`).** Tier 3 found real,
   previously-unrecorded display gaps (currencies/deathSaves/conditions/single-class pact magic never
   appearing in `get_character`'s output despite correct writes) and one genuine regression risk
   (`add_condition` without an explicit `level` silently clearing an existing leveled condition). None of
   these were caught by tier 1 or tier 2 at the time, which is exactly the gap tier 3 exists to close —
   tier 2 proves the API accepts the write; tier 3 proved a player or DM using only these tools had no way
   to read four of those writes back. Both are now fixed and re-verified at all three tiers (see the
   results-table update and findings 1-3 above) — **the recommendation to fix the display gap before
   tagging is satisfied.**
2. **Release checklist (§5) status:** 1 ✅, 2 ✅, 3 ✅ (no "deprecation accepted" branches remain), 4 ✅
   (tier 3 dispatched, results recorded, scrubbed summary appended below — see findings above for
   follow-up work this surfaced), 5 ✅ (sweep confirms no orphans after this session's fixtures were
   cleaned up too), 6 ✅, 7 ✅, 8 ✅, 9 ⬜ (findings 1-3 are now fixed and re-verified — item 1's blocker
   on tagging is cleared; no git tag or release notes cut yet, pending user sign-off).
3. **Decide whether to open this as a real PR** against `origin/main` (or the upstream fork) now, or
   continue accumulating v0.9.0 work on top of `feat/0.8.0-write-path` first. Nothing has been pushed
   beyond `release/v0.8.0`.
4. Once 0.8.0 is signed off, v0.9.0 (items 1, 3, 2, 4, 10, 12, 8 — PRs 6–13) can start; §1's dependency
   graph says land item 3 (`computeCharacterAbilityScore`) first since items 2 and 4 both build on it.
   PR 8 (item 2, AC) should also investigate the AC-reading-inconsistently-across-calls note from the
   tier-3 results below (F2, no equipment change between reads).

---

## v0.8.0 tier-3 behavioral test results (2026-09-06)

Two new agent definitions were added per §3.3: [`ddb-character-reader.md`](../../.claude/agents/ddb-character-reader.md)
(read-only) and [`ddb-character-writer.md`](../../.claude/agents/ddb-character-writer.md) (read + write; every
prompt must name an explicit `MCPTEST-` fixture, and its system prompt forbids acting on any character it wasn't
given). Fixtures were built fresh via the live MCP tools per §3.2, since the ones from Phase 0/tier-2 were already
swept: **F1** = `MCPTEST-F1-Fighter` (standard-build, Fighter 1) and **F2** = `MCPTEST-F2-Warlock` (quick-build,
Warlock 3, point-buy CHA 15/CON 14/DEX 14). Both were deleted via `test:live:sweep` after this run — no orphans.

Full per-test transcripts (prompts, tool-call logs, verbatim responses) live in a private working file, not this
repo — they carry this account's real character IDs. This section is the scrubbed record: every finding, every
grade, no account-identifying detail, per §3.3's closing paragraph.

**Before dispatch: a stale-server false start, caught and resolved.** The interactive MCP server backing these
tool calls had been running since before PR1–4's build was produced. `update_death_saves` and `update_currency`
briefly returned the *old*, pre-0.8.0 "⚠️ ...temporarily unavailable... D&D Beyond has deprecated the v5 character
write API endpoints" canned text, verbatim — text that no longer exists anywhere in this repo's `src/` or `build/`.
`build/` was already current on disk (rebuilt after PR1–4, confirmed by timestamp), so this was a stale *running
process*, not a stale build artifact. Resolved by restarting the app / MCP connection; both endpoints immediately
returned current-code responses afterward (confirmed before any test fixture was touched). No code change — noted
here because, uncaught, it would have produced false FAIL grades below indistinguishable from real regressions.

| ID | Item | Naturalistic/Directed | Grade |
|---|---|---|---|
| W1a | 5 | naturalistic | INCONCLUSIVE |
| W1b | 5 | directed | ~~PARTIAL~~ → **PASS** (2026-09-06, `25482eb`) |
| W1c | 5 | directed (merge) | ~~PARTIAL~~ → **PASS** (2026-09-06, `25482eb`) |
| W2a | 9 | naturalistic | INCONCLUSIVE |
| W2b | 9 | directed | ~~FAIL~~ → **PASS** (2026-09-06, `25482eb`) |
| W3a | 6 | naturalistic | ~~PARTIAL~~ → **PASS** (2026-09-06, `25482eb`) |
| W3b | 6 | directed | PASS |
| W4a | 13/14 | naturalistic | ~~PARTIAL~~ → **PASS** (2026-09-06, `25482eb`) |
| W4b | 13/14 | directed | ~~FAIL~~ → **PASS** (2026-09-06, `25482eb`) |

**Originally 1/9 PASS, 4/9 PARTIAL, 2/9 FAIL, 2/9 INCONCLUSIVE.** Every write this suite actually exercised persisted
correctly at the API level, independently confirmed out-of-band for all four PARTIAL/FAIL write tests (W1b, W1c,
W3a, W4a) — **item 5, 6, 9 and 13's write-side logic all check out.** The PARTIAL/FAIL grades were overwhelmingly
one root cause (finding 1, below), not four separate write-path bugs. The two INCONCLUSIVE results (W1a, W2a) are
fixture/prompt mismatches (a Fighter asked to cast Fireball; a Warlock asked to cast a spell it doesn't have
prepared) — in both cases the subject correctly refused to fabricate a write rather than guessing, which is the
behavior §3.3's Threat A/B framing asks for, but it means those two tests didn't exercise anything; they remain
INCONCLUSIVE (see finding 4) rather than re-run, since the gap is in the fixture/prompt, not the product.

**Update (2026-09-06, commit `25482eb`): findings 1-3 are fixed and re-verified.** `formatCharacterSheet` now
reads `char.currencies`/`char.deathSaves`/`char.conditions[]`, `formatSpellSlots` computes pact magic
unconditionally instead of returning early, and `addCondition` defaults an omitted `level` to 1 for a leveled
condition instead of forwarding `null` (which D&D Beyond's API treats as "clear"). Verified at all three tiers:
414/414 unit tests (12 new), 65/65 live tests against the real API (6 new, asserting the *formatted sheet text*
reflects each write, not just the raw field), and a fresh Tier 3 dispatch — `ddb-character-writer` re-ran exactly
the five checks behind W1b/W1c/W3a/W4a/W4b against new `MCPTEST-T3b-Fighter`/`MCPTEST-T3b-Warlock` fixtures and
reported PASS on all five with quoted sheet output as evidence (fixtures deleted afterward, sweep confirmed no
orphans). W3b was already PASS and unaffected. W1a/W2a stay INCONCLUSIVE — unrelated fixture/prompt mismatches
(finding 4), not re-run.

### Findings (ranked)

1. **HIGH — FIXED (2026-09-06, `25482eb`).** `currencies`, `deathSaves`, and `conditions` are completely absent from
   `get_character`'s output, at every detail level (summary/sheet/full). Confirmed by W1b (gold), W1c (death saves),
   and W4a (conditions): in each case the write independently verified correct (out-of-band), but the subject — using
   only the tools this MCP exposes — had no way to read any of the three back, and correctly said so rather than
   reporting false confidence. `character.currencies` is read only inside `updateCurrency` (to compute a delta);
   `deathSaves` and `CONDITION_NAMES` are likewise never consulted by the sheet formatter. This is the single
   largest tier-3 finding: it silently defeats half of item 5's restoration and all of item 13's, from a usability
   standpoint, even though every underlying write is correct. **Fix (applied):** added `formatCurrencies`,
   `formatDeathSaves`, and `formatConditions` to `formatCharacterSheet` (`src/tools/character.ts`), each omitting
   its section when there's nothing to report. Re-verified at all three tiers — see the results-table update above.
2. **HIGH — FIXED (2026-09-06, `25482eb`).** Pact Magic never displays for a single-class Warlock. `formatSpellSlots`
   ([character.ts:474](../../src/tools/character.ts#L474)) filters regular `spellSlots` to `available > 0` and
   returns immediately if that list is empty — before ever reaching the `getPactMagicState` pact-magic append a
   few lines later. A single-class Warlock's regular `spellSlots` are *always* all `available: 0` (all of their
   slots are pact slots), so this early return fires every time, live-confirmed on F2 (W2b) even after directly
   writing real non-zero pact-magic state. Item 9's whole purpose was making pact magic visible and correct; the
   normalization logic itself is correct (independently confirmed: a direct `update_pact_magic` write landed on
   the correct level-2 row for this Warlock-3 fixture, and a `short_rest` correctly reset it — W3a), but the
   display never fired for the most common Warlock shape. **Fix (applied):** `formatSpellSlots` now computes the
   pact-magic line unconditionally, not gated on regular spell slots being non-empty. Re-verified at all three
   tiers — see the results-table update above.
3. **MEDIUM — FIXED (2026-09-06, `25482eb`).** `add_condition` with no explicit `level` silently clears an existing
   leveled condition instead of adding one. Found by W4b, whose prompt (deliberately mechanical, per §3.3) never
   specified a level — realistic phrasing for a condition that isn't Exhaustion, where level doesn't apply.
   Reproduced twice independently: applying condition id 4 (Exhaustion) with `level: 3` persists correctly;
   immediately calling `add_condition` again with the *same id and no level* wipes the condition from the character
   entirely (empty `conditions[]`), rather than adding it at a default level or leaving the existing level untouched.
   `addCondition` ([character.ts:1234](../../src/tools/character.ts#L1234)) sent `level: params.level ?? null`
   unconditionally — D&D Beyond's API treats a bare `null` level on a leveled condition as "remove," not
   "default." **Fix (applied):** defaults to level 1 for a leveled condition (currently only Exhaustion, id 4) when
   the caller omits `level`; non-leveled conditions still forward `null` unchanged, live-verified against Blinded
   (id 1). Re-verified at all three tiers — see the results-table update above.
4. **LOW — two fixture/prompt mismatches produced INCONCLUSIVE results (W1a, W2a) rather than real signal.** F1
   is a Fighter (per the fixture catalog's own spec — no specific build required for item 5/6/13 tests), so "I
   cast Fireball" has no spell to attach to; F2's auto-resolved spell picks (§3.1 P3: "first-available, repeatable
   option") didn't happen to include Hex. Both subjects handled the mismatch correctly (refused to fabricate) —
   this is a test-authoring gap, not a product defect. If item 5's naturalistic cast-and-spend path needs
   re-verification, re-run against a fixture/spell pairing the sheet actually supports.
5. **Not a defect — MCP server process staleness, transient and resolved.** See the callout above the results
   table. Recorded here so a future session recognizes the symptom (old canned deprecation text reappearing) as
   "restart the server," not "the fix regressed."
6. **Not a defect, informational — AC read 13 then 12 across three consecutive `get_character` calls on F2 with
   no equipment change in between** (W3a). Leather stayed equipped (`armorClass: 11`, DEX +2, expected AC 13
   consistently) — unexplained by anything this session touched. Out of scope for v0.8.0 (this is item 2 / v0.9.0
   territory), not investigated further; flagged for whoever picks up PR 8.
