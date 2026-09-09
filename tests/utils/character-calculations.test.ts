import { describe, it, expect } from "vitest";
import {
  computeFinalAbilityScore,
  computeCharacterAbilityScore,
  sumModifierBonuses,
  calculateAc,
  computeLevel,
  calculateProficiencyBonus,
  calculateMaxHp,
  calculateCurrentHp,
  getSavingThrowTotal,
  getSkillTotal,
  getSpellSaveDcBonus,
  getSpeeds,
  getInitiative,
  getPassiveScore,
  getSenses,
} from "../../src/utils/character-calculations.js";
import type { DdbCharacter, DdbModifier } from "../../src/types/character.js";

describe("computeFinalAbilityScore", () => {
  const baseStats = [
    { id: 1, value: 15 },
    { id: 2, value: 14 },
    { id: 3, value: 13 },
    { id: 4, value: 12 },
    { id: 5, value: 10 },
    { id: 6, value: 8 },
  ];

  it("should compute base + bonus when no override", () => {
    const bonusStats = [{ id: 1, value: 2 }];
    const overrideStats: any[] = [];
    const modifiers = { race: [], class: [], background: [], item: [], feat: [], condition: [] };

    const result = computeFinalAbilityScore(baseStats, bonusStats, overrideStats, modifiers, 1);
    expect(result).toBe(17); // 15 + 2
  });

  it("should return override value when present", () => {
    const bonusStats = [{ id: 1, value: 2 }];
    const overrideStats = [{ id: 1, value: 20 }];
    const modifiers = { race: [], class: [], background: [], item: [], feat: [], condition: [] };

    const result = computeFinalAbilityScore(baseStats, bonusStats, overrideStats, modifiers, 1);
    expect(result).toBe(20);
  });

  it("should add modifier bonuses to base + bonus", () => {
    const bonusStats = [{ id: 1, value: 2 }];
    const overrideStats: any[] = [];
    const modifiers = {
      race: [],
      class: [],
      background: [],
      item: [
        { type: "bonus", subType: "strength-score", value: 1 } as DdbModifier,
      ],
      feat: [],
      condition: [],
    };

    const result = computeFinalAbilityScore(baseStats, bonusStats, overrideStats, modifiers, 1);
    expect(result).toBe(18); // 15 + 2 + 1
  });

  it("should handle missing bonus stat", () => {
    const bonusStats: any[] = [];
    const overrideStats: any[] = [];
    const modifiers = { race: [], class: [], background: [], item: [], feat: [], condition: [] };

    const result = computeFinalAbilityScore(baseStats, bonusStats, overrideStats, modifiers, 1);
    expect(result).toBe(15); // Just base
  });
});

// Item 3 (v0.9.0): `set`-type ability modifiers (Belt of Hill Giant Strength
// and similar). Confirmed live 2026-09-09: a character with the belt
// equipped displayed their unmodified natural score (12), not 21 — the belt's
// `type: "set", subType: "strength-score", value: 21` modifier was invisible
// to the old computeFinalAbilityScore, which only ever summed `type: "bonus"`.
describe("computeCharacterAbilityScore", () => {
  const charWith = (statValue: number, setValue: number | null, extra?: Partial<DdbCharacter>): DdbCharacter => ({
    stats: [{ id: 1, value: statValue }, { id: 2, value: 10 }, { id: 3, value: 10 }, { id: 4, value: 10 }, { id: 5, value: 10 }, { id: 6, value: 10 }],
    bonusStats: [],
    overrideStats: [],
    modifiers: {
      race: [], class: [], background: [], feat: [], condition: [],
      item: setValue == null ? [] : [
        { id: 1, type: "set", subType: "strength-score", value: setValue, friendlyTypeName: "Set", friendlySubtypeName: "Strength Score", componentId: 1, componentTypeId: 1 } as DdbModifier,
      ],
    },
    ...extra,
  } as unknown as DdbCharacter);

  it("a `set` below the natural score does not lower it", () => {
    // Belt of Hill Giant Strength's own rule: "no effect ... if your
    // Strength ... is ... equal to or greater than 21."
    const char = charWith(24, 21);
    expect(computeCharacterAbilityScore(char, 1)).toBe(24);
  });

  it("a `set` above the natural score raises it", () => {
    const char = charWith(12, 21);
    expect(computeCharacterAbilityScore(char, 1)).toBe(21);
  });

  it("multiple `set` modifiers take the highest", () => {
    const char = charWith(8, null, {
      modifiers: {
        race: [], class: [], background: [], feat: [], condition: [],
        item: [
          { id: 1, type: "set", subType: "strength-score", value: 19, friendlyTypeName: "Set", friendlySubtypeName: "Strength Score", componentId: 1, componentTypeId: 1 } as DdbModifier,
          { id: 2, type: "set", subType: "strength-score", value: 21, friendlyTypeName: "Set", friendlySubtypeName: "Strength Score", componentId: 2, componentTypeId: 1 } as DdbModifier,
        ],
      },
    } as unknown as Partial<DdbCharacter>);
    expect(computeCharacterAbilityScore(char, 1)).toBe(21);
  });

  it("no `set` modifier behaves exactly as computeFinalAbilityScore (regression guard)", () => {
    const char = charWith(15, null);
    expect(computeCharacterAbilityScore(char, 1)).toBe(15);
  });

  it("an explicit override still wins outright over a `set` modifier", () => {
    const char = charWith(12, 21, { overrideStats: [{ id: 1, value: 8 }] } as unknown as Partial<DdbCharacter>);
    expect(computeCharacterAbilityScore(char, 1)).toBe(8);
  });
});

