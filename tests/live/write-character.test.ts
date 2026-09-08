import { describe, it, expect, afterAll, beforeAll } from "vitest";
import { setupWriteTestCharacter, deleteTestCharacter, assertIsTestCharacter, MCPTEST_PREFIX } from "./setup.js";
import {
  updateHp,
  updateCurrency,
  updateSpellSlots,
  updateDeathSaves,
  updatePactMagic,
  longRest,
  shortRest,
  addCondition,
  removeCondition,
  getCharacter,
  resolveChoices,
} from "../../src/tools/character.js";
import { ENDPOINTS } from "../../src/api/endpoints.js";
import type { DdbClient } from "../../src/api/client.js";
import type { DdbCharacter } from "../../src/types/character.js";

/**
 * Fetch raw character data with cache bypass for fresh reads.
 */
async function fetchCharacterState(client: DdbClient, characterId: number): Promise<DdbCharacter> {
  const cacheKey = `live-test-char:${characterId}:${Date.now()}`;
  return client.get<DdbCharacter>(ENDPOINTS.character.get(characterId), cacheKey, 1);
}

/**
 * v0.8.0 restored these five write endpoints (see
 * docs/plans/2026-09-05-character-fixes-integration-plan.md, item 5/6/9/13).
 * Every test here asserts persistence through an INDEPENDENT read-back, never
 * the write call's own response text — a write that returns 200 but doesn't
 * persist looks identical to a successful one (Threat C, §3.3 of the plan).
 * A "temporarily unavailable" / deprecation response is now a FAILURE, not an
 * accepted outcome, per the plan's release checklist for 0.8.0.
 *
 * All fixtures here are built fresh per run and named with MCPTEST_PREFIX,
 * enforced by setupWriteTestCharacter()/assertIsTestCharacter() — never point
 * these tests at a real character.
 */
