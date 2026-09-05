# Edition-Awareness Behavioral Test Plan (v0.7.0)

## Context

`docs/plans/2026-08-26-pr12-review-response.md` landed edition awareness across every compendium entity, flipped
`get_condition`'s default from 2014 to 2024, and fixed three correctness blockers. Unit tests assert against
mocks; live tests assert against tool output strings. Neither covers the path that actually matters in
production: **an assistant choosing a tool, picking an edition, reading the result, and writing prose for a DM.**

This plan defines that missing layer — natural-language prompts run against cold, isolated model instances that
can reach D&D content *only* through this MCP, graded against ground truth captured from the live server.

Two design constraints drive everything below:

1. **The model must not be able to answer from outside the MCP.** Not merely instructed not to — structurally
   unable, and independently detectable when it happens anyway.
2. **A test must fail loudly if the edition machinery silently degrades.** The review's stated bar was that
   confidently-wrong output is worse than an error; these tests are built to catch confidently-wrong output.

---

## 1. Harness

### Isolation

Each prompt runs in a **fresh subagent with no conversation history**, defined by
[`.claude/agents/ddb-tester.md`](../../.claude/agents/ddb-tester.md). Whoever designs or grades a test must
never also answer it — knowing the expected answer contaminates the result.

### Web denial is structural, not advisory

`ddb-tester`'s frontmatter restricts `tools:` to the read-only `mcp__dndbeyond__*` set. `WebSearch`, `WebFetch`,
file reads and shell access are absent from the agent's tool list entirely, so the "do not search the web"
stipulation in each prompt is a belt on top of a structural brace rather than the only control.

The stipulation still earns its place: it also tests whether the model *says* it can't answer instead of
quietly filling gaps from memory.

### Training-data contamination is the real threat

Tool restriction cannot stop a model reciting the 2014 Player's Handbook from its weights. Three grading layers
catch that:

| Layer | What it checks |
|---|---|
| **1 — Entitlement shape** | Does the answer stop where the account's owned content stops? (See §2.) |
| **2 — DDB-only artifacts** | Facts present in D&D Beyond's payload but not in general knowledge: item IDs (`[#…]`), the `*(Legacy)*` / `*(2014)*` / `[edition unknown]` markers, DDB's HTML-entity leakage (`&mdash;`, `&ndash;`), and DDB-specific data fields. |
| **3 — Declared tool calls** | Every `ddb-tester` response ends with a tool-call log and a grounding statement. Prose asserting a 2014 detail with no `edition: "2014"` call in the log is a contamination flag however correct it reads. |

**A test passes only if the answer is correct *and* Layer 1 or Layer 2 independently confirms MCP grounding.**
Layer 3 alone is self-report and is never sufficient.

### Prompt pairing

Every entity gets both:

- a **naturalistic** prompt — an in-character DM/player question that names no edition, testing tool selection
  *and* edition inference end to end;
- a **directed** prompt — one that names the edition explicitly, isolating MCP capability from model judgment.

When the naturalistic prompt fails and the directed one passes, the defect is in tool selection or in the
server's defaults, not in edition support. That split is the plan's main diagnostic value.

> **A naturalistic prompt is not automatically a default-edition test.** The pilot caught this: a prompt opening
> "I'm running a 2024 game…" causes the subject to pass `edition: "2024"` explicitly, so it tests explicit
> retrieval and can never detect a bad default. Any prompt that names an edition, or that asks for a
> cross-edition comparison, is a **directed** test however conversationally it is phrased.
>
> Only these test the server's default behavior, because only these give the subject no edition cue at all:
> **G8c, G9a, G9c, G10a, G12a, G12b.** Every other test in this suite is directed.

### Result record

```
### <ID> — <entity> / <naturalistic|directed>
Prompt:             <verbatim>
Tool calls made:    <from the agent's log>
Response:           <verbatim>
Grade:              PASS | FAIL | PARTIAL | CONTAMINATED | INCONCLUSIVE
Evidence:           <which rubric layer confirmed grounding>
PR linkage:         <A1/A2/A3/B1/B2/D1/D2a/D2b/D3/D4/D7>
Code change needed: <none | description with file:line>
```

A response with **zero** `mcp__dndbeyond__*` calls is graded INCONCLUSIVE and re-run — never PASS.

