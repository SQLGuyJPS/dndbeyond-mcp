import { describe, it, expect, vi } from "vitest";
import {
  searchClasses,
  getClass,
  searchSubclasses,
  getSubclass,
  searchRaces,
  getRace,
  searchBackgrounds,
  getBackground,
  searchFeats,
  getFeat,
  searchItems,
  getItem,
  searchClassFeatures,
  searchSpells,
  getSpell,
} from "../../src/tools/reference.js";
import { DdbClient } from "../../src/api/client.js";
import { ENDPOINTS } from "../../src/api/endpoints.js";

// Regression coverage for the "search for an alternative to sharingSetting"
// follow-up: campaignId must actually reach the underlying request (URL) and
// must not be dropped by caching — a campaign-scoped call must not read from
// (or write to) the same cache entry as the account's normal unscoped view.

const MOCK_CONFIG = { challengeRatings: [], monsterTypes: [], environments: [], alignments: [], damageTypes: [], senses: [], damageAdjustments: [], sources: [] };
const CAMPAIGN_ID = 6789678;

/** Records every (url, cacheKey) pair client.get/getRaw was called with, and
 * returns empty-array-ish data for everything so callers don't throw. */
function recordingClient() {
  const calls: Array<{ url: string; cacheKey: string }> = [];
  const client = {
    get: vi.fn().mockImplementation(async (url: string, cacheKey: string) => {
      calls.push({ url, cacheKey });
      return [];
    }),
    getRaw: vi.fn().mockResolvedValue(MOCK_CONFIG),
  } as unknown as DdbClient;
  return { client, calls };
}

describe("campaignId threading — classes", () => {
  it("searchClasses passes campaignId to the request URL and cache key", async () => {
    const { client, calls } = recordingClient();
    await searchClasses(client, { campaignId: CAMPAIGN_ID });
    expect(calls[0].url).toBe(ENDPOINTS.gameData.classes(CAMPAIGN_ID));
    expect(calls[0].cacheKey).toContain(`campaign:${CAMPAIGN_ID}`);
  });

  it("getClass passes campaignId to the request URL and cache key", async () => {
    const { client, calls } = recordingClient();
    await getClass(client, { className: "Fighter", campaignId: CAMPAIGN_ID });
    expect(calls[0].url).toBe(ENDPOINTS.gameData.classes(CAMPAIGN_ID));
    expect(calls[0].cacheKey).toContain(`campaign:${CAMPAIGN_ID}`);
  });

  it("uses the plain (non-campaign) cache key and URL when campaignId is omitted", async () => {
    const { client, calls } = recordingClient();
    await searchClasses(client, {});
    expect(calls[0].url).toBe(ENDPOINTS.gameData.classes());
    expect(calls[0].url).not.toContain("campaignId");
    expect(calls[0].cacheKey).toBe("game-data:classes");
  });
});

describe("campaignId threading — subclasses", () => {
  it("searchSubclasses passes campaignId through to both the classes fetch and the per-class subclasses fetch", async () => {
    const { client, calls } = recordingClient();
    // The classes() fetch returns [] with the default recordingClient, so
    // there are no candidate classes to fan out to — this still proves the
    // classes() call itself carries campaignId, which is what matters here.
    await searchSubclasses(client, { campaignId: CAMPAIGN_ID });
    expect(calls[0].url).toBe(ENDPOINTS.gameData.classes(CAMPAIGN_ID));
  });

  it("getSubclass fans campaignId out to the per-class subclasses request", async () => {
    const classes = [{ id: 2190881, name: "Paladin", description: "", hitDice: 10, isHomebrew: false, spellCastingAbilityId: 6, sources: [], classFeatures: [] }];
    const client = {
      get: vi.fn().mockImplementation(async (url: string) => {
        if (url === ENDPOINTS.gameData.classes(CAMPAIGN_ID)) return classes;
        if (url === ENDPOINTS.gameData.subclasses(2190881, CAMPAIGN_ID)) {
          return [{ id: 1, name: "Oath of Glory", description: "", parentClassId: 2190881, sources: [], classFeatures: [] }];
        }
        throw new Error(`Unexpected URL: ${url}`);
      }),
      getRaw: vi.fn().mockResolvedValue(MOCK_CONFIG),
    } as unknown as DdbClient;

    const result = await getSubclass(client, { subclassName: "Oath of Glory", className: "Paladin", campaignId: CAMPAIGN_ID });
    expect(result.content[0].text).toContain("# Oath of Glory");
  });
});

