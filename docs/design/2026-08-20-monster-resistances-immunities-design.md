# Surface Damage/Condition Resistances in `getMonster()` — Design Spec

> Date: 2026-08-20
> Status: Draft

## Overview

`getMonster()` (`src/tools/reference.ts`) already fetches every field needed to render a monster's damage resistances, damage immunities, damage vulnerabilities, and condition immunities — but its formatter never emits them. Consumers (e.g. the `dndtools` combat tracker's stat-block lookup) get a stat block missing this data entirely, even though a live D&D Beyond page always shows it.

This was root-caused by inspecting live API responses (not guessed): `DdbMonster.damageAdjustments: number[]` holds IDs into `config.damageAdjustments`, a lookup table where each entry has `{ id, name, type }` and `type` is `1` = Resistance, `2` = Immunity, `3` = Vulnerability. Verified against three monsters with well-known stat blocks:

| Monster | Decoded `damageAdjustments` | Matches real stat block? |
|---|---|---|
| Skeleton | Poison (type 2) + Bludgeoning (type 3) | ✅ "Immune to poison, vulnerable to bludgeoning" |
| Zombie | Poison (type 2) | ✅ "Immune to poison" |
| Fire Elemental | nonmagical B/P/S (type 1) + Poison (type 2) + Fire (type 2) | ✅ "Resistant to nonmagical B/P/S, immune to fire and poison" |

Condition immunities are simpler: `DdbMonster.conditionImmunitiesHtml` is already clean, ready-to-strip HTML (the same shape as the already-used `skillsHtml`/`sensesHtml`), just never read.

## Scope

In scope: adding the four missing lines to `getMonster()`'s output, for this repo (`dndbeyond-mcp`) only.

Out of scope (deliberately, per a separate conversation): reformatting the rendered stat-block panel in the `dndtools` combat tracker (fonts, layout, "boxed" look) — that's downstream CSS/rendering work in a different repo, tracked separately.

## Design

### 1. `GameConfig` interface

Add the new lookup table's shape, mirroring the existing `damageTypes`/`senses` entries in the same interface (`src/tools/reference.ts`, near the top):

```ts
interface GameConfig {
  challengeRatings: Array<{ id: number; value: number; xp: number; proficiencyBonus: number }>;
  monsterTypes: Array<{ id: number; name: string }>;
  environments: Array<{ id: number; name: string }>;
  alignments: Array<{ id: number; name: string }>;
  damageTypes: Array<{ id: number; name: string }>;
  senses: Array<{ id: number; name: string }>;
  sources?: Array<{ id: number; name: string }>;
  damageAdjustments: Array<{ id: number; name: string; type: number }>;
}
```

No new API call — `getGameConfig()` already fetches the full config object (cached 24h), `damageAdjustments` is just an unread key on the same response.

### 2. `getMonster()` formatter

Insert after the existing **Skills** line and before **Senses** (matching canonical 5e stat-block field order: Saving Throws → Skills → Vulnerabilities → Resistances → Immunities → Condition Immunities → Senses → Languages → Challenge):

- Build a `Map<id, {name, type}>` from `config.damageAdjustments`.
- Walk `m.damageAdjustments`, group resolved names by `type` (1/2/3). An id with no match in the map is silently skipped (defensive — matches how the rest of the formatter already treats unresolvable config lookups, e.g. `typeMap.get(m.typeId) ?? "Unknown"` rather than throwing).
- Emit, only when that group is non-empty:
  - `**Damage Vulnerabilities** <names joined with ", ">` (type 3)
  - `**Damage Resistances** <names>` (type 1)
  - `**Damage Immunities** <names>` (type 2)
- Emit `**Condition Immunities** <stripHtml(m.conditionImmunitiesHtml)>` when `m.conditionImmunitiesHtml` is present and non-empty — same `stripHtml()` helper already used for `skillsHtml`.
- A monster with no adjustments at all (e.g. a plain Goblin) gets none of these four lines, same as how `savingThrows`/`languageDescription` are already omitted when empty.

### 3. Tests

Extend `tests/tools/reference-monsters.test.ts`:

- Add `damageAdjustments: [{ id: 1, name: "Fire", type: 1 }, { id: 2, name: "Poison", type: 2 }, { id: 3, name: "Bludgeoning", type: 3 }]` (a minimal one-of-each-type fixture) to `MOCK_CONFIG`.
- Add a new test monster fixture (a copy of `MOCK_MONSTER` with `damageAdjustments: [1, 2, 3]` and a representative `conditionImmunitiesHtml` string) and assert the resulting text contains all four correctly-labeled lines in the right order.
- Assert the existing bare-`MOCK_MONSTER` case (`damageAdjustments: []`, no `conditionImmunitiesHtml`) still produces none of the four lines — a regression guard proving the omit-when-empty behavior isn't broken by this change.

## Testing

`npm test` (Vitest) in the `dndbeyond-mcp` repo. No live-API test changes needed (`test:live` config untouched) — this is pure formatter logic over already-typed mock data.

## Out of scope

- Reformatting the combat tracker's rendered stat-block panel in `dndtools` (separate repo, separate future design pass).
- Any other undecoded `DdbMonster` fields (e.g. `swarm`, `tags`) — not requested, no evidence they're missing anything users have asked about.
