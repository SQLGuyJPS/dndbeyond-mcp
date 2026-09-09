/**
 * Shared character calculation utilities used by both tools and resources.
 * These are the canonical implementations for ability scores, AC, HP, level,
 * saves/skills, and speed/initiative/passives/senses.
 */

import type {
  DdbCharacter,
  DdbAbilityScore,
  DdbModifier,
} from "../types/character.js";

export const ABILITY_NAMES = ["STR", "DEX", "CON", "INT", "WIS", "CHA"];

// Maps stat ID (1-6) to the subType prefix used in D&D Beyond modifiers
export const ABILITY_SUBTYPE_MAP: Record<number, string> = {
  1: "strength-score",
  2: "dexterity-score",
  3: "constitution-score",
  4: "intelligence-score",
  5: "wisdom-score",
  6: "charisma-score",
};

// Sense/AC/HP modifiers observed live (2026-09-09) frequently carry `value: null`
// with the real number only in `fixedValue` — e.g. an item-granted flat HP bonus
// on a real character payload. Read both so a null `value` doesn't silently drop
// a modifier that D&D Beyond's own sheet still applies.
function modifierValue(mod: DdbModifier): number | null {
  return mod.value ?? mod.fixedValue ?? null;
}

export function calculateAbilityModifier(score: number): string {
  const modifier = Math.floor((score - 10) / 2);
  return modifier >= 0 ? `+${modifier}` : `${modifier}`;
}

export function abilityModifierNumeric(score: number): number {
  return Math.floor((score - 10) / 2);
}

export function sumModifierBonuses(
  modifiers: Record<string, DdbModifier[]>,
  subType: string
): number {
  let total = 0;
  for (const list of Object.values(modifiers)) {
    if (!Array.isArray(list)) continue;
    for (const mod of list) {
      if (mod.type === "bonus" && mod.subType === subType) {
        const value = modifierValue(mod);
        if (value != null) total += value;
      }
    }
  }
  return total;
}

export function hasModifierBySubType(
  modifiers: Record<string, DdbModifier[]>,
  subType: string,
  type: string
): boolean {
  for (const list of Object.values(modifiers)) {
    if (!Array.isArray(list)) continue;
    for (const mod of list) {
      if (mod.subType === subType && mod.type === type) return true;
    }
  }
  return false;
}

export function computeFinalAbilityScore(
  base: DdbAbilityScore[],
  bonus: DdbAbilityScore[],
  override: DdbAbilityScore[],
  modifiers: Record<string, DdbModifier[]>,
  id: number
): number {
  const overrideValue = override.find((s) => s.id === id)?.value;
  if (overrideValue !== null && overrideValue !== undefined) return overrideValue;

  const baseValue = base.find((s) => s.id === id)?.value ?? 10;
  const bonusValue = bonus.find((s) => s.id === id)?.value ?? 0;
  const modifierBonus = sumModifierBonuses(modifiers, ABILITY_SUBTYPE_MAP[id] ?? "");
  return baseValue + bonusValue + modifierBonus;
}

// Item 3 (v0.9.0): computeFinalAbilityScore only ever summed `type: "bonus"`
// modifiers, so a `type: "set"` modifier — e.g. Belt of Hill Giant Strength
// setting Strength to 21 — was invisible; the character's natural score won
// every time. Confirmed live 2026-09-09 (Niko / Belt of Hill Giant Strength):
// STR displayed 12, the character's unmodified score, despite the belt being
// equipped. Context-aware replacement for computeFinalAbilityScore: takes the
// max of the natural score and every matching `set` modifier's value, per the
// belt's own rules text ("no effect ... if your Strength ... is ... greater").
// `override` still wins outright over everything, matching prior behavior.
export function computeCharacterAbilityScore(char: DdbCharacter, id: number): number {
  const overrideValue = char.overrideStats.find((s) => s.id === id)?.value;
  if (overrideValue !== null && overrideValue !== undefined) return overrideValue;

  const natural = computeFinalAbilityScore(char.stats, char.bonusStats, char.overrideStats, char.modifiers, id);
  const subType = ABILITY_SUBTYPE_MAP[id];
  let best = natural;

  for (const list of Object.values(char.modifiers)) {
    if (!Array.isArray(list)) continue;
    for (const mod of list) {
      if (mod.type === "set" && mod.subType === subType) {
        const setValue = modifierValue(mod);
        if (setValue != null) best = Math.max(best, setValue);
      }
    }
  }

  return best;
}

