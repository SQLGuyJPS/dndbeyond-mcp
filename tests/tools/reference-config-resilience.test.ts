import { describe, it, expect, vi } from "vitest";
import { searchClasses, searchBackgrounds, searchFeats } from "../../src/tools/reference.js";
import { DdbClient } from "../../src/api/client.js";

// Regression coverage for a behavior change introduced by edition support:
// searchClasses/searchBackgrounds/searchFeats now fetch the shared game config
// (via getGameConfigSafe) to derive isLegacy from source books, whereas before
// they had zero dependency on the config endpoint. If that endpoint is down,
// these searches must still return results — just without edition tags —
// rather than fail outright the way they never used to.
//
// This lives in its own file (not reference-editions.test.ts) so the
// module-level game-config cache starts empty: a shared file would let an
// earlier passing config fetch mask a real regression in the failure path.

function mockClientWithFailingConfig(collection: unknown[]): DdbClient {
  return {
    get: vi.fn().mockResolvedValue(collection),
    getRaw: vi.fn().mockRejectedValue(new Error("config endpoint unreachable")),
  } as unknown as DdbClient;
}

describe("reference tools degrade gracefully when game config is unavailable", () => {
  it("searchClasses still returns results (untagged) when config fetch fails", async () => {
    const classes = [{ id: 10, name: "Fighter", description: "", hitDice: 10, isHomebrew: false, spellCastingAbilityId: null, sources: [{ sourceId: 1 }] }];
    const result = await searchClasses(mockClientWithFailingConfig(classes), {});
    expect(result.content[0].text).toContain("Fighter");
    expect(result.content[0].text).not.toContain("*(Legacy)*");
  });

  it("searchBackgrounds still returns results (untagged) when config fetch fails", async () => {
    const backgrounds = [{ id: 10, name: "Noble", description: "", isHomebrew: false, sources: [{ sourceId: 1 }] }];
    const result = await searchBackgrounds(mockClientWithFailingConfig(backgrounds), {});
    expect(result.content[0].text).toContain("Noble");
    expect(result.content[0].text).not.toContain("*(Legacy)*");
  });

  it("searchFeats still returns results (untagged) when config fetch fails", async () => {
    const feats = [{ id: 1, name: "Alert", description: "", snippet: "", isHomebrew: false, sources: [{ sourceId: 1 }] }];
    const result = await searchFeats(mockClientWithFailingConfig(feats), {});
    expect(result.content[0].text).toContain("Alert");
    expect(result.content[0].text).not.toContain("*(Legacy)*");
  });
});