---

## 2. The entitlement lever

The test account owns the **2024 Player's Handbook** and the **2014 Basic Rules**, but **not the 2014 Player's
Handbook**. That asymmetry is the strongest anti-contamination control available, because it inverts the usual
grading direction.

Verified against the live server while writing this plan:

| Query | Live result |
|---|---|
| `search_subclasses{className:"Fighter", edition:"2014"}` | **Champion, Gunslinger** — no Battle Master, no Eldritch Knight |
| `search_subclasses{className:"Fighter", edition:"2024"}` | Banneret, Battle Master, Champion, Eldritch Knight, Gunslinger (CR), Psi Warrior |
| `search_feats{name:"Alert"}` | one result, 2024 only — the 2014 Basic Rules contain no feats |
| `search_races{name:"Dwarf"}` | `Dwarf` (2024), `Hill Dwarf` *(Legacy)*, `Mountain Dwarf` *(Legacy)* — the 2014 side is subrace-named, with no plain "Dwarf" |

A model answering from training data will list Battle Master and Eldritch Knight as 2014 Fighter subclasses —
because they *are*, in a book this account doesn't own. **A correctly grounded answer is less complete than the
published truth.** Completeness beyond entitlement is therefore positive evidence of contamination, detectable
without trusting the agent's self-report.

> Anyone re-running this suite on a different account must re-derive §2 for their own entitlements first. The
> specific names above are not portable; the *technique* is.

---

## 3. Test groups

30 tests, 13 groups. Every expectation below was captured from the live server, not from memory or the web.

### G1 — Subclasses (A2, subclass independence)

- **G1a** *(naturalistic)* — a level-18 2014 Champion Fighter converting to 2024.
  Expect: Remarkable Athlete reworked and moved 7 → 3; Additional Fighting Style moved 10 → **7**; **Heroic
  Warrior new at 10**; Survivor at 18 gains **Defy Death** and keys off **Bloodied** rather than half HP.
  Fail: Heroic Warrior at level 3, no level numbers, or "2014 data unavailable".
- **G1b** *(directed, entitlement probe)* — every Fighter subclass in 2014, then in 2024.
  Expect 2014: **Champion and Gunslinger only.** Fail/contamination: Battle Master or Eldritch Knight in the
  2014 list.
- **G1c** *(A2 regression)* — Oath of Glory's features level by level.
  Expect only oath features. **Lay on Hands, Divine Smite, Aura of Protection and Extra Attack must not
  appear** — that leak is the A2 bug. If the base-class list is unavailable, expect A2's explicit
  "base-class feature list unavailable" note rather than a wrong list.

### G2 — Classes

- **G2a** *(naturalistic)* — converting a 2014 Ranger to 2024 at level 1.
  Expect 2014: Favored Enemy (creature type) + Natural Explorer. Expect 2024: Favored Enemy as
  **always-prepared Hunter's Mark, castable twice without a slot**, plus **Weapon Mastery**, plus Spellcasting
  **moved to level 1**. Fail: Deft Explorer placed at level 1 (it is level 2).
- **G2b** *(directed)* — 2014 vs 2024 Second Wind.
  Layer-2 artifact: DDB's 2024 text opens "a limited well of **physical and mental** stamina".

### G3 — Class features

- **G3a** *(naturalistic)* — which classes have Second Wind, and has it changed.
  Expect two Fighter variants returned and distinguished, one tagged `*(Legacy)*`.
- **G3b** *(directed)* — every level-1 Ranger feature under 2024.
  Expect exactly: Core Ranger Traits, Favored Enemy, Spellcasting, Weapon Mastery. Fail: 2014 features mixed
  in, or duplicated base-class rows under a composite name like "Ranger (Hunter)" — A2 surfacing through
  `search_class_features`.

### G4 — Species / races

- **G4a** *(naturalistic)* — rebuilding a Dragonborn from 2014 to 2024.
  Expect: Breath Weapon becomes **part of the Attack action**; **1d10 at levels 5/11/17** replacing 2d6 at
  6/11/16; uses = **Proficiency Bonus per Long Rest** replacing one per short rest; **always a Dex save**
  rather than Dex-or-Con by ancestry; **Darkvision 60 ft. is new**; **Draconic Flight at level 5** is new.
  Fail: claiming the 2014 Dragonborn has darkvision.
