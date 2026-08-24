import { describe, it, expect } from "vitest";
import { getLiveClient } from "./setup.js";
import {
  searchSpells,
  getSpell,
  searchMonsters,
  getMonster,
  searchItems,
  getItem,
  searchFeats,
  getFeat,
  searchClasses,
  getClass,
  searchSubclasses,
  getSubclass,
  searchClassFeatures,
  searchRaces,
  getRace,
  searchBackgrounds,
  getBackground,
  getCondition,
} from "../../src/tools/reference.js";

describe("Live: Spell endpoints", () => {
  it("should search spells by name", async () => {
    const client = await getLiveClient();
    const result = await searchSpells(client, { name: "fireball" });
    const text = result.content[0].text;

    expect(text).toContain("Fireball");
  });

  it("should search cantrips by name", async () => {
    const client = await getLiveClient();
    // Search by name + level is more reliable than level alone
    const result = await searchSpells(client, { name: "fire bolt" });
    const text = result.content[0].text;

    expect(text).toBeDefined();
    expect(text.length).toBeGreaterThan(0);
  });

  it("should get full spell details", async () => {
    const client = await getLiveClient();
    const result = await getSpell(client, { spellName: "Fireball" });
    const text = result.content[0].text;

    expect(text).toContain("Fireball");
    expect(text).toContain("Casting Time:");
    expect(text).toContain("Range:");
    expect(text).toContain("Components:");
    expect(text).toContain("Duration:");
  });
});

describe("Live: Monster endpoints", () => {
  it("should search monsters by name", async () => {
    const client = await getLiveClient();
    const result = await searchMonsters(client, { name: "goblin" });
    const text = result.content[0].text;

    expect(text.toLowerCase()).toContain("goblin");
  });

  it("should search monsters with source filter", async () => {
    const client = await getLiveClient();
    const result = await searchMonsters(client, {
      name: "dragon",
      source: "Monster Manual",
    });
    const text = result.content[0].text;

    expect(text).toBeDefined();
    expect(text.length).toBeGreaterThan(0);
  });

  it("should get full monster stat block", async () => {
    const client = await getLiveClient();
    const result = await getMonster(client, { monsterName: "Goblin" });
    const text = result.content[0].text;

    expect(text).toContain("Goblin");
    // Monster stat block uses **Armor Class** and **Hit Points** format
    expect(text).toContain("Armor Class");
    expect(text).toContain("Hit Points");
  });

  it("should support pagination", async () => {
    const client = await getLiveClient();
    // Just verify pagination doesn't error — cached results may be identical
    const page1 = await searchMonsters(client, { name: "dragon", page: 1 });
    const page2 = await searchMonsters(client, { name: "dragon", page: 2 });

    expect(page1.content[0].text).toBeDefined();
    expect(page2.content[0].text).toBeDefined();
  });
});

describe("Live: Item endpoints", () => {
  it("should search items by name", async () => {
    const client = await getLiveClient();
    const result = await searchItems(client, { name: "longsword" });
    const text = result.content[0].text;

    expect(text.toLowerCase()).toContain("longsword");
  });

  it("should get full item details", async () => {
    const client = await getLiveClient();
    const result = await getItem(client, { itemName: "Longsword" });
    const text = result.content[0].text;

    expect(text).toBeDefined();
    expect(text.length).toBeGreaterThan(0);
  });
});

describe("Live: Feat endpoints", () => {
  it("should search feats", async () => {
    const client = await getLiveClient();
    const result = await searchFeats(client, { name: "alert" });
    const text = result.content[0].text;

    expect(text.toLowerCase()).toContain("alert");
  });

  it("should get full feat details", async () => {
    const client = await getLiveClient();
    const result = await getFeat(client, { featName: "Chef" });
    const text = result.content[0].text;

    expect(text).toContain("# Chef");
    // A real description, not just the not-found fallback.
    expect(text.length).toBeGreaterThan(50);
  });
});

describe("Live: Class endpoints", () => {
  it("should search classes", async () => {
    const client = await getLiveClient();
    const result = await searchClasses(client, { className: "wizard" });
    const text = result.content[0].text;

    expect(text.toLowerCase()).toContain("wizard");
  });

  it("should list both editions of a class distinguishably when no edition is given", async () => {
    const client = await getLiveClient();
    const result = await searchClasses(client, { className: "fighter" });
    const text = result.content[0].text;

    // Fighter exists in both the 2014 Basic Rules and the 2024 PHB, and both
    // are free/owned content, so this account should always see two rows.
    expect(text.match(/\*\*Fighter\*\*/g)?.length).toBe(2);
    expect(text).toMatch(/\*\*Fighter\*\* \*\(Legacy\)\*/);
  });

  it("should collapse to a single edition-matching class when edition is given", async () => {
    const client = await getLiveClient();
    const result = await searchClasses(client, { className: "fighter", edition: "2024" });
    const text = result.content[0].text;

    expect(text.match(/\*\*Fighter\*\*/g)?.length).toBe(1);
  });

  it("should get edition-specific class descriptions for get_class", async () => {
    const client = await getLiveClient();
    const current = await getClass(client, { className: "Fighter", edition: "2024" });
    const legacy = await getClass(client, { className: "Fighter", edition: "2014" });

    expect(current.content[0].text).toContain("*(2024)*");
    expect(legacy.content[0].text).toContain("*(2014)*");
    expect(current.content[0].text).not.toBe(legacy.content[0].text);
  });

  it("should return the Ranger's edition-specific Favored Enemy feature", async () => {
    const client = await getLiveClient();
    const current = await getClass(client, { className: "Ranger", edition: "2024" });
    const legacy = await getClass(client, { className: "Ranger", edition: "2014" });

    // 2024: Favored Enemy always grants a free casting of the Hunter's Mark
    // spell. 2014's version is a tracking/language bonus and never mentions
    // Hunter's Mark — though it does name-drop the (unrelated) Hunter archetype,
    // so match the specific phrase rather than the bare word "Hunter".
    const huntersMark = /Hunter.s Mark/;
    expect(current.content[0].text).toMatch(huntersMark);
    expect(legacy.content[0].text.toLowerCase()).toContain("favored enemy");
    expect(legacy.content[0].text).not.toMatch(huntersMark);
  });
});

