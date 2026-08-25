import { describe, it, expect, vi } from "vitest";
import { getSubclass, searchSubclasses, searchClassFeatures } from "../../src/tools/reference.js";
import { DdbClient } from "../../src/api/client.js";
import { ENDPOINTS } from "../../src/api/endpoints.js";

// D&D Beyond's real source-category IDs (see reference-editions.test.ts): 26 =
// "5e Core Rules" (2014, legacy), 24 = "5.5e Core Rules" (2024, current).
const MOCK_CONFIG = {
  challengeRatings: [], monsterTypes: [], environments: [], alignments: [],
  damageTypes: [], senses: [], damageAdjustments: [],
  sources: [
    { id: 1, name: "PHB 2014", sourceCategoryId: 26 },
    { id: 145, name: "PHB 2024", sourceCategoryId: 24 },
  ],
};

const BASE_PALADIN_FEATURES_2024 = [
  { id: 1, name: "Lay On Hands", description: "Heal stuff.", requiredLevel: 1 },
  { id: 2, name: "Paladin Subclass", description: "Choose an oath.", requiredLevel: 3 },
];

const CLASSES_2024 = [
  {
    id: 2190881, name: "Paladin", description: "A paladin.", hitDice: 10, isHomebrew: false,
    spellCastingAbilityId: 6, sources: [{ sourceId: 145 }], classFeatures: BASE_PALADIN_FEATURES_2024,
  },
  {
    id: 2190886, name: "Wizard", description: "A wizard.", hitDice: 6, isHomebrew: false,
    spellCastingAbilityId: 4, sources: [{ sourceId: 145 }],
    classFeatures: [{ id: 100, name: "Channel Divinity", description: "Not actually a wizard feature, just a name collision fixture.", requiredLevel: 3 }],
  },
];

const CLASSES_2014 = [
  {
    id: 4, name: "Paladin", description: "A paladin (legacy).", hitDice: 10, isHomebrew: false,
    spellCastingAbilityId: 6, sources: [{ sourceId: 1 }], classFeatures: BASE_PALADIN_FEATURES_2024,
  },
];

// Oath of Glory's classFeatures array mirrors live behavior: it's the merged
// base-class + subclass-only feature list, not the subclass's own alone.
const OATH_OF_GLORY_2024 = {
  id: 2190977, name: "Oath of Glory", description: "<p>Strive for glory.</p>",
  cardDescription: "Strive for the Heights of Heroism", subclassTagline: null, subclassFlavorText: null,
  parentClassId: 2190881, spellCastingAbilityId: 6, sources: [{ sourceId: 145 }],
  classFeatures: [
    ...BASE_PALADIN_FEATURES_2024,
    { id: 10, name: "Inspiring Smite", description: "Smite stuff.", requiredLevel: 3 },
    { id: 11, name: "Peerless Athlete", description: "Jump far.", requiredLevel: 3 },
    { id: 12, name: "Aura of Alacrity", description: "Move fast.", requiredLevel: 7 },
    { id: 13, name: "Glorious Defense", description: "Block attacks.", requiredLevel: 15 },
    { id: 14, name: "Living Legend", description: "Become a legend.", requiredLevel: 20 },
  ],
};

const OATH_OF_DEVOTION_2024 = {
  id: 2190976, name: "Oath of Devotion", description: "<p>Uphold justice.</p>",
  cardDescription: "Uphold the Ideals of Justice and Order", parentClassId: 2190881,
  spellCastingAbilityId: 6, sources: [{ sourceId: 145 }],
  classFeatures: [...BASE_PALADIN_FEATURES_2024, { id: 20, name: "Sacred Weapon", description: "Magic weapon.", requiredLevel: 3 }],
};

const OATH_OF_DEVOTION_2014 = {
  id: 21, name: "Oath of Devotion", description: "<p>Uphold justice (legacy).</p>",
  parentClassId: 4, spellCastingAbilityId: 6, sources: [{ sourceId: 1 }],
  classFeatures: [...BASE_PALADIN_FEATURES_2024, { id: 21, name: "Sacred Weapon (Legacy)", description: "Magic weapon, but old.", requiredLevel: 3 }],
};

