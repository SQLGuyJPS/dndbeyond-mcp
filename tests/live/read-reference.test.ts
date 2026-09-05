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
import { ENDPOINTS } from "../../src/api/endpoints.js";
import type { DdbCampaign } from "../../src/types/api.js";

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

  // A1: whether the live items payload actually carries a native `isLegacy`
  // flag was unconfirmed at review time — searchItems/getItem apply a
  // sources[]-derived fallback either way (see reference-editions.test.ts),
  // but this is the one assertion that tells us whether that fallback is
  // purely defensive or actually load-bearing. Gating result for A1 — see
  // docs/plans/2026-08-26-pr12-review-response.md.
  it("should carry a native isLegacy flag on the raw items payload", async () => {
    const client = await getLiveClient();
    const items = await client.get<Array<{ isLegacy?: boolean }>>(
      ENDPOINTS.gameData.items(),
      "live-items-raw",
      60_000,
    );

    expect(items.some((i) => typeof i.isLegacy === "boolean")).toBe(true);
    expect(items.some((i) => i.isLegacy === true)).toBe(true);
  });

  it("should collapse a reprinted magic item to the requested edition", async () => {
    const client = await getLiveClient();
    // Bag of Holding is reprinted 2014 -> 2024 and free/owned content, so
    // this account should always see both variants pre-collapse.
    const both = await searchItems(client, { name: "bag of holding" });
    expect(both.content[0].text.match(/Bag of Holding/g)?.length).toBe(2);

    const legacy = await searchItems(client, { name: "bag of holding", edition: "2014" });
    expect(legacy.content[0].text.match(/Bag of Holding/g)?.length).toBe(1);

    const legacyItem = await getItem(client, { itemName: "Bag of Holding", edition: "2014" });
    expect(legacyItem.content[0].text).toContain("*(2014)*");
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

  // A1 step 6: feats had no live edition coverage at all before this plan.
  // Confirmed live (2026-08-29) that this account's feats() payload carries
  // no native `isLegacy` at all (feats never do — see isLegacyBySource's doc
  // comment) and only one "Chef" (the 2024 printing, source id 145) — the
  // legacy Chef comes from a sourcebook this particular account doesn't own,
  // so a strict "both editions" assertion isn't portable across accounts.
  // What *is* portable, and is the actual regression this guards: a
  // recognized source must resolve to a definite true/false, never the
  // "[edition unknown]"/"*(edition undetermined)*" tri-state fallback (that
  // would mean the derivation broke, e.g. config stopped listing source 145).
  it("should resolve Chef's edition via source-derivation, never as undetermined", async () => {
    const client = await getLiveClient();
    const result = await searchFeats(client, { name: "chef" });
    const text = result.content[0].text;

    expect(text).toContain("Chef");
    expect(text).not.toContain("edition unknown");

    if ((text.match(/\*\*Chef\*\*/g)?.length ?? 0) > 1) {
      // This account happens to own both printings — the stronger assertion applies.
      expect(text).toMatch(/\*\*Chef\*\* \*\(Legacy\)\*/);
    }
  });

  it("should label get_feat's header with a definite edition, never undetermined", async () => {
    const client = await getLiveClient();
    const current = await getFeat(client, { featName: "Chef", edition: "2024" });
    const legacy = await getFeat(client, { featName: "Chef", edition: "2014" });

    expect(current.content[0].text).toContain("*(2024)*");
    // If this account doesn't own the legacy printing, pickByEdition falls
    // back to the only variant that exists (2024) rather than erroring —
    // documented, correct behavior, not a bug. Assert *some* definite label
    // either way; only assert it's specifically *(2014)* when that variant
    // is actually present.
    expect(legacy.content[0].text).toMatch(/\*\(20(14|24)\)\*/);
    expect(legacy.content[0].text).not.toContain("undetermined");
    if (legacy.content[0].text !== current.content[0].text) {
      expect(legacy.content[0].text).toContain("*(2014)*");
    }
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
  // docs/plans/2026-08-24-subclass-feature-independence-handoff.md: subclass features were only
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

describe("Live: campaignId support", () => {
  // The follow-up to the subclass-feature-independence fix: sharingSetting
  // only widens *owned*-content coverage, so a subclass whose sourcebook the
  // account doesn't own (e.g. legacy Oath of Glory, gated behind Tasha's
  // Cauldron of Everything) stays unreachable without campaignId even though
  // a DM may have shared it via a campaign. This exercises campaignId
  // end-to-end against the live API rather than re-deriving which specific
  // campaign/subclass pairing (if any) is unlocked on this account, since
  // that depends on what the test account's campaigns currently share.

  it("accepts a real campaignId without error on every affected tool", async () => {
    const client = await getLiveClient();
    const campaigns = await client.get<DdbCampaign[]>(ENDPOINTS.campaign.list(), "live-campaigns-raw", 60_000);

    if (!campaigns || campaigns.length === 0) {
      return; // No campaigns on this account to scope to — nothing to test.
    }
    const campaignId = campaigns[0].id;

    // None of these should throw, and each should still return well-formed
    // results (possibly identical to the unscoped call, if this particular
    // campaign shares nothing extra for that entity type).
    const results = await Promise.all([
      searchClasses(client, { campaignId }),
      searchSubclasses(client, { className: "Paladin", campaignId }),
      searchRaces(client, { name: "elf", campaignId }),
      searchBackgrounds(client, { campaignId }),
      searchFeats(client, { name: "alert", campaignId }),
      searchItems(client, { name: "longsword", campaignId }),
      searchClassFeatures(client, { name: "Glory", campaignId }),
    ]);

    for (const result of results) {
      expect(result.content[0].text).toBeDefined();
      expect(result.content[0].text.length).toBeGreaterThan(0);
    }
  }, 60_000);

  it("a campaign-scoped subclass lookup either matches or exceeds the unscoped one", async () => {
    const client = await getLiveClient();
    const campaigns = await client.get<DdbCampaign[]>(ENDPOINTS.campaign.list(), "live-campaigns-raw", 60_000);

    if (!campaigns || campaigns.length === 0) {
      return;
    }

    // Look across every campaign for one that unlocks the legacy Oath of
    // Glory (unreachable without campaignId per the original handoff doc's
    // investigation, unless this account now owns Tasha's Cauldron of
    // Everything outright). Best-effort: if none of the account's current
    // campaigns share it, that's a valid outcome too — just skip the assertion
    // rather than failing on account-state this test doesn't control.
    const unscoped = await getSubclass(client, { subclassName: "Oath of Glory", className: "Paladin", edition: "2014" });
    if (!unscoped.content[0].text.toLowerCase().includes("not found")) {
      return; // Already owned outright — campaignId isn't the deciding factor here.
    }

    for (const campaign of campaigns) {
      const scoped = await getSubclass(client, { subclassName: "Oath of Glory", className: "Paladin", edition: "2014", campaignId: campaign.id });
      if (!scoped.content[0].text.toLowerCase().includes("not found")) {
        expect(scoped.content[0].text).toContain("# Oath of Glory");
        return; // Found a campaign that unlocks it — regression confirmed.
      }
    }
    // No campaign on this account currently shares it — not a failure, just
    // means this account's campaign-sharing state has changed since the
    // original investigation.
  }, 60_000);

  it("a campaign-scoped feat lookup either matches or exceeds the unscoped one", async () => {
    const client = await getLiveClient();
    const campaigns = await client.get<DdbCampaign[]>(ENDPOINTS.campaign.list(), "live-campaigns-raw", 60_000);

    if (!campaigns || campaigns.length === 0) {
      return;
    }

    // Mirrors the Oath of Glory test above, for the entity that actually
    // surfaced this gap (see the "should resolve Chef's edition" test in the
    // feat block above). Feats don't behave like subclasses here: get_feat's
    // edition pick falls back to whichever printing exists instead of
    // reporting "not found", so a present-but-wrong-edition *(2024)* tag is
    // the unscoped-ownership signal, not absence. Best-effort: if this
    // account owns legacy Chef outright, or none of its campaigns currently
    // share it, that's a valid outcome too — this only asserts the positive
    // case when the account state actually supports it.
    const unscoped = await getFeat(client, { featName: "Chef", edition: "2014" });
    if (unscoped.content[0].text.includes("*(2014)*")) {
      return; // Already owned outright — campaignId isn't the deciding factor here.
    }

    for (const campaign of campaigns) {
      const scoped = await getFeat(client, { featName: "Chef", edition: "2014", campaignId: campaign.id });
      if (scoped.content[0].text.includes("*(2014)*")) {
        expect(scoped.content[0].text).toContain("# Chef");
        return; // Found a campaign that unlocks it — regression confirmed.
      }
    }
    // No campaign on this account currently shares it — not a failure, just
    // means this account's campaign-sharing state has changed since this was
    // confirmed live (2026-08-30) via a campaign sharing Tasha's Cauldron of
    // Everything.
  }, 60_000);
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
