/**
 * Item 8 (v0.9.0): spell provenance. `getAllSpells` (src/tools/character.ts,
 * pre-fix) merged the five `spells.*` collections but every caller then
 * filtered to `prepared || alwaysPrepared` — which silently dropped every
 * at-will or limited-use spell granted by a race, feat, or item, since D&D
 * Beyond marks all of those `prepared: false, alwaysPrepared: false` too.
 *
 * Confirmed live 2026-09-09 on real characters: a Tiefling's innate spells
 * (Fire Bolt, Thaumaturgy always-at-will; Hellish Rebuke, Darkness 1/long
 * rest), a Magic Initiate feat's 1/long-rest spell, an Elven Lineage's
 * 1/long-rest spell, a Wand of Magic Missiles' charge-based spell, and a
 * Warlock's invocation-granted at-will/limited spells (Disguise Self, Mage
 * Armor, Find Familiar) were all completely invisible under the old filter,
 * on top of also being invisible to `formatSpellcasting`'s "does this
 * character have any spells at all" gate.
 *
 * `classSpells` (confirmed live, not previously modeled) duplicates some of
 * `spells.class` while carrying additional invocation/pact-granted entries;
 * both are merged here and de-duplicated by definition ID, OR-ing the
 * prepared/alwaysPrepared/usesSpellSlot flags and unioning sources so a
 * spell granted by two features (e.g. a race and an item) appears once,
 * crediting both.
 */
import type { DdbCharacter, DdbSpell, DdbLimitedUse } from "../types/character.js";

const SOURCE_LABELS: Record<string, string> = {
  race: "Race",
  class: "Class",
  background: "Background",
  item: "Item",
  feat: "Feat",
};

export interface CharacterSpellEntry {
  definitionId: number;
  spell: DdbSpell;
  sources: Set<string>;
  prepared: boolean;
  alwaysPrepared: boolean;
  usesSpellSlot: boolean;
  limitedUse: DdbLimitedUse | null;
}

export function getCharacterSpellEntries(char: DdbCharacter): CharacterSpellEntry[] {
  const entries = new Map<number, CharacterSpellEntry>();

  function merge(source: string, spell: DdbSpell): void {
    const id = spell.definition.id ?? spell.id;
    const existing = entries.get(id);
    if (existing) {
      existing.sources.add(source);
      existing.prepared = existing.prepared || spell.prepared;
      existing.alwaysPrepared = existing.alwaysPrepared || spell.alwaysPrepared;
      existing.usesSpellSlot = existing.usesSpellSlot || spell.usesSpellSlot;
      existing.limitedUse = existing.limitedUse ?? (spell.limitedUse ?? null);
      return;
    }
    entries.set(id, {
      definitionId: id,
      spell,
      sources: new Set([source]),
      prepared: spell.prepared,
      alwaysPrepared: spell.alwaysPrepared,
      usesSpellSlot: spell.usesSpellSlot,
      limitedUse: spell.limitedUse ?? null,
    });
  }

  for (const [source, list] of Object.entries(char.spells)) {
    if (!Array.isArray(list)) continue;
    for (const spell of list) merge(source, spell);
  }

  for (const classEntry of char.classSpells ?? []) {
    for (const spell of classEntry.spells ?? []) merge("class", spell);
  }

  return [...entries.values()];
}

export function formatSourceLabel(source: string): string {
  return SOURCE_LABELS[source] ?? source.charAt(0).toUpperCase() + source.slice(1);
}

// Fallback names for resetType — shared with src/tools/character.ts's
// RESET_TYPE_NAMES (corrected Phase 0 P10; see that file's comment).
const RESET_TYPE_NAMES: Record<number, string> = {
  1: "Short Rest", 2: "Long Rest", 3: "Dawn", 4: "Other",
};

// Renders the casting-mode annotation for one spell entry:
//   "Prepared" | "Always Prepared" | "1/Long Rest" | "PB/Long Rest" | "At Will"
export function formatCastingMode(entry: CharacterSpellEntry): string {
  if (entry.alwaysPrepared) return "Always Prepared";
  if (entry.prepared) return "Prepared";
  if (entry.limitedUse) {
    const reset = entry.limitedUse.resetTypeDescription
      || RESET_TYPE_NAMES[entry.limitedUse.resetType]
      || "Unknown Reset";
    const uses = entry.limitedUse.useProficiencyBonus ? "PB" : String(entry.limitedUse.maxUses);
    return `${uses}/${reset}`;
  }
  return "At Will";
}

export function formatSpellAnnotation(entry: CharacterSpellEntry): string {
  const sources = [...entry.sources].map(formatSourceLabel).sort().join(", ");
  const modes = new Set<string>([formatCastingMode(entry)]);
  return `${entry.spell.definition.name} [${sources}; ${[...modes].join(", ")}]`;
}
