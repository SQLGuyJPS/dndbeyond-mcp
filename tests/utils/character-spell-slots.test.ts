import { describe, it, expect } from "vitest";
import { getPactMagicState, buildPactMagicUpdateBody, warlockSlotLevel, warlockSlotCount } from "../../src/utils/character-spell-slots.js";
import type { DdbCharacter } from "../../src/types/character.js";

function warlock(level: number, pactMagic: DdbCharacter["pactMagic"]): DdbCharacter {
  return {
    classes: [{ id: 1, definition: { id: 2190885, name: "Warlock" }, subclassDefinition: null, level, isStartingClass: true, classFeatures: [] }],
    pactMagic,
  } as unknown as DdbCharacter;
}

describe("getPactMagicState", () => {
  it("passes through the object shape unchanged when available > 0", () => {
    const char = warlock(5, { level: 3, used: 1, available: 2 });
    expect(getPactMagicState(char)).toEqual({ level: 3, used: 1, available: 2 });
  });

  it("derives available from Warlock level when the array shape has available: 0 (level 1)", () => {
    const char = warlock(1, [{ level: 1, used: 0, available: 0 }]);
    expect(getPactMagicState(char)).toEqual({ level: 1, used: 0, available: 1 });
  });

  it("derives available at level 2 (2 slots)", () => {
    const char = warlock(2, [{ level: 1, used: 0, available: 0 }, { level: 1, used: 0, available: 0 }]);
    // slot level = min(ceil(2/2),5) = 1
    expect(getPactMagicState(char)!.available).toBe(2);
  });

  it("derives available at level 5 (2 slots, slot level 3)", () => {
    const rows = [1, 2, 3, 4, 5].map((level) => ({ level, used: 0, available: 0 }));
    const char = warlock(5, rows);
    expect(getPactMagicState(char)).toEqual({ level: 3, used: 0, available: 2 });
  });

  it("derives available at level 11 (3 slots, slot level 5)", () => {
    const rows = [1, 2, 3, 4, 5].map((level) => ({ level, used: 0, available: 0 }));
    const char = warlock(11, rows);
    expect(getPactMagicState(char)).toEqual({ level: 5, used: 0, available: 3 });
  });

  it("derives available at level 17 (4 slots)", () => {
    const rows = [1, 2, 3, 4, 5].map((level) => ({ level, used: 0, available: 0 }));
    const char = warlock(17, rows);
    expect(getPactMagicState(char)).toEqual({ level: 5, used: 0, available: 4 });
  });

  it("sums only Warlock levels for a multiclass character", () => {
    const char = {
      classes: [
        { id: 1, definition: { id: 2190885, name: "Warlock" }, subclassDefinition: null, level: 2, isStartingClass: true, classFeatures: [] },
        { id: 2, definition: { id: 1, name: "Fighter" }, subclassDefinition: null, level: 10, isStartingClass: false, classFeatures: [] },
      ],
      pactMagic: [{ level: 1, used: 0, available: 0 }],
    } as unknown as DdbCharacter;
    // Warlock level 2 => slot level 1, 2 slots — not influenced by 10 Fighter levels
    expect(getPactMagicState(char)).toEqual({ level: 1, used: 0, available: 2 });
  });

  it("returns null for a non-Warlock character", () => {
    const char = { classes: [{ id: 1, definition: { id: 1, name: "Fighter" }, subclassDefinition: null, level: 5, isStartingClass: true, classFeatures: [] }], pactMagic: { level: 1, used: 0, available: 0 } } as unknown as DdbCharacter;
    expect(getPactMagicState(char)).toBeNull();
  });

  it("returns null for an empty array", () => {
    const char = warlock(3, []);
    expect(getPactMagicState(char)).toBeNull();
  });

  it("returns null when pactMagic is null", () => {
    const char = warlock(3, null);
    expect(getPactMagicState(char)).toBeNull();
  });
});

describe("buildPactMagicUpdateBody", () => {
  it("targets the level row the character's current pact slot level resolves to", () => {
    const rows = [1, 2, 3].map((level) => ({ level, used: 0, available: 0 }));
    const char = warlock(3, rows);
    expect(buildPactMagicUpdateBody(char, 123, 1)).toEqual({ characterId: 123, level2: 1 });
  });
});

describe("warlockSlotLevel / warlockSlotCount", () => {
  it.each([
    [1, 1, 1],
    [2, 1, 2],
    [5, 3, 2],
    [10, 5, 2],
    [11, 5, 3],
    [16, 5, 3],
    [17, 5, 4],
    [20, 5, 4],
  ])("level %i => slot level %i, count %i", (level, expectedSlotLevel, expectedCount) => {
    expect(warlockSlotLevel(level)).toBe(expectedSlotLevel);
    expect(warlockSlotCount(level)).toBe(expectedCount);
  });
});
