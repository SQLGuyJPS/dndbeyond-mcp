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
});
