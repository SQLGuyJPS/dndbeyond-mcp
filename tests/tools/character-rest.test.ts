import { describe, it, expect, vi, beforeEach } from "vitest";
import { longRest, shortRest } from "../../src/tools/character.js";
import type { DdbClient } from "../../src/api/client.js";
import type { DdbCharacter } from "../../src/types/character.js";

const multiclassCharacter = {
  classes: [
    { id: 111, definition: { id: 1, name: "Fighter" }, subclassDefinition: null, level: 3, isStartingClass: true, classFeatures: [], hitDiceUsed: 2 },
    { id: 222, definition: { id: 2, name: "Wizard" }, subclassDefinition: null, level: 2, isStartingClass: false, classFeatures: [], hitDiceUsed: 0 },
  ],
} as unknown as DdbCharacter;

describe("longRest", () => {
  let mockClient: DdbClient;

  beforeEach(() => {
    mockClient = {
      get: vi.fn().mockResolvedValue({}),
      getRaw: vi.fn(),
      post: vi.fn().mockResolvedValue({}),
      invalidateCache: vi.fn(),
    } as unknown as DdbClient;
  });

  it("should POST to the server-side long rest endpoint with a body and invalidate cache", async () => {
    const result = await longRest(mockClient, { characterId: 123 });

    expect(result.content[0].text).toContain("Long rest completed for character 123");
    expect(result.content[0].text).toContain("HP, spell slots, and long-rest abilities have been restored");

    // Restored 2026-09-06 (Phase 0 P9): POST with body, not GET with query —
    // the GET form returns a plausible 200 but never persists the reset.
    expect(mockClient.post).toHaveBeenCalledWith(
      expect.stringContaining("/character/v5/character/rest/long"),
      { characterId: 123, resetMaxHpModifier: true, adjustConditionLevel: false }
    );
    expect(mockClient.post).not.toHaveBeenCalledWith(expect.stringContaining("characterId=123"), expect.anything());

    expect(mockClient.invalidateCache).toHaveBeenCalledWith("character:123");
  });
});

describe("shortRest", () => {
  let mockClient: DdbClient;

  beforeEach(() => {
    mockClient = {
      get: vi.fn().mockResolvedValue(multiclassCharacter),
      getRaw: vi.fn(),
      post: vi.fn().mockResolvedValue({}),
      invalidateCache: vi.fn(),
    } as unknown as DdbClient;
  });

  it("should POST to the server-side short rest endpoint with classHitDiceUsed keyed by class-mapping id", async () => {
    const result = await shortRest(mockClient, { characterId: 123 });

    expect(result.content[0].text).toContain("Short rest completed for character 123");
    expect(result.content[0].text).toContain("Pact magic and short-rest abilities have been restored");

    expect(mockClient.post).toHaveBeenCalledWith(
      expect.stringContaining("/character/v5/character/rest/short"),
      {
        characterId: 123,
        classHitDiceUsed: { 111: 2, 222: 0 },
        resetMaxHpModifier: false,
      }
    );

    expect(mockClient.invalidateCache).toHaveBeenCalledWith("character:123");
  });
});