describe("sumModifierBonuses", () => {
  it("should accumulate bonuses for matching subType", () => {
    const modifiers = {
      race: [
        { type: "bonus", subType: "armor-class", value: 1 } as DdbModifier,
      ],
      class: [
        { type: "bonus", subType: "armor-class", value: 2 } as DdbModifier,
      ],
      background: [],
      item: [],
      feat: [],
      condition: [],
    };

    const result = sumModifierBonuses(modifiers, "armor-class");
    expect(result).toBe(3);
  });

  it("should ignore non-bonus types", () => {
    const modifiers = {
      race: [
        { type: "bonus", subType: "armor-class", value: 1 } as DdbModifier,
        { type: "set", subType: "armor-class", value: 13 } as DdbModifier,
      ],
      class: [],
      background: [],
      item: [],
      feat: [],
      condition: [],
    };

    const result = sumModifierBonuses(modifiers, "armor-class");
    expect(result).toBe(1); // Only the bonus type
  });

  it("should ignore null values", () => {
    const modifiers = {
      race: [
        { type: "bonus", subType: "armor-class", value: 1 } as DdbModifier,
        { type: "bonus", subType: "armor-class", value: null } as DdbModifier,
      ],
      class: [],
      background: [],
      item: [],
      feat: [],
      condition: [],
    };

    const result = sumModifierBonuses(modifiers, "armor-class");
    expect(result).toBe(1);
  });

  it("should return 0 when no matching modifiers", () => {
    const modifiers = {
      race: [
        { type: "bonus", subType: "strength-score", value: 2 } as DdbModifier,
      ],
      class: [],
      background: [],
      item: [],
      feat: [],
      condition: [],
    };

    const result = sumModifierBonuses(modifiers, "armor-class");
    expect(result).toBe(0);
  });

  // Confirmed live 2026-09-09: some modifiers carry `value: null` with the
  // real number only in `fixedValue` (e.g. an item-granted flat HP bonus).
  it("should fall back to fixedValue when value is null", () => {
    const modifiers = {
      race: [],
      class: [],
      background: [],
      item: [
        { type: "bonus", subType: "hit-points", value: null, fixedValue: 2 } as DdbModifier,
      ],
      feat: [],
      condition: [],
    };

    const result = sumModifierBonuses(modifiers, "hit-points");
    expect(result).toBe(2);
  });
});