describe("Live: Write endpoints (v0.8.0)", () => {
  let client: DdbClient;
  let f1Id: number; // Wizard 1 — HP/currency/death-saves/condition/spell-slots/rest
  let f2Id: number; // Warlock 3 — pact magic

  beforeAll(async () => {
    const f1 = await setupWriteTestCharacter("F1-Wizard");
    client = f1.client;
    f1Id = f1.testCharacterId;
    // 2024 Wizard classId=2190886 — guarantees a level-1 spell slot to exercise.
    await client.post(ENDPOINTS.character.addClass(), { characterId: f1Id, classId: 2190886, level: 1 }, [`character:${f1Id}`]);

    const f2 = await setupWriteTestCharacter("F2-Warlock");
    f2Id = f2.testCharacterId;
    // 2024 Warlock classId=2190885
    await client.post(ENDPOINTS.character.addClass(), { characterId: f2Id, classId: 2190885, level: 3 }, [`character:${f2Id}`]);
  });

  afterAll(async () => {
    if (f1Id) await deleteTestCharacter(client, f1Id);
    if (f2Id) await deleteTestCharacter(client, f2Id);
  });

  it("fixtures are named with the MCPTEST- prefix", async () => {
    const f1 = await fetchCharacterState(client, f1Id);
    const f2 = await fetchCharacterState(client, f2Id);
    expect(() => assertIsTestCharacter(f1.name)).not.toThrow();
    expect(() => assertIsTestCharacter(f2.name)).not.toThrow();
    expect(f1.name.startsWith(MCPTEST_PREFIX)).toBe(true);
  });

  it("updateHp persists, confirmed by an independent read-back", async () => {
    const before = await fetchCharacterState(client, f1Id);
    await updateHp(client, { characterId: f1Id, hpChange: -1 });

    const afterDamage = await fetchCharacterState(client, f1Id);
    expect(afterDamage.removedHitPoints).toBe(before.removedHitPoints + 1);

    // Rollback
    await updateHp(client, { characterId: f1Id, hpChange: 1 });
    const restored = await fetchCharacterState(client, f1Id);
    expect(restored.removedHitPoints).toBe(before.removedHitPoints);
  });

  it("updateCurrency persists, confirmed by an independent read-back", async () => {
    const before = await fetchCharacterState(client, f1Id);
    const result = await updateCurrency(client, { characterId: f1Id, currency: "gp", delta: 5 });
    expect(result.content[0].text).not.toContain("temporarily unavailable");

    const after = await fetchCharacterState(client, f1Id);
    expect(after.currencies.gp).toBe(before.currencies.gp + 5);

    // Rollback
    await updateCurrency(client, { characterId: f1Id, currency: "gp", delta: -5 });
  });

  it("updateDeathSaves merges the untouched count rather than zeroing it (item 5's merge-behavior guard)", async () => {
    await updateDeathSaves(client, { characterId: f1Id, type: "success", count: 1 });
    await updateDeathSaves(client, { characterId: f1Id, type: "failure", count: 2 });

    const after = await fetchCharacterState(client, f1Id);
    expect(after.deathSaves.failCount).toBe(2);
    // The success count set moments earlier must survive the failure-only write.
    expect(after.deathSaves.successCount).toBe(1);

    // Reset
    await updateDeathSaves(client, { characterId: f1Id, type: "success", count: 0 });
    await updateDeathSaves(client, { characterId: f1Id, type: "failure", count: 0 });
  });

  it("updateSpellSlots persists, confirmed by an independent read-back", async () => {
    const before = await fetchCharacterState(client, f1Id);
    const slots = before.spellSlots;
    if (!slots || slots.length === 0 || !slots.some((s) => s.available > 0)) {
      // No spell slots on this account's Wizard build — nothing to exercise.
      return;
    }
    const slotLevel = slots.find((s) => s.available > 0)!;
    const result = await updateSpellSlots(client, { characterId: f1Id, level: slotLevel.level, used: slotLevel.used + 1 });
    expect(result.content[0].text).not.toContain("temporarily unavailable");

    const after = await fetchCharacterState(client, f1Id);
    const afterSlot = after.spellSlots!.find((s) => s.level === slotLevel.level)!;
    expect(afterSlot.used).toBe(slotLevel.used + 1);

    // Rollback
    await updateSpellSlots(client, { characterId: f1Id, level: slotLevel.level, used: slotLevel.used });
  });

  it("updatePactMagic persists on the Warlock fixture, confirmed by an independent read-back (item 9)", async () => {
    const before = await fetchCharacterState(client, f2Id);
    const result = await updatePactMagic(client, { characterId: f2Id, used: 1 });
    expect(result.content[0].text).not.toContain("temporarily unavailable");
    expect(result.content[0].text).not.toContain("NaN");
    expect(result.content[0].text).not.toContain("undefined");

    const after = await fetchCharacterState(client, f2Id);
    const beforeArr = Array.isArray(before.pactMagic) ? before.pactMagic : [];
    const afterArr = Array.isArray(after.pactMagic) ? after.pactMagic : [];
    const changedRow = afterArr.find((row, i) => row.used !== (beforeArr[i]?.used ?? 0));
    expect(changedRow).toBeDefined();

    // Rollback
    await updatePactMagic(client, { characterId: f2Id, used: 0 });
  });

  it("addCondition/removeCondition apply Exhaustion at conditionId 4, confirmed by an independent read-back (item 13)", async () => {
    await addCondition(client, { characterId: f1Id, conditionId: 4, level: 2 });
    const after = await fetchCharacterState(client, f1Id);
    const exhaustion = after.conditions?.find((c) => c.id === 4);
    expect(exhaustion?.level).toBe(2);

    await removeCondition(client, { characterId: f1Id, conditionId: 4 });
    const removed = await fetchCharacterState(client, f1Id);
    expect(removed.conditions?.find((c) => c.id === 4)).toBeUndefined();
  });

  it("longRest restores HP via POST, confirmed by an independent read-back (item 6)", async () => {
    await updateHp(client, { characterId: f1Id, hpChange: -3 });
    const damaged = await fetchCharacterState(client, f1Id);
    expect(damaged.removedHitPoints).toBeGreaterThan(0);

    const result = await longRest(client, { characterId: f1Id });
    expect(result.content[0].text).not.toContain("temporarily unavailable");

    const rested = await fetchCharacterState(client, f1Id);
    expect(rested.removedHitPoints).toBe(0);
  });

  it("shortRest restores pact magic on the Warlock fixture via POST, confirmed by an independent read-back (item 6)", async () => {
    await updatePactMagic(client, { characterId: f2Id, used: 1 });
    const spent = await fetchCharacterState(client, f2Id);
    const spentArr = Array.isArray(spent.pactMagic) ? spent.pactMagic : [];
    expect(spentArr.some((row) => row.used > 0)).toBe(true);

    const result = await shortRest(client, { characterId: f2Id });
    expect(result.content[0].text).not.toContain("temporarily unavailable");

    const rested = await fetchCharacterState(client, f2Id);
    const restedArr = Array.isArray(rested.pactMagic) ? rested.pactMagic : [];
    expect(restedArr.every((row) => row.used === 0)).toBe(true);
  });

  /**
   * Post-release validation (2026-09-07/08, docs/plans/2026-09-05-character-fixes-
   * integration-plan.md, "Post-release validation" section): longRest's own
   * comment claimed the server-side reset clears death saves atomically, but an
   * independent read-back showed them unchanged after a rest that fully restored
   * HP. Per 5e rules, regaining any HP clears death saves — asserted here via
   * independent read-back, not the rest call's own response text, per Threat C.
   */
  it("longRest clears death saves after restoring HP, confirmed by an independent read-back (item 6 follow-up)", async () => {
    await updateDeathSaves(client, { characterId: f1Id, type: "success", count: 1 });
    await updateDeathSaves(client, { characterId: f1Id, type: "failure", count: 1 });
    await updateHp(client, { characterId: f1Id, hpChange: -1 });

    const damaged = await fetchCharacterState(client, f1Id);
    expect(damaged.deathSaves.successCount).toBe(1);
    expect(damaged.deathSaves.failCount).toBe(1);
    expect(damaged.removedHitPoints).toBeGreaterThan(0);

    const result = await longRest(client, { characterId: f1Id });
    expect(result.content[0].text).toContain("Death saves cleared.");

    const rested = await fetchCharacterState(client, f1Id);
    expect(rested.removedHitPoints).toBe(0);
    expect(rested.deathSaves.successCount).toBe(0);
    expect(rested.deathSaves.failCount).toBe(0);
  });

  /**
   * Short rest deliberately does NOT clear death saves — unlike longRest, it
   * never restores HP on its own (only hit-dice-used tracking), so per 5e rules
   * death saves have no trigger to clear. This locks in the asymmetry so nobody
   * "fixes" shortRest to match longRest without re-probing first.
   */
  it("shortRest does not clear death saves, since it doesn't restore HP (item 6 follow-up)", async () => {
    await updateDeathSaves(client, { characterId: f2Id, type: "success", count: 1 });
    await updateDeathSaves(client, { characterId: f2Id, type: "failure", count: 1 });

    const before = await fetchCharacterState(client, f2Id);
    expect(before.deathSaves.successCount).toBe(1);
    expect(before.deathSaves.failCount).toBe(1);

    const result = await shortRest(client, { characterId: f2Id });
    expect(result.content[0].text).not.toContain("Death saves cleared");

    const after = await fetchCharacterState(client, f2Id);
    expect(after.deathSaves.successCount).toBe(1);
    expect(after.deathSaves.failCount).toBe(1);

    // Reset
    await updateDeathSaves(client, { characterId: f2Id, type: "success", count: 0 });
    await updateDeathSaves(client, { characterId: f2Id, type: "failure", count: 0 });
  });
});