/** Routes client.get by URL: classes() -> the fixture matching `classesFixture`
 * (2024 by default, unless a request explicitly asks for legacy in tests that
 * mix editions); subclasses(id) -> the matching subclass list; anything else
 * (game config) -> MOCK_CONFIG. */
function mockClient(opts: {
  classes?: unknown[];
  subclassesByParent?: Record<number, unknown[]>;
} = {}): DdbClient {
  const classes = opts.classes ?? CLASSES_2024;
  const subclassesByParent = opts.subclassesByParent ?? {
    2190881: [OATH_OF_GLORY_2024, OATH_OF_DEVOTION_2024],
    4: [OATH_OF_DEVOTION_2014],
  };

  return {
    get: vi.fn().mockImplementation(async (url: string) => {
      if (url === ENDPOINTS.gameData.classes()) return classes;
      for (const [parentId, subs] of Object.entries(subclassesByParent)) {
        if (url === ENDPOINTS.gameData.subclasses(Number(parentId))) return subs;
      }
      throw new Error(`Unexpected URL in mock: ${url}`);
    }),
    getRaw: vi.fn().mockResolvedValue(MOCK_CONFIG),
  } as unknown as DdbClient;
}

describe("getSubclass", () => {
  it("returns the subclass's own features across all levels, independent of any character", async () => {
    const result = await getSubclass(mockClient(), { subclassName: "Oath of Glory", className: "Paladin" });
    const text = result.content[0].text;

    expect(text).toContain("# Oath of Glory");
    expect(text).toContain("Inspiring Smite");
    expect(text).toContain("Peerless Athlete");
    expect(text).toContain("Aura of Alacrity");
    expect(text).toContain("Glorious Defense");
    expect(text).toContain("Living Legend");
    // Levels above any "character's" level (there is none) still show up.
    expect(text).toContain("Level 15: Glorious Defense");
    expect(text).toContain("Level 20: Living Legend");
  });

  it("excludes inherited base-class features from the subclass's own feature list", async () => {
    const result = await getSubclass(mockClient(), { subclassName: "Oath of Glory", className: "Paladin" });
    const text = result.content[0].text;

    // Lay On Hands / Paladin Subclass are base Paladin features, not Oath of
    // Glory's own — subclassOnlyFeatures() must diff them out.
    expect(text).not.toContain("Lay On Hands");
    expect(text).not.toContain("Paladin Subclass");
  });

  it("resolves without a className, scanning all classes", async () => {
    const result = await getSubclass(mockClient(), { subclassName: "Oath of Glory" });
    expect(result.content[0].text).toContain("# Oath of Glory");
  });

  it("selects the edition-matching variant when both exist", async () => {
    const client = mockClient({
      classes: [...CLASSES_2024, ...CLASSES_2014],
      subclassesByParent: { 2190881: [OATH_OF_DEVOTION_2024], 4: [OATH_OF_DEVOTION_2014] },
    });

    const current = await getSubclass(client, { subclassName: "Oath of Devotion", edition: "2024" });
    const legacy = await getSubclass(client, { subclassName: "Oath of Devotion", edition: "2014" });

    expect(current.content[0].text).toContain("*(2024)*");
    expect(current.content[0].text).toContain("Sacred Weapon");
    expect(current.content[0].text).not.toContain("Sacred Weapon (Legacy)");

    expect(legacy.content[0].text).toContain("*(2014)*");
    expect(legacy.content[0].text).toContain("Sacred Weapon (Legacy)");
  });

  it("reports not-found instead of erroring when a subclass isn't reachable for this account/edition", async () => {
    const result = await getSubclass(mockClient(), { subclassName: "Oath of the Crown", className: "Paladin" });
    expect(result.content[0].text).toContain("not found");
  });

  it("reports class-not-found distinctly from subclass-not-found", async () => {
    const result = await getSubclass(mockClient(), { subclassName: "Anything", className: "Not A Real Class" });
    expect(result.content[0].text).toContain('Class "Not A Real Class" not found');
  });

  it("includes subclass flavor text when available", async () => {
    const result = await getSubclass(mockClient(), { subclassName: "Oath of Glory", className: "Paladin" });
    expect(result.content[0].text).toContain("Strive for the Heights of Heroism");
  });

  it("survives one candidate class's subclass request failing (e.g. unowned content)", async () => {
    const client: DdbClient = {
      get: vi.fn().mockImplementation(async (url: string) => {
        if (url === ENDPOINTS.gameData.classes()) return CLASSES_2024;
        if (url === ENDPOINTS.gameData.subclasses(2190881)) return [OATH_OF_GLORY_2024];
        if (url === ENDPOINTS.gameData.subclasses(2190886)) throw new Error("D&D Beyond API error: 404 Not Found");
        throw new Error(`Unexpected URL: ${url}`);
      }),
      getRaw: vi.fn().mockResolvedValue(MOCK_CONFIG),
    } as unknown as DdbClient;

    const result = await getSubclass(client, { subclassName: "Oath of Glory" });
    expect(result.content[0].text).toContain("# Oath of Glory");
  });
});