describe("calculateAc", () => {
  const baseChar: DdbCharacter = {
    id: 1,
    name: "Test",
    readonlyUrl: "",
    race: { fullName: "Human", baseRaceName: "Human", isHomebrew: false, racialTraits: [] },
    classes: [
      {
        id: 1,
        definition: { name: "Fighter" },
        level: 5,
        isStartingClass: true,
        subclassDefinition: null,
        classFeatures: [],
      },
    ],
    level: 5,
    stats: [
      { id: 1, value: 10 }, // STR
      { id: 2, value: 14 }, // DEX (+2)
      { id: 3, value: 12 }, // CON (+1)
      { id: 4, value: 10 }, // INT
      { id: 5, value: 10 }, // WIS
      { id: 6, value: 10 }, // CHA
    ],
    bonusStats: [],
    overrideStats: [],
    modifiers: { race: [], class: [], background: [], item: [], feat: [], condition: [] },
    inventory: [],
    baseHitPoints: 42,
    bonusHitPoints: null,
    overrideHitPoints: null,
    removedHitPoints: 0,
    temporaryHitPoints: 0,
    currencies: { cp: 0, sp: 0, ep: 0, gp: 0, pp: 0 },
    background: null,
    currentXp: 0,
    alignmentId: null,
    lifestyleId: null,
    spells: { race: [], class: [], background: [], item: [], feat: [] },
    deathSaves: { failCount: null, successCount: null, isStabilized: false },
    traits: {
      personalityTraits: "",
      ideals: "",
      bonds: "",
      flaws: "",
      appearance: "",
    },
    preferences: {},
    configuration: {},
    campaign: null,
  } as unknown as DdbCharacter;

  it("should calculate unarmored AC (10 + DEX)", () => {
    const result = calculateAc(baseChar);
    expect(result).toBe(12); // 10 + 2
  });

  it("should calculate light armor AC (AC + DEX)", () => {
    const charWithLightArmor = {
      ...baseChar,
      inventory: [
        {
          id: 1,
          definition: {
            name: "Leather Armor",
            type: "Light Armor",
            filterType: "Light Armor",
            armorClass: 11,
            rarity: "Common",
            weight: 10,
            cost: null,
            isHomebrew: false,
            description: "",
          },
          equipped: true,
          quantity: 1,
        },
      ],
    } as unknown as DdbCharacter;

    const result = calculateAc(charWithLightArmor);
    expect(result).toBe(13); // 11 + 2
  });

  it("should calculate medium armor AC (AC + min(DEX, 2))", () => {
    const charWithMediumArmor = {
      ...baseChar,
      inventory: [
        {
          id: 1,
          definition: {
            name: "Scale Mail",
            type: "Medium Armor",
            filterType: "Medium Armor",
            armorClass: 14,
            rarity: "Common",
            weight: 45,
            cost: null,
            isHomebrew: false,
            description: "",
          },
          equipped: true,
          quantity: 1,
        },
      ],
    } as unknown as DdbCharacter;

    const result = calculateAc(charWithMediumArmor);
    expect(result).toBe(16); // 14 + 2
  });

  it("should calculate heavy armor AC (AC only, no DEX)", () => {
    const charWithHeavyArmor = {
      ...baseChar,
      inventory: [
        {
          id: 1,
          definition: {
            name: "Chain Mail",
            type: "Heavy Armor",
            filterType: "Heavy Armor",
            armorClass: 16,
            rarity: "Common",
            weight: 55,
            cost: null,
            isHomebrew: false,
            description: "",
          },
          equipped: true,
          quantity: 1,
        },
      ],
    } as unknown as DdbCharacter;

    const result = calculateAc(charWithHeavyArmor);
    expect(result).toBe(16); // Just armor AC
  });

  it("should add shield bonus to AC", () => {
    const charWithShield = {
      ...baseChar,
      inventory: [
        {
          id: 1,
          definition: {
            name: "Shield",
            type: "Shield",
            filterType: "Shield",
            armorClass: 2,
            rarity: "Common",
            weight: 6,
            cost: null,
            isHomebrew: false,
            description: "",
          },
          equipped: true,
          quantity: 1,
        },
      ],
    } as unknown as DdbCharacter;

    const result = calculateAc(charWithShield);
    expect(result).toBe(14); // 10 + 2 (DEX) + 2 (shield)
  });

  // Item 2 (v0.9.0): confirmed live 2026-09-09 — every shield on a real
  // character carried an empty/null `type` string; only the numeric
  // `armorTypeId: 4` identified it. The old string-only matcher silently
  // skipped shields shaped like this (0 AC contribution).
  it("should detect a shield via armorTypeId even with a missing type string", () => {
    const charWithBareShield = {
      ...baseChar,
      inventory: [
        {
          id: 1,
          definition: {
            name: "Shield",
            type: "",
            filterType: "Armor",
            armorTypeId: 4,
            armorClass: 2,
            rarity: "Common",
            weight: 6,
            cost: null,
            isHomebrew: false,
            description: "",
          },
          equipped: true,
          quantity: 1,
        },
      ],
    } as unknown as DdbCharacter;

    const result = calculateAc(charWithBareShield);
    expect(result).toBe(14); // 10 + 2 (DEX) + 2 (shield), same as the named-shield case
  });

  // Confirmed live 2026-09-09: a real character's "Crossbow, Light" weapon
  // (no armorTypeId, since it isn't armor) false-matched the fallback's bare
  // `.includes("light")` check and got misclassified as light armor,
  // overwriting a correctly-detected Breastplate processed earlier in the
  // same inventory loop.
  it("does not misclassify a weapon whose name contains an armor-weight word as armor", () => {
    // DEX +4 makes light vs. medium diverge (18 vs. 16) so the test actually
    // discriminates between "the bug happened" (Crossbow, Light — processed
    // after Breastplate — overwrites it as uncapped light armor) and correct
    // behavior (medium armor's DEX cap wins).
    const charWithBreastplateAndLightCrossbow = {
      ...baseChar,
      stats: [
        { id: 1, value: 10 }, { id: 2, value: 18 }, { id: 3, value: 12 },
        { id: 4, value: 10 }, { id: 5, value: 10 }, { id: 6, value: 10 },
      ],
      inventory: [
        {
          id: 1,
          definition: {
            name: "Breastplate", type: "", filterType: "Armor", armorTypeId: 2,
            armorClass: 14, rarity: "Common", weight: 20, cost: null, isHomebrew: false, description: "",
          },
          equipped: true,
          quantity: 1,
        },
        {
          id: 2,
          definition: {
            name: "Crossbow, Light", type: "Crossbow, Light", filterType: "Weapon",
            armorTypeId: null, armorClass: null, rarity: "Common", weight: 5, cost: null, isHomebrew: false, description: "",
          },
          equipped: true,
          quantity: 1,
        },
      ],
    } as unknown as DdbCharacter;

    expect(calculateAc(charWithBreastplateAndLightCrossbow)).toBe(16); // medium armor's +2 cap, not light armor's uncapped +4
  });

  it("should calculate Barbarian unarmored defense (10 + DEX + CON) via the generic set modifier", () => {
    const barbarian = {
      ...baseChar,
      classes: [
        {
          id: 1,
          definition: { name: "Barbarian" },
          level: 5,
          isStartingClass: true,
          subclassDefinition: null,
          classFeatures: [],
        },
      ],
      modifiers: {
        race: [], background: [], item: [], feat: [], condition: [],
        class: [
          { id: 1, type: "set", subType: "unarmored-armor-class", value: null, statId: 3, friendlyTypeName: "Set", friendlySubtypeName: "Unarmored Armor Class", componentId: 1, componentTypeId: 1 } as DdbModifier,
        ],
      },
    } as unknown as DdbCharacter;

    const result = calculateAc(barbarian);
    expect(result).toBe(13); // 10 + 2 (DEX) + 1 (CON)
  });

  it("should calculate Monk unarmored defense (10 + DEX + WIS) via the generic set modifier", () => {
    const monk = {
      ...baseChar,
      stats: [
        { id: 1, value: 10 }, // STR
        { id: 2, value: 14 }, // DEX (+2)
        { id: 3, value: 10 }, // CON
        { id: 4, value: 10 }, // INT
        { id: 5, value: 16 }, // WIS (+3)
        { id: 6, value: 10 }, // CHA
      ],
      classes: [
        {
          id: 1,
          definition: { name: "Monk" },
          level: 5,
          isStartingClass: true,
          subclassDefinition: null,
          classFeatures: [],
        },
      ],
      modifiers: {
        race: [], background: [], item: [], feat: [], condition: [],
        class: [
          { id: 1, type: "set", subType: "unarmored-armor-class", value: null, statId: 5, friendlyTypeName: "Set", friendlySubtypeName: "Unarmored Armor Class", componentId: 1, componentTypeId: 1 } as DdbModifier,
        ],
      },
    } as unknown as DdbCharacter;

    const result = calculateAc(monk);
    expect(result).toBe(15); // 10 + 2 (DEX) + 3 (WIS)
  });

  // Best-of, not first-match: a Barbarian/Monk hybrid (multiclass or a feat
  // granting a second unarmored formula) should get whichever formula is
  // higher, not whichever modifier happens to be encountered first.
  it("takes the best of multiple unarmored-armor-class candidates, not the first match", () => {
    const hybrid = {
      ...baseChar,
      stats: [
        { id: 1, value: 10 },
        { id: 2, value: 14 }, // DEX +2
        { id: 3, value: 18 }, // CON +4
        { id: 4, value: 10 },
        { id: 5, value: 12 }, // WIS +1
        { id: 6, value: 10 },
      ],
      modifiers: {
        race: [], background: [], item: [], feat: [], condition: [],
        class: [
          // Monk formula (10+2+1=13) listed first...
          { id: 1, type: "set", subType: "unarmored-armor-class", value: null, statId: 5, friendlyTypeName: "Set", friendlySubtypeName: "Unarmored Armor Class", componentId: 1, componentTypeId: 1 } as DdbModifier,
          // ...but Barbarian's (10+2+4=16) is better and must win.
          { id: 2, type: "set", subType: "unarmored-armor-class", value: null, statId: 3, friendlyTypeName: "Set", friendlySubtypeName: "Unarmored Armor Class", componentId: 2, componentTypeId: 1 } as DdbModifier,
        ],
      },
    } as unknown as DdbCharacter;

    expect(calculateAc(hybrid)).toBe(16);
  });

  // Homebrew natural armor, confirmed live 2026-09-09 (a "13 + CON mod, no
  // DEX" feat): `value` is the flat component (13 - 10 = 3), `statId` names
  // the ability, and a companion `ignore: unarmored-dex-ac-bonus` modifier
  // suppresses the usual DEX term.
  it("honors a natural-armor set value with statId and an ignore-DEX modifier", () => {
    const naturalArmor = {
      ...baseChar,
      stats: [
        { id: 1, value: 10 },
        { id: 2, value: 16 }, // DEX +3 — must NOT be added, this formula excludes DEX
        { id: 3, value: 14 }, // CON +2
        { id: 4, value: 10 },
        { id: 5, value: 10 },
        { id: 6, value: 10 },
      ],
      modifiers: {
        race: [], class: [], background: [], condition: [],
        feat: [
          { id: 1, type: "set", subType: "unarmored-armor-class", value: 3, statId: 3, friendlyTypeName: "Set", friendlySubtypeName: "Unarmored Armor Class", componentId: 1, componentTypeId: 1 } as DdbModifier,
          { id: 2, type: "ignore", subType: "unarmored-dex-ac-bonus", value: null, friendlyTypeName: "Ignore", friendlySubtypeName: "Unarmored Dex AC Bonus", componentId: 1, componentTypeId: 1 } as DdbModifier,
        ],
        item: [],
      },
    } as unknown as DdbCharacter;

    expect(calculateAc(naturalArmor)).toBe(15); // 10 + 3 + 2 (CON), no DEX
  });

  it("caps the unarmored DEX bonus when an ac-max-dex-modifier is present", () => {
    const capped = {
      ...baseChar,
      stats: [
        { id: 1, value: 10 },
        { id: 2, value: 18 }, // DEX +4, capped to +1
        { id: 3, value: 10 },
        { id: 4, value: 10 },
        { id: 5, value: 10 },
        { id: 6, value: 10 },
      ],
      modifiers: {
        race: [], class: [], background: [], feat: [], condition: [],
        item: [
          { id: 1, type: "bonus", subType: "ac-max-dex-modifier", value: 1, friendlyTypeName: "Bonus", friendlySubtypeName: "AC Max Dex Modifier", componentId: 1, componentTypeId: 1 } as DdbModifier,
        ],
      },
    } as unknown as DdbCharacter;

    expect(calculateAc(capped)).toBe(11); // 10 + 1 (capped DEX)
  });

  it("should add AC modifiers from features", () => {
    const charWithAcBonus = {
      ...baseChar,
      modifiers: {
        race: [],
        class: [
          { type: "bonus", subType: "armor-class", value: 1 } as DdbModifier,
        ],
        background: [],
        item: [],
        feat: [],
        condition: [],
      },
    } as unknown as DdbCharacter;

    const result = calculateAc(charWithAcBonus);
    expect(result).toBe(13); // 10 + 2 (DEX) + 1 (feature)
  });

  // State-gating: `armored-armor-class` and `unarmored-armor-class` *bonus*
  // modifiers previously applied unconditionally; each should only apply in
  // its matching armor state.
  it("does not apply an armored-armor-class bonus while unarmored", () => {
    const unarmoredWithArmoredBonus = {
      ...baseChar,
      modifiers: {
        race: [], class: [], background: [], feat: [], condition: [],
        item: [
          { id: 1, type: "bonus", subType: "armored-armor-class", value: 1, friendlyTypeName: "Bonus", friendlySubtypeName: "Armored Armor Class", componentId: 1, componentTypeId: 1 } as DdbModifier,
        ],
      },
    } as unknown as DdbCharacter;

    expect(calculateAc(unarmoredWithArmoredBonus)).toBe(12); // 10 + 2 (DEX); the +1 does not apply
  });

  it("does not apply an unarmored-armor-class bonus while armored", () => {
    const armoredWithUnarmoredBonus = {
      ...baseChar,
      inventory: [
        {
          id: 1,
          definition: {
            name: "Chain Mail", type: "Heavy Armor", filterType: "Heavy Armor",
            armorClass: 16, rarity: "Common", weight: 55, cost: null, isHomebrew: false, description: "",
          },
          equipped: true,
          quantity: 1,
        },
      ],
      modifiers: {
        race: [], class: [], background: [], feat: [], condition: [],
        item: [
          { id: 1, type: "bonus", subType: "unarmored-armor-class", value: 1, friendlyTypeName: "Bonus", friendlySubtypeName: "Unarmored Armor Class", componentId: 1, componentTypeId: 1 } as DdbModifier,
        ],
      },
    } as unknown as DdbCharacter;

    expect(calculateAc(armoredWithUnarmoredBonus)).toBe(16); // heavy armor only; the +1 does not apply
  });

  it("applies an armored-armor-class bonus while armored (e.g. Defense fighting style)", () => {
    const armoredWithBonus = {
      ...baseChar,
      inventory: [
        {
          id: 1,
          definition: {
            name: "Chain Mail", type: "Heavy Armor", filterType: "Heavy Armor",
            armorClass: 16, rarity: "Common", weight: 55, cost: null, isHomebrew: false, description: "",
          },
          equipped: true,
          quantity: 1,
        },
      ],
      modifiers: {
        race: [], class: [], background: [], feat: [], condition: [],
        item: [
          { id: 1, type: "bonus", subType: "armored-armor-class", value: 1, friendlyTypeName: "Bonus", friendlySubtypeName: "Armored Armor Class", componentId: 1, componentTypeId: 1 } as DdbModifier,
        ],
      },
    } as unknown as DdbCharacter;

    expect(calculateAc(armoredWithBonus)).toBe(17); // 16 + 1
  });
});