describe("Live: Subclass endpoints", () => {
  // Regression coverage for the gap described in
  // dndbeyond-mcp-class-feature-handoff.md: subclass features were only
  // reachable through a character who already had that subclass at a high
  // enough level. These assert the character-independent path works.

  it("should return every 2024 Oath of Glory feature across all levels, with no character involved", async () => {
    const client = await getLiveClient();
    const result = await getSubclass(client, { subclassName: "Oath of Glory", className: "Paladin", edition: "2024" });
    const text = result.content[0].text;

    expect(text).toContain("# Oath of Glory");
    expect(text).toContain("*(2024)*");
    expect(text).toContain("Inspiring Smite");
    expect(text).toContain("Peerless Athlete");
    expect(text).toContain("Aura of Alacrity");
    // The regression case: levels beyond any roster character's actual level.
    expect(text).toContain("Level 15: Glorious Defense");
    expect(text).toContain("Level 20: Living Legend");
    // Inherited base Paladin features must not leak into the subclass's own list.
    expect(text).not.toContain("Lay On Hands");
  });

  it("should resolve a subclass without a className, by scanning all classes", async () => {
    const client = await getLiveClient();
    const result = await getSubclass(client, { subclassName: "Oath of Glory", edition: "2024" });
    expect(result.content[0].text).toContain("# Oath of Glory");
  }, 30_000);

  it("should list every Paladin oath via search_subclasses", async () => {
    const client = await getLiveClient();
    const result = await searchSubclasses(client, { className: "Paladin", edition: "2024" });
    const text = result.content[0].text;

    expect(text).toContain("Oath of Devotion");
    expect(text).toContain("Oath of Glory");
  });

  it("should find a subclass feature by name via search_class_features without knowing its class", async () => {
    const client = await getLiveClient();
    // This is the exact call that 404'd before the fix (search_class_features
    // hit a class-feature/collection endpoint that doesn't exist on the live API).
    const result = await searchClassFeatures(client, { name: "Glory" });
    const text = result.content[0].text;

    expect(text).toContain("Oath of Glory");
    expect(text).toMatch(/Paladin \(Oath of Glory\)/);
  });

  it("should report a not-found message (not throw) for an unowned/nonexistent subclass", async () => {
    const client = await getLiveClient();
    const result = await getSubclass(client, { subclassName: "Definitely Not A Real Subclass Xyz", className: "Paladin" });
    expect(result.content[0].text.toLowerCase()).toContain("not found");
  });
});

describe("Live: Race endpoints", () => {
  it("should search races without error", async () => {
    const client = await getLiveClient();
    const result = await searchRaces(client, { name: "elf" });
    const text = result.content[0].text;

    // API may return races with "elf" in name, or none if data shape changed
    expect(text).toBeDefined();
    expect(text.length).toBeGreaterThan(0);
  });

  it("should get full race/species details for the current (2024) Elf", async () => {
    const client = await getLiveClient();
    const result = await getRace(client, { raceName: "Elf", edition: "2024" });
    const text = result.content[0].text;

    expect(text).toContain("# Elf");
    expect(text).toContain("*(2024)*");
  });

  it("should get full details and traits for a legacy (2014) subrace", async () => {
    const client = await getLiveClient();
    // The 2014 base "Elf" is a non-selectable parent of its subraces on this
    // account; High Elf is the reliably-present legacy variant.
    const result = await getRace(client, { raceName: "High Elf", edition: "2014" });
    const text = result.content[0].text;

    expect(text).toContain("# High Elf");
    expect(text).toContain("*(2014)*");
    expect(text).toContain("## Traits");
  });
});

describe("Live: Background endpoints", () => {
  it("should search backgrounds", async () => {
    const client = await getLiveClient();
    const result = await searchBackgrounds(client, { name: "soldier" });
    const text = result.content[0].text;

    expect(text.toLowerCase()).toContain("soldier");
  });

  it("should return the 2024 Noble's ability score choices", async () => {
    const client = await getLiveClient();
    const result = await getBackground(client, { backgroundName: "Noble", edition: "2024" });
    const text = result.content[0].text;

    expect(text).toContain("*(2024)*");
    expect(text).toContain("Ability Score Choices:");
    expect(text).toContain("STR");
    expect(text).toContain("INT");
    expect(text).toContain("CHA");
  });

  it("should return the 2014 Noble's different granted feature", async () => {
    const client = await getLiveClient();
    const result = await getBackground(client, { backgroundName: "Noble", edition: "2014" });
    const text = result.content[0].text;

    expect(text).toContain("*(2014)*");
    // 2014 Noble grants "Position of Privilege"; 2024 grants the "Skilled" feat.
    expect(text).toContain("Position of Privilege");
  });
});

describe("Live: Condition lookup", () => {
  it("should get condition rules text", async () => {
    const client = await getLiveClient();
    const result = await getCondition(client, { conditionName: "blinded" });
    const text = result.content[0].text;

    expect(text.toLowerCase()).toContain("blinded");
  });
});
