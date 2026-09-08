import { describe, it, expect, vi, beforeEach } from "vitest";
import { updatePactMagic, getCharacter } from "../../src/tools/character.js";
import type { DdbClient } from "../../src/api/client.js";
import type { DdbCharacter, DdbSpell } from "../../src/types/character.js";

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

// Live-confirmed 2026-09-06 (tier-3 finding 2, W2b/W3a): formatSpellSlots used to
// filter regular char.spellSlots to `available > 0` and return early if that list
// was empty, before the pact-magic append ever ran. A single-class Warlock's
// regular spellSlots are always all `available: 0` (every slot they have is a
// pact slot), so pact magic never displayed for the most common Warlock shape.
describe("getCharacter sheet — pact magic display (tier-3 finding 2)", () => {
  const eldritchBlast: DdbSpell = {
    id: 1,
    definition: {
      name: "Eldritch Blast",
      level: 0,
      school: "Evocation",
      description: "A beam of crackling energy.",
      range: null,
      duration: null,
      activation: null,
      components: null,
      componentsDescription: null,
      concentration: false,
      ritual: false,
    },
    prepared: true,
    alwaysPrepared: true,
    usesSpellSlot: false,
  };

  it("shows Pact Magic for a single-class Warlock when char.spellSlots is entirely absent", async () => {
    const char: DdbCharacter = {
      ...baseCharacter,
      spells: { race: [], class: [eldritchBlast], background: [], item: [], feat: [] },
      // spellSlots intentionally omitted.
    };
    const mockClient = { get: vi.fn().mockResolvedValue(char), getRaw: vi.fn() } as unknown as DdbClient;

    const result = await getCharacter(mockClient, { characterId: 123 });
    const text = result.content[0].text;

    expect(text).toContain("--- Spell Slots ---");
    expect(text).toContain("Pact Magic (Level 2)");
    expect(text).toContain("(1/2 used)");
  });

  it("shows Pact Magic when char.spellSlots is present but every regular slot is available: 0", async () => {
    const char: DdbCharacter = {
      ...baseCharacter,
      spells: { race: [], class: [eldritchBlast], background: [], item: [], feat: [] },
      spellSlots: [
        { level: 1, used: 0, available: 0 },
        { level: 2, used: 0, available: 0 },
      ],
    };
    const mockClient = { get: vi.fn().mockResolvedValue(char), getRaw: vi.fn() } as unknown as DdbClient;

    const result = await getCharacter(mockClient, { characterId: 123 });
    const text = result.content[0].text;

    // No regular slot lines (all filtered out at available: 0) but Pact Magic
    // still appears — this is the exact shape that broke before the fix.
    expect(text).not.toContain("Level 1: ");
    expect(text).toContain("Pact Magic (Level 2)");
    expect(text).toContain("(1/2 used)");
  });
});
