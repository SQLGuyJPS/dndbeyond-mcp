# Surface Damage/Condition Resistances in getMonster() Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add damage resistances, damage immunities, damage vulnerabilities, and condition immunities to `getMonster()`'s stat-block output — data already fetched from D&D Beyond but currently discarded.

**Architecture:** Single formatter change in `src/tools/reference.ts`'s existing `getMonster()` function. `DdbMonster.damageAdjustments: number[]` is decoded via a new `config.damageAdjustments` lookup table (verified against live API data: `type` 1/2/3 = Resistance/Immunity/Vulnerability). `DdbMonster.conditionImmunitiesHtml` is stripped and emitted the same way `skillsHtml`/`sensesHtml` already are. No new API calls — both fields are already present on responses this function already fetches.

**Tech Stack:** TypeScript, Vitest 3.0 (globals enabled).

## Global Constraints

- `type` in `config.damageAdjustments` entries: `1` = Resistance, `2` = Immunity, `3` = Vulnerability — verified against live Skeleton/Zombie/Fire Elemental data, not assumed.
- Output line order must follow canonical 5e stat-block field order: Saving Throws → Skills → **Damage Vulnerabilities → Damage Resistances → Damage Immunities → Condition Immunities** → Senses → Languages → Challenge. (Note: Vulnerabilities is listed before Resistances/Immunities in the real stat-block convention even though `type` numbering is 1/2/3 for Resistance/Immunity/Vulnerability — the emission order is NOT the same as the numeric `type` order.)
- Every new line is omitted entirely (not printed empty) when its source data is empty — matching the existing pattern for `savingThrows`, `languageDescription`, etc. in the same function.
- An unresolvable `damageAdjustments` id (missing from `config.damageAdjustments`) is skipped silently, not thrown — matching the existing `?? "Unknown"` / lookup-miss tolerance already used elsewhere in this function (e.g. `typeMap.get(m.typeId) ?? "Unknown"`).
- No new API calls: `config.damageAdjustments` must come from the same `getGameConfig(client)` call `getMonster()` already makes (24h-cached `config/json` fetch).

---

### Task 1: Add damage/condition adjustment lines to `getMonster()`

**Files:**
- Modify: `src/tools/reference.ts:13-21` (`GameConfig` interface)
- Modify: `src/tools/reference.ts:710-714` (insert new formatter block after the existing Skills block, before Senses)
- Test: `tests/tools/reference-monsters.test.ts:45-58` (`MOCK_CONFIG`), append new fixtures and tests

**Interfaces:**
- Produces: no new exported functions/types — this is an internal formatting change to the existing `getMonster(client, params)` tool handler. `GameConfig.damageAdjustments: Array<{ id: number; name: string; type: number }>` is the only new (internal, non-exported) shape.

- [ ] **Step 1: Write the failing tests**

In `tests/tools/reference-monsters.test.ts`, add `damageAdjustments` to `MOCK_CONFIG` (currently at lines 45-58):

```ts
const MOCK_CONFIG = {
  challengeRatings: [
    { id: 5, value: 1, xp: 200, proficiencyBonus: 2 },
    { id: 14, value: 10, xp: 5900, proficiencyBonus: 4 },
  ],
  monsterTypes: [
    { id: 6, name: "Dragon" },
    { id: 11, name: "Humanoid" },
  ],
  environments: [{ id: 7, name: "Mountain" }],
  alignments: [{ id: 9, name: "Chaotic Evil" }],
  damageTypes: [{ id: 1, name: "Fire" }],
  senses: [{ id: 2, name: "Darkvision" }],
  damageAdjustments: [
    { id: 1, name: "Fire", type: 1 },
    { id: 2, name: "Poison", type: 2 },
    { id: 3, name: "Bludgeoning", type: 3 },
  ],
};
```

Immediately after the existing `MOCK_MONSTER` object (currently ending at line 106 with `};`), add a second fixture that has adjustments set (everything else copied from `MOCK_MONSTER`):

```ts
const MOCK_MONSTER_WITH_ADJUSTMENTS = {
  ...MOCK_MONSTER,
  id: 17101,
  name: "Ochre Jelly",
  damageAdjustments: [1, 2, 3],
  conditionImmunitiesHtml: "<a>Prone</a>, <a>Poisoned</a>",
};
```

Inside the existing `describe("getMonster", ...)` block (currently lines 311-355), append two new tests, right before its closing `});`:

