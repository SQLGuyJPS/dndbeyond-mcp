import { describe, it, expect, vi } from "vitest";
import { searchRacialTraits } from "../../src/tools/reference.js";
import { DdbClient } from "../../src/api/client.js";
import { ENDPOINTS } from "../../src/api/endpoints.js";

// C4: search_racial_traits used to source from
// ENDPOINTS.gameData.racialTraitCollection(), confirmed live to return
// `{ data: { definitionData: [], accessTypes: {} } }` — an object, not an
// array — which crashed every call with "items.map is not a function"
// regardless of race or edition. Fixed to build the trait list from each
// race's own `racialTraits[]` (already fetched by searchRaces/getRace), the
// same fix pattern as loadAllClassFeatures for the classFeatureCollection 404.

const dwarfLegacy = {
  entityRaceId: 1, fullName: "Dwarf", baseName: "Dwarf", baseRaceName: "Dwarf",
  description: "", isHomebrew: false, isLegacy: true, isSubRace: false, size: "Medium",
  sources: [{ sourceId: 1 }],
  racialTraits: [
    { definition: { id: 1, name: "Darkvision", description: "You have Darkvision 60 ft. (legacy).", snippet: "Darkvision 60 ft." } },
    { definition: { id: 2, name: "Dwarven Resilience", description: "Legacy poison resistance.", snippet: "" } },
  ],
};

const dwarfCurrent = {
  entityRaceId: 2, fullName: "Dwarf", baseName: "Dwarf", baseRaceName: "Dwarf",
  description: "", isHomebrew: false, isLegacy: false, isSubRace: false, size: "Medium",
  sources: [{ sourceId: 145 }],
  racialTraits: [
    { definition: { id: 3, name: "Darkvision", description: "You have Darkvision 120 ft.", snippet: "Darkvision 120 ft." } },
    { definition: { id: 4, name: "Dwarven Toughness", description: "Extra HP.", snippet: "" } },
  ],
};

const elfCurrent = {
  entityRaceId: 3, fullName: "Elf", baseName: "Elf", baseRaceName: "Elf",
  description: "", isHomebrew: false, isLegacy: false, isSubRace: false, size: "Medium",
  sources: [{ sourceId: 145 }],
  racialTraits: [
    { definition: { id: 5, name: "Darkvision", description: "You have Darkvision 60 ft. (Elf).", snippet: "" } },
    { definition: { id: 6, name: "Fey Ancestry", description: "Advantage vs charmed.", snippet: "" } },
  ],
};

function mockClient(races: unknown[]): DdbClient {
  return {
    get: vi.fn().mockImplementation(async (url: string) => {
      if (url === ENDPOINTS.gameData.races()) return races;
      throw new Error(`Unexpected URL in mock: ${url}`);
    }),
    getRaw: vi.fn(),
  } as unknown as DdbClient;
}

describe("searchRacialTraits", () => {
  it("does not crash and returns real trait rows (regression guard for C4)", async () => {
    const result = await searchRacialTraits(mockClient([dwarfCurrent]), {});
    const text = result.content[0].text;
    expect(text).toContain("Darkvision");
    expect(text).toContain("Dwarven Toughness");
    expect(text).toContain("Dwarf");
  });

  it("filters by raceName", async () => {
    const result = await searchRacialTraits(mockClient([dwarfCurrent, elfCurrent]), { raceName: "Elf" });
    const text = result.content[0].text;
    expect(text).toContain("Fey Ancestry");
    expect(text).not.toContain("Dwarven Toughness");
  });

  it("filters by trait name across races", async () => {
    const result = await searchRacialTraits(mockClient([dwarfCurrent, elfCurrent]), { name: "Darkvision" });
    const text = result.content[0].text;
    expect(text.match(/\*\*Darkvision\*\*/g)?.length).toBe(2);
    expect(text).toContain("Dwarf");
    expect(text).toContain("Elf");
  });

  it("shows both editions' same-named trait distinguishably when no edition is requested", async () => {
    const result = await searchRacialTraits(mockClient([dwarfLegacy, dwarfCurrent]), { name: "Darkvision" });
    const text = result.content[0].text;
    expect(text.match(/\*\*Darkvision\*\*/g)?.length).toBe(2);
    expect(text).toMatch(/\*\*Darkvision\*\* \*\(Legacy\)\*/);
  });

  it("collapses cross-edition duplicates for the same race+trait to the requested edition", async () => {
    const result = await searchRacialTraits(mockClient([dwarfLegacy, dwarfCurrent]), { name: "Darkvision", edition: "2024" });
    const text = result.content[0].text;
    expect(text.match(/\*\*Darkvision\*\*/g)?.length).toBe(1);
    expect(text).toContain("120 ft");
  });

  // The generic name-only collapse (collapseByEdition) would wrongly merge
  // Dwarf's and Elf's "Darkvision" into a single row when an edition is
  // requested — must stay keyed on race+name, not name alone.
  it("does not collapse the same trait name across different races when an edition is requested", async () => {
    const result = await searchRacialTraits(mockClient([dwarfCurrent, elfCurrent]), { name: "Darkvision", edition: "2024" });
    const text = result.content[0].text;
    expect(text.match(/\*\*Darkvision\*\*/g)?.length).toBe(2);
    expect(text).toContain("Dwarf");
    expect(text).toContain("Elf");
  });

  it("passes campaignId through to the races() request", async () => {
    const get = vi.fn().mockImplementation(async (url: string) => {
      if (url === ENDPOINTS.gameData.races(999)) return [dwarfCurrent];
      throw new Error(`Unexpected URL in mock: ${url}`);
    });
    const client = { get, getRaw: vi.fn() } as unknown as DdbClient;
    const result = await searchRacialTraits(client, { campaignId: 999 });
    expect(result.content[0].text).toContain("Darkvision");
  });

  it("returns a not-found message when nothing matches", async () => {
    const result = await searchRacialTraits(mockClient([dwarfCurrent]), { name: "Nonexistent Trait" });
    expect(result.content[0].text).toContain("No racial traits found");
  });
});
