import { describe, it, expect } from "vitest";
import { getCharacterSpellEntries, formatSpellAnnotation, formatCastingMode } from "../../src/utils/character-spells.js";
import type { DdbCharacter, DdbSpell } from "../../src/types/character.js";

// Item 8 (v0.9.0): confirmed live 2026-09-09 that D&D Beyond marks every
// at-will/limited-use racial, feat, and item spell `prepared: false,
// alwaysPrepared: false` — structurally identical to a prepared caster's
// "known but not chosen today" spell. The old filter (prepared ||
// alwaysPrepared) dropped all of them. See character-spells.ts.

function makeSpell(overrides: Partial<DdbSpell> & { definition: Partial<DdbSpell["definition"]> }): DdbSpell {
  return {
    id: 1,
    prepared: false,
    alwaysPrepared: false,
    usesSpellSlot: false,
    limitedUse: null,
    ...overrides,
    definition: {
      id: 1,
      name: "Test Spell",
      level: 0,
      school: "Evocation",
      description: "",
      range: null,
      duration: null,
      activation: null,
      components: null,
      componentsDescription: null,
      concentration: false,
      ritual: false,
      ...overrides.definition,
    },
  } as DdbSpell;
}

function baseChar(spells: Partial<DdbCharacter["spells"]>, classSpells?: DdbCharacter["classSpells"]): DdbCharacter {
  return {
    spells: { race: [], class: [], background: [], item: [], feat: [], ...spells },
    classSpells,
  } as unknown as DdbCharacter;
}

describe("getCharacterSpellEntries", () => {
  it("includes a prepared:false, alwaysPrepared:false racial at-will spell", () => {
    const char = baseChar({ race: [makeSpell({ id: 10, definition: { id: 2618890, name: "Fire Bolt", level: 0 } })] });
    const entries = getCharacterSpellEntries(char);
    expect(entries).toHaveLength(1);
    expect(entries[0].spell.definition.name).toBe("Fire Bolt");
  });

  it("includes a prepared:false feat-granted limited-use spell", () => {
    const char = baseChar({
      feat: [makeSpell({
        id: 20,
        definition: { id: 2619143, name: "Healing Word", level: 1 },
        limitedUse: { maxUses: 1, numberUsed: 0, resetType: 2, resetTypeDescription: "Long Rest" },
      })],
    });
    const entries = getCharacterSpellEntries(char);
    expect(entries).toHaveLength(1);
    expect(entries[0].limitedUse?.maxUses).toBe(1);
  });

  it("merges the same spell from two sources into one entry, crediting both", () => {
    const char = baseChar({
      race: [makeSpell({ id: 30, definition: { id: 999, name: "Darkness", level: 2 } })],
      item: [makeSpell({ id: 31, definition: { id: 999, name: "Darkness", level: 2 } })],
    });
    const entries = getCharacterSpellEntries(char);
    expect(entries).toHaveLength(1);
    expect([...entries[0].sources].sort()).toEqual(["item", "race"]);
  });

  it("ORs prepared/alwaysPrepared/usesSpellSlot across merged sources", () => {
    const char = baseChar({
      race: [makeSpell({ id: 40, definition: { id: 555, name: "Shield" }, prepared: false, usesSpellSlot: false })],
      class: [makeSpell({ id: 41, definition: { id: 555, name: "Shield" }, prepared: true, usesSpellSlot: true })],
    });
    const entries = getCharacterSpellEntries(char);
    expect(entries).toHaveLength(1);
    expect(entries[0].prepared).toBe(true);
    expect(entries[0].usesSpellSlot).toBe(true);
  });

  it("merges in classSpells entries not present in spells.class", () => {
    const char = baseChar(
      { class: [makeSpell({ id: 50, definition: { id: 1, name: "Known Spell" } })] },
      [{ characterClassId: 1, spells: [makeSpell({ id: 51, definition: { id: 2, name: "Mind Sliver" } })] }]
    );
    const entries = getCharacterSpellEntries(char);
    const names = entries.map((e) => e.spell.definition.name).sort();
    expect(names).toEqual(["Known Spell", "Mind Sliver"]);
  });

  it("a character with no spells anywhere returns an empty list", () => {
    expect(getCharacterSpellEntries(baseChar({}))).toEqual([]);
  });
});

describe("formatCastingMode", () => {
  it("labels an always-prepared spell", () => {
    const entries = getCharacterSpellEntries(baseChar({ class: [makeSpell({ alwaysPrepared: true })] }));
    expect(formatCastingMode(entries[0])).toBe("Always Prepared");
  });

  it("labels a prepared spell", () => {
    const entries = getCharacterSpellEntries(baseChar({ class: [makeSpell({ prepared: true })] }));
    expect(formatCastingMode(entries[0])).toBe("Prepared");
  });

  it("renders a limited-use spell's uses and reset", () => {
    const entries = getCharacterSpellEntries(baseChar({
      feat: [makeSpell({ limitedUse: { maxUses: 1, numberUsed: 0, resetType: 2, resetTypeDescription: "Long Rest" } })],
    }));
    expect(formatCastingMode(entries[0])).toBe("1/Long Rest");
  });

  it("renders a useProficiencyBonus spell as PB/<reset>", () => {
    const entries = getCharacterSpellEntries(baseChar({
      feat: [makeSpell({
        limitedUse: { maxUses: 1, numberUsed: 0, resetType: 2, resetTypeDescription: "Long Rest", useProficiencyBonus: true },
      })],
    }));
    expect(formatCastingMode(entries[0])).toBe("PB/Long Rest");
  });

  it("falls back to the resetType number table when resetTypeDescription is absent", () => {
    const entries = getCharacterSpellEntries(baseChar({
      feat: [makeSpell({ limitedUse: { maxUses: 2, numberUsed: 0, resetType: 1, resetTypeDescription: "" } })],
    }));
    expect(formatCastingMode(entries[0])).toBe("2/Short Rest");
  });

  it("labels a spell with no prepared/limited-use flags as At Will", () => {
    const entries = getCharacterSpellEntries(baseChar({ race: [makeSpell({})] }));
    expect(formatCastingMode(entries[0])).toBe("At Will");
  });
});

describe("formatSpellAnnotation", () => {
  it("renders name, sorted sources, and casting mode", () => {
    const char = baseChar({
      race: [makeSpell({ id: 1, definition: { id: 1, name: "Darkness" } })],
      item: [makeSpell({ id: 2, definition: { id: 1, name: "Darkness" } })],
    });
    const entries = getCharacterSpellEntries(char);
    expect(formatSpellAnnotation(entries[0])).toBe("Darkness [Item, Race; At Will]");
  });
});
