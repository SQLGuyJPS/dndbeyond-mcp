import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  searchClasses,
  getClass,
  searchBackgrounds,
  getBackground,
  searchFeats,
  getFeat,
  searchRaces,
  getRace,
  searchItems,
  getItem,
  isLegacyBySource,
} from "../../src/tools/reference.js";
import { DdbClient } from "../../src/api/client.js";

// D&D Beyond's real source-category IDs: 26 = "5e Core Rules" (2014, legacy),
// 145 -> 24 = "5.5e Core Rules" (2024, current). See src/tools/reference.ts.
const MOCK_CONFIG = {
  challengeRatings: [],
  monsterTypes: [],
  environments: [],
  alignments: [],
  damageTypes: [],
  senses: [],
  damageAdjustments: [],
  sources: [
    { id: 1, name: "BR", sourceCategoryId: 26 }, // Basic Rules (2014) — legacy
    { id: 145, name: "PHB-2024", sourceCategoryId: 24 }, // Player's Handbook 2024 — current
    { id: 999, name: "Unrelated Book", sourceCategoryId: 2 }, // Critical Role, etc — not edition-specific
  ],
};

/** Builds a mock DdbClient whose `get` resolves the collection and whose
 * `getRaw` resolves the shared game config (used for source->edition lookup). */
function mockClient(collection: unknown[]): DdbClient {
  return {
    get: vi.fn().mockResolvedValue(collection),
    getRaw: vi.fn().mockResolvedValue(MOCK_CONFIG),
  } as unknown as DdbClient;
}

describe("isLegacyBySource", () => {
  it("returns true for a source in a 2014 (5e) category", () => {
    expect(isLegacyBySource(MOCK_CONFIG, [{ sourceId: 1 }])).toBe(true);
  });
  it("returns false for a source in a 2024 (5.5e) category", () => {
    expect(isLegacyBySource(MOCK_CONFIG, [{ sourceId: 145 }])).toBe(false);
  });
  it("returns false for a *recognized* source outside both edition category sets", () => {
    // sourceId 999 is in MOCK_CONFIG.sources (category 2, e.g. Critical Role) —
    // known, just not edition-tied, so this is a confident false, not "unknown".
    expect(isLegacyBySource(MOCK_CONFIG, [{ sourceId: 999 }])).toBe(false);
  });
  // Tri-state (B2): undefined means "genuinely couldn't determine this", and
  // must stay distinct from a confident false — a caller that coerces the
  // result with Boolean() collapses "unknown" back into "2024", which is the
  // exact bug this tri-state exists to prevent.
  it("returns undefined when the entity itself has no source (nothing to look up)", () => {
    expect(isLegacyBySource(MOCK_CONFIG, [])).toBeUndefined();
    expect(isLegacyBySource(MOCK_CONFIG, undefined)).toBeUndefined();
  });
  it("returns undefined when the config or its sources are unavailable", () => {
    expect(isLegacyBySource(undefined, [{ sourceId: 1 }])).toBeUndefined();
    expect(isLegacyBySource({ ...MOCK_CONFIG, sources: undefined }, [{ sourceId: 1 }])).toBeUndefined();
  });
  it("returns undefined when the entity's sourceId isn't among config's known sources", () => {
    expect(isLegacyBySource(MOCK_CONFIG, [{ sourceId: 424242 }])).toBeUndefined();
  });
});

describe("searchClasses edition", () => {
  const fighterLegacy = { id: 10, name: "Fighter", description: "d10 legacy fighter.", hitDice: 10, isHomebrew: false, spellCastingAbilityId: null, sources: [{ sourceId: 1 }] };
  const fighterCurrent = { id: 2190879, name: "Fighter", description: "d10 current fighter.", hitDice: 10, isHomebrew: false, spellCastingAbilityId: null, sources: [{ sourceId: 145 }] };

  it("shows both editions distinguishably when no edition is requested", async () => {
    const result = await searchClasses(mockClient([fighterLegacy, fighterCurrent]), {});
    const text = result.content[0].text;
    expect(text.match(/\*\*Fighter\*\*/g)).toHaveLength(2);
    expect(text).toMatch(/\*\*Fighter\*\* \*\(Legacy\)\*/);
  });

  it("collapses to the requested edition's variant", async () => {
    const result = await searchClasses(mockClient([fighterLegacy, fighterCurrent]), { edition: "2024" });
    const text = result.content[0].text;
    expect(text.match(/\*\*Fighter\*\*/g)).toHaveLength(1);
    expect(text).toContain("d10 current fighter");
    expect(text).not.toContain("d10 legacy fighter");
  });

  it("filters by className alongside edition", async () => {
    const wizard = { id: 8, name: "Wizard", description: "", hitDice: 6, isHomebrew: false, spellCastingAbilityId: 4, sources: [{ sourceId: 145 }] };
    const result = await searchClasses(mockClient([fighterLegacy, fighterCurrent, wizard]), { className: "fighter", edition: "2024" });
    const text = result.content[0].text;
    expect(text).toContain("Fighter");
    expect(text).not.toContain("Wizard");
  });
});

