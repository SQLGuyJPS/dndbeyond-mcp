import { describe, it, expect, vi, beforeEach } from "vitest";
import { searchMonsters, getMonster, pickByEdition, collapseByEdition } from "../../src/tools/reference.js";
import { DdbClient } from "../../src/api/client.js";
import { MonsterSearchParams } from "../../src/types/reference.js";

describe("pickByEdition", () => {
  const legacy = { id: 1, name: "Goblin", isLegacy: true };
  const modern = { id: 2, name: "Goblin", isLegacy: false };

  it("returns the non-legacy variant for edition 2024", () => {
    expect(pickByEdition([legacy, modern], "2024")).toBe(modern);
  });
  it("returns the legacy variant for edition 2014", () => {
    expect(pickByEdition([legacy, modern], "2014")).toBe(legacy);
  });
  it("falls back to the only variant present when no edition match", () => {
    expect(pickByEdition([legacy], "2024")).toBe(legacy);
  });
  it("returns the first candidate when edition is omitted", () => {
    expect(pickByEdition([legacy, modern], undefined)).toBe(legacy);
  });
});

describe("collapseByEdition", () => {
  const gobLegacy = { id: 1, name: "Goblin", isLegacy: true };
  const gobModern = { id: 2, name: "goblin", isLegacy: false };
  const owlbear2014 = { id: 3, name: "Owlbear", isLegacy: true };

  it("collapses same-name cross-edition duplicates to the selected edition (one row per name)", () => {
    const out = collapseByEdition([gobLegacy, gobModern, owlbear2014], "2024");
    expect(out).toHaveLength(2);
    expect(out[0]).toBe(gobModern); // 2024 variant kept
    expect(out[1]).toBe(owlbear2014); // only-2014 monster kept
  });
  it("preserves first-seen name order", () => {
    const out = collapseByEdition([owlbear2014, gobLegacy, gobModern], "2024");
    expect(out.map((m) => m.name.toLowerCase())).toEqual(["owlbear", "goblin"]);
  });
  it("returns the input unchanged when edition is omitted", () => {
    const input = [gobLegacy, gobModern];
    expect(collapseByEdition(input, undefined)).toBe(input);
  });
});

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

const MOCK_MONSTER = {
  id: 17100,
  name: "Goblin",
  alignmentId: 9,
  sizeId: 3,
  typeId: 11,
  armorClass: 15,
  armorClassDescription: "(leather armor, shield)",
  averageHitPoints: 7,
  hitPointDice: { diceCount: 2, diceValue: 6, fixedValue: 0, diceString: "2d6" },
  passivePerception: 9,
  challengeRatingId: 5,
  isHomebrew: false,
  isLegendary: false,
  isMythic: false,
  isLegacy: false,
  url: "",
  avatarUrl: "",
  stats: [
    { statId: 1, value: 8 },
    { statId: 2, value: 14 },
    { statId: 3, value: 10 },
    { statId: 4, value: 10 },
    { statId: 5, value: 8 },
    { statId: 6, value: 8 },
  ],
  skills: [{ skillId: 5, value: 4 }],
  senses: [{ senseId: 2, notes: "60 ft." }],
  savingThrows: [],
  movements: [{ movementId: 1, speed: 30, notes: null }],
  languages: [],
  damageAdjustments: [],
  conditionImmunities: [],
  environments: [],
  specialTraitsDescription: "<p><strong>Nimble Escape.</strong> The goblin can take the Disengage or Hide action as a bonus action.</p>",
  actionsDescription: "<p><strong>Scimitar.</strong> Melee Weapon Attack</p>",
  reactionsDescription: "",
  legendaryActionsDescription: "",
  mythicActionsDescription: "",
  bonusActionsDescription: "",
  lairDescription: "",
  languageDescription: "Common, Goblin",
  languageNote: "",
  sensesHtml: "",
  skillsHtml: "Stealth +6",
  conditionImmunitiesHtml: "",
};

const MOCK_MONSTER_WITH_ADJUSTMENTS = {
  ...MOCK_MONSTER,
  id: 17101,
  name: "Ochre Jelly",
  damageAdjustments: [1, 2, 3],
  conditionImmunitiesHtml: "<a>Prone</a>, <a>Poisoned</a>",
};

// Helper: create a mock client that routes config calls automatically
// and queues monster responses in order
function createRoutingMockClient(monsterResponses: unknown[]) {
  const responseQueue = [...monsterResponses];
  const getRawFn = vi.fn(async (url: string) => {
    if (url.includes("config/json")) return MOCK_CONFIG;
    return responseQueue.shift();
  });
  return {
    get: vi.fn(),
    getRaw: getRawFn,
  } as unknown as DdbClient;
}