export function computeLevel(char: DdbCharacter): number {
  return char.classes.reduce((sum, cls) => sum + cls.level, 0);
}

export function calculateProficiencyBonus(level: number): number {
  return Math.ceil(level / 4) + 1;
}

// Item 1 (v0.9.0): calculateMaxHp used to be `base + bonus` (or override) —
// no Constitution term at all. Confirmed live 2026-09-09 across six real
// characters: `baseHitPoints` is pre-CON (matches the fork-comparison
// doc's finding, docs/fork-comparison-2026-09-05-grahamethompson.md #1),
// so every character above level 1 with a nonzero CON mod got the wrong
// max HP. Also adds flat/per-level HP modifiers (Tough feat, magic items),
// confirmed live via Balgrum Moonhide / Salazar Falone / Niko, all of whom
// carry a `hit-points-per-level` bonus from the Tough feat.
// Ported-From: grahamethompson/dndbeyond-mcp
export function calculateMaxHp(char: DdbCharacter): number {
  if (char.overrideHitPoints != null) return char.overrideHitPoints;

  const base = char.baseHitPoints;
  const bonus = char.bonusHitPoints ?? 0;
  const level = computeLevel(char);
  const conMod = abilityModifierNumeric(computeCharacterAbilityScore(char, 3));
  const flatBonus = sumModifierBonuses(char.modifiers, "hit-points");
  const perLevelBonus = sumModifierBonuses(char.modifiers, "hit-points-per-level");

  return base + bonus + conMod * level + flatBonus + perLevelBonus * level;
}

export function calculateCurrentHp(char: DdbCharacter): number {
  const max = calculateMaxHp(char);
  return max - char.removedHitPoints;
}

// Armor type IDs D&D Beyond assigns on item definitions: 1=light, 2=medium,
// 3=heavy, 4=shield. Numeric IDs are preferred over string matching — many
// real armor pieces (Breastplate, Scale Mail) and *every* shield observed
// live 2026-09-09 carry an empty or null `type` string, which the old
// string-only matcher silently skipped (shield bonus never applied).
function findArmorTypeId(item: { definition: { armorTypeId?: number | null; type?: string; filterType?: string } }): number | null {
  if (item.definition.armorTypeId != null) return item.definition.armorTypeId;

  const type = (item.definition.type || "").toLowerCase();
  const filterType = (item.definition.filterType || "").toLowerCase();

  // Confirmed live 2026-09-09: a weapon named "Crossbow, Light" false-matched
  // a bare `.includes("light")` check and got misclassified as light armor,
  // overwriting a correctly-detected Breastplate later in the same loop. Gate
  // the string fallback on the item plausibly being armor/a shield at all
  // before asking which kind — this is exactly the "unclean item strings"
  // failure mode the numeric armorTypeId check exists to avoid; the fallback
  // must not reintroduce it.
  const looksLikeArmor = type.includes("armor") || type.includes("shield")
    || filterType.includes("armor") || filterType.includes("shield");
  if (!looksLikeArmor) return null;

  if (type.includes("shield") || filterType.includes("shield")) return 4;
  if (type.includes("heavy")) return 3;
  if (type.includes("medium")) return 2;
  if (type.includes("light")) return 1;
  return null;
}