describe("getClass", () => {
  const rangerLegacy = {
    id: 1, name: "Ranger", description: "A legacy ranger.", hitDice: 10, isHomebrew: false, spellCastingAbilityId: 5,
    sources: [{ sourceId: 1 }],
    classFeatures: [
      { id: 1, name: "Favored Enemy", description: "Legacy favored enemy grants tracking bonuses.", requiredLevel: 1 },
    ],
  };
  const rangerCurrent = {
    id: 2, name: "Ranger", description: "A current ranger.", hitDice: 10, isHomebrew: false, spellCastingAbilityId: 5,
    primaryAbilities: [2, 5],
    sources: [{ sourceId: 145 }],
    classFeatures: [
      { id: 2, name: "Favored Enemy", description: "You always have Hunter's Mark prepared.", requiredLevel: 1 },
    ],
  };

  it("returns the 2024 variant's class features for edition 2024", async () => {
    const result = await getClass(mockClient([rangerLegacy, rangerCurrent]), { className: "Ranger", edition: "2024" });
    const text = result.content[0].text;
    expect(text).toContain("Hunter's Mark");
    expect(text).not.toContain("tracking bonuses");
    expect(text).toContain("Primary Abilities:");
  });

  it("returns the 2014 variant's class features for edition 2014", async () => {
    const result = await getClass(mockClient([rangerLegacy, rangerCurrent]), { className: "Ranger", edition: "2014" });
    const text = result.content[0].text;
    expect(text).toContain("tracking bonuses");
    expect(text).not.toContain("Hunter's Mark");
  });

  it("returns not-found for an unknown class", async () => {
    const result = await getClass(mockClient([rangerLegacy]), { className: "Nonexistent" });
    expect(result.content[0].text).toContain("not found");
  });
});

describe("searchBackgrounds and getBackground edition", () => {
  const nobleLegacy = { id: 10, name: "Noble", description: "Legacy noble upbringing.", isHomebrew: false, sources: [{ sourceId: 1 }] };
  const nobleCurrent = {
    id: 406484, name: "Noble", description: "Current noble upbringing.", isHomebrew: false,
    sources: [{ sourceId: 145 }], primaryAbilities: [1, 4, 6],
    skillProficienciesDescription: "History and Persuasion", featureName: "Skilled",
  };

  it("tags legacy rows when listing both editions", async () => {
    const result = await searchBackgrounds(mockClient([nobleLegacy, nobleCurrent]), {});
    expect(result.content[0].text.match(/\*\*Noble\*\*/g)).toHaveLength(2);
    expect(result.content[0].text).toMatch(/\*\*Noble\*\* \*\(Legacy\)\*/);
  });

  it("returns the 2024 background's ability score choices", async () => {
    const result = await getBackground(mockClient([nobleLegacy, nobleCurrent]), { backgroundName: "Noble", edition: "2024" });
    const text = result.content[0].text;
    expect(text).toContain("STR, INT, CHA");
    expect(text).toContain("Skilled");
  });

  it("returns the 2014 background variant", async () => {
    const result = await getBackground(mockClient([nobleLegacy, nobleCurrent]), { backgroundName: "Noble", edition: "2014" });
    expect(result.content[0].text).toContain("Legacy noble upbringing");
  });
});

describe("searchFeats and getFeat edition", () => {
  const chefLegacy = {
    id: 451316, name: "Chef", description: "Legacy chef feat text.", snippet: "",
    prerequisites: [{ description: "Level 4+" }], isHomebrew: false, sources: [{ sourceId: 1 }],
  };
  const chefCurrent = {
    id: 1789123, name: "Chef", description: "Current chef feat text.", snippet: "",
    prerequisites: [], isHomebrew: false, sources: [{ sourceId: 145 }],
    categories: [{ tagName: "General" }],
  };

  it("normalizes the real prerequisites[] shape into filter/display text", async () => {
    const result = await searchFeats(mockClient([chefLegacy]), { prerequisite: "level 4" });
    expect(result.content[0].text).toContain("Chef");
    expect(result.content[0].text).toContain("Prerequisite: Level 4+");
  });

  it("falls back to the legacy `prerequisite` scalar shape for older mocks", async () => {
    const oldShapeFeat = { id: 1, name: "Grappler", description: "", snippet: "", prerequisite: "Strength 13", isHomebrew: false, sources: [] };
    const result = await searchFeats(mockClient([oldShapeFeat]), { prerequisite: "strength" });
    expect(result.content[0].text).toContain("Grappler");
  });

  it("collapses cross-edition duplicates and tags the fallback row", async () => {
    const result = await searchFeats(mockClient([chefLegacy, chefCurrent]), { name: "chef", edition: "2024" });
    const text = result.content[0].text;
    expect(text.match(/\*\*Chef\*\*/g)).toHaveLength(1);
    expect(text).toContain("Current chef feat text");
  });

  it("get_feat returns the requested edition's full description", async () => {
    const result = await getFeat(mockClient([chefLegacy, chefCurrent]), { featName: "Chef", edition: "2014" });
    const text = result.content[0].text;
    expect(text).toContain("Legacy chef feat text");
    expect(text).toContain("Prerequisite: Level 4+");
  });

  it("get_feat returns not-found for an unknown feat", async () => {
    const result = await getFeat(mockClient([chefCurrent]), { featName: "Nonexistent Feat" });
    expect(result.content[0].text).toContain("not found");
  });
});