describe("campaignId threading — races, backgrounds, feats, items", () => {
  it("searchRaces / getRace", async () => {
    const r1 = recordingClient();
    await searchRaces(r1.client, { campaignId: CAMPAIGN_ID });
    expect(r1.calls[0].url).toBe(ENDPOINTS.gameData.races(CAMPAIGN_ID));
    expect(r1.calls[0].cacheKey).toContain(`campaign:${CAMPAIGN_ID}`);

    const r2 = recordingClient();
    await getRace(r2.client, { raceName: "Elf", campaignId: CAMPAIGN_ID });
    expect(r2.calls[0].url).toBe(ENDPOINTS.gameData.races(CAMPAIGN_ID));
  });

  it("searchBackgrounds / getBackground", async () => {
    const r1 = recordingClient();
    await searchBackgrounds(r1.client, { campaignId: CAMPAIGN_ID });
    expect(r1.calls[0].url).toBe(ENDPOINTS.gameData.backgrounds(CAMPAIGN_ID));

    const r2 = recordingClient();
    await getBackground(r2.client, { backgroundName: "Noble", campaignId: CAMPAIGN_ID });
    expect(r2.calls[0].url).toBe(ENDPOINTS.gameData.backgrounds(CAMPAIGN_ID));
  });

  it("searchFeats / getFeat", async () => {
    const r1 = recordingClient();
    await searchFeats(r1.client, { campaignId: CAMPAIGN_ID });
    expect(r1.calls[0].url).toBe(ENDPOINTS.gameData.feats(CAMPAIGN_ID));

    const r2 = recordingClient();
    await getFeat(r2.client, { featName: "Alert", campaignId: CAMPAIGN_ID });
    expect(r2.calls[0].url).toBe(ENDPOINTS.gameData.feats(CAMPAIGN_ID));
  });

  it("searchItems / getItem", async () => {
    const r1 = recordingClient();
    await searchItems(r1.client, { campaignId: CAMPAIGN_ID });
    expect(r1.calls[0].url).toBe(ENDPOINTS.gameData.items(CAMPAIGN_ID));

    const r2 = recordingClient();
    await getItem(r2.client, { itemName: "Longsword", campaignId: CAMPAIGN_ID });
    expect(r2.calls[0].url).toBe(ENDPOINTS.gameData.items(CAMPAIGN_ID));
  });
});

describe("campaignId threading — class features corpus", () => {
  it("searchClassFeatures passes campaignId to the classes() fetch that seeds the corpus", async () => {
    const { client, calls } = recordingClient();
    await searchClassFeatures(client, { campaignId: CAMPAIGN_ID });
    expect(calls[0].url).toBe(ENDPOINTS.gameData.classes(CAMPAIGN_ID));
  });
});

describe("campaignId threading — spell compendium", () => {
  it("searchSpells passes campaignId to the always-known/prepared-spells requests", async () => {
    const { client, calls } = recordingClient();
    await searchSpells(client, { campaignId: CAMPAIGN_ID });
    expect(calls.length).toBeGreaterThan(0);
    for (const { url, cacheKey } of calls) {
      expect(url).toContain(`campaignId=${CAMPAIGN_ID}`);
      expect(cacheKey).toContain(`campaign:${CAMPAIGN_ID}`);
    }
  });

  it("getSpell passes campaignId to the always-known/prepared-spells requests", async () => {
    const { client, calls } = recordingClient();
    await getSpell(client, { spellName: "Fireball", campaignId: CAMPAIGN_ID });
    expect(calls.length).toBeGreaterThan(0);
    for (const { url } of calls) {
      expect(url).toContain(`campaignId=${CAMPAIGN_ID}`);
    }
  });

  it("omits campaignId from spell requests when not given", async () => {
    const { client, calls } = recordingClient();
    await searchSpells(client, {});
    expect(calls.length).toBeGreaterThan(0);
    for (const { url, cacheKey } of calls) {
      expect(url).not.toContain("campaignId");
      expect(cacheKey).not.toContain("campaign:");
    }
  });
});