describe("searchMonsters", () => {
  it("shouldReturnFormattedListWhenMonstersFound", async () => {
    const mockClient = createRoutingMockClient([
      {
        accessType: { "17100": 1 },
        pagination: { take: 20, skip: 0, currentPage: 1, pages: 1, total: 1 },
        data: [MOCK_MONSTER],
      },
    ]);

    const result = await searchMonsters(mockClient, { name: "goblin" });

    expect(result.content[0].text).toContain("Monster Search Results");
    expect(result.content[0].text).toContain("Goblin");
  });

  it("shouldReturnNoResultsMessageWhenNoMonstersFound", async () => {
    const mockClient = createRoutingMockClient([
      {
        accessType: {},
        pagination: { take: 20, skip: 0, currentPage: 1, pages: 0, total: 0 },
        data: [],
      },
    ]);

    const result = await searchMonsters(mockClient, { name: "nonexistent" });

    expect(result.content[0].text).toContain("No monsters found");
  });

  it("shouldAcceptMultipleSearchParameters", async () => {
    const mockClient = createRoutingMockClient([
      {
        accessType: {},
        pagination: { take: 20, skip: 0, currentPage: 1, pages: 0, total: 0 },
        data: [],
      },
    ]);

    const params: MonsterSearchParams = {
      name: "dragon",
      cr: 10,
      type: "dragon",
      size: "huge",
    };

    const result = await searchMonsters(mockClient, params);
    expect(result).toHaveProperty("content");
    expect(result.content[0]).toHaveProperty("type", "text");
  });

  it("shouldAcceptEmptySearchParameters", async () => {
    const mockClient = createRoutingMockClient([
      {
        accessType: { "17100": 1 },
        pagination: { take: 20, skip: 0, currentPage: 1, pages: 1, total: 1 },
        data: [MOCK_MONSTER],
      },
    ]);

    const result = await searchMonsters(mockClient, {});
    expect(result).toHaveProperty("content");
    expect(result.content[0]).toHaveProperty("type", "text");
  });

  it("shouldHandlePaginationWithPageParameter", async () => {
    const mockClient = createRoutingMockClient([
      {
        accessType: { "17100": 1 },
        pagination: { take: 20, skip: 20, currentPage: 2, pages: 5, total: 97 },
        data: [MOCK_MONSTER],
      },
    ]);

    const result = await searchMonsters(mockClient, { page: 2 });

    expect(result.content[0].text).toContain("Monster Search Results");
    expect(result.content[0].text).toContain("Goblin");
  });

  it("shouldDefaultToPage1WhenPageNotSpecified", async () => {
    const mockClient = createRoutingMockClient([
      {
        accessType: { "17100": 1 },
        pagination: { take: 20, skip: 0, currentPage: 1, pages: 3, total: 50 },
        data: [MOCK_MONSTER],
      },
    ]);

    const result = await searchMonsters(mockClient, { name: "goblin" });

    expect(result.content[0].text).toContain("Monster Search Results");
    expect(result.content[0].text).toContain("Goblin");
  });

  it("shouldMarkHomebrewMonstersWithTag", async () => {
    const homebrewMonster = { ...MOCK_MONSTER, name: "Custom Dragon", isHomebrew: true };
    const mockClient = createRoutingMockClient([
      {
        accessType: { "17100": 1 },
        pagination: { take: 20, skip: 0, currentPage: 1, pages: 1, total: 2 },
        data: [MOCK_MONSTER, homebrewMonster],
      },
    ]);

    const result = await searchMonsters(mockClient, {});

    expect(result.content[0].text).toContain("**Custom Dragon** [Homebrew]");
    expect(result.content[0].text).not.toContain("Goblin** [Homebrew]");
  });

  it("shouldPassShowHomebrewParameterToEndpoint", async () => {
    const mockClient = createRoutingMockClient([
      {
        accessType: {},
        pagination: { take: 20, skip: 0, currentPage: 1, pages: 0, total: 0 },
        data: [],
      },
    ]);

    await searchMonsters(mockClient, { showHomebrew: true });

    expect(mockClient.getRaw).toHaveBeenCalled();
  });
});

function monsterVariant(over: Partial<typeof MOCK_MONSTER> & { id: number; name: string; isLegacy: boolean }) {
  return { ...MOCK_MONSTER, ...over };
}

describe("searchMonsters edition", () => {
  it("collapses cross-edition duplicates and tags only the other-edition rows", async () => {
    const data = [
      monsterVariant({ id: 1, name: "Goblin", isLegacy: true }),
      monsterVariant({ id: 2, name: "Goblin", isLegacy: false }),
      monsterVariant({ id: 3, name: "Owlbear", isLegacy: true }),
    ];
    const mc = createRoutingMockClient([
      { accessType: {}, pagination: { take: 20, skip: 0, currentPage: 1, pages: 1, total: 3 }, data },
    ]);
    const result = await searchMonsters(mc, { name: "g", edition: "2024" });
    const text = result.content[0].text;
    expect(text.match(/\*\*Goblin\*\*/g)).toHaveLength(1);
    expect(text).not.toMatch(/\*\*Goblin\*\* \[2014\]/);
    expect(text).toMatch(/\*\*Owlbear\*\* \[2014\]/);
  });

  it("leaves results unchanged when edition is omitted", async () => {
    const data = [
      monsterVariant({ id: 1, name: "Goblin", isLegacy: true }),
      monsterVariant({ id: 2, name: "Goblin", isLegacy: false }),
    ];
    const mc = createRoutingMockClient([
      { accessType: {}, pagination: { take: 20, skip: 0, currentPage: 1, pages: 1, total: 2 }, data },
    ]);
    const result = await searchMonsters(mc, { name: "goblin" });
    expect(result.content[0].text.match(/\*\*Goblin\*\*/g)).toHaveLength(2);
  });
});

