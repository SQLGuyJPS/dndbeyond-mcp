export interface DdbCharacter {
  id: number;
  readonlyUrl: string;
  name: string;
  race: DdbRace;
  classes: DdbClass[];
  background: DdbBackground;
  stats: DdbAbilityScore[];
  bonusStats: DdbAbilityScore[];
  overrideStats: DdbAbilityScore[];
  baseHitPoints: number;
  bonusHitPoints: number | null;
  overrideHitPoints: number | null;
  removedHitPoints: number;
  temporaryHitPoints: number;
  currentXp: number;
  alignmentId: number;
  lifestyleId: number;
  currencies: DdbCurrencies;
  spells: DdbSpellsContainer;
  inventory: DdbInventoryItem[];
  deathSaves: DdbDeathSaves;
  traits: DdbTraits;
  preferences: Record<string, unknown>;
  configuration: Record<string, unknown>;
  actions: Record<string, DdbAction[]>;
  modifiers: Record<string, DdbModifier[]>;
  campaign: { id: number; name: string } | null;
  // Corrected 2026-09-06 (Phase 0 P6): id 4 is Exhaustion, not id 15 — see
  // CONDITION_NAMES in src/tools/character.ts.
  conditions?: Array<{ id: number; level: number | null }>;
  feats: DdbFeat[];
  notes: DdbNotes;
  level?: number;
  // Two shapes observed live (Phase 0 P5, 2026-09-06): a single object, and an
  // array of per-level rows with `available` left at 0. Use getPactMagicState()
  // (src/utils/character-spell-slots.ts) rather than reading this directly.
  pactMagic?:
    | { level: number; used: number; available: number }
    | Array<{ level: number; used: number; available: number }>
    | null;
  spellSlots?: Array<{
    level: number;
    used: number;
    available: number;
  }>;
  hitDiceUsed?: number;
  // Confirmed live 2026-09-09 (Warlock Test): a per-class collection separate
  // from spells.class, carrying spells (often the same ones, plus
  // invocation/pact-granted at-will spells) that spells.class's `prepared`/
  // `alwaysPrepared` flags don't always mark. See getCharacterSpellEntries()
  // in character-spells.ts (item 8).
  classSpells?: Array<{
    characterClassId: number;
    spells: DdbSpell[];
  }>;
}

export interface DdbRace {
  fullName: string;
  baseRaceName: string;
  isHomebrew: boolean;
  racialTraits: DdbRacialTrait[];
  // Confirmed live 2026-09-09 — real per-race movement speeds. The old code
  // hardcoded every character to 30 ft; see getSpeeds() in
  // character-calculations.ts.
  weightSpeeds?: {
    normal?: {
      walk?: number;
      fly?: number;
      burrow?: number;
      swim?: number;
      climb?: number;
    } | null;
  } | null;
}

export interface DdbClass {
  id: number;
  definition: { id: number; name: string };
  subclassDefinition: { name: string; classFeatures: DdbClassFeature[] } | null;
  level: number;
  isStartingClass: boolean;
  classFeatures: DdbClassFeature[];
  // Present on live payloads (confirmed 2026-09-06); needed for the
  // rest/short POST body's classHitDiceUsed map, keyed by this class's `id`
  // (the class-mapping ID), not `definition.id`.
  hitDiceUsed?: number;
}

export interface DdbBackground {
  definition: {
    name: string;
    description: string;
    featureName: string | null;
    featureDescription: string | null;
    snippet: string | null;
    skillProficienciesDescription: string | null;
    toolProficienciesDescription: string | null;
    equipmentDescription: string | null;
  } | null;
}

export interface DdbAbilityScore {
  id: number; // 1=STR, 2=DEX, 3=CON, 4=INT, 5=WIS, 6=CHA
  value: number | null;
}

export interface DdbCurrencies {
  cp: number;
  sp: number;
  ep: number;
  gp: number;
  pp: number;
}

export interface DdbSpellsContainer {
  race: DdbSpell[] | null;
  class: DdbSpell[] | null;
  background: DdbSpell[] | null;
  item: DdbSpell[] | null;
  feat: DdbSpell[] | null;
}

