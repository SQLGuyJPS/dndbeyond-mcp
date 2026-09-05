import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  searchItems,
  getItem,
  searchFeats,
  getCondition,
  searchClasses,
  listSources,
} from "../../src/tools/reference.js";
import { DdbClient } from "../../src/api/client.js";
import { ItemSearchParams, FeatSearchParams } from "../../src/types/reference.js";

const MOCK_CONFIG_WITH_SOURCES = {
  challengeRatings: [],
  monsterTypes: [],
  environments: [],
  alignments: [],
  damageTypes: [],
  senses: [],
  sources: [{ id: 999, name: "Test Book" }],
};

function fakeClientWithSources(items: unknown[]) {
  return {
    get: vi.fn().mockResolvedValue(items),
    getRaw: vi.fn().mockResolvedValue(MOCK_CONFIG_WITH_SOURCES),
  } as unknown as DdbClient;
}

const MOCK_ITEMS = [
  {
    id: 1, name: "Flame Tongue Longsword", type: "Weapon", filterType: "Weapon",
    rarity: "Rare", requiresAttunement: true, attunementDescription: "",
    description: "A fiery blade.", snippet: "A fiery blade.", weight: 3,
    cost: null, armorClass: null, damage: { diceString: "1d8" },
    properties: [{ name: "Versatile" }], isHomebrew: false, sources: [],
    canAttune: true, magic: true,
  },
  {
    id: 2, name: "Bag of Holding", type: "Wondrous Item", filterType: "Wondrous Item",
    rarity: "Uncommon", requiresAttunement: false, attunementDescription: "",
    description: "A bag that holds more.", snippet: "", weight: 15,
    cost: null, armorClass: null, damage: null, properties: null,
    isHomebrew: false, sources: [], canAttune: false, magic: true,
  },
];

const MOCK_FEATS = [
  { id: 1, name: "Alert", description: "Always on the lookout.", snippet: "Can't be surprised.", prerequisite: null, isHomebrew: false, sources: [] },
  { id: 2, name: "Grappler", description: "Advantage on grapple checks.", snippet: "Better at grappling.", prerequisite: "Strength 13 or higher", isHomebrew: false, sources: [] },
];

const MOCK_CLASSES = [
  { id: 10, name: "Fighter", description: "A master of martial combat.", hitDice: 10, isHomebrew: false, spellCastingAbilityId: null, sources: [] },
  { id: 8, name: "Wizard", description: "A scholarly magic-user.", hitDice: 6, isHomebrew: false, spellCastingAbilityId: 4, sources: [] },
];

describe("searchItems", () => {
  let mockClient: DdbClient;

  beforeEach(() => {
    mockClient = {
      get: vi.fn().mockResolvedValue(MOCK_ITEMS),
      getRaw: vi.fn(),
    } as unknown as DdbClient;
  });

  it("shouldReturnFormattedListWhenItemsFound", async () => {
    const result = await searchItems(mockClient, { name: "flame" });

    expect(result.content[0].text).toContain("Item Search Results");
    expect(result.content[0].text).toContain("Flame Tongue Longsword");
  });

  it("shouldReturnNoResultsMessageWhenNoItemsFound", async () => {
    const result = await searchItems(mockClient, { name: "nonexistent" });

    expect(result.content[0].text).toContain("No items found");
  });

  it("shouldAcceptMultipleSearchParameters", async () => {
    const params: ItemSearchParams = { name: "sword", rarity: "rare", type: "weapon" };
    const result = await searchItems(mockClient, params);

    expect(result).toHaveProperty("content");
    expect(result.content[0]).toHaveProperty("type", "text");
  });

  it("shouldAcceptEmptySearchParameters", async () => {
    const result = await searchItems(mockClient, {});

    expect(result).toHaveProperty("content");
    expect(result.content[0].text).toContain("Item Search Results");
  });
});

describe("getItem", () => {
  let mockClient: DdbClient;

  beforeEach(() => {
    mockClient = {
      get: vi.fn().mockResolvedValue(MOCK_ITEMS),
      getRaw: vi.fn(),
    } as unknown as DdbClient;
  });

  it("shouldReturnNotFoundMessageWhenItemDoesNotExist", async () => {
    const result = await getItem(mockClient, { itemName: "Nonexistent Item" });

    expect(result.content[0].text).toContain("not found");
    expect(result.content[0].text).toContain("Nonexistent Item");
  });

  it("shouldReturnFormattedItemDetailsStructure", async () => {
    const result = await getItem(mockClient, { itemName: "Flame Tongue Longsword" });

    expect(result.content[0].text).toContain("Flame Tongue Longsword");
    expect(result.content[0].text).toContain("Rare");
  });

  it("shouldHandleItemNameCaseInsensitively", async () => {
    const result = await getItem(mockClient, { itemName: "bag of holding" });
    expect(result.content[0].text).toContain("Bag of Holding");
  });
});