// Item 2 (v0.9.0): calculateAc rewritten. Confirmed live 2026-09-09 across
// five real characters (armored with a shield, natural armor via a homebrew
// feat, unarmored barbarian, unarmored monk, heavy armor + shield + a
// fighting-style AC bonus) — see docs/plans/2026-09-05-character-fixes-
// integration-plan.md item 2 for the full worked comparisons. Three
// independent bugs fixed:
//   1. Armor/shield detection now prefers the numeric `armorTypeId` (set by
//      D&D Beyond even when `type`/`filterType` strings are empty — true for
//      every shield observed live), falling back to string matching only
//      when it's absent.
//   2. Unarmored AC now builds a candidate list from every `set`-type
//      `unarmored-armor-class` modifier (barbarian/monk official features,
//      homebrew natural-armor feats — all use the same shape: a flat
//      `value`/`fixedValue` plus a `statId` naming which ability to add) and
//      takes the max, instead of a hardcoded barbarian/monk-by-class-name
//      check that missed every other case (including natural armor).
//      DEX is included in each candidate unless an `ignore` modifier with
//      subType `unarmored-dex-ac-bonus` is present (real homebrew natural
//      armor carries exactly this pairing), and capped by a
//      `ac-max-dex-modifier` value when one exists.
//   3. `armored-armor-class` and `unarmored-armor-class` *bonus*-type
//      modifiers (e.g. a Defense fighting style's +1) now apply only in
//      their respective armor states, instead of both being summed
//      unconditionally.
// Ported-From: grahamethompson/dndbeyond-mcp
export function calculateAc(char: DdbCharacter): number {
  const dexMod = abilityModifierNumeric(computeCharacterAbilityScore(char, 2));

  let armorTypeId: number | null = null; // 1/2/3 = light/medium/heavy body armor; null = unarmored
  let armorAcValue = 10;
  let shieldBonus = 0;

  for (const item of char.inventory) {
    if (!item.equipped) continue;
    const typeId = findArmorTypeId(item);
    if (typeId == null) continue;

    if (typeId === 4) {
      shieldBonus = item.definition.armorClass ?? 2;
      continue;
    }

    armorTypeId = typeId;
    armorAcValue = item.definition.armorClass ?? 10;
  }

  const ignoreUnarmoredDex = hasModifierBySubType(char.modifiers, "unarmored-dex-ac-bonus", "ignore");
  const dexCap = findModifierValue(char.modifiers, "ac-max-dex-modifier");
  const cappedDexMod = dexCap != null ? Math.min(dexMod, dexCap) : dexMod;
  const dexTerm = ignoreUnarmoredDex ? 0 : cappedDexMod;

  let baseAc: number;

  if (armorTypeId == null) {
    // Unarmored: candidate list starts with the plain 10 + DEX baseline, then
    // adds one candidate per `set`-type unarmored-armor-class modifier
    // (barbarian/monk class features, natural-armor feats/traits) — the
    // character gets whichever formula is best, not whichever is first.
    const candidates = [10 + dexTerm];

    for (const list of Object.values(char.modifiers)) {
      if (!Array.isArray(list)) continue;
      for (const mod of list) {
        if (mod.type !== "set" || mod.subType !== "unarmored-armor-class") continue;
        const flat = mod.value ?? mod.fixedValue ?? 0;
        const statBonus = mod.statId != null
          ? abilityModifierNumeric(computeCharacterAbilityScore(char, mod.statId))
          : 0;
        candidates.push(10 + flat + statBonus + dexTerm);
      }
    }

    baseAc = Math.max(...candidates);
  } else if (armorTypeId === 1) {
    baseAc = armorAcValue + dexMod; // light: full DEX
  } else if (armorTypeId === 2) {
    baseAc = armorAcValue + Math.min(dexMod, 2); // medium: DEX capped at +2
  } else {
    baseAc = armorAcValue; // heavy: no DEX
  }

  let finalAc = baseAc + shieldBonus;

  // Generic AC bonus always applies; armored/unarmored-specific bonuses only
  // apply in their matching state (previously both were summed unconditionally).
  finalAc += sumModifierBonuses(char.modifiers, "armor-class");
  finalAc += armorTypeId == null
    ? sumModifierBonuses(char.modifiers, "unarmored-armor-class")
    : sumModifierBonuses(char.modifiers, "armored-armor-class");

  return finalAc;
}

function findModifierValue(modifiers: Record<string, DdbModifier[]>, subType: string): number | null {
  for (const list of Object.values(modifiers)) {
    if (!Array.isArray(list)) continue;
    for (const mod of list) {
      if (mod.subType === subType) {
        const value = modifierValue(mod);
        if (value != null) return value;
      }
    }
  }
  return null;
}

// ============================================================================
// ITEM 10 (v0.9.0): saves, skills, and spell save DC — generic bonus subtypes
// ============================================================================
// Confirmed live 2026-09-09: Omaran Thallenn's Stone of Good Luck (Luckstone)
// grants `bonus ability-checks +1`, which every skill total should include
// but none did (formatSkills never summed anything beyond proficiency).

export const SAVING_THROW_SUBTYPES: Record<number, string> = {
  1: "strength-saving-throws",
  2: "dexterity-saving-throws",
  3: "constitution-saving-throws",
  4: "intelligence-saving-throws",
  5: "wisdom-saving-throws",
  6: "charisma-saving-throws",
};

