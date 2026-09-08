# Fork Comparison: grahamethompson/dndbeyond-mcp vs. SQLGuyJPS/dndbeyond-mcp

**Date:** 2026-09-05
**Compared:** `graham/main` (https://github.com/grahamethompson/dndbeyond-mcp) vs. `origin/main` (this fork)
**Common ancestor:** `61d6f3c` (an early snapshot of the original `dmjohnston89/dndbeyond-mcp` base)

## Method

Both forks diverged from the same upstream commit and have since gone in almost entirely different directions with very little file overlap:

| Focus area | This fork (origin) | grahamethompson's fork |
|---|---|---|
| Edition-awareness (2014/2024) for reference lookups (classes, races, backgrounds, feats, spells, monsters, subclasses) | ✅ Extensive (`src/tools/reference.ts`, +1770 lines of changes) | Minimal |
| `campaignId` support across reference tools | ✅ Yes | Partial (spells/items/feats only) |
| Monster resistances/immunities, saving throws | ✅ Yes | No |
| Compendium snapshot downloader (`src/compendium/`) | ✅ Yes | No |
| **Character sheet data accuracy** (AC, HP, ability scores, spells, proficiencies, speed, senses) | ⚠️ Largely unchanged from upstream, several known-wrong formulas | ✅ Extensive rewrite with real bug fixes |
| **Character write endpoints** (spell slots, death saves, currency, pact magic) | ❌ Explicitly disabled — code comments say "deprecated (404)" | ✅ Fixed to use corrected endpoint paths/payloads |
| `list_characters` / character-by-name lookup | Iterates every campaign's character list (misses characters with no campaign) | Uses the user's owned-character list endpoint (includes campaign-less characters) |

Only 12 files were touched by **both** forks since the common ancestor (mostly `reference.ts`, `endpoints.ts`, `server.ts`, `campaign.ts`, `types/*`), so most of what follows can be pulled into this fork with low merge-conflict risk — the character-fix files graham touched (`character.ts`, `character-calculations.ts`, `character-spells.ts`, `character-spell-slots.ts`, `character-inventory.ts`, `resources/character.ts`, `types/api.ts`) are files **this fork never modified**.

---

## Enhancements/fixes graham's fork has that this fork lacks

### 1. `calculateMaxHp` ignores Constitution modifier — likely wrong for every character above level 1 ⭐ high priority
- **This fork:** `calculateMaxHp` = `baseHitPoints + bonusHitPoints` (or override). It never adds a CON modifier.
- **Graham's fork:** adds `constitutionModifier * level`, plus flat/per-level HP modifiers from feats/items (`hit-points`, `hit-points-per-level` subtypes), because character-service v5's `baseHitPoints` is pre-CON.
- **Impact:** Any character with a CON modifier ≠ 0 gets a wrong max HP from `get_character`, which cascades into HP percentage/status displays.
- **Recommendation: Pull in.** This looks like a straightforward, well-reasoned bug fix. Verify against a couple of live characters with non-zero CON mod before merging, but the logic (and comment explaining *why* character-service returns pre-CON `baseHitPoints`) is credible and should be easy to validate.

### 2. `calculateAc` — shield/armor detection, natural armor, "best of" unarmored formulas ⭐ high priority
- **This fork:** detects shields/armor purely from freeform `itemType`/`filterType` string matching (`.includes("shield")`, `.includes("heavy")`, etc.), and unarmored AC picks exactly one formula (barbarian OR monk OR base) rather than the max of all applicable ones. It doesn't handle "set"-type natural armor (Tortle, Warforged, etc.) or `unarmored-armor-class` "ignores dex"/"max dex" modifiers.
- **Graham's fork:** uses the numeric `armorTypeId` (1/2/3=light/medium/heavy, 4=shield) as the primary signal with string matching as fallback, computes every eligible unarmored formula (base/barbarian/monk/natural-armor) and takes the max — matching how D&D Beyond's sheet actually resolves AC — and correctly separates `armored-armor-class` vs. `unarmored-armor-class` bonuses based on whether armor is worn.
- **Recommendation: Pull in.** This fixes multiple real classes of characters (barbarians/monks with high stats, natural-armor races, anyone whose item data lacks clean `filterType` strings). Low risk since `calculateAc` isn't touched by this fork's edition work.

### 3. Ability score "set" modifiers (Belt of Giant Strength, etc.) not applied
- **This fork:** `computeFinalAbilityScore` sums base + bonus + modifier bonuses only; it never checks for `type: "set"` modifiers, which D&D Beyond uses for items like a Belt of Giant Strength.
- **Graham's fork:** adds a pass that takes `Math.max(score, setValue)` for matching `set` modifiers.
- **Recommendation: Pull in.** Small, self-contained, clearly modeled on a known D&D Beyond mechanic.

### 4. 2024-background + legacy-species double-counted ability score improvements
- **Graham's fork** adds `uses2024BackgroundAbilityScores()` / `computeCharacterAbilityScore()`: when a character uses a 2024 background's ability-score-improvement feat, D&D Beyond's API still leaves the *legacy species'* ASI bonus modifiers in `modifiers.race`, causing double-counting if you naively sum everything. Graham detects the 2024-background case and filters out the stale race ASI bonuses.
- **Recommendation: Pull in, but verify.** This is exactly the kind of hybrid-2014/2024 data quirk this fork already cares a lot about (it's the whole point of the edition-awareness work), so it's a natural fit — but since this fork has done deep edition-specific work elsewhere, double check this heuristic (matching on a feat literally named "Ability Score Improvements" or "`<background>` Ability Score Improvements") doesn't collide with anything already special-cased for 2014 characters. Worth a live test against a hybrid character before merging.

### 5. Character write endpoints are dead code in this fork — spell slots/death saves/currency/pact magic all hard-fail ⭐ highest priority
- **This fork's own code comments say it outright:**
  ```
  // Deprecated v5 endpoints (return 404, kept for reference)
  updateSpellSlots: (id) => `.../character/v5/character/${id}/spell/slots`,
  updateDeathSaves: (id) => `.../character/v5/character/${id}/life/death-saves`,
  updateCurrency: (id) => `.../character/v5/character/${id}/inventory/currency`,
  updatePactMagic: (id) => `.../character/v5/character/${id}/spell/pact-magic`,
  ```
  and the tool handlers catch the resulting 404 and return a canned "temporarily unavailable... D&D Beyond has deprecated the v5 write API" message. This means `update_spell_slots`, `update_death_saves`, `update_currency`, `update_pact_magic`, and `cast_spell`'s slot-consumption path **do not work at all** in this fork today.
- **Graham's fork found the correct current shape:** character ID moves out of the path and into the request body/query, and the field names changed:
  - `updateSpellSlots()` → `POST/PUT .../character/v5/spell/slots` with body `{ characterId, level<N>: used }` (level-indexed field, not `{ level, used }`)
  - `updateDeathSaves()` → `.../character/v5/life/death-saves` with body `{ characterId, failCount, successCount }` (both counts always sent, merged with the character's current values — the old code sent only one field, which may have been silently dropping the other)
  - `updatePactMagic()` → `.../character/v5/spell/pact-magic` with body `{ characterId, level<N>: used }`
  - A new `inventory.setCurrency(denomination)` endpoint (`.../inventory/currency/{copper|silver|electrum|gold|platinum}`) replaces the single dead `updateCurrency(id)`.
- **Recommendation: Pull in — this is the single highest-value fix in graham's fork.** These are currently advertised MCP tools that silently no-op with an apologetic error message. Graham's fix looks internally consistent (matches the pattern already used for the *working* endpoints in this fork, like `updateHp`/`updateLimitedUse`/`setInspiration`, which already moved `characterId` into the body). Recommend porting the endpoint/payload shapes and then live-testing each of the four write tools plus `cast_spell` against a real character before considering it done.

### 6. `long_rest` / `short_rest` use GET with a `?characterId=` query param; graham switched to POST with a real body
- **This fork:** `client.get(ENDPOINTS.character.rest.long(characterId), ...)` — a mutating action performed via GET, manually invalidating the cache and relying on the server to reset everything atomically.
- **Graham's fork:** `client.post(ENDPOINTS.character.rest.long(), { characterId, resetMaxHpModifier, adjustConditionLevel })` and, for short rest, additionally sends `classHitDiceUsed` (each class's current hit-dice-used count, needed so the server knows how many the character can spend).
- **Recommendation: Verify, then likely pull in.** Since this fork doesn't mark these as broken (no 404 comment), the GET-based calls may currently work — D&D Beyond APIs sometimes tolerate GET for state changes. But POST-with-body is the more defensible REST shape and graham's version passes hit-dice state that GET-with-no-body cannot possibly convey correctly for short rest. Confirm live before replacing a possibly-working code path.

### 7. `list_characters` / find-by-name only sees characters that belong to a campaign
- **This fork:** builds the character list by calling `campaign.list()` then `campaign.characters(campaignId)` for every campaign — any character not assigned to a campaign is invisible to `list_characters` and to fuzzy name lookup (used by every other character tool's `characterName` param). The tool description ("List all characters across all campaigns") is accurate to what it does but not to what a user wants.
- **Graham's fork:** calls `ENDPOINTS.character.list(userId)` (the same "owned character" listing endpoint, using `getUserId()` — a helper that already exists in this fork's `auth.ts`) which returns every character the account owns, campaign or not, along with race/class/level summary fields directly (no per-character detail fetch needed, so `list_characters` also gets much cheaper — no N+1 `client.get` per character).
- **Recommendation: Pull in.** This fork already has `getUserId()` (used in `campaign.ts`), so this is a low-effort adoption. It fixes a real usability gap (solo/campaign-less characters) and is a nice performance win (no more fetching full character payloads just to list names).

### 8. Spell merging across all source collections, with per-source casting-mode labels
- **This fork:** `getAllSpells()` concatenates `spells.class/race/background/item/feat`, then the sheet formatter filters to `prepared || alwaysPrepared`. Anything granted by a feat/item/racial trait that D&D Beyond marks `prepared: false` (very common for "at will" or limited-use racial/item spells) is silently dropped from the character sheet.
- **Graham's fork:** `getCharacterSpellEntries()` also folds in `classSpells` (a collection this fork's `DdbCharacter` type doesn't even model yet) and de-duplicates by spell ID while merging `prepared`/`alwaysPrepared`/`usesSpellSlot` flags and recording every source + casting mode (spell slot vs. limited-use vs. at-will) so the sheet can show e.g. `Misty Step [Item; 1/Long Rest]`.
- **Recommendation: Pull in.** This directly fixes spells silently disappearing from character output, which is a correctness bug, not just a formatting nicety. Straightforward to adopt since this fork's `character.ts`/`resources/character.ts` haven't touched spell handling.

### 9. Pact magic normalization for the current (per-level-row) payload shape
- **This fork's type:** `pactMagic?: { level, used, available } | null` — a single object.
- **Live API today (per graham):** returns an *array* of per-level rows with `available` frequently left at `0`, so the real slot count has to be derived from Warlock level (1 slot at level 1, 2 through level 10, 3 through 16, 4 at 17+).
- **Graham's fork:** adds `getPactMagicState()` to normalize both shapes and backfill `available` from computed Warlock slot progression when the API returns zero.
- **Recommendation: Pull in.** If the live API has in fact moved to the array shape, every Warlock's pact magic display and `cast_spell`/`update_pact_magic` write path in this fork is currently broken (the object-shaped access would just get `undefined`/`NaN`). Verify against a live Warlock character first — if this fork's testing shows the object shape still comes back for some accounts, keep both-shape handling as graham did rather than replacing the type outright.

### 10. Saving throws, skills, and spell save DC skip several bonus sources
- **This fork:** saving throws = ability mod + (prof bonus if proficient); skills = ability mod + (prof/expertise bonus); spell save DC = `8 + prof + ability mod`. None of these add generic `saving-throws`/`ability-checks`/`spell-save-dc` modifier-bonus subtypes, or per-class spell-save-DC bonuses (e.g. from feats/items that boost "Warlock spell save DC" specifically), or per-skill modifier bonuses (e.g. Jack of All Trades–style or item bonuses tagged directly to a skill subtype).
- **Graham's fork:** folds in `sumModifierBonuses(modifiers, "saving-throws")` (and per-ability subtype), `sumModifierBonuses(modifiers, "ability-checks")` (and per-skill subtype), and `sumModifierBonuses(modifiers, "spell-save-dc")` plus a `${classSlug}-spell-save-dc` subtype.
- **Recommendation: Pull in.** Same category as the AC/HP fixes — these are additive, backward-compatible (only changes output when such a modifier is actually present), and low risk.

### 11. Custom proficiencies, custom items, and custom item display names ignored entirely
- **This fork's `DdbCharacter` type** has no `customProficiencies`, `customItems`, `characterValues`, or `options` fields, so any custom skill/language a player added by hand, custom homebrew inventory items, or a player's custom display name for a stock item (D&D Beyond lets you rename "Longsword" to "Frostbite") are invisible to every tool.
- **Graham's fork:** adds all four fields to the type, plus `getInventoryDisplayName()`/`formatInventoryItemLabel()` (custom name > definition name), custom-proficiency handling in `formatSkills`/`formatProficiencies` (with D&D Beyond's 1=None/2=Half/3=Proficient/4=Expertise enum), and a "Custom Items" section in the sheet.
- **Recommendation: Pull in, medium priority.** Nice completeness win for any player who has customized their sheet at all (very common), and additive/low-risk to this fork's edition-awareness work.

### 12. Missing derived stats: initiative, passive skills, senses, and per-movement-type speed
- **This fork:** `formatSpeed` hardcodes a 30 ft base walking speed for "most races" and only adds flat/`innate-speed-walking` bonuses — no fly/swim/climb/burrow speeds, and no per-race actual base speed (`race.weightSpeeds`). There's no initiative line, no passive Perception/Insight/Investigation, and no darkvision/blindsight/tremorsense/truesight reporting anywhere in the sheet.
- **Graham's fork:** reads the character's actual race speed data, reports every nonzero movement type, and adds a `formatDerivedStats()` block (initiative, three passive skills, and any nonzero special sense) to the character sheet.
- **Recommendation: Pull in.** These are all things a DM/player would expect on a character sheet and are currently just absent from this fork's output; the race speed fix in particular means a race with a base fly/swim/burrow speed, or any non-30ft base walk speed (many are 25 or 35), currently shows the wrong number.

### 13. Condition ID mapping disagreement — needs verification, don't blindly copy
- **This fork:** `1=Blinded, 2=Charmed, 3=Deafened, 4=Frightened, 5=Grappled, 6=Incapacitated, 7=Invisible, 8=Paralyzed, 9=Petrified, 10=Poisoned, 11=Prone, 12=Restrained, 13=Stunned, 14=Unconscious, 15=Exhaustion`
- **Graham's fork:** `1=Blinded, 2=Charmed, 3=Deafened, 4=Exhaustion, 5=Frightened, 6=Grappled, 7=Incapacitated, 8=Invisible, 9=Paralyzed, 10=Petrified, 11=Poisoned, 12=Prone, 13=Restrained, 14=Stunned, 15=Unconscious`
- Graham moved Exhaustion from ID 15 to ID 4 (alphabetical position) everywhere it's used: `add_condition`/`remove_condition` tool descriptions, the `level` param description, and `CONDITION_NAMES`.
- **Recommendation: Don't pull in blindly — verify against a live `add_condition` call first.** Two independent forks disagreeing on a hardcoded ID table is exactly the situation where one dev's assumption (alphabetical ordering) could be wrong, or D&D Beyond's actual enum could be non-alphabetical (15 conditions with Exhaustion tacked on at the end, as this fork has it, is a plausible real-world API quirk from Exhaustion being added later). This fork's own commit history shows real discipline around live-testing edition/reference assumptions rather than trusting guesses — apply the same standard here: fire `add_condition` with `conditionId: 4` at a live character, see whether the sheet shows Exhaustion or Deafened, and fix whichever table is wrong.

### 14. `DdbLimitedUse.resetType` comment was backwards (and reset-type name tables downstream)
- **This fork's type comment:** `resetType: number; // 1 = Long Rest, 2 = Short Rest`
- **Graham's fork's corrected comment:** `// 1 = Short Rest, 2 = Long Rest, 3 = Dawn, 4 = Other` — and `formatLimitedUseResources` gains a `resetNames` fallback table plus `useProficiencyBonus` handling (some limited-use resources cap at "proficiency bonus per rest" rather than a fixed number) and clamps `remaining` at 0.
- **Recommendation: Pull in, but verify like #13.** This fork's `formatLimitedUseResources` (`src/tools/character.ts:374`) only ever reads `resetTypeDescription` (a string D&D Beyond sends directly) and never branches on the numeric `resetType`, so the stale comment is currently harmless dead documentation, not an active bug — but if any future code (or a merge of graham's `resetNames` fallback) starts trusting that numeric mapping, it needs to use the corrected 1=Short/2=Long/3=Dawn/4=Other ordering. Worth fixing the comment regardless of whether the fallback table is adopted.

### 15. Selected "options" (feat/racial/class choice picks) not surfaced anywhere
- **This fork:** has no concept of `character.options` (D&D Beyond's collection of player-selected choices — e.g. a Fighting Style pick, a Metamagic choice, an Eldritch Invocation) — `search_definitions`/`get_character full` never show these.
- **Graham's fork:** adds `getSelectedOptionGroups()`/`formatSelectedOptions()`, a new "Selected Options" section on the sheet, definitions searchable via `search_definitions`, and folds class-sourced options into `formatClassFeatureNames` so an Eldritch Invocation shows up alongside class features.
- **Recommendation: Pull in, medium priority.** Real, common D&D Beyond data (most classes have at least one "choose one of these" option) that's currently just missing from every character view in this fork.

---

## What NOT to pull in

- **Anything in `src/tools/reference.ts` / `src/api/endpoints.ts` game-data query construction.** This fork's edition-awareness, `campaignId`, and `sharingSetting=3` (broader compendium coverage) work is more advanced than graham's equivalent changes to the same functions — pulling his versions of these functions would be a regression, not an enhancement. Where both forks touch `endpoints.ts` (e.g. the `gameData.*` helpers), keep this fork's versions.
- **`list_characters`/`add_condition`/`remove_condition` tool description wording changes** beyond the substantive fixes above — cosmetic-only rewording isn't worth a merge review by itself; fold description-string cleanup in with whatever functional fix you land, not as a separate change.
- **`package.json`/`package-lock.json`, `LICENSE`, `README.md`, `AGENTS.md`, `ROADMAP.md`, `AUDIT.md`, `MCP_TOOL_TEST_REPORT.md`, and the `docs/api/*.md` files.** These are graham's own project-metadata/branding/documentation for his fork (version numbers, his README rewrite, his own audit/test-report notes). Don't merge the files themselves — but the `docs/api/*.md` files (`character-v5.md`, `spells-and-slots.md`, `inventory-and-customization.md`, `normalization-contract.md`, `response-envelopes.md`) are good source material to *read* while porting the fixes above, since they document the exact API quirks (hybrid 2024 data, pact-magic array shape, custom item names) that motivate each fix.
- **`src/compendium/downloader.ts` deletion / removal of the compendium CLI script.** Graham's fork never had this feature (it branched before or without it), so the diff shows it "missing" relative to this fork — there's nothing to pull in here, and definitely don't delete this fork's compendium downloader to "match" graham's tree.
- **Graham's `0.2.1`/`0.2.2` version bumps and changelog entries.** Versioning is fork-specific; don't import his version number.

---

## Suggested adoption order

1. **Do first (broken-tool fixes, high confidence):** #5 (write-endpoint 404s), #1 (max HP ignores CON), #2 (AC shield/armor/natural-armor detection).
2. **Do next (correctness, low risk, additive):** #8 (spell merging), #9 (pact magic array shape — verify live first), #3 (ability score `set` modifiers), #10 (saving throw/skill/spell-DC bonus sources), #12 (speed/initiative/passives/senses).
3. **Do after, with live verification:** #4 (2024 background ASI double-count), #6 (rest POST vs GET), #13 (condition ID ordering — **live-test before touching**), #14 (resetType comment/fallback — low stakes either way).
4. **Nice-to-have, lower priority:** #7 (owned-character list endpoint — also a perf win), #11 (custom proficiencies/items/display names), #15 (selected options).

For each item pulled in, port the underlying logic/endpoint shape rather than merging graham's commits wholesale — the surrounding code in this fork (edition-awareness, campaign scoping) has diverged enough that a raw `git cherry-pick`/merge will conflict heavily in `character.ts`, `types/character.ts`, and `endpoints.ts`. Recommend one small PR per numbered item above, each with a live test against a real character, consistent with how this fork's existing history (`test(live): ...`, `fix: ... crash`) already operates.