describe("computeLevel", () => {
  it("should sum class levels", () => {
    const char = {
      classes: [
        { level: 5 },
        { level: 3 },
      ],
    } as unknown as DdbCharacter;

    const result = computeLevel(char);
    expect(result).toBe(8);
  });

  it("should handle single class", () => {
    const char = {
      classes: [
        { level: 10 },
      ],
    } as unknown as DdbCharacter;

    const result = computeLevel(char);
    expect(result).toBe(10);
  });
});

describe("calculateProficiencyBonus", () => {
  it.each([
    [1, 2], [4, 2], [5, 3], [8, 3], [9, 4], [12, 4], [13, 5], [16, 5], [17, 6], [20, 6],
  ])("level %i -> +%i", (level, expected) => {
    expect(calculateProficiencyBonus(level)).toBe(expected);
  });
});

// Item 1 (v0.9.0): calculateMaxHp now adds (CON mod * level) plus flat/
// per-level HP modifiers, instead of ignoring Constitution entirely.
// Confirmed live 2026-09-09 against `baseHitPoints` on six real characters —
// see the comment on calculateMaxHp in character-calculations.ts.
describe("calculateMaxHp", () => {
  const charAt = (level: number, conValue: number, extra?: Partial<DdbCharacter>): DdbCharacter => ({
    classes: [{ id: 1, definition: { name: "Fighter" }, level, isStartingClass: true, subclassDefinition: null, classFeatures: [] }],
    stats: [{ id: 1, value: 10 }, { id: 2, value: 10 }, { id: 3, value: conValue }, { id: 4, value: 10 }, { id: 5, value: 10 }, { id: 6, value: 10 }],
    bonusStats: [],
    overrideStats: [],
    modifiers: { race: [], class: [], background: [], item: [], feat: [], condition: [] },
    baseHitPoints: 0,
    bonusHitPoints: null,
    overrideHitPoints: null,
    ...extra,
  } as unknown as DdbCharacter);

  it("level 1, CON 14 (+2): adds CON once", () => {
    const char = charAt(1, 14, { baseHitPoints: 10 });
    expect(calculateMaxHp(char)).toBe(12); // 10 + 2*1
  });

  it("level 5: adds CON mod * level", () => {
    const char = charAt(5, 14, { baseHitPoints: 42 });
    expect(calculateMaxHp(char)).toBe(52); // 42 + 2*5
  });

  it("multiclass: adds CON mod * total level across classes", () => {
    const char = charAt(0, 14, {
      classes: [
        { id: 1, definition: { name: "Fighter" }, level: 3, isStartingClass: true, subclassDefinition: null, classFeatures: [] },
        { id: 2, definition: { name: "Barbarian" }, level: 2, isStartingClass: false, subclassDefinition: null, classFeatures: [] },
      ],
      baseHitPoints: 37,
    });
    expect(calculateMaxHp(char)).toBe(47); // 37 + 2*5
  });

  it("a negative CON modifier subtracts", () => {
    const char = charAt(4, 8, { baseHitPoints: 24 }); // CON 8 = -1 mod
    expect(calculateMaxHp(char)).toBe(20); // 24 - 1*4
  });

  it("adds flat hit-points and hit-points-per-level modifiers (e.g. the Tough feat)", () => {
    const char = charAt(3, 14, {
      baseHitPoints: 18,
      modifiers: {
        race: [], class: [], background: [], item: [], condition: [],
        feat: [
          { id: 1, type: "bonus", subType: "hit-points-per-level", value: 2, friendlyTypeName: "Bonus", friendlySubtypeName: "Hit Points per Level", componentId: 1, componentTypeId: 1 } as DdbModifier,
        ],
      },
    });
    expect(calculateMaxHp(char)).toBe(30); // 18 + 2*3 (CON) + 2*3 (Tough)
  });

  it("override wins outright, ignoring base/bonus/CON/modifiers", () => {
    const char = charAt(5, 18, { baseHitPoints: 42, bonusHitPoints: 10, overrideHitPoints: 100 });
    expect(calculateMaxHp(char)).toBe(100);
  });

  it("bonusHitPoints still applies alongside the CON term", () => {
    const char = charAt(1, 12, { baseHitPoints: 10, bonusHitPoints: 5 });
    expect(calculateMaxHp(char)).toBe(16); // 10 + 5 + 1*1
  });
});