export function getSavingThrowTotal(char: DdbCharacter, abilityId: number): number {
  const abilityMod = abilityModifierNumeric(computeCharacterAbilityScore(char, abilityId));
  const profBonus = calculateProficiencyBonus(computeLevel(char));
  const subType = SAVING_THROW_SUBTYPES[abilityId];
  const proficient = hasModifierBySubType(char.modifiers, subType, "proficiency");

  let total = abilityMod + (proficient ? profBonus : 0);
  total += sumModifierBonuses(char.modifiers, "saving-throws");
  total += sumModifierBonuses(char.modifiers, subType);
  return total;
}

export function getSkillTotal(char: DdbCharacter, abilityId: number, subType: string): number {
  const abilityMod = abilityModifierNumeric(computeCharacterAbilityScore(char, abilityId));
  const profBonus = calculateProficiencyBonus(computeLevel(char));
  const proficient = hasModifierBySubType(char.modifiers, subType, "proficiency");
  const expertise = hasModifierBySubType(char.modifiers, subType, "expertise");

  let total = abilityMod;
  if (expertise) total += profBonus * 2;
  else if (proficient) total += profBonus;

  total += sumModifierBonuses(char.modifiers, "ability-checks");
  total += sumModifierBonuses(char.modifiers, subType);
  return total;
}

// className lowercased, spaces hyphenated — e.g. "Eldritch Knight" -> "eldritch-knight".
export function classSlug(className: string): string {
  return className.toLowerCase().replace(/\s+/g, "-");
}

export function getSpellSaveDcBonus(char: DdbCharacter, className: string): number {
  return sumModifierBonuses(char.modifiers, "spell-save-dc")
    + sumModifierBonuses(char.modifiers, `${classSlug(className)}-spell-save-dc`);
}

// ============================================================================
// ITEM 12 (v0.9.0): speeds, initiative, passives, senses
// ============================================================================
// Confirmed live 2026-09-09: `race.weightSpeeds.normal` carries the real
// per-race speeds ({ walk, fly, burrow, swim, climb }); the old code
// hardcoded `baseSpeed = 30` regardless of race. `?? 30` fallback keeps
// older frozen fixtures/mocks (built before this field was known) working.

export interface CharacterSpeeds {
  walk: number;
  fly: number;
  swim: number;
  climb: number;
  burrow: number;
}

export function getSpeeds(char: DdbCharacter): CharacterSpeeds {
  const normal = char.race.weightSpeeds?.normal;
  const walkBase = normal?.walk ?? 30;
  const walkBonus = sumModifierBonuses(char.modifiers, "speed")
    + sumModifierBonuses(char.modifiers, "unarmored-movement")
    + sumModifierBonuses(char.modifiers, "innate-speed-walking");

  return {
    walk: walkBase + walkBonus,
    fly: normal?.fly ?? 0,
    swim: normal?.swim ?? 0,
    climb: normal?.climb ?? 0,
    burrow: normal?.burrow ?? 0,
  };
}

export function getInitiative(char: DdbCharacter): number {
  const dexMod = abilityModifierNumeric(computeCharacterAbilityScore(char, 2));
  return dexMod + sumModifierBonuses(char.modifiers, "initiative");
}

export function getPassiveScore(char: DdbCharacter, abilityId: number, subType: string): number {
  return 10 + getSkillTotal(char, abilityId, subType);
}

// Confirmed live 2026-09-09 (Warlock Test, Tiefling): darkvision is granted
// via `{ type: "set-base", subType: "darkvision", value: 60 }`. Senses take
// the max of any set/set-base value for that sense plus the sum of bonus-type
// additions, mirroring the "max, not stack" rule real 5e senses follow.
export const SENSE_SUBTYPES = ["darkvision", "blindsight", "tremorsense", "truesight"] as const;

export function getSenses(char: DdbCharacter): Record<string, number> {
  const senses: Record<string, number> = {};

  for (const subType of SENSE_SUBTYPES) {
    let best = 0;
    for (const list of Object.values(char.modifiers)) {
      if (!Array.isArray(list)) continue;
      for (const mod of list) {
        if (mod.subType !== subType) continue;
        const value = modifierValue(mod);
        if (value == null) continue;
        if (mod.type === "set" || mod.type === "set-base") best = Math.max(best, value);
      }
    }
    best += sumModifierBonuses(char.modifiers, subType);
    if (best > 0) senses[subType] = best;
  }

  return senses;
}