describe("getMonster edition", () => {
  it("fetches the detail for the edition-matching variant", async () => {
    const search = {
      accessType: {},
      pagination: { take: 10, skip: 0, currentPage: 1, pages: 1, total: 2 },
      data: [
        monsterVariant({ id: 11, name: "Goblin", isLegacy: true }),
        monsterVariant({ id: 22, name: "Goblin", isLegacy: false }),
      ],
    };
    const detail = { data: monsterVariant({ id: 22, name: "Goblin", isLegacy: false }) };
    const urls: string[] = [];
    const getRaw = vi.fn(async (url: string) => {
      urls.push(url);
      if (url.includes("config")) return MOCK_CONFIG;       // getGameConfig during render
      if (url.includes("22")) return detail;                 // detail fetch for the 2024 variant
      if (url.includes("11")) return { data: monsterVariant({ id: 11, name: "Goblin", isLegacy: true }) };
      return search;                                         // the by-name search
    });
    const mc = { get: vi.fn(), getRaw } as unknown as DdbClient;

    const result = await getMonster(mc, { monsterName: "Goblin", edition: "2024" });
    expect(result.content[0].text).toContain("Goblin");
    const nonConfig = urls.filter((u) => !u.includes("config"));
    expect(nonConfig.some((u) => u.includes("22"))).toBe(true);
    expect(nonConfig.some((u) => u.includes("11"))).toBe(false);
  });
});

describe("getMonster saving throws", () => {
  it("shouldComputeSavingThrowBonusWhenApiReturnsNullBonusModifier", async () => {
    // Real D&D Beyond API returns bonusModifier: null for standard (non-overridden)
    // saving throw proficiencies — the bonus must be derived from ability modifier + proficiency bonus.
    const monster = monsterVariant({
      id: 17100,
      name: "Goblin",
      isLegacy: false,
      challengeRatingId: 5, // proficiencyBonus 2 per MOCK_CONFIG
      savingThrows: [{ statId: 2, bonusModifier: null }], // DEX 14 -> mod +2
    });
    const mockClient = createRoutingMockClient([
      {
        accessType: { "17100": 1 },
        pagination: { take: 5, skip: 0, currentPage: 1, pages: 1, total: 1 },
        data: [monster],
      },
      { accessType: 1, data: monster },
    ]);

    const result = await getMonster(mockClient, { monsterName: "Goblin" });

    expect(result.content[0].text).toContain("**Saving Throws** DEX +4");
    expect(result.content[0].text).not.toContain("null");
  });

  it("shouldUseExplicitBonusModifierWhenApiProvidesOne", async () => {
    const monster = monsterVariant({
      id: 17100,
      name: "Goblin",
      isLegacy: false,
      challengeRatingId: 5,
      savingThrows: [{ statId: 2, bonusModifier: 9 }],
    });
    const mockClient = createRoutingMockClient([
      {
        accessType: { "17100": 1 },
        pagination: { take: 5, skip: 0, currentPage: 1, pages: 1, total: 1 },
        data: [monster],
      },
      { accessType: 1, data: monster },
    ]);

    const result = await getMonster(mockClient, { monsterName: "Goblin" });

    expect(result.content[0].text).toContain("**Saving Throws** DEX +9");
  });
});

describe("getMonster", () => {
  it("shouldReturnNotFoundMessageWhenMonsterDoesNotExist", async () => {
    const mockClient = createRoutingMockClient([
      {
        accessType: {},
        pagination: { take: 5, skip: 0, currentPage: 1, pages: 0, total: 0 },
        data: [],
      },
    ]);

    const result = await getMonster(mockClient, { monsterName: "Nonexistent Monster" });

    expect(result.content[0].text).toContain("not found");
  });

  it("shouldReturnFormattedStatBlockStructure", async () => {
    const mockClient = createRoutingMockClient([
      {
        accessType: { "17100": 1 },
        pagination: { take: 5, skip: 0, currentPage: 1, pages: 1, total: 1 },
        data: [MOCK_MONSTER],
      },
      { accessType: 1, data: MOCK_MONSTER },
    ]);

    const result = await getMonster(mockClient, { monsterName: "Goblin" });

    expect(result.content[0].text).toContain("Goblin");
    expect(result.content[0].text).toContain("Armor Class");
    expect(result.content[0].text).toContain("Hit Points");
  });

  it("shouldHandleMonsterNameCaseInsensitively", async () => {
    const mockClient = createRoutingMockClient([
      {
        accessType: { "17100": 1 },
        pagination: { take: 5, skip: 0, currentPage: 1, pages: 1, total: 1 },
        data: [MOCK_MONSTER],
      },
      { accessType: 1, data: MOCK_MONSTER },
    ]);

    const result = await getMonster(mockClient, { monsterName: "goblin" });
    expect(result.content[0].text).toContain("Goblin");
  });

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
});