describe("calculateCurrentHp", () => {
  const char = (removedHitPoints: number): DdbCharacter => ({
    classes: [{ id: 1, definition: { name: "Fighter" }, level: 5, isStartingClass: true, subclassDefinition: null, classFeatures: [] }],
    stats: [{ id: 1, value: 10 }, { id: 2, value: 10 }, { id: 3, value: 14 }, { id: 4, value: 10 }, { id: 5, value: 10 }, { id: 6, value: 10 }],
    bonusStats: [],
    overrideStats: [],
    modifiers: { race: [], class: [], background: [], item: [], feat: [], condition: [] },
    baseHitPoints: 42,
    bonusHitPoints: null,
    overrideHitPoints: null,
    removedHitPoints,
  } as unknown as DdbCharacter);

  it("should return max - removed", () => {
    const result = calculateCurrentHp(char(10));
    expect(result).toBe(42); // (42 + 2*5) - 10
  });

  it("should handle zero damage", () => {
    const result = calculateCurrentHp(char(0));
    expect(result).toBe(52); // 42 + 2*5
  });
});

// Item 10 (v0.9.0): saves/skills/spell DC now include `sumModifierBonuses`
// for generic subtypes (`saving-throws`, `ability-checks`, `spell-save-dc`)
// plus the per-ability/per-skill/per-class variants. Confirmed live
// 2026-09-09: a Stone of Good Luck's `bonus ability-checks +1` was silently
// dropped from every skill total.
describe("getSavingThrowTotal / getSkillTotal / getSpellSaveDcBonus", () => {
  const baseChar = (): DdbCharacter => ({
    classes: [{ id: 1, definition: { name: "Fighter" }, level: 5, isStartingClass: true, subclassDefinition: null, classFeatures: [] }],
    stats: [{ id: 1, value: 10 }, { id: 2, value: 14 }, { id: 3, value: 10 }, { id: 4, value: 10 }, { id: 5, value: 16 }, { id: 6, value: 10 }],
    bonusStats: [],
    overrideStats: [],
    modifiers: { race: [], class: [], background: [], item: [], feat: [], condition: [] },
  } as unknown as DdbCharacter);

  it("save: ability mod only, no proficiency or bonuses", () => {
    expect(getSavingThrowTotal(baseChar(), 5)).toBe(3); // WIS +3
  });

  it("save: adds proficiency bonus when proficient", () => {
    const char = baseChar();
    char.modifiers.class = [
      { id: 1, type: "proficiency", subType: "wisdom-saving-throws", value: null, friendlyTypeName: "Proficiency", friendlySubtypeName: "Wisdom Saving Throws", componentId: 1, componentTypeId: 1 } as DdbModifier,
    ];
    expect(getSavingThrowTotal(char, 5)).toBe(6); // 3 + 3 (prof bonus at level 5)
  });

  it("save: includes a generic saving-throws bonus and the per-ability subtype bonus, combined", () => {
    const char = baseChar();
    char.modifiers.item = [
      { id: 1, type: "bonus", subType: "saving-throws", value: 1, friendlyTypeName: "Bonus", friendlySubtypeName: "Saving Throws", componentId: 1, componentTypeId: 1 } as DdbModifier,
      { id: 2, type: "bonus", subType: "wisdom-saving-throws", value: 2, friendlyTypeName: "Bonus", friendlySubtypeName: "Wisdom Saving Throws", componentId: 2, componentTypeId: 1 } as DdbModifier,
    ];
    expect(getSavingThrowTotal(char, 5)).toBe(6); // 3 + 1 + 2
  });

  it("skill: proficiency adds once, expertise doubles it", () => {
    const char = baseChar();
    char.modifiers.class = [
      { id: 1, type: "expertise", subType: "perception", value: null, friendlyTypeName: "Expertise", friendlySubtypeName: "Perception", componentId: 1, componentTypeId: 1 } as DdbModifier,
    ];
    expect(getSkillTotal(char, 5, "perception")).toBe(9); // WIS +3 + (2 * prof 3)
  });

  it("skill: includes ability-checks and the per-skill subtype bonus, combined", () => {
    const char = baseChar();
    char.modifiers.item = [
      { id: 1, type: "bonus", subType: "ability-checks", value: 1, friendlyTypeName: "Bonus", friendlySubtypeName: "Ability Checks", componentId: 1, componentTypeId: 1 } as DdbModifier,
      { id: 2, type: "bonus", subType: "perception", value: 1, friendlyTypeName: "Bonus", friendlySubtypeName: "Perception", componentId: 2, componentTypeId: 1 } as DdbModifier,
    ];
    expect(getSkillTotal(char, 5, "perception")).toBe(5); // WIS +3 + 1 + 1
  });

  it("skill: with no modifiers at all, matches the pre-fix ability-mod-only result (regression guard)", () => {
    expect(getSkillTotal(baseChar(), 2, "acrobatics")).toBe(2); // DEX +2
  });

  it("spell DC bonus: sums the generic and class-specific subtypes", () => {
    const char = baseChar();
    char.modifiers.item = [
      { id: 1, type: "bonus", subType: "spell-save-dc", value: 1, friendlyTypeName: "Bonus", friendlySubtypeName: "Spell Save DC", componentId: 1, componentTypeId: 1 } as DdbModifier,
      { id: 2, type: "bonus", subType: "warlock-spell-save-dc", value: 1, friendlyTypeName: "Bonus", friendlySubtypeName: "Warlock Spell Save DC", componentId: 2, componentTypeId: 1 } as DdbModifier,
    ];
    expect(getSpellSaveDcBonus(char, "Warlock")).toBe(2);
  });
});

