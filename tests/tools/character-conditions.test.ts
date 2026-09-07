import { describe, it, expect, vi } from "vitest";
import { addCondition, removeCondition, getCharacter } from "../../src/tools/character.js";
import type { DdbClient } from "../../src/api/client.js";
import type { DdbCharacter } from "../../src/types/character.js";

const baseCharacter: DdbCharacter = {
  id: 123,
  readonlyUrl: "https://example.com",
  name: "Test Character",
  race: { fullName: "Human", baseRaceName: "Human", isHomebrew: false, racialTraits: [] },
  classes: [
    { id: 1, definition: { id: 1, name: "Fighter" }, subclassDefinition: null, level: 5, isStartingClass: true, classFeatures: [] },
  ],
  background: { definition: null },
  stats: [1, 2, 3, 4, 5, 6].map((id) => ({ id, value: 10 })),
  bonusStats: [],
  overrideStats: [],
  modifiers: { race: [], class: [], background: [], item: [], feat: [], condition: [] },
  baseHitPoints: 40,
  bonusHitPoints: null,
  overrideHitPoints: null,
  removedHitPoints: 0,
  temporaryHitPoints: 0,
  currentXp: 0,
  alignmentId: 1,
  lifestyleId: 1,
  currencies: { cp: 0, sp: 0, ep: 0, gp: 0, pp: 0 },
  spells: { race: [], class: [], background: [], item: [], feat: [] },
  inventory: [],
  deathSaves: { failCount: null, successCount: null, isStabilized: false },
  traits: { personalityTraits: null, ideals: null, bonds: null, flaws: null, appearance: null },
  preferences: {},
  configuration: {},
  actions: {},
  campaign: null,
  feats: [],
  notes: { personalPossessions: null, backstory: null, otherNotes: null, allies: null, organizations: null },
};

// Corrected 2026-09-06 (Phase 0 P6): id 4 is Exhaustion, not id 15.
// See docs/plans/2026-09-05-character-fixes-integration-plan.md.
describe("condition ID mapping", () => {
  it("reports Exhaustion for conditionId 4, not 15", async () => {
    const mockClient = { get: vi.fn().mockResolvedValue(baseCharacter), put: vi.fn().mockResolvedValue({}) } as unknown as DdbClient;
    const result = await addCondition(mockClient, { characterId: 123, conditionId: 4, level: 2 });
    expect(result.content[0].text).toContain("Exhaustion");
    expect(result.content[0].text).toContain("level 2");
  });

  it("reports Unconscious for conditionId 15, not Exhaustion", async () => {
    const mockClient = { get: vi.fn().mockResolvedValue(baseCharacter), put: vi.fn().mockResolvedValue({}) } as unknown as DdbClient;
    const result = await addCondition(mockClient, { characterId: 123, conditionId: 15 });
    expect(result.content[0].text).toContain("Unconscious");
    expect(result.content[0].text).not.toContain("Exhaustion");
  });

  it("removeCondition also uses the corrected table", async () => {
    const mockClient = { delete: vi.fn().mockResolvedValue({}) } as unknown as DdbClient;
    const result = await removeCondition(mockClient, { characterId: 123, conditionId: 4 });
    expect(result.content[0].text).toContain("Exhaustion");
  });
});

// Live-confirmed 2026-09-06 (tier-3 finding 3): applying Exhaustion (id 4) with an
// explicit level, then re-applying it with no level, wiped the condition entirely —
// D&D Beyond's API treats a bare `null` level on a leveled condition as "remove,"
// not "default." addCondition now defaults to level 1 for a leveled condition when
// the caller omits `level`, and still forwards `null` unchanged for a non-leveled one.
describe("addCondition — leveled condition default (tier-3 finding 3)", () => {
  it("defaults level to 1 for a leveled condition (Exhaustion, id 4) when level is omitted", async () => {
    const putMock = vi.fn().mockResolvedValue({});
    const mockClient = { get: vi.fn().mockResolvedValue(baseCharacter), put: putMock } as unknown as DdbClient;

    const result = await addCondition(mockClient, { characterId: 123, conditionId: 4 });

    expect(putMock).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ id: 4, level: 1 }),
      expect.any(Array)
    );
    expect(result.content[0].text).toContain("Exhaustion");
    expect(result.content[0].text).toContain("level 1");
  });

  it("still honors an explicit level on a leveled condition", async () => {
    const putMock = vi.fn().mockResolvedValue({});
    const mockClient = { get: vi.fn().mockResolvedValue(baseCharacter), put: putMock } as unknown as DdbClient;

    await addCondition(mockClient, { characterId: 123, conditionId: 4, level: 3 });

    expect(putMock).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ id: 4, level: 3 }),
      expect.any(Array)
    );
  });

  it("still forwards null for a non-leveled condition (Blinded, id 1) when level is omitted", async () => {
    const putMock = vi.fn().mockResolvedValue({});
    const mockClient = { get: vi.fn().mockResolvedValue(baseCharacter), put: putMock } as unknown as DdbClient;

    const result = await addCondition(mockClient, { characterId: 123, conditionId: 1 });

    expect(putMock).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ id: 1, level: null }),
      expect.any(Array)
    );
    expect(result.content[0].text).toBe("Added Blinded to character 123.");
  });
});