describe("searchSubclasses", () => {
  it("lists every subclass under a class", async () => {
    const result = await searchSubclasses(mockClient(), { className: "Paladin" });
    const text = result.content[0].text;
    expect(text).toContain("Oath of Glory");
    expect(text).toContain("Oath of Devotion");
  });

  it("finds a subclass by name without knowing its parent class", async () => {
    const result = await searchSubclasses(mockClient(), { name: "Glory" });
    expect(result.content[0].text).toContain("Oath of Glory");
    expect(result.content[0].text).not.toContain("Oath of Devotion");
  });

  it("collapses cross-edition duplicates when an edition is requested", async () => {
    const client = mockClient({
      classes: [...CLASSES_2024, ...CLASSES_2014],
      subclassesByParent: { 2190881: [OATH_OF_DEVOTION_2024], 4: [OATH_OF_DEVOTION_2014] },
    });
    const result = await searchSubclasses(client, { name: "Devotion", edition: "2024" });
    expect(result.content[0].text.match(/Oath of Devotion/g)?.length).toBe(1);
  });

  it("reports no matches without erroring", async () => {
    const result = await searchSubclasses(mockClient(), { name: "Nonexistent Oath" });
    expect(result.content[0].text).toContain("No subclasses found");
  });
});

describe("searchClassFeatures", () => {
  it("finds subclass features by name alone, without className", async () => {
    const result = await searchClassFeatures(mockClient(), { name: "Glorious Defense" });
    const text = result.content[0].text;
    expect(text).toContain("Glorious Defense");
    expect(text).toContain("Paladin (Oath of Glory)");
    expect(text).toContain("level 15");
  });

  it("finds both base and subclass features when filtering by className", async () => {
    const result = await searchClassFeatures(mockClient(), { className: "Paladin" });
    const text = result.content[0].text;
    expect(text).toContain("Lay On Hands"); // base
    expect(text).toContain("Inspiring Smite"); // Oath of Glory
    expect(text).toContain("Sacred Weapon"); // Oath of Devotion
  });

  it("filters by level across base and subclass features", async () => {
    const result = await searchClassFeatures(mockClient(), { className: "Paladin", level: 20 });
    const text = result.content[0].text;
    expect(text).toContain("Living Legend");
    expect(text).not.toContain("Lay On Hands");
    expect(text).not.toContain("Inspiring Smite");
  });

  it("does not collapse same-named base features across different classes when an edition is requested", async () => {
    // Fixture has "Channel Divinity" as a Wizard base feature (name collision
    // on purpose) and Paladin has no feature of that name — collapseByEdition
    // must key on class+name, not name alone, or this would wrongly merge.
    const result = await searchClassFeatures(mockClient(), { name: "Channel Divinity", edition: "2024" });
    const text = result.content[0].text;
    expect(text).toContain("Wizard");
    expect(text.match(/Channel Divinity/g)?.length).toBeGreaterThanOrEqual(1);
  });

  it("reports no matches without erroring", async () => {
    const result = await searchClassFeatures(mockClient(), { name: "Definitely Not A Feature" });
    expect(result.content[0].text).toContain("No class features found");
  });
});