describe("searchRaces and getRace edition", () => {
  // Real DDB data: the 2014 "Elf" only shows up as its subraces (High Elf, Wood
  // Elf) plus Half-Elf; the base "Elf" entry itself is the 2024 (non-legacy) one.
  const highElf = { entityRaceId: 1, fullName: "High Elf", baseName: "High Elf", baseRaceName: "Elf", description: "A legacy high elf.", isHomebrew: false, isLegacy: true, isSubRace: true, size: "Medium", sources: [{ sourceId: 1 }] };
  const elf2024 = {
    entityRaceId: 1751437, fullName: "Elf", baseName: "Elf", baseRaceName: "Elf", description: "A current elf.",
    longDescription: "The current elf, in full.", isHomebrew: false, isLegacy: false, isSubRace: false, size: "Medium",
    sources: [{ sourceId: 145 }],
    racialTraits: [{ definition: { name: "Darkvision", description: "You can see in the dark." } }],
  };

  it("tags legacy rows when listing without an edition filter", async () => {
    const result = await searchRaces(mockClient([highElf, elf2024]), {});
    const text = result.content[0].text;
    expect(text).toMatch(/\*\*High Elf\*\* \*\(Legacy\)\*/);
    expect(text).not.toMatch(/\*\*Elf\*\* \*\(Legacy\)\*/);
  });

  it("get_race returns full details plus racial traits", async () => {
    const result = await getRace(mockClient([highElf, elf2024]), { raceName: "Elf" });
    const text = result.content[0].text;
    expect(text).toContain("The current elf, in full");
    expect(text).toContain("Darkvision");
  });

  it("get_race returns not-found for an unknown race", async () => {
    const result = await getRace(mockClient([elf2024]), { raceName: "Nonexistent Species" });
    expect(result.content[0].text).toContain("not found");
  });
});

describe("searchItems edition", () => {
  const bagLegacy = { id: 1, name: "Bag of Holding", type: "Wondrous Item", filterType: "Wondrous Item", rarity: "Uncommon", requiresAttunement: false, isHomebrew: false, sources: [], canAttune: false, magic: true, isLegacy: true };
  const bagCurrent = { id: 2, name: "Bag of Holding", type: "Wondrous Item", filterType: "Wondrous Item", rarity: "Uncommon", requiresAttunement: false, isHomebrew: false, sources: [], canAttune: false, magic: true, isLegacy: false };

  it("collapses cross-edition duplicate items to the requested edition", async () => {
    const client = { get: vi.fn().mockResolvedValue([bagLegacy, bagCurrent]), getRaw: vi.fn() } as unknown as DdbClient;
    const result = await searchItems(client, { name: "bag of holding", edition: "2024" });
    expect(result.content[0].text.match(/Bag of Holding/g)).toHaveLength(1);
  });

  // A1: it's unconfirmed whether the live items payload reliably carries
  // `isLegacy` — belt-and-braces, items without it still collapse correctly
  // via the sources[]-derived fallback (isLegacyBySource), same as classes/
  // backgrounds/feats.
  it("collapses items with no native isLegacy field, deriving edition from sources[]", async () => {
    const swordLegacy = { id: 1, name: "Sun Blade", type: "Weapon", filterType: "Weapon", rarity: "Rare", requiresAttunement: true, isHomebrew: false, sources: [{ sourceId: 1 }], canAttune: true, magic: true };
    const swordCurrent = { id: 2, name: "Sun Blade", type: "Weapon", filterType: "Weapon", rarity: "Rare", requiresAttunement: true, isHomebrew: false, sources: [{ sourceId: 145 }], canAttune: true, magic: true };
    const client = mockClient([swordLegacy, swordCurrent]);

    const legacyResult = await searchItems(client, { name: "sun blade", edition: "2014" });
    expect(legacyResult.content[0].text.match(/Sun Blade/g)).toHaveLength(1);
    expect(legacyResult.content[0].text).not.toContain("edition unknown");

    const item = await getItem(client, { itemName: "Sun Blade", edition: "2014" });
    expect(item.content[0].text).toContain("*(2014)*");
  });
});