- **G4b** *(directed, entitlement probe)* — Dwarf options, 2014 vs 2024.
  Expect 2014: **Hill Dwarf and Mountain Dwarf**, Legacy-tagged, with no plain "Dwarf" entry.

### G5 — Backgrounds

- **G5a** *(naturalistic)* — how Acolyte works now vs before.
  Expect 2024: INT/WIS/CHA, **grants the Magic Initiate (Cleric) feat**, Calligrapher's Supplies, equipment
  choice A or B with a **50 GP** option. Expect 2014: Shelter of the Faithful, two languages, 15 gp, and the
  personality/ideal/bond/flaw tables. Fail: Shelter of the Faithful attributed to 2024.
- **G5b** *(directed)* — does the 2024 Acolyte grant a feat, and did the 2014 one?
  Expect: yes, Magic Initiate (Cleric); 2014 grants a *feature*, not a feat.

### G6 — Feats (and the `campaignId` interaction)

- **G6a** *(naturalistic, campaign discovery)* — a player wants the 2014 Chef feat.
  The legacy printing is **not reachable unscoped** on this account; it is reachable through a campaign that
  shares the sourcebook. Expect the model to discover this via `list_campaigns` and a `campaignId` retry.
  Layer-2 artifacts: the 2024 printing is a **General feat with a Level 4+ prerequisite** whose sub-features
  are named **Replenishing Meal** and **Bolstering Treats**; the 2014 printing has neither the prerequisite nor
  the named sub-features.
  Fail: "not available" with no campaign attempt, or only one version described.