/**
 * Tier-3 behavioral testing (2026-09-06) found that currencies, deathSaves,
 * conditions, and single-class-Warlock pact magic all persisted correctly but
 * never showed up in get_character's formatted output — see the plan doc's
 * "v0.8.0 tier-3 behavioral test results" section, findings 1-3. These tests
 * go one step past write-character.test.ts's raw read-backs above: they call
 * getCharacter() itself and assert the *formatted sheet text* reflects the
 * write, since that's what a real caller of this MCP actually sees.
 */
describe("Live: get_character sheet reflects writes (tier-3 findings 1-3)", () => {
  let client: DdbClient;
  let f1Id: number; // Wizard 1 — currency/death-saves/conditions
  let f2Id: number; // Warlock 3 — pact magic display

  beforeAll(async () => {
    const f1 = await setupWriteTestCharacter("F1b-DisplayCheck");
    client = f1.client;
    f1Id = f1.testCharacterId;
    // formatCharacterSheet dereferences char.race.fullName unconditionally, and a
    // bare standard-build character has race: null until species is set (unrelated
    // pre-existing gap, not one of findings 1-3 — give the fixture a species so the
    // sheet formatter itself doesn't throw). 2024 Human, same IDs as
    // character-lifecycle.test.ts.
    await client.put(ENDPOINTS.character.setRace(), { characterId: f1Id, entityRaceId: 1751441, entityRaceTypeId: 1743923279 }, [`character:${f1Id}`]);

    const f2 = await setupWriteTestCharacter("F2b-WarlockDisplay");
    // Same client for both fixtures (setupWriteTestCharacter reuses the shared live client).
    f2Id = f2.testCharacterId;
    await client.put(ENDPOINTS.character.setRace(), { characterId: f2Id, entityRaceId: 1751441, entityRaceTypeId: 1743923279 }, [`character:${f2Id}`]);
    // 2024 Warlock classId=2190885 — gives it real spellcasting so formatSpellcasting
    // (and, gated behind it, formatSpellSlots) actually runs.
    await client.post(ENDPOINTS.character.addClass(), { characterId: f2Id, classId: 2190885, level: 3 }, [`character:${f2Id}`]);
    // formatSpellcasting only renders (and only then does formatSpellSlots run)
    // once the character has at least one known spell — resolve pending choices
    // (cantrips/spells known included) the same way real fixtures were built.
    await resolveChoices(client, { characterId: f2Id });
  });

  afterAll(async () => {
    if (f1Id) await deleteTestCharacter(client, f1Id);
    if (f2Id) await deleteTestCharacter(client, f2Id);
  });

  it("shows a non-zero currency write in the sheet's Currency section (finding 1)", async () => {
    const before = await fetchCharacterState(client, f1Id);
    await updateCurrency(client, { characterId: f1Id, currency: "gp", delta: 7 });

    const result = await getCharacter(client, { characterId: f1Id, detail: "sheet" });
    const text = result.content[0].text;
    expect(text).toContain("--- Currency ---");
    // Delta, not absolute — a fresh build may not start at 0 gp.
    expect(text).toMatch(new RegExp(`\\b${before.currencies.gp + 7} gp\\b`));

    await updateCurrency(client, { characterId: f1Id, currency: "gp", delta: -7 });
  });

  it("shows a death-saves write in the sheet's Death Saves section (finding 1)", async () => {
    await updateDeathSaves(client, { characterId: f1Id, type: "success", count: 2 });

    const result = await getCharacter(client, { characterId: f1Id, detail: "sheet" });
    const text = result.content[0].text;
    expect(text).toContain("--- Death Saves ---");
    expect(text).toContain("Successes: ●●○ (2/3)");

    await updateDeathSaves(client, { characterId: f1Id, type: "success", count: 0 });
  });

  it("shows an active condition in the sheet's Conditions section (finding 1)", async () => {
    await addCondition(client, { characterId: f1Id, conditionId: 11 }); // Poisoned — not leveled

    const result = await getCharacter(client, { characterId: f1Id, detail: "sheet" });
    const text = result.content[0].text;
    expect(text).toContain("--- Conditions ---");
    expect(text).toContain("Poisoned");

    await removeCondition(client, { characterId: f1Id, conditionId: 11 });
  });

  it("addCondition without a level defaults Exhaustion to level 1 instead of clearing it (finding 3)", async () => {
    // Reproduces the exact regression: apply with an explicit level, then
    // re-apply with none. Before the fix this second call wiped the condition.
    await addCondition(client, { characterId: f1Id, conditionId: 4, level: 3 });
    await addCondition(client, { characterId: f1Id, conditionId: 4 });

    const after = await fetchCharacterState(client, f1Id);
    const exhaustion = after.conditions?.find((c) => c.id === 4);
    expect(exhaustion).toBeDefined();
    expect(exhaustion?.level).toBe(1);

    const result = await getCharacter(client, { characterId: f1Id, detail: "sheet" });
    expect(result.content[0].text).toContain("Exhaustion (level 1)");

    await removeCondition(client, { characterId: f1Id, conditionId: 4 });
  });

  it("addCondition without a level still forwards null for a non-leveled condition (finding 3 verification)", async () => {
    // Per the fix's caveat: this session hadn't previously confirmed null is
    // safe for a non-leveled condition — verify it applies cleanly and doesn't
    // get treated as a clear on a *fresh* apply (no prior state to wipe).
    await addCondition(client, { characterId: f1Id, conditionId: 1 }); // Blinded

    const after = await fetchCharacterState(client, f1Id);
    const blinded = after.conditions?.find((c) => c.id === 1);
    expect(blinded).toBeDefined();
    // Non-leveled conditions aren't asserted to persist exactly `null` here —
    // the API's own representation of "no level" (null vs. omitted) isn't
    // pinned down by this session — only that applying it doesn't silently
    // default it to a real level (1) the way the leveled-condition fix does.
    expect(blinded?.level).toBeFalsy();

    await removeCondition(client, { characterId: f1Id, conditionId: 1 });
  });

  it("shows Pact Magic in the sheet for a single-class Warlock (finding 2)", async () => {
    await updatePactMagic(client, { characterId: f2Id, used: 1 });

    const result = await getCharacter(client, { characterId: f2Id, detail: "sheet" });
    const text = result.content[0].text;
    expect(text).toContain("--- Spell Slots ---");
    expect(text).toMatch(/Pact Magic \(Level \d\): .*\(1\/\d used\)/);

    await updatePactMagic(client, { characterId: f2Id, used: 0 });
  });
});