```ts
  it("shouldIncludeDamageAndConditionAdjustmentsWhenPresent", async () => {
    const mockClient = createRoutingMockClient([
      {
        accessType: { "17101": 1 },
        pagination: { take: 5, skip: 0, currentPage: 1, pages: 1, total: 1 },
        data: [MOCK_MONSTER_WITH_ADJUSTMENTS],
      },
      { accessType: 1, data: MOCK_MONSTER_WITH_ADJUSTMENTS },
    ]);

    const result = await getMonster(mockClient, { monsterName: "Ochre Jelly" });
    const text = result.content[0].text;

    expect(text).toContain("**Damage Vulnerabilities** Bludgeoning");
    expect(text).toContain("**Damage Resistances** Fire");
    expect(text).toContain("**Damage Immunities** Poison");
    expect(text).toContain("**Condition Immunities** Prone, Poisoned");

    // Canonical stat-block order: Vulnerabilities, Resistances, Immunities, Condition Immunities, then Senses.
    const vulnIdx = text.indexOf("Damage Vulnerabilities");
    const resIdx = text.indexOf("Damage Resistances");
    const immIdx = text.indexOf("Damage Immunities");
    const condIdx = text.indexOf("Condition Immunities");
    const sensesIdx = text.indexOf("**Senses**");
    expect(vulnIdx).toBeGreaterThan(-1);
    expect(vulnIdx).toBeLessThan(resIdx);
    expect(resIdx).toBeLessThan(immIdx);
    expect(immIdx).toBeLessThan(condIdx);
    expect(condIdx).toBeLessThan(sensesIdx);
  });

  it("shouldOmitDamageAndConditionAdjustmentLinesWhenAbsent", async () => {
    const mockClient = createRoutingMockClient([
      {
        accessType: { "17100": 1 },
        pagination: { take: 5, skip: 0, currentPage: 1, pages: 1, total: 1 },
        data: [MOCK_MONSTER],
      },
      { accessType: 1, data: MOCK_MONSTER },
    ]);

    const result = await getMonster(mockClient, { monsterName: "Goblin" });
    const text = result.content[0].text;

    expect(text).not.toContain("Damage Vulnerabilities");
    expect(text).not.toContain("Damage Resistances");
    expect(text).not.toContain("Damage Immunities");
    expect(text).not.toContain("Condition Immunities");
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/tools/reference-monsters.test.ts`
Expected: FAIL — `shouldIncludeDamageAndConditionAdjustmentsWhenPresent` fails because none of the four new lines are in the output yet. `shouldOmitDamageAndConditionAdjustmentLinesWhenAbsent` passes already (nothing to omit yet) — that's fine, it's a regression guard for the next step, not currently exercising new code.

- [ ] **Step 3: Add `damageAdjustments` to the `GameConfig` interface**

In `src/tools/reference.ts`, replace the `GameConfig` interface (lines 13-21):

```ts
interface GameConfig {
  challengeRatings: Array<{ id: number; value: number; xp: number; proficiencyBonus: number }>;
  monsterTypes: Array<{ id: number; name: string }>;
  environments: Array<{ id: number; name: string }>;
  alignments: Array<{ id: number; name: string }>;
  damageTypes: Array<{ id: number; name: string }>;
  senses: Array<{ id: number; name: string }>;
  sources?: Array<{ id: number; name: string }>;
}
```

with:

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

- [ ] **Step 4: Insert the formatter block**

In `src/tools/reference.ts`, the Skills block (lines 710-713) currently reads:

```ts
  // Skills
  if (m.skillsHtml) {
    lines.push(`**Skills** ${stripHtml(m.skillsHtml)}`);
  }
```

immediately followed by the `// Senses` comment (line 715). Insert this new block between them (after line 713's closing `}`, before line 715's `// Senses`):

```ts

  // Damage vulnerabilities / resistances / immunities
  if (m.damageAdjustments && m.damageAdjustments.length > 0) {
    const adjMap = new Map(config.damageAdjustments.map((a) => [a.id, a]));
    const byType: Record<number, string[]> = { 1: [], 2: [], 3: [] };
    for (const id of m.damageAdjustments) {
      const adj = adjMap.get(id);
      if (adj && byType[adj.type]) byType[adj.type].push(adj.name);
    }
    if (byType[3].length > 0) lines.push(`**Damage Vulnerabilities** ${byType[3].join(", ")}`);
    if (byType[1].length > 0) lines.push(`**Damage Resistances** ${byType[1].join(", ")}`);
    if (byType[2].length > 0) lines.push(`**Damage Immunities** ${byType[2].join(", ")}`);
  }

  // Condition immunities
  if (m.conditionImmunitiesHtml) {
    lines.push(`**Condition Immunities** ${stripHtml(m.conditionImmunitiesHtml)}`);
  }
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run tests/tools/reference-monsters.test.ts`
Expected: PASS — all tests in the file, including the 2 new ones.

- [ ] **Step 6: Run the full test suite**

Run: `npm test`
Expected: PASS — full suite green, no regressions in other test files (this change only touches `getMonster()`'s formatter and the shared `GameConfig` interface, both scoped to `reference.ts`).

- [ ] **Step 7: Commit**

```bash
git add src/tools/reference.ts tests/tools/reference-monsters.test.ts
git commit -m "feat: surface damage/condition resistances in getMonster stat blocks"
```

---

## Final verification

- [ ] Run `npm test` — full suite passes.
- [ ] Run `npm run build` (`tsc`) — confirm no type errors from the `GameConfig` interface change.
- [ ] Optional manual spot-check: run a live lookup for a monster with known resistances (e.g. Fire Elemental, Skeleton, Zombie — the three verified during design) via `npm run test:live` or a manual MCP call, and confirm the four new lines render correctly and in order.
