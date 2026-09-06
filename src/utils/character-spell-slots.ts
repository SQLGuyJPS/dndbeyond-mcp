/**
 * Pact magic normalization.
 *
 * D&D Beyond's character-service has returned pactMagic in two different shapes
 * across this project's history: a single `{ level, used, available }` object,
 * and — confirmed live 2026-09-06 against a real Warlock (Phase 0 P5, see
 * docs/plans/2026-09-05-character-fixes-integration-plan.md) — an array of
 * per-level rows (`[{ level: 1, used, available }, { level: 2, ... }, ...]`)
 * where `available` is left at 0 for every row regardless of the character's
 * actual Warlock level. `getPactMagicState` handles both shapes and backfills
 * `available` from the Warlock Pact Magic table when the API doesn't populate it.
 *
 * Ported-From: grahamethompson/dndbeyond-mcp
 */
import type { DdbCharacter } from "../types/character.js";

export interface PactMagicState {
  level: number;
  used: number;
  available: number;
}

// PHB Warlock Pact Magic table: slot level and slot count by Warlock level.
export function warlockSlotLevel(warlockLevel: number): number {
  return Math.min(Math.ceil(warlockLevel / 2), 5);
}

export function warlockSlotCount(warlockLevel: number): number {
  if (warlockLevel <= 0) return 0;
  if (warlockLevel === 1) return 1;
  if (warlockLevel <= 10) return 2;
  if (warlockLevel <= 16) return 3;
  return 4;
}

function getWarlockLevel(char: DdbCharacter): number {
  return char.classes
    .filter((cls) => cls.definition.name === "Warlock")
    .reduce((sum, cls) => sum + cls.level, 0);
}

export function getPactMagicState(char: DdbCharacter): PactMagicState | null {
  const warlockLevel = getWarlockLevel(char);
  if (warlockLevel <= 0) return null;

  const raw = char.pactMagic;
  if (!raw) return null;

  const slotLevel = warlockSlotLevel(warlockLevel);
  const backfillAvailable = warlockSlotCount(warlockLevel);

  if (Array.isArray(raw)) {
    if (raw.length === 0) return null;
    const row = raw.find((r) => r.level === slotLevel) ?? raw.find((r) => r.available > 0) ?? raw[0];
    const available = row.available > 0 ? row.available : backfillAvailable;
    return { level: row.level, used: row.used, available };
  }

  const available = raw.available > 0 ? raw.available : backfillAvailable;
  return { level: raw.level, used: raw.used, available };
}

/**
 * Builds the { characterId, level<N>: used } body the live spell/pact-magic
 * endpoint expects, targeting whichever level row the character's current pact
 * slot level resolves to.
 */
export function buildPactMagicUpdateBody(char: DdbCharacter, characterId: number, used: number): Record<string, number> {
  const state = getPactMagicState(char);
  const warlockLevel = char.classes
    .filter((cls) => cls.definition.name === "Warlock")
    .reduce((sum, cls) => sum + cls.level, 0);
  const level = state?.level ?? warlockSlotLevel(warlockLevel);
  return { characterId, [`level${level}`]: used };
}