describe("searchFeats", () => {
  let mockClient: DdbClient;

  beforeEach(() => {
    mockClient = {
      get: vi.fn().mockResolvedValue(MOCK_FEATS),
      getRaw: vi.fn(),
    } as unknown as DdbClient;
  });

  it("shouldReturnFormattedListWhenFeatsFound", async () => {
    const result = await searchFeats(mockClient, { name: "alert" });

    expect(result.content[0].text).toContain("Feat Search Results");
    expect(result.content[0].text).toContain("Alert");
  });

  it("shouldReturnNoResultsMessageWhenNoFeatsFound", async () => {
    const result = await searchFeats(mockClient, { name: "nonexistent" });

    expect(result.content[0].text).toContain("No feats found");
  });

  it("shouldAcceptPrerequisiteParameter", async () => {
    const result = await searchFeats(mockClient, { name: "grappler", prerequisite: "strength" });

    expect(result).toHaveProperty("content");
    expect(result.content[0].text).toContain("Grappler");
  });

  it("shouldAcceptEmptySearchParameters", async () => {
    const result = await searchFeats(mockClient, {});

    expect(result).toHaveProperty("content");
    expect(result.content[0].text).toContain("Feat Search Results");
  });
});

describe("getCondition", () => {
  let mockClient: DdbClient;

  beforeEach(() => {
    mockClient = {
      get: vi.fn(),
      getRaw: vi.fn(),
    } as unknown as DdbClient;
  });

  it("shouldReturnNotFoundMessageWhenConditionDoesNotExist", async () => {
    const result = await getCondition(mockClient, { conditionName: "Nonexistent Condition" });

    expect(result.content[0].text).toContain("not found");
    expect(result.content[0].text).toContain("Nonexistent Condition");
  });

  it("shouldReturnFormattedConditionDetailsStructure", async () => {
    const result = await getCondition(mockClient, { conditionName: "blinded" });

    expect(result.content[0].text).toContain("Blinded");
    expect(result.content[0].text).toContain("can't see");
  });

  it("shouldHandleCommonConditions", async () => {
    const conditions = ["blinded", "charmed", "deafened", "frightened", "paralyzed", "stunned"];

    for (const conditionName of conditions) {
      const result = await getCondition(mockClient, { conditionName });
      expect(result).toHaveProperty("content");
      expect(result.content[0].text.length).toBeGreaterThan(10);
    }
  });
});

describe("searchClasses", () => {
  let mockClient: DdbClient;

  beforeEach(() => {
    mockClient = {
      get: vi.fn().mockResolvedValue(MOCK_CLASSES),
      getRaw: vi.fn(),
    } as unknown as DdbClient;
  });

  it("shouldReturnNoResultsMessageWhenNoClassesFound", async () => {
    const result = await searchClasses(mockClient, { className: "nonexistent" });

    expect(result.content[0].text).toContain("No classes found");
  });

  it("shouldReturnFormattedClassDetailsStructure", async () => {
    const result = await searchClasses(mockClient, { className: "Fighter" });

    expect(result.content[0].text).toContain("Fighter");
    expect(result.content[0].text).toContain("d10");
  });

  it("shouldAcceptEmptySearchParameters", async () => {
    const result = await searchClasses(mockClient, {});

    expect(result).toHaveProperty("content");
    expect(result.content[0].text).toContain("Class Search Results");
  });

  it("shouldHandleCommonClasses", async () => {
    const result = await searchClasses(mockClient, {});
    expect(result.content[0].text).toContain("Fighter");
    expect(result.content[0].text).toContain("Wizard");
  });
});

describe("listSources", () => {
  it("returns config sources as JSON", async () => {
    const client = fakeClientWithSources([]);
    const res = await listSources(client);
    const parsed = JSON.parse(res.content[0].text as string);
    expect(parsed).toEqual([{ id: 999, name: "Test Book" }]);
  });
});

describe("searchItems source/page", () => {
  it("filters items by source name", async () => {
    const items = [
      { id: 1, name: "Aaa Blade", type: "Weapon", filterType: "Weapon", rarity: "Rare", requiresAttunement: false, sources: [{ sourceId: 999 }] },
      { id: 2, name: "Bbb Ring", type: "Ring", filterType: "Ring", rarity: "Rare", requiresAttunement: true, sources: [{ sourceId: 1 }] },
      { id: 3, name: "Ccc Cloak", type: "Wondrous", filterType: "Wondrous", rarity: "Rare", requiresAttunement: false, sources: [{ sourceId: 999 }] },
    ];
    const client = fakeClientWithSources(items);
    const res = await searchItems(client, { rarity: "Rare", source: "Test Book" });
    const text = res.content[0].text as string;
    expect(text).toMatch(/Aaa Blade/);
    expect(text).toMatch(/Ccc Cloak/);
    expect(text).not.toMatch(/Bbb Ring/);
    expect(text).toMatch(/2 found/);
    // MOCK_CONFIG_WITH_SOURCES's "Test Book" source has no sourceCategoryId,
    // so isLegacyBySource can't determine an edition — [edition unknown] is
    // the honest tri-state tag (B2), not a silently-assumed 2024.
    expect(text).toMatch(/Aaa Blade\*\* \[edition unknown\] — Rare Weapon \[#1\]/);
    expect(text).toMatch(/\[#3\]/); // Ccc Cloak
  });

  it("paginates with page (page size 30)", async () => {
    const items = Array.from({ length: 35 }, (_, i) => ({
      id: i, name: `Item ${String(i).padStart(2, "0")}`, type: "Wondrous", filterType: "Wondrous",
      rarity: "Common", requiresAttunement: false, sources: [{ sourceId: 1 }],
    }));
    const client = fakeClientWithSources(items);
    const page2 = await searchItems(client, { rarity: "Common", page: 2 });
    const text = page2.content[0].text as string;
    expect(text).toMatch(/showing 5 of 35/);
    expect(text).toMatch(/of 35/);
    expect(text).toMatch(/Item 30/);
    expect(text).not.toMatch(/Item 05/);
  });
});
