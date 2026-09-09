/**
 * Tier-1 frozen-fixture tests, per docs/plans/2026-09-05-character-fixes-
 * integration-plan.md §3.2's capture -> freeze rule. Each `<name>.json` is a
 * scrubbed real character-service v5 payload (see src/scripts/scrub-fixture.ts
 * and the fixture catalog in the plan); `<name>.expected.json` is ground
 * truth. This is what keeps armored AC, natural armor, unarmored barbarian/
 * monk formulas, multiclass HP, and set-type ability scores covered forever
 * without a contributor owning any of the source characters.
 *
 * NOTE: `expected.json`'s values here were computed from the fixed formulas
 * (2026-09-09), not yet independently confirmed against the real D&D Beyond
 * web sheet — see each file's `notes` field and the plan's §3.2 "Ground
 * truth: the web sheet, mandatory" rule. Update the `.expected.json` files
 * (and this comment) once confirmed.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { DdbCharacter } from "../../src/types/character.js";
import {
  calculateAc,
  calculateMaxHp,
  computeCharacterAbilityScore,
  getSavingThrowTotal,
  getSpeeds,
  getInitiative,
  getPassiveScore,
} from "../../src/utils/character-calculations.js";
import { getCharacterSpellEntries } from "../../src/utils/character-spells.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = join(__dirname, "../fixtures/characters");

const ABILITY_IDS: Record<string, number> = { str: 1, dex: 2, con: 3, int: 4, wis: 5, cha: 6 };

interface Expected {
  ac: number;
  maxHp: number;
  initiative: number;
  passivePerception: number;
  passiveInsight: number;
  passiveInvestigation: number;
  speeds: { walk: number; fly: number; swim: number; climb: number; burrow: number };
  saves: Record<string, number>;
  abilityScores: Record<string, number>;
  spellCount: number;
}

const fixtureNames = readdirSync(FIXTURES_DIR)
  .filter((f) => f.endsWith(".json") && !f.endsWith(".expected.json"))
  .map((f) => f.replace(/\.json$/, ""));

describe.each(fixtureNames)("frozen fixture: %s", (name) => {
  const char: DdbCharacter = JSON.parse(readFileSync(join(FIXTURES_DIR, `${name}.json`), "utf-8"));
  const expected: Expected = JSON.parse(readFileSync(join(FIXTURES_DIR, `${name}.expected.json`), "utf-8"));

  it("AC matches expected", () => {
    expect(calculateAc(char)).toBe(expected.ac);
  });

  it("max HP matches expected", () => {
    expect(calculateMaxHp(char)).toBe(expected.maxHp);
  });

  it("initiative matches expected", () => {
    expect(getInitiative(char)).toBe(expected.initiative);
  });

  it("passive scores match expected", () => {
    expect(getPassiveScore(char, 5, "perception")).toBe(expected.passivePerception);
    expect(getPassiveScore(char, 5, "insight")).toBe(expected.passiveInsight);
    expect(getPassiveScore(char, 4, "investigation")).toBe(expected.passiveInvestigation);
  });

  it("speeds match expected", () => {
    expect(getSpeeds(char)).toEqual(expected.speeds);
  });

  it("ability scores match expected", () => {
    for (const [name, id] of Object.entries(ABILITY_IDS)) {
      expect(computeCharacterAbilityScore(char, id)).toBe(expected.abilityScores[name]);
    }
  });

  it("saving throws match expected", () => {
    for (const [name, id] of Object.entries(ABILITY_IDS)) {
      expect(getSavingThrowTotal(char, id)).toBe(expected.saves[name]);
    }
  });

  it("spell count matches expected", () => {
    expect(getCharacterSpellEntries(char)).toHaveLength(expected.spellCount);
  });
});
