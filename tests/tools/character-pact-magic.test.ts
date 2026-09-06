import { describe, it, expect, vi, beforeEach } from "vitest";
import { updatePactMagic } from "../../src/tools/character.js";
import type { DdbClient } from "../../src/api/client.js";
import type { DdbCharacter } from "../../src/types/character.js";

const baseCharacter: DdbCharacter = {
  id: 123,
  readonlyUrl: "https://example.com",
  name: "Test Warlock",
  race: { fullName: "Human", baseRaceName: "Human", isHomebrew: false, racialTraits: [] },
  classes: [
    {
      id: 456,
      definition: { id: 2190885, name: "Warlock" },
      subclassDefinition: null,
      level: 3,
      isStartingClass: true,
      classFeatures: [],
    },
  ],
  background: { definition: null },
  stats: [],
  bonusStats: [],
  overrideStats: [],
  modifiers: { race: [], class: [], background: [], item: [], feat: [], condition: [] },
  baseHitPoints: 24,
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
  // Live shape (Phase 0 P5): array of per-level rows, `available` left at 0.
  pactMagic: [
    { level: 1, used: 0, available: 0 },
    { level: 2, used: 1, available: 0 },
    { level: 3, used: 0, available: 0 },
  ],
};

describe("updatePactMagic", () => {
  let mockClient: DdbClient;

  beforeEach(() => {
    mockClient = {
      get: vi.fn().mockResolvedValue(baseCharacter),
      getRaw: vi.fn(),
      put: vi.fn().mockResolvedValue({}),
    } as unknown as DdbClient;
  });

  it("should update pact magic slots, targeting the level row the Warlock's level resolves to", async () => {
    const result = await updatePactMagic(mockClient, {
      characterId: 123,
      used: 1,
    });

    // Level-3 Warlock => slot level min(ceil(3/2),5) = 2
    expect(mockClient.put).toHaveBeenCalledWith(
      "https://character-service.dndbeyond.com/character/v5/spell/pact-magic",
      { characterId: 123, level2: 1 },
      ["character:123"]
    );

    expect(result.content[0].text).toBe("Updated pact magic slots to 1 used.");
  });

  it("should reject negative used slots", async () => {
    const result = await updatePactMagic(mockClient, {
      characterId: 123,
      used: -1,
    });

    expect(result.content[0].text).toBe("Used pact magic slots cannot be negative.");
    expect(mockClient.put).not.toHaveBeenCalled();
  });

  it("should allow resetting to 0", async () => {
    const result = await updatePactMagic(mockClient, {
      characterId: 123,
      used: 0,
    });

    expect(mockClient.put).toHaveBeenCalledWith(
      "https://character-service.dndbeyond.com/character/v5/spell/pact-magic",
      { characterId: 123, level2: 0 },
      ["character:123"]
    );

    expect(result.content[0].text).toBe("Updated pact magic slots to 0 used.");
  });
});