// Fixed 2026-09-06 (tier-3 finding 1): char.conditions[] has correct write paths
// but was never read by the sheet formatter — an active condition was invisible
// on get_character. formatConditions reuses the same CONDITION_NAMES table
// addCondition/removeCondition already use.
describe("formatConditions (via getCharacter sheet)", () => {
  it("shows active conditions, including a leveled one, on the sheet", async () => {
    const char: DdbCharacter = {
      ...baseCharacter,
      conditions: [{ id: 4, level: 2 }, { id: 11, level: null }],
    };
    const mockClient = { get: vi.fn().mockResolvedValue(char) } as unknown as DdbClient;

    const result = await getCharacter(mockClient, { characterId: 123 });
    const text = result.content[0].text;

    expect(text).toContain("--- Conditions ---");
    expect(text).toContain("Exhaustion (level 2)");
    expect(text).toContain("Poisoned");
  });

  it("omits the Conditions section entirely when conditions[] is empty or absent", async () => {
    const mockClient = { get: vi.fn().mockResolvedValue(baseCharacter) } as unknown as DdbClient;

    const result = await getCharacter(mockClient, { characterId: 123 });

    expect(result.content[0].text).not.toContain("--- Conditions ---");
  });
});

describe("formatLimitedUseResources (via getCharacter sheet)", () => {
  it("caps max uses at maxUses + proficiency bonus when useProficiencyBonus is set", async () => {
    const char: DdbCharacter = {
      ...baseCharacter,
      actions: {
        class: [
          {
            id: 1, entityTypeId: 1, name: "Channel Divinity", componentId: 1, componentTypeId: 1,
            limitedUse: { maxUses: 1, numberUsed: 0, resetType: 2, resetTypeDescription: "Long Rest", useProficiencyBonus: true },
          },
        ],
      },
    };
    const mockClient = { get: vi.fn().mockResolvedValue(char) } as unknown as DdbClient;
    const result = await getCharacter(mockClient, { characterId: 123 });
    const text = result.content[0].text;
    // Level 5 => proficiency bonus +3; maxUses 1 + 3 = 4
    expect(text).toContain("Channel Divinity: 4/4 (Long Rest)");
  });

  it("clamps remaining at 0 rather than going negative when numberUsed exceeds maxUses", async () => {
    const char: DdbCharacter = {
      ...baseCharacter,
      actions: {
        class: [
          {
            id: 1, entityTypeId: 1, name: "Second Wind", componentId: 1, componentTypeId: 1,
            limitedUse: { maxUses: 1, numberUsed: 3, resetType: 1, resetTypeDescription: "Short Rest" },
          },
        ],
      },
    };
    const mockClient = { get: vi.fn().mockResolvedValue(char) } as unknown as DdbClient;
    const result = await getCharacter(mockClient, { characterId: 123 });
    expect(result.content[0].text).toContain("Second Wind: 0/1 (Short Rest)");
  });

  it("falls back to the corrected numeric resetType table when resetTypeDescription is absent", async () => {
    const char: DdbCharacter = {
      ...baseCharacter,
      actions: {
        class: [
          {
            id: 1, entityTypeId: 1, name: "Rage", componentId: 1, componentTypeId: 1,
            limitedUse: { maxUses: 2, numberUsed: 0, resetType: 2, resetTypeDescription: "" },
          },
        ],
      },
    };
    const mockClient = { get: vi.fn().mockResolvedValue(char) } as unknown as DdbClient;
    const result = await getCharacter(mockClient, { characterId: 123 });
    // resetType 2 = Long Rest (corrected mapping, Phase 0 P10)
    expect(result.content[0].text).toContain("Rage: 2/2 (Long Rest)");
  });
});
