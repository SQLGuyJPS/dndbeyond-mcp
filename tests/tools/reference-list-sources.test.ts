import { describe, it, expect, vi } from "vitest";
import { listSources } from "../../src/tools/reference.js";
import { DdbClient } from "../../src/api/client.js";

// A dedicated file (rather than a shared reference-*.test.ts) since
// getGameConfig caches its result in a module-level variable for 24h — even
// within this one file, a second test's differently-shaped mock client would
// never actually be consulted once the first test has populated the cache.
// So this exercises nameFilter/no-filter/no-match as one client, one test.

describe("listSources nameFilter", () => {
  // LOW finding from the 2026-09-01 edition-awareness test suite: the
  // unfiltered list runs to ~53k characters on a typical account, unusable
  // for a caller that only wants to check ownership of one or two books.
  it("narrows to sources matching nameFilter, passes through unfiltered, and reports no matches", async () => {
    const client = {
      getRaw: vi.fn().mockResolvedValue({
        challengeRatings: [], monsterTypes: [], environments: [], alignments: [],
        damageTypes: [], senses: [], damageAdjustments: [],
        sources: [
          { id: 1, name: "Player's Handbook" },
          { id: 2, name: "Tasha's Cauldron of Everything" },
          { id: 3, name: "Xanathar's Guide to Everything" },
        ],
      }),
    } as unknown as DdbClient;

    const filtered = await listSources(client, "tasha");
    expect(JSON.parse(filtered.content[0].text as string)).toEqual([
      { id: 2, name: "Tasha's Cauldron of Everything" },
    ]);

    const unfiltered = await listSources(client);
    expect(JSON.parse(unfiltered.content[0].text as string)).toHaveLength(3);

    const noMatch = await listSources(client, "nonexistent book");
    expect(JSON.parse(noMatch.content[0].text as string)).toEqual([]);
  });
});
