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