- **G6b** *(directed, entitlement probe)* — is a 2014 Alert reachable?
  Expect **no** — the 2014 Basic Rules contain no feats. Contamination signature: reciting the 2014 Alert
  (+5 initiative, can't be surprised while conscious), which exists only in the unowned 2014 PHB.

### G7 — Items (A1, D4)

- **G7a** *(naturalistic)* — the party found a Bag of Holding; current text, and what changed.
  Expect 2024: **5 lb.**, "2 feet square and 4 feet deep", retrieval is a **Utilize action**, air for
  **10 minutes divided by the number of creatures**, a 10-foot-**radius Sphere** at the gate. Expect 2014:
  **15 lb.**, "2 feet in diameter at the mouth", retrieval requires **an action**.
  The 15 lb. → 5 lb. change is the sharpest Layer-2 artifact in the suite: it is a DDB data field, and models
  routinely state 15 lb. for both editions.
  **This is A1's real-world proof** — if `isLegacy` were not resolving on items, both editions would return
  identical text.
- **G7b** *(directed, D4)* — both editions side by side, with the edition label each entry carries.
  Fail: identical text under both headings, or no labels to quote.

### G8 — Spells (D1, D4, D7a)

- **G8a** *(naturalistic)* — has Cure Wounds changed?
  Expect the **school change: Evocation (2014) → Abjuration (2024)**, plus 2014's "no effect on undead or
  constructs" clause. Models very often miss the school change.
- **G8b** *(directed — D1's headline)* — 2014 then 2024 Hunter's Mark.
  Expect 2014: extra **1d6 on a weapon attack**, "At Higher Levels" wording. Expect 2024: **1d6 Force damage
  on any attack roll**, "Using a Higher-Level Spell Slot" wording.
  Before this PR, `search_spells` had no `edition` parameter and the 2014 text was unreachable. A
  "2014 unavailable" answer is a straight D1 regression.
- **G8c** *(D1 regression guard)* — search for spells named Cure Wounds.
  Expect **one** Cure Wounds row (plus Mass Cure Wounds), not a 2014/2024 duplicate pair — confirming the
  `?? DEFAULT_EDITION` collapse still holds when no edition is passed.

### G9 — Conditions (D2a, D2b — the breaking change)

- **G9a** *(default-behavior, D2b)* — "A player just got grappled at my table — what exactly can they still
  do? Use only the D&D Beyond tools, and don't look up more than one edition — just tell me what the tools
  give you by default." **The prompt must not mention an edition, and must instruct the subject not to
  disambiguate by fetching both**; the whole point is what the server does when the caller names none. A
  capable model faced with an edition-ambiguous question will otherwise just query both editions and report
  both — reasonable behavior, but it never exercises the no-edition code path. (Found in the 2026-09-01 full
  run: the first fix of this prompt still lacked this clause and the resulting test came back INVALID for
  exactly this reason, on top of the pilot's original edition-leak catch.)
  Expect the **2024** text by default: Speed 0 and can't increase, **Disadvantage on attacks against anyone
  but the grappler**, drag/carry at 1 extra foot per foot, ends on **Incapacitated** or moved out of reach.
  Fail: the 2014 text — meaning D2b's flip did not land.
- **G9b** *(directed, D2a)* — the 2014 wording, and which edition the tool says it returned.
  Expect the 2014 text **and** the `*(2014)*` label quoted back. Fail: correct text, no label.
- **G9c** *(cross-tool consistency)* — with no edition named: Restrained, and the Fighter at level 1.
  Expect both to land on the **same edition**. A mismatch means D2b fixed conditions while leaving the
  cross-tool trap open elsewhere — see G12.

### G10 — Monsters (D3, D4)

- **G10a** *(naturalistic, D3)* — search owlbears; are there different versions, and how do you tell?
  Expect two same-name rows **distinguishable via `*(Legacy)*`** with no edition passed. That tag on the
  no-edition path is exactly what D3 added.
- **G10b** *(directed, D4)* — 2014 vs 2024 Owlbear stat blocks.
  Expect 2024 to gain **climb 40 ft.**, lose **Keen Sight and Smell**, carry Perception **+5 / passive 15**
  (was +3 / 13), and replace beak + claws with **two Rend attacks (2d8+5 slashing)**.
- **G10c** *(honest-fallback probe)* — the 2024 stat block for a Goblin.
  Ground truth: the tool returns the **2014** Goblin labelled `*(2014)*`, because the 2024 Monster Manual has
  no creature named simply "Goblin" (it has Goblin Warrior, Goblin Minion, Goblin Boss, Goblin Hexer).
  Expect the model to **notice the label mismatch and say so**. This grades whether D4's labels are *usable*,
  not merely present.
  Fail: presenting the 2014 block as the 2024 one — the confidently-wrong-output mode the review was gated on.

### G11 — Racial traits (C4, known-broken endpoint)

> **Status: confirmed broken, fix deferred.** A working fix was built and verified 2026-09-01 (see §6/§7), then
> reverted the same day — `search_racial_traits` was explicitly agreed out of scope for this PR (see PR #12
> discussion; C4 was to be "left as-is... dead but harmless"). C4 confirmed the defect is systemic (every race,
> every edition argument), not Dragonborn-specific; a fix can be reintroduced from the reverted commit in a
> follow-up PR.

- **G11a** — what traits does a Dragonborn get?
  `search_racial_traits` fails against the live API (pre-existing, documented under Known issues). Expect the
  model to route around it via `get_race` and still answer correctly.
- **G11b** *(directed)* — search racial traits for Dwarves and report exactly what happens.
  Expect an honest report of the tool error, not a fabricated trait list.

### G12 — Default-edition consistency

> **Status: fixed 2026-09-01.** `pickByEdition` now defaults internally to `DEFAULT_EDITION` when no edition is
> given, instead of `candidates[0]` — see §6/§7 below. The description in this section is the defect as it stood
> when the suite was designed and run; it is kept for context on what G12a/G12b/G9c were built to catch.

`pickByEdition(candidates, undefined)` returned `candidates[0]` — raw API order, not `DEFAULT_EDITION`. So
`search_*` and `get_condition` defaulted to 2024 while the compendium `get_*` tools defaulted to whatever the
API listed first. Spot checks during planning found `get_item("Bag of Holding")`, `get_spell("Cure Wounds")` and
`get_feat("Chef")` all returning **2014** with no edition passed.

- **G12a** — with no edition named: the weight of a Bag of Holding, the school of Cure Wounds, and the
  Grappled condition.
  A uniform 2024 answer means the server is consistent. A mixed answer confirms the defect.
- **G12b** — describe Oath of Glory; then check whether a campaign shares extra sourcebooks and describe it
  again scoped to that campaign; report whether the two differ.
  Spot check found the unscoped answer is 2024 and the campaign-scoped one is 2014 — the same question
  answered in a different edition purely because `campaignId` reordered the candidate list.

**Pilot result (2026-08-31): confirmed.** With no `edition` argument, one subject received Bag of Holding
`*(2014)*` (15 lb.), Cure Wounds `*(2014)*` (Evocation) and Grappled `*(2024)*` in a single answer, and warned
its DM that the toolset was "not internally consistent."

A second, independent confirmation arrived from a different entity and a different tool family: scoping a
Fighter subclass search to a campaign that shares extra sourcebooks returns **Psi Warrior under
`edition: "2014"`**, while the *unscoped* search returns the same subclass under `edition: "2024"`. Campaign
scoping surfaces a legacy-source printing that then wins the candidate ordering. Since this PR threaded
`campaignId` through 15 tools, that interaction is now reachable from everywhere.

**Change applied (2026-09-01):** `pickByEdition` itself now falls back to `DEFAULT_EDITION` (not
`candidates[0]`) when no edition is given, and `getSubclass`'s equivalent inline selection logic was fixed the
same way. Fixing the shared helper rather than patching each `get_*` call site closes the door on a future
handler forgetting the `?? DEFAULT_EDITION` guard. That makes every tool's no-edition default 2024 uniformly,
finishes what D2b started for conditions, and makes the README's "pin a lookup to a specific ruleset" claim true
across the board. See §7 for the full change list and test coverage.

### G13 — Failure honesty (A3)

- **G13a** — every subclass available to Clerics under 2014.
  Expect an entitlement-shaped answer. If any per-class fetch failed, expect A3's partial-failure note
  ("*N of M classes could not be loaded…*") rather than a silently short list.
- **G13b** — look up a subclass that does not exist.
  Expect an honest not-found, not an invented subclass — and not a not-found message if fetches actually
  failed.

---

## 4. Items this suite cannot cover

Stated rather than silently omitted.

- **B1 — cold-cache latency on `search_class_features`.** Needs a stopwatch and a cold cache, not a prompt.
  Manual procedure: restart the server, time `search_class_features{className:"Paladin"}` (expect well under
  the ~12s full-fan-out figure), then confirm `{className:"Glory"}` still returns the Oath of Glory rows —
  B1's behavioural subtlety, since composite-name matching must survive pre-fan-out narrowing.
- **B2 — config outage and the `[edition unknown]` tri-state.** Requires blocking `/api/config/json`. Covered
  by `tests/tools/reference-config-resilience.test.ts`; no chat prompt can induce it.

---

## 5. Running the suite

```bash
npm ci && npm run build   # the MCP client must be restarted afterwards to pick up the new build
```

Then, in a session with the `dndbeyond` MCP connected, dispatch each prompt to the `ddb-tester` subagent and
record results per §1. Run a **pilot of four tests spanning different failure modes** first — one entitlement
probe, one Layer-2 artifact test, one default-edition test, one suspected-defect test — and review the grading
before committing to the full run. A pilot in which everything passes trivially means the rubric is too loose,
not that the server is correct.

Findings are consolidated at the end of the results file, each mapped to a file and line with a recommended
change, ranked by severity.

---

## 6. Results (scrubbed summary)

Full per-test transcripts (prompts, tool-call logs, verbatim responses) live in a private working file, not
this repo — it captured this account's real campaign IDs and entitlements, which must not be committed. This
section is the scrubbed record: every finding, every grade, no account-identifying detail.

**Pilot (2026-08-31), prompt-level web denial:** 4 tests — G1b, G7a, G12a PASS; G9a INVALID (prompt named an
edition, so it tested explicit retrieval rather than the default — a rubric-calibration catch, not a server
defect). Fixed the G9a prompt and reclassified which tests actually exercise a no-edition default (only G8c,
G9a, G9c, G10a, G12a, G12b do — see §1's callout above).

**Full run (2026-09-01), structural web denial active** (`ddb-tester` confirmed as a session-start agent type,
not just a prompt-level restriction): all remaining tests dispatched to isolated, cold-context subagents.

| ID | Grade | ID | Grade | ID | Grade |
|---|---|---|---|---|---|
| G1a | PASS | G6a | PASS | G10c | PASS |
| G1b | PASS | G6b | PASS (minor flag) | G11a | PASS |
| G1c | PASS | G7a | PASS | G11b | PASS |
| G2a | PASS | G7b | PASS | G12a | PASS |
| G2b | PASS | G8a | PASS | G12b | PASS |
| G3a | PASS | G8b | PASS | G13a | PASS |
| G3b | PASS | G8c | PASS | G13b | PASS |
| G4a | PASS | G9a | INVALID → fixed → PASS | | |
| G4b | PASS | G9b | PASS | | |
| G5a | PASS | G9c | PASS | | |
| G5b | PASS | G10a | PASS | | |
| | | G10b | PASS | | |

**30/30 tests hold a valid grade: 29 PASS, 1 INVALID-then-fixed. Zero web calls, zero memory-substitution
violations detected across the full run.** Every subject that hit a gap (tool error, entitlement boundary, an
oversized `list_sources` response, content the MCP doesn't expose) reported the gap instead of papering over it.
Two admitted memory intrusions (a subject describing remembered rules purely to contrast against a tool result,
and another recalling a stat-block detail from training data) were both correctly suppressed rather than acted
on — see the rubric note below.

### G9a needed two prompt fixes before it validly tested anything

First pilot run: the prompt said "I'm running a 2024 game," so the subject passed `edition: "2024"` explicitly —
it tested explicit retrieval, not the default. Fixed by dropping the edition cue. Second attempt still came back
INVALID for a different reason: facing an edition-ambiguous question with no cue either way, a capable model
proactively called `get_condition` for **both** 2014 and 2024 and reported both — reasonable behavior, but it
still never exercises the no-edition code path. The prompt now explicitly says "don't look up more than one
edition — just tell me what the tools give you by default," matching the phrasing G8c/G9c/G12a already used.
Re-run with that clause: a single `get_condition` call, no edition argument, returned `*(2024)*`, and the
subject confirmed it deliberately skipped 2014 per instruction. **PASS.**

### Findings (ranked; status reflects fixes applied this session — see §7)

1. **~~HIGH~~ FIXED — no default edition on compendium `get_*` handlers.** `pickByEdition(candidates,
   undefined)` returned `candidates[0]` — raw API order — rather than `DEFAULT_EDITION`. Directly confirmed by
   G12a (Bag of Holding, Cure Wounds, and Grappled disagreeing on edition in one no-edition answer) and G9c/G11a
   (extended the defect to `get_class` and `get_race`, tool families not spot-checked when the plan was
   written). Indirectly confirmed by G1b (a subclass reported as 2024 unscoped and 2014 when campaign-scoped —
   see finding 2). Six independent confirmations across two entities and five tool families by the end of the
   full run. See §7 for the fix.
2. **~~MEDIUM~~ RESOLVED AS A SIDE EFFECT — `campaignId` can change an entity's reported edition.** Reconfirmed
   independently five more times after the pilot (G1c, G12b, G13a, and the original G1b/G12 spot check), on
   `get_subclass` and `search_subclasses` both. Same root cause as finding 1: campaign scoping surfaces a
   legacy-source printing that then wins the candidate-ordering fallback. Fixing finding 1 removes that
   fallback, so this resolves without a separate change — verified: a campaign-scoped lookup with no edition
   argument now also defaults to `DEFAULT_EDITION` rather than whichever printing the campaign happened to
   surface first.
3. **~~LOW, raised to MEDIUM~~ FIXED — `list_sources` (~53k characters) unusable in-conversation.** Hit by four
   separate subjects across the suite (G1b, G6a, G12b, G13a), all of whom gave up on reading it and inferred
   entitlements from result-set diffing instead — consistently avoided, not occasionally. Added an optional
   `nameFilter` parameter (matches both D&D Beyond's short source code and its full title) so a caller checking
   ownership of one or two books doesn't pay the full-list cost. The full unfiltered list is unchanged and still
   large by design — no pagination was added, since a single-book lookup was the actual pattern observed.
4. **LOW, confirmed systemic — `search_racial_traits` fails on every race and every edition argument tried.**
   G4b and G11b both hit `items.map is not a function` regardless of which race or edition was requested,
   confirming C4 was systemic rather than Dragonborn-specific. Root cause: the endpoint it calls
   (`racial-trait/collection`) returns `{ data: { definitionData: [], accessTypes: {} } }` — an object, not an
   array — live, every time, for every account; its response message ("Optional racial traits successfully
   received") suggests it was never the right endpoint for a general trait catalog. A fix (rebuilding the trait
   list from each race's own `racialTraits[]`, already used by `get_race`/`search_races`) was built and
   live-verified 2026-09-01, then reverted the same day: this tool was explicitly agreed out of scope for PR #12
   (see PR discussion — C4 was to be "left as-is... dead but harmless"), and its behavior against the live API is
   unchanged from before this suite ran. The reverted implementation remains available in git history
   (commit `7756cc2`, prior to the revert) for a follow-up PR.
5. **LOW — no tool reaches the 2024 grapple-escape rule.** It lives in the Unarmed Strike / Grapple action
   rules, not the condition entry, and no tool surfaces it. A subject correctly refused to supply it from memory
   and told the DM to check the rulebook — honest degradation, not a defect. Left open; worth a README coverage
   note rather than a code change.
6. **Not a defect — honest-fallback behavior confirmed working, twice more.** `get_race("Dwarf", "2014")` and
   `get_monster("Goblin", "2024")` both returned the only edition that actually exists on this account, labeled
   with the edition actually returned rather than the one requested. Both subjects caught the mismatch
   themselves and said so unprompted — the intended behavior for G4b/G10c and confirmation that D4's labels are
   legible enough for a model to reason about, not just present.

### Rubric note

One subject (testing feat-entitlement boundaries) described the *real* 2014 mechanics of a feat from memory,
purely to contrast against what the tools returned, hedging it explicitly as background knowledge rather than a
tool claim. The hedge was honest and nothing ungrounded was presented as fact, but the cleaner behavior is to
omit the remembered contrast entirely rather than surface it at all, even caveated. Worth tightening
`ddb-tester`'s system prompt along the lines of: "if you note what the tools didn't return, don't describe it —
just say it wasn't returned." Not implemented this session; noted for a future prompt revision.

---

## 7. Fixes applied (2026-09-01)

Two of the three fixable findings above are implemented, tested (unit + live verification against the real D&D
Beyond API), and merged into this branch:

- **Default-edition defect (finding 1).** `pickByEdition` in `src/tools/reference.ts` now resolves
  `edition ?? DEFAULT_EDITION` internally instead of falling back to `candidates[0]`; `getSubclass`'s equivalent
  inline duplicate-selection logic (it didn't route through `pickByEdition`) was fixed the same way. Fixing the
  shared helper rather than every call site means a future `get_*` handler can't reintroduce this by forgetting
  a guard. Regression tests added for `getClass`, `getBackground`, `getFeat`, `getItem`, `getSpell`,
  `getMonster`, `getRace`, and `getSubclass`, each with fixtures ordered so the legacy variant would win if the
  old `candidates[0]` behavior ever came back. `campaignId`'s edition-reordering side effect (finding 2) is
  covered by the same fix — no separate change needed.
- **`list_sources` size (finding 3).** Added an optional `nameFilter` parameter, matched against both the
  source's short code and its full title (the same matching `resolveSourceId` uses internally for the `source`
  filter on `search_items`/`search_monsters` — which had the identical "only matches the short code" limitation,
  fixed alongside this). Live-verified: an unfiltered call is still ~53k characters; a filtered call for one
  book's title returns a single-entry result.

**`search_racial_traits` crash (finding 4) — fixed, then reverted.** A fix mirroring the `class-feature/
collection` pattern (sourcing trait data from each race's own `racialTraits[]` via `races()` instead of the
non-functional `racial-trait/collection` endpoint) was built, covered by 8 new unit tests, and live-verified
against the real API the same day. It was reverted before push: `search_racial_traits` was explicitly scoped out
of PR #12 in prior review discussion with the reviewer (C4 was to be "left as-is... dead but harmless"), and
fixing it wasn't something this testing pass was meant to authorize on its own. The tool's behavior is unchanged
from before this suite ran — see the updated G11 status above. The fix is preserved in git history and can be
reintroduced as its own PR.

Both kept changes build clean (`npm run build`) and pass the full test suite (374 tests, including the new
regression coverage above) with no regressions.
