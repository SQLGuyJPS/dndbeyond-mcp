import { describe, it, expect } from "vitest";
import { ENDPOINTS } from "../../src/api/endpoints.js";

// campaignId unlocks content shared with this account via a specific
// campaign (e.g. a subclass from a sourcebook the DM shared but the account
// doesn't own) — distinct from sharingSetting, which only widens *owned*
// content coverage. See the "Search for an alternative to sharingSetting"
// follow-up to the subclass-feature-independence work.
describe("ENDPOINTS.gameData campaignId support", () => {
  it("omits campaignId entirely when not given", () => {
    expect(ENDPOINTS.gameData.classes()).not.toContain("campaignId");
    expect(ENDPOINTS.gameData.subclasses(2190881)).not.toContain("campaignId");
    expect(ENDPOINTS.gameData.races()).not.toContain("campaignId");
    expect(ENDPOINTS.gameData.backgrounds()).not.toContain("campaignId");
    expect(ENDPOINTS.gameData.feats()).not.toContain("campaignId");
    expect(ENDPOINTS.gameData.items()).not.toContain("campaignId");
    expect(ENDPOINTS.gameData.alwaysKnownSpells(1)).not.toContain("campaignId");
    expect(ENDPOINTS.gameData.alwaysPreparedSpells(1)).not.toContain("campaignId");
  });

  it("appends campaignId as the only query param for endpoints with no other params", () => {
    expect(ENDPOINTS.gameData.classes(6789678)).toBe(
      "https://character-service.dndbeyond.com/character/v5/game-data/classes?campaignId=6789678"
    );
    expect(ENDPOINTS.gameData.races(6789678)).toBe(
      "https://character-service.dndbeyond.com/character/v5/game-data/races?campaignId=6789678"
    );
    expect(ENDPOINTS.gameData.backgrounds(6789678)).toBe(
      "https://character-service.dndbeyond.com/character/v5/game-data/backgrounds?campaignId=6789678"
    );
    expect(ENDPOINTS.gameData.feats(6789678)).toBe(
      "https://character-service.dndbeyond.com/character/v5/game-data/feats?campaignId=6789678"
    );
  });

  it("appends campaignId with & when other query params already exist", () => {
    expect(ENDPOINTS.gameData.subclasses(2190881, 6789678)).toBe(
      "https://character-service.dndbeyond.com/character/v5/game-data/subclasses?sharingSetting=3&baseClassId=2190881&campaignId=6789678"
    );
    expect(ENDPOINTS.gameData.items(6789678)).toBe(
      "https://character-service.dndbeyond.com/character/v5/game-data/items?sharingSetting=2&campaignId=6789678"
    );
    expect(ENDPOINTS.gameData.alwaysKnownSpells(1, 20, 6789678)).toBe(
      "https://character-service.dndbeyond.com/character/v5/game-data/always-known-spells?classId=1&classLevel=20&sharingSetting=3&campaignId=6789678"
    );
    expect(ENDPOINTS.gameData.alwaysPreparedSpells(1, 20, 6789678)).toBe(
      "https://character-service.dndbeyond.com/character/v5/game-data/always-prepared-spells?classId=1&classLevel=20&sharingSetting=3&campaignId=6789678"
    );
  });

  it("keeps baseClassId/classId/classLevel intact when campaignId is added", () => {
    expect(ENDPOINTS.gameData.subclasses(4, 111)).toContain("baseClassId=4");
    expect(ENDPOINTS.gameData.alwaysKnownSpells(7, 5, 111)).toContain("classId=7");
    expect(ENDPOINTS.gameData.alwaysKnownSpells(7, 5, 111)).toContain("classLevel=5");
  });
});