export interface DdbSpell {
  id: number;
  definition: {
    // The spell-definition ID (stable across every source/character that
    // grants this spell) — distinct from the top-level `id`, which is a
    // per-grant instance ID and differs even for the same spell granted
    // twice. Dedup by `definition.id`, not `id`. Confirmed live 2026-09-09.
    id?: number;
    name: string;
    level: number;
    school: string;
    description: string;
    range: {
      origin: string;
      rangeValue: number | null;
      aoeType: string | null;
      aoeValue: number | null;
    } | null;
    duration: {
      durationInterval: number | null;
      durationUnit: string | null; // "Hour", "Minute", etc.
      durationType: string; // "Concentration" or "Time"
    } | null;
    activation: {
      activationTime: number;
      activationType: number; // 1=Action, 3=Bonus Action, 6=Reaction
    } | null;
    components: number[] | null; // 1=V, 2=S, 3=M
    componentsDescription: string | null;
    concentration: boolean;
    ritual: boolean;
    isLegacy?: boolean; // true = 2014 (legacy) content; false = 2024
    sourceId?: number;
  };
  prepared: boolean;
  alwaysPrepared: boolean;
  usesSpellSlot: boolean;
  // Confirmed live 2026-09-09: an at-will/limited-use racial, feat, or item
  // spell (e.g. Tiefling's Hellish Rebuke, Magic Initiate's 1/long-rest
  // spell) carries this even though `prepared`/`alwaysPrepared` are both
  // false. See getCharacterSpellEntries() in character-spells.ts (item 8).
  limitedUse?: DdbLimitedUse | null;
}

export interface DdbInventoryItem {
  id: number;
  definition: {
    name: string;
    description: string;
    type: string;
    rarity: string;
    weight: number;
    cost: number | null;
    isHomebrew: boolean;
    armorClass?: number | null;
    filterType?: string;
    // Confirmed live 2026-09-09: 1=light, 2=medium, 3=heavy, 4=shield. Every
    // shield observed live carries this even when `type`/`filterType` are
    // empty/null — see findArmorTypeId() in character-calculations.ts.
    armorTypeId?: number | null;
  };
  equipped: boolean;
  quantity: number;
}

export interface DdbDeathSaves {
  failCount: number | null;
  successCount: number | null;
  isStabilized: boolean;
}

export interface DdbTraits {
  personalityTraits: string | null;
  ideals: string | null;
  bonds: string | null;
  flaws: string | null;
  appearance: string | null;
}

export interface DdbLimitedUse {
  maxUses: number;
  numberUsed: number;
  // Corrected 2026-09-06 (Phase 0 P10): 1 = Short Rest, 2 = Long Rest, 3 = Dawn,
  // 4 = Other. This comment previously had Long Rest and Short Rest swapped;
  // confirmed live via a Warlock feature whose PHB text is explicitly
  // long-rest-only and carried resetType 2, not 1. Ported-From: grahamethompson/dndbeyond-mcp
  resetType: number;
  resetTypeDescription: string;
  useProficiencyBonus?: boolean;
}

export interface DdbAction {
  id: number;
  entityTypeId: number;
  name: string;
  componentId: number;
  componentTypeId: number;
  limitedUse: DdbLimitedUse | null;
}

export interface DdbModifier {
  id: string | number;
  type: string;
  subType: string;
  value: number | null;
  // Confirmed live 2026-09-09: some modifiers (item-granted flat bonuses, and
  // every `set`/`set-base` modifier observed) carry the real number here
  // instead of — or in addition to — `value`. Read both (see
  // character-calculations.ts's modifierValue()) rather than `value` alone.
  fixedValue?: number | null;
  // Present on `set`/`set-base` modifiers that scale off an ability score
  // (e.g. natural armor's "13 + CON mod": value=3, statId=3). Absent
  // (null/undefined) on modifiers with no ability-score component.
  statId?: number | null;
  friendlyTypeName: string;
  friendlySubtypeName: string;
  componentId: number;
  componentTypeId: number;
}

export interface DdbFeat {
  definition: {
    name: string;
    description: string;
    snippet: string | null;
    prerequisite: string | null;
  };
  componentId: number;
  componentTypeId: number;
}

export interface DdbClassFeature {
  // Class features nest under .definition; subclass features are flat
  definition?: {
    name: string;
    requiredLevel: number;
    description: string;
    snippet: string | null;
  };
  // Flat fields (subclass features)
  name?: string;
  requiredLevel?: number;
  description?: string;
}

export interface DdbRacialTrait {
  definition: {
    name: string;
    description: string;
    snippet: string | null;
  };
}

export interface DdbNotes {
  personalPossessions: string | null;
  backstory: string | null;
  otherNotes: string | null;
  allies: string | null;
  organizations: string | null;
}

export interface CharacterSummary {
  id: number;
  name: string;
  race: string;
  classes: string;
  level: number;
  hp: { current: number; max: number; temp: number };
  ac: number;
  campaignName: string | null;
}