// Item 12 (v0.9.0): real per-race speeds, initiative, passives, and senses.
// Confirmed live 2026-09-09 (race.weightSpeeds, darkvision's `set-base`
// modifier shape) — see character-calculations.ts.
describe("getSpeeds / getInitiative / getPassiveScore / getSenses", () => {
  const charWithSpeed = (walk: number, extra?: Record<string, number>): DdbCharacter => ({
    race: { fullName: "Test", baseRaceName: "Test", isHomebrew: false, racialTraits: [], weightSpeeds: { normal: { walk, ...extra } } },
    modifiers: { race: [], class: [], background: [], item: [], feat: [], condition: [] },
    stats: [{ id: 1, value: 10 }, { id: 2, value: 14 }, { id: 3, value: 10 }, { id: 4, value: 10 }, { id: 5, value: 16 }, { id: 6, value: 10 }],
    bonusStats: [],
    overrideStats: [],
    classes: [{ id: 1, definition: { name: "Fighter" }, level: 1, isStartingClass: true, subclassDefinition: null, classFeatures: [] }],
  } as unknown as DdbCharacter);

  it("a 25 ft species reports 25, not the old hardcoded 30", () => {
    expect(getSpeeds(charWithSpeed(25)).walk).toBe(25);
  });

  it("a 35 ft species reports 35", () => {
    expect(getSpeeds(charWithSpeed(35)).walk).toBe(35);
  });

  it("a flying species reports both walk and fly", () => {
    const speeds = getSpeeds(charWithSpeed(30, { fly: 60 }));
    expect(speeds.walk).toBe(30);
    expect(speeds.fly).toBe(60);
  });

  it("unarmored movement adds to walking speed", () => {
    const char = charWithSpeed(30);
    char.modifiers.class = [
      { id: 1, type: "bonus", subType: "unarmored-movement", value: 10, friendlyTypeName: "Bonus", friendlySubtypeName: "Unarmored Movement", componentId: 1, componentTypeId: 1 } as DdbModifier,
    ];
    expect(getSpeeds(char).walk).toBe(40);
  });

  it("falls back to 30 ft when race.weightSpeeds is absent (older fixtures)", () => {
    const char = {
      race: { fullName: "Test", baseRaceName: "Test", isHomebrew: false, racialTraits: [] },
      modifiers: { race: [], class: [], background: [], item: [], feat: [], condition: [] },
    } as unknown as DdbCharacter;
    expect(getSpeeds(char).walk).toBe(30);
  });

  it("initiative is DEX mod plus initiative bonuses", () => {
    const char = charWithSpeed(30);
    char.modifiers.item = [
      { id: 1, type: "bonus", subType: "initiative", value: 1, friendlyTypeName: "Bonus", friendlySubtypeName: "Initiative", componentId: 1, componentTypeId: 1 } as DdbModifier,
    ];
    expect(getInitiative(char)).toBe(3); // DEX +2 + 1
  });

  it("passive Perception reflects proficiency and expertise", () => {
    const char = charWithSpeed(30);
    char.modifiers.class = [
      { id: 1, type: "expertise", subType: "perception", value: null, friendlyTypeName: "Expertise", friendlySubtypeName: "Perception", componentId: 1, componentTypeId: 1 } as DdbModifier,
    ];
    expect(getPassiveScore(char, 5, "perception")).toBe(17); // 10 + WIS +3 + (2*2 prof at level 1)
  });

  it("sums darkvision from a race and an item source", () => {
    const char = charWithSpeed(30);
    char.modifiers.race = [
      { id: 1, type: "set-base", subType: "darkvision", value: 60, friendlyTypeName: "Set Base", friendlySubtypeName: "Darkvision", componentId: 1, componentTypeId: 1 } as DdbModifier,
    ];
    char.modifiers.item = [
      { id: 2, type: "bonus", subType: "darkvision", value: 30, friendlyTypeName: "Bonus", friendlySubtypeName: "Darkvision", componentId: 2, componentTypeId: 1 } as DdbModifier,
    ];
    expect(getSenses(char).darkvision).toBe(90);
  });

  it("a character with no special senses reports none", () => {
    expect(getSenses(charWithSpeed(30))).toEqual({});
  });
});
