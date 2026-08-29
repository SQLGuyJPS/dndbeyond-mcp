import { DdbClient } from "../api/client.js";
import { SpellSearchParams, MonsterSearchParams, ItemSearchParams, FeatSearchParams, ClassSearchParams, RaceSearchParams, BackgroundSearchParams, ClassFeatureSearchParams, RacialTraitSearchParams, SubclassSearchParams, Edition } from "../types/reference.js";
import { DdbCharacter, DdbSpell } from "../types/character.js";
import { ENDPOINTS } from "../api/endpoints.js";

interface ToolResult {
  [key: string]: unknown;
  content: Array<{ type: "text"; text: string }>;
}

// --- Game config / enum lookup tables ---

interface GameConfig {
  challengeRatings: Array<{ id: number; value: number; xp: number; proficiencyBonus: number }>;
  monsterTypes: Array<{ id: number; name: string }>;
  environments: Array<{ id: number; name: string }>;
  alignments: Array<{ id: number; name: string }>;
  damageTypes: Array<{ id: number; name: string }>;
  senses: Array<{ id: number; name: string }>;
  sources?: Array<{ id: number; name: string; sourceCategoryId?: number }>;
  damageAdjustments: Array<{ id: number; name: string; type: number }>;
}

const SIZE_MAP: Record<number, string> = {
  2: "Tiny", 3: "Small", 4: "Medium", 5: "Large", 6: "Huge", 7: "Gargantuan",
};

const STAT_NAMES: Record<number, string> = {
  1: "STR", 2: "DEX", 3: "CON", 4: "INT", 5: "WIS", 6: "CHA",
};

const MOVEMENT_NAMES: Record<number, string> = {
  1: "walk", 2: "burrow", 3: "climb", 4: "fly", 5: "swim",
};

// Hardcoded source book map as fallback if config doesn't have sources
const SOURCE_MAP: Record<string, number> = {
  "monster manual": 1,
  "volos guide": 2,
  "volos guide to monsters": 2,
  "mordenkainens tome": 3,
  "mordenkainens tome of foes": 3,
  "fizbans treasury": 4,
  "fizbans treasury of dragons": 4,
  "tomb of annihilation": 9,
  "curse of strahd": 1,
  "hoard of the dragon queen": 1,
  "princes of the apocalypse": 2,
  "out of the abyss": 2,
  "storm kings thunder": 3,
  "tales from the yawning portal": 7,
  "tomb of horrors": 9,
};

let cachedConfig: GameConfig | null = null;

async function getGameConfig(client: DdbClient): Promise<GameConfig> {
  if (cachedConfig) return cachedConfig;
  cachedConfig = await client.getRaw<GameConfig>(
    ENDPOINTS.config.json(),
    "game-config",
    86_400_000, // 24h
  );
  return cachedConfig;
}

/**
 * Like getGameConfig, but swallows fetch failures. Classes, backgrounds, feats,
 * class features, and racial traits only need config for optional edition
 * tagging/derivation (source-category lookup) — not to fetch their own data — so
 * if the config endpoint is unreachable those searches should still return
 * results (just without edition tags) rather than fail outright.
 */
async function getGameConfigSafe(client: DdbClient): Promise<GameConfig | undefined> {
  try {
    return await getGameConfig(client);
  } catch {
    return undefined;
  }
}

function resolveSourceId(config: GameConfig, source?: string): number | undefined {
  if (!source) return undefined;
  const q = source.toLowerCase().trim();
  const fromConfig = config.sources?.find((s) => s.name.toLowerCase().includes(q) || q.includes(s.name.toLowerCase()));
  if (fromConfig) return fromConfig.id;
  return SOURCE_MAP[q];
}

// --- Monster service types ---

interface MonsterServiceResponse {
  accessType: Record<string, number>;
  pagination: { take: number; skip: number; currentPage: number; pages: number; total: number };
  data: DdbMonster[];
}

interface MonsterServiceSingleResponse {
  accessType: number;
  data: DdbMonster;
}

interface DdbMonster {
  id: number;
  name: string;
  alignmentId: number;
  sizeId: number;
  typeId: number;
  armorClass: number;
  armorClassDescription: string;
  averageHitPoints: number;
  hitPointDice: { diceCount: number; diceValue: number; fixedValue: number; diceString: string };
  passivePerception: number;
  challengeRatingId: number;
  isHomebrew: boolean;
  isLegendary: boolean;
  isMythic: boolean;
  isLegacy: boolean;
  url: string;
  avatarUrl: string;
  stats: Array<{ statId: number; value: number }>;
  skills: Array<{ skillId: number; value: number }>;
  senses: Array<{ senseId: number; notes: string }>;
  savingThrows: Array<{ statId: number; bonusModifier: number | null }>;
  movements: Array<{ movementId: number; speed: number; notes: string | null }>;
  languages: Array<{ languageId: number; notes: string }>;
  damageAdjustments: number[];
  conditionImmunities: number[];
  environments: number[];
  specialTraitsDescription: string;
  actionsDescription: string;
  reactionsDescription: string;
  legendaryActionsDescription: string;
  mythicActionsDescription: string;
  bonusActionsDescription: string;
  lairDescription: string;
  languageDescription: string;
  languageNote: string;
  sensesHtml: string;
  skillsHtml: string;
  conditionImmunitiesHtml: string;
}

// --- Spell compendium ---

// Class IDs for building the full spell compendium
const SPELLCASTING_CLASS_IDS = [1, 2, 3, 4, 5, 6, 7, 8]; // Bard through Wizard

// D7a: the single named interception point for "what edition do we show when
// the caller doesn't say?" — today a constant equal to every other tool's
// implicit default; a future config-driven per-user preference (see
// docs/design/2026-08-26-edition-preference-design.md) only has to change
// this one spot instead of every `?? "2024"` call site.
const DEFAULT_EDITION: Edition = "2024";

/**
 * Loads the full spell compendium by querying always-known-spells and always-prepared-spells for all classes.
 * Queries both classLevel=1 (for cantrips/level 0 spells) and classLevel=20 (for levels 1-9).
 * Deduplicates by spell definition name.
 */
async function loadSpellCompendium(client: DdbClient, campaignId?: number): Promise<DdbSpell[]> {
  const allSpells = new Map<string, DdbSpell>();
  let failureCount = 0;
  const totalRequests = SPELLCASTING_CLASS_IDS.length * 4; // 2 for known, 2 for prepared

  for (const classId of SPELLCASTING_CLASS_IDS) {
    // Fetch cantrips (level 0) by querying at classLevel=1
    try {
      const cantrips = await client.get<DdbSpell[]>(
        ENDPOINTS.gameData.alwaysKnownSpells(classId, 1, campaignId),
        campaignCacheKey(`spell-compendium:class:${classId}:cantrips`, campaignId),
        86_400_000, // 24h
      );

      for (const spell of cantrips ?? []) {
        const key = `${spell.definition?.name}|${spell.definition?.isLegacy ? "L" : "N"}`;
        if (spell.definition?.name && !allSpells.has(key)) {
          allSpells.set(key, spell);
        }
      }
    } catch {
      failureCount++;
    }

    // Fetch higher-level spells (levels 1-9) by querying at classLevel=20
    try {
      const spells = await client.get<DdbSpell[]>(
        ENDPOINTS.gameData.alwaysKnownSpells(classId, 20, campaignId),
        campaignCacheKey(`spell-compendium:class:${classId}`, campaignId),
        86_400_000, // 24h
      );

      for (const spell of spells ?? []) {
        const key = `${spell.definition?.name}|${spell.definition?.isLegacy ? "L" : "N"}`;
        if (spell.definition?.name && !allSpells.has(key)) {
          allSpells.set(key, spell);
        }
      }
    } catch {
      failureCount++;
    }

    // Fetch always-prepared cantrips (level 0) by querying at classLevel=1
    try {
      const preparedCantrips = await client.get<DdbSpell[]>(
        ENDPOINTS.gameData.alwaysPreparedSpells(classId, 1, campaignId),
        campaignCacheKey(`spell-compendium:class:${classId}:prepared-cantrips`, campaignId),
        86_400_000, // 24h
      );

      for (const spell of preparedCantrips ?? []) {
        const key = `${spell.definition?.name}|${spell.definition?.isLegacy ? "L" : "N"}`;
        if (spell.definition?.name && !allSpells.has(key)) {
          allSpells.set(key, spell);
        }
      }
    } catch {
      failureCount++;
    }

    // Fetch always-prepared spells (levels 1-9) by querying at classLevel=20
    try {
      const preparedSpells = await client.get<DdbSpell[]>(
        ENDPOINTS.gameData.alwaysPreparedSpells(classId, 20, campaignId),
        campaignCacheKey(`spell-compendium:class:${classId}:prepared`, campaignId),
        86_400_000, // 24h
      );

      for (const spell of preparedSpells ?? []) {
        const key = `${spell.definition?.name}|${spell.definition?.isLegacy ? "L" : "N"}`;
        if (spell.definition?.name && !allSpells.has(key)) {
          allSpells.set(key, spell);
        }
      }
    } catch {
      failureCount++;
    }
  }

  if (failureCount === totalRequests) {
    throw new Error("Failed to load spell compendium: all API requests failed. Check your authentication or try again later.");
  }

  return Array.from(allSpells.values());
}

/**
 * Projects a DdbSpell into the shape collapseByEdition/pickByEdition need —
 * both operate on top-level `name`/`isLegacy`, but DdbSpell nests both under
 * `.definition`. Returns a new object (rather than mutating the input) since
 * DdbSpell instances here come from the shared TTL cache and may be reused
 * across calls.
 */
function asEditionRanked(spell: DdbSpell): DdbSpell & EditionRanked {
  return { ...spell, name: spell.definition.name, isLegacy: spell.definition.isLegacy };
}

/**
 * Searches for spells matching the given parameters.
 * Uses the full spell compendium from always-known-spells endpoints.
 */
export async function searchSpells(
  client: DdbClient,
  params: SpellSearchParams,
  _characterIds?: number[]
): Promise<ToolResult> {
  let allSpells: DdbSpell[];
  try {
    allSpells = await loadSpellCompendium(client, params.campaignId);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load spell compendium";
    return { content: [{ type: "text", text: message }] };
  }

  let matchedSpells = allSpells;

  if (params.name) {
    const searchName = params.name.toLowerCase();
    matchedSpells = matchedSpells.filter((spell) =>
      spell.definition.name.toLowerCase().includes(searchName)
    );
  }

  if (params.level !== undefined) {
    matchedSpells = matchedSpells.filter(
      (spell) => spell.definition.level === params.level
    );
  }

  if (params.school) {
    const searchSchool = params.school.toLowerCase();
    matchedSpells = matchedSpells.filter((spell) =>
      spell.definition.school.toLowerCase().includes(searchSchool)
    );
  }

  if (params.concentration !== undefined) {
    matchedSpells = matchedSpells.filter(
      (spell) => spell.definition.concentration === params.concentration
    );
  }

  if (params.ritual !== undefined) {
    matchedSpells = matchedSpells.filter(
      (spell) => spell.definition.ritual === params.ritual
    );
  }

  // Collapse 2014/2024 duplicates to one row per name, preferring the
  // requested edition — or DEFAULT_EDITION when none is given, which
  // preserves the old hardcoded "always prefer 2024" behavior rather than
  // regressing to collapseByEdition's no-op-when-undefined default (that
  // would resurrect duplicate same-name rows for every unfiltered search).
  matchedSpells = collapseByEdition(matchedSpells.map(asEditionRanked), params.edition ?? DEFAULT_EDITION);

  // Sort by level then name
  matchedSpells.sort((a, b) => {
    if (a.definition.level !== b.definition.level) return a.definition.level - b.definition.level;
    return a.definition.name.localeCompare(b.definition.name);
  });

  if (matchedSpells.length === 0) {
    return {
      content: [{ type: "text", text: "No spells found matching the criteria." }],
    };
  }

  const lines = [`# Spell Search Results (${matchedSpells.length} found)\n`];
  for (const spell of matchedSpells) {
    const level = spell.definition.level === 0 ? "Cantrip" : `Level ${spell.definition.level}`;
    const tags = [];
    if (spell.definition.concentration) tags.push("Concentration");
    if (spell.definition.ritual) tags.push("Ritual");
    const tagStr = tags.length > 0 ? ` (${tags.join(", ")})` : "";
    // Same DEFAULT_EDITION fallback as the collapse above: with no edition
    // requested, a spell that only exists pre-2024 had to fall back to its
    // 2014 variant during the collapse, so it's tagged here — new
    // information the old hand-rolled collapse never surfaced, not a
    // regression (see D1 in the PR #12 review-response plan).
    const editionTag = editionSuffix(spell.definition.isLegacy, params.edition ?? DEFAULT_EDITION);

    lines.push(
      `- **${spell.definition.name}**${editionTag} — ${level}, ${spell.definition.school}${tagStr}`
    );
  }

  return {
    content: [{ type: "text", text: lines.join("\n") }],
  };
}

/**
 * Gets full details for a specific spell by name.
 */
export async function getSpell(
  client: DdbClient,
  params: { spellName: string; edition?: Edition; campaignId?: number },
  _characterIds?: number[]
): Promise<ToolResult> {
  const searchName = params.spellName.toLowerCase();
  let allSpells: DdbSpell[];
  try {
    allSpells = await loadSpellCompendium(client, params.campaignId);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load spell compendium";
    return { content: [{ type: "text", text: message }] };
  }

  // Candidate matches: exact name first, else partial. A spell can have both a
  // 2014 (isLegacy) and a 2024 variant, so there may be more than one.
  const exact = allSpells.filter((s) => s.definition.name.toLowerCase() === searchName);
  const candidates = exact.length > 0
    ? exact
    : allSpells.filter((s) => s.definition.name.toLowerCase().includes(searchName));

  if (candidates.length === 0) {
    return {
      content: [
        { type: "text", text: `Spell "${params.spellName}" not found in the compendium.` },
      ],
    };
  }

  // Pick the variant matching the requested edition (2024 = non-legacy, 2014 =
  // legacy); fall back to whatever exists if only one edition is present.
  const spell = pickByEdition(candidates.map(asEditionRanked), params.edition);

  return formatSpellDetails(spell);
}

function formatSpellDetails(spell: DdbSpell): ToolResult {
  const def = spell.definition;

  const level = def.level === 0 ? "Cantrip" : `${def.level}${getOrdinalSuffix(def.level)}-level`;

  const componentMap = { 1: "V", 2: "S", 3: "M" };
  const components = (def.components ?? [])
    .map((c) => componentMap[c as keyof typeof componentMap])
    .filter(Boolean)
    .join(", ");

  const ACTIVATION_TYPES: Record<number, string> = {
    0: "No Action",
    1: "Action",
    2: "No Action",
    3: "Bonus Action",
    4: "Reaction",
    5: "Special",
    6: "Minute",
    7: "Hour",
    8: "Special",
  };
  const castingTime = def.activation
    ? `${def.activation.activationTime} ${ACTIVATION_TYPES[def.activation.activationType] ?? "Action"}`
    : "1 Action";

  let range = "Self";
  if (def.range) {
    range = def.range.rangeValue && def.range.origin !== "Self"
      ? `${def.range.rangeValue} ft`
      : def.range.origin;
    if (def.range.aoeType && def.range.aoeValue) {
      range += ` (${def.range.aoeValue}-ft ${def.range.aoeType})`;
    }
  }

  let duration = "Instantaneous";
  if (def.duration) {
    const interval = def.duration.durationInterval;
    const unit = def.duration.durationUnit;
    if (interval && unit) {
      duration = `${def.concentration ? "Concentration, up to " : ""}${interval} ${unit}${interval > 1 ? "s" : ""}`;
    } else if (def.duration.durationType === "Concentration") {
      duration = "Concentration";
    }
  }

  const tags = [];
  if (def.concentration) tags.push("Concentration");
  if (def.ritual) tags.push("Ritual");
  const tagStr = tags.length > 0 ? ` (${tags.join(", ")})` : "";

  const lines = [
    `# ${def.name}${editionHeaderLabel(def.isLegacy)}`,
    `*${level} ${def.school}${tagStr}*\n`,
    `**Casting Time:** ${castingTime}`,
    `**Range:** ${range}`,
    `**Components:** ${components}`,
    `**Duration:** ${duration}\n`,
    stripHtml(def.description),
  ];

  return {
    content: [{ type: "text", text: lines.join("\n") }],
  };
}

function getOrdinalSuffix(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return s[(v - 20) % 10] || s[v] || s[0];
}

// --- Monster tools ---

function stripHtml(html: string): string {
  if (!html) return "";
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<\/li>/gi, "\n")
    .replace(/<li>/gi, "• ")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function abilityMod(score: number): string {
  const mod = Math.floor((score - 10) / 2);
  return mod >= 0 ? `+${mod}` : `${mod}`;
}

/** A monster-ish record carrying DDB's legacy flag. */
export type EditionRanked = {
  name: string;
  /** Optional so plain test stubs may omit it; treated as non-legacy (2024) when absent. */
  isLegacy?: boolean;
};

/**
 * Pick the variant matching the requested edition (2024 = non-legacy, 2014 =
 * legacy); fall back to the first candidate when no edition is given or none match.
 * Mirrors getSpell's variant selection.
 */
export function pickByEdition<T extends EditionRanked>(
  candidates: T[],
  edition?: Edition,
): T {
  if (!edition) return candidates[0];
  const wantLegacy = edition === "2014";
  return candidates.find((c) => Boolean(c.isLegacy) === wantLegacy) ?? candidates[0];
}

/**
 * Collapse same-name cross-edition duplicates to one row per name, preferring the
 * requested edition's variant (keeping single-edition monsters as-is). Preserves
 * first-seen name order. Returns the input unchanged when no edition is given.
 */
export function collapseByEdition<T extends EditionRanked>(
  monsters: T[],
  edition?: Edition,
): T[] {
  if (!edition) return monsters;
  const byName = new Map<string, T[]>();
  for (const m of monsters) {
    const key = m.name.toLowerCase();
    const arr = byName.get(key);
    if (arr) arr.push(m);
    else byName.set(key, [m]);
  }
  const out: T[] = [];
  const seen = new Set<string>();
  for (const m of monsters) {
    const key = m.name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(pickByEdition(byName.get(key)!, edition));
  }
  return out;
}

// D&D Beyond source-category IDs that distinguish 2014 ("5e") rulebooks from 2024
// ("5.5e") ones — see the `sourceCategories` list at /api/config/json.
const LEGACY_SOURCE_CATEGORY_IDS = new Set([1, 23, 26]); // 5e Expanded Rules, Legacy/Noncore, 5e Core Rules
// The current-edition counterparts. A source landing in neither set (homebrew,
// campaign settings, Critical Role, etc.) is a *recognized* source that just
// isn't tied to a specific edition — that's still a confident "false" below,
// distinct from not being able to determine anything at all.
const CURRENT_SOURCE_CATEGORY_IDS = new Set([24, 38]); // 5.5e Core Rules, 5.5e Expanded Rules

/**
 * Derives 2014-vs-2024 edition status from an entity's primary source book, for
 * entity types (classes, backgrounds, feats, ...) whose game-data payload doesn't
 * carry an explicit `isLegacy` flag the way monsters/items/races/spells do.
 *
 * Returns `undefined` — genuinely unknown, not "assume 2024" — whenever the
 * question can't actually be answered: the config fetch failed, the config
 * omits its `sources` list, or the entity's source isn't among the ones config
 * knows about. Only returns a real `boolean` once the source is recognized:
 * `true`/`false` for the two edition-tied category sets, `false` for a
 * recognized source outside both (it's confidently not edition-specific, which
 * is a different fact than "we don't know"). Callers must not coerce this
 * result with `Boolean()` — that silently turns "unknown" into "2024" again,
 * which is exactly the bug this tri-state exists to avoid; use it as-is (or
 * via editionHeaderLabel/editionSuffix, which handle all three states).
 */
export function isLegacyBySource(config: GameConfig | undefined, sources?: Array<{ sourceId: number }>): boolean | undefined {
  const sourceId = sources?.[0]?.sourceId;
  if (sourceId === undefined) return undefined;
  if (!config?.sources) return undefined;
  const categoryId = config.sources.find((s) => s.id === sourceId)?.sourceCategoryId;
  if (categoryId === undefined) return undefined;
  if (LEGACY_SOURCE_CATEGORY_IDS.has(categoryId)) return true;
  if (CURRENT_SOURCE_CATEGORY_IDS.has(categoryId)) return false;
  return false; // Recognized source, but not tied to either edition.
}

/**
 * Annotates entities that carry a `sources` list (but no native `isLegacy` field)
 * with a computed `isLegacy` flag, making them usable with pickByEdition /
 * collapseByEdition just like monsters, items, races, and spells. `isLegacy` is
 * `undefined` (not a coerced `false`) whenever isLegacyBySource couldn't
 * determine it — see its doc comment.
 */
function withLegacyFlag<T extends { sources?: Array<{ sourceId: number }> }>(
  config: GameConfig | undefined,
  items: T[],
): (T & { isLegacy: boolean | undefined })[] {
  return items.map((item) => ({ ...item, isLegacy: isLegacyBySource(config, item.sources) }));
}

/**
 * Formats an edition-indicator suffix for a list row. `isLegacy === undefined`
 * (edition genuinely undetermined — see isLegacyBySource) always renders
 * "[edition unknown]", regardless of whether an edition was requested: a
 * confident-looking [2014]/[2024] tag here would be worse than no tag, since
 * the row's true edition is not actually known. Otherwise: with no edition
 * requested, legacy entries are tagged "(Legacy)" so same-name 2014/2024 rows
 * (e.g. two "Fighter" classes) stay distinguishable; with an edition
 * requested, results have already been collapsed to one row per name, so the
 * tag only appears when that row had to fall back to the other edition
 * because no matching variant exists.
 */
function editionSuffix(isLegacy: boolean | undefined, edition?: Edition): string {
  if (isLegacy === undefined) return " [edition unknown]";
  if (edition) {
    // isLegacy is already a real boolean here (not undefined), so this
    // Boolean() is just documenting the comparison's intent, not coercing
    // away a missing value.
    return Boolean(isLegacy) !== (edition === "2014") ? (isLegacy ? " [2014]" : " [2024]") : "";
  }
  return isLegacy ? " *(Legacy)*" : "";
}

/**
 * Formats the "*(2014)*"/"*(2024)*"/"*(edition undetermined)*" header suffix
 * shared by every get_* detail handler (getClass, getFeat, getSubclass,
 * getRace, getBackground, getCondition, and — per D4 — getItem/getMonster/
 * getSpell), so a caller can always tell which variant `pickByEdition` (or the
 * hardcoded getCondition table) actually handed them, instead of assuming.
 */
function editionHeaderLabel(isLegacy: boolean | undefined): string {
  if (isLegacy === undefined) return " *(edition undetermined)*";
  return isLegacy ? " *(2014)*" : " *(2024)*";
}

/**
 * The one-line note appended to a result when the caller asked to filter/tag
 * by edition but the shared game config was unreachable, so isLegacyBySource
 * couldn't resolve anything for this call — every row would otherwise carry
 * an unexplained "[edition unknown]" tag with no stated cause.
 */
function configUnavailableNote(config: GameConfig | undefined, edition: Edition | undefined): string {
  return config === undefined && edition !== undefined
    ? "\n\n*Edition could not be determined — D&D Beyond's config endpoint was unreachable, so edition filtering was not applied.*"
    : "";
}

/**
 * Appends a campaign suffix to a cache key when campaignId is set. Required
 * whenever an endpoint's result depends on campaignId — content shared via
 * one campaign differs from another campaign's or from the account's own
 * unscoped view, so reusing a plain (non-campaign) cache key across calls
 * with different campaignId values would serve stale/wrong cross-campaign
 * data from cache.
 */
function campaignCacheKey(base: string, campaignId?: number): string {
  return campaignId ? `${base}:campaign:${campaignId}` : base;
}

/**
 * Search for monsters by name.
 * When CR/type/size filters are provided without a name search, fetches multiple pages
 * to improve match reliability (up to 200 monsters across 10 pages).
 */
export async function searchMonsters(
  client: DdbClient,
  params: MonsterSearchParams
): Promise<ToolResult> {
  const searchTerm = params.name || "";
  const hasFilters = params.cr !== undefined || params.type !== undefined || params.size !== undefined;
  const shouldPaginate = hasFilters && !searchTerm;

  const config = await getGameConfig(client);
  const crMap = new Map(config.challengeRatings.map((cr) => [cr.id, cr]));
  const typeMap = new Map(config.monsterTypes.map((t) => [t.id, t.name]));

  // Resolve source name to ID if provided
  const resolvedId = resolveSourceId(config, params.source);
  const sourceId = resolvedId !== undefined ? resolvedId.toString() : undefined;

  let allMonsters: DdbMonster[] = [];
  let totalInDataset = 0;
  let pagesSearched = 0;
  const maxPages = shouldPaginate ? 10 : 1; // Fetch up to 10 pages (200 results) when filtering

  // Fetch multiple pages if we're filtering without a name search
  for (let pageIdx = 0; pageIdx < maxPages; pageIdx++) {
    const skip = pageIdx * 20;
    const url = ENDPOINTS.monster.search(searchTerm, skip, 20, params.showHomebrew, sourceId);
    const cacheKey = `monsters:search:${searchTerm}:${skip}:${params.showHomebrew ?? false}:${sourceId ?? ""}`;

    try {
      const response = await client.getRaw<MonsterServiceResponse>(url, cacheKey, 86_400_000);
      totalInDataset = response.pagination.total;

      if (!response.data || response.data.length === 0) {
        break; // No more results
      }

      allMonsters.push(...response.data);
      pagesSearched++;

      // Stop if we've reached the end of available data
      if (allMonsters.length >= totalInDataset) {
        break;
      }
    } catch {
      break; // Stop on error
    }
  }

  let monsters = allMonsters;

  // Client-side filter by CR if requested
  if (params.cr !== undefined) {
    const targetCr = config.challengeRatings.find((cr) => cr.value === params.cr);
    if (targetCr) {
      monsters = monsters.filter((m) => m.challengeRatingId === targetCr.id);
    }
  }

  // Client-side filter by type if requested
  if (params.type) {
    const searchType = params.type.toLowerCase();
    monsters = monsters.filter((m) => {
      const typeName = typeMap.get(m.typeId)?.toLowerCase() ?? "";
      return typeName.includes(searchType);
    });
  }

  // Client-side filter by size if requested
  if (params.size) {
    const searchSize = params.size.toLowerCase();
    monsters = monsters.filter((m) => {
      const sizeName = SIZE_MAP[m.sizeId]?.toLowerCase() ?? "";
      return sizeName.includes(searchSize);
    });
  }

  // Edition: collapse cross-edition duplicates to the selected edition.
  monsters = collapseByEdition(monsters, params.edition);

  if (monsters.length === 0) {
    const hint = shouldPaginate
      ? "\n\nNote: CR/type/size filters were applied to a limited dataset. For best results, combine filters with a name search term."
      : "";
    return {
      content: [{ type: "text", text: `No monsters found matching the search criteria.${hint}` }],
    };
  }

  const searchInfo = shouldPaginate
    ? `searched ${allMonsters.length} of ${totalInDataset} total monsters across ${pagesSearched} pages`
    : `showing results from page 1`;

  const lines = [`# Monster Search Results (${monsters.length} matches, ${searchInfo})\n`];

  if (shouldPaginate && allMonsters.length < totalInDataset) {
    lines.push(`*Note: Filters applied to the first ${allMonsters.length} monsters. For comprehensive results, add a name search term.*\n`);
  }

  for (const m of monsters) {
    const cr = crMap.get(m.challengeRatingId);
    const crStr = cr ? (cr.value < 1 ? `${cr.value}` : `${cr.value}`) : "?";
    const typeName = typeMap.get(m.typeId) ?? "Unknown";
    const sizeName = SIZE_MAP[m.sizeId] ?? "Unknown";
    const homebrewTag = m.isHomebrew ? " [Homebrew]" : "";
    // D3: was a hand-rolled ternary that (unlike every other search tool)
    // omitted the no-edition "*(Legacy)*" tag entirely, so two same-name
    // monsters rendered indistinguishably when no edition was requested.
    const editionTag = editionSuffix(m.isLegacy, params.edition);
    lines.push(
      `- **${m.name}**${homebrewTag}${editionTag} — CR ${crStr}, ${sizeName} ${typeName}, AC ${m.armorClass}, ${m.averageHitPoints} HP${m.isLegendary ? " ★" : ""}`
    );
  }

  return {
    content: [{ type: "text", text: lines.join("\n") }],
  };
}

/**
 * Get full stat block for a specific monster by name.
 */
export async function getMonster(
  client: DdbClient,
  params: { monsterName: string; edition?: "2014" | "2024" }
): Promise<ToolResult> {
  // Search for the monster by name — fetch up to 10 so both edition variants are present
  const searchUrl = ENDPOINTS.monster.search(params.monsterName, 0, 10);
  const searchCacheKey = `monsters:search:${params.monsterName.toLowerCase()}`;
  const searchResponse = await client.getRaw<MonsterServiceResponse>(searchUrl, searchCacheKey, 86_400_000);

  if (!searchResponse.data || searchResponse.data.length === 0) {
    return {
      content: [{ type: "text", text: `Monster "${params.monsterName}" not found.` }],
    };
  }

  // Pick the edition-matching variant among same-name candidates (exact name first).
  const searchName = params.monsterName.toLowerCase();
  const exact = searchResponse.data.filter((m) => m.name.toLowerCase() === searchName);
  const candidates = exact.length > 0 ? exact : searchResponse.data;
  const monster = pickByEdition(candidates, params.edition);

  // Fetch full details by ID
  const detailUrl = ENDPOINTS.monster.get(monster.id);
  const detailCacheKey = `monster:${monster.id}`;
  const detailResponse = await client.getRaw<MonsterServiceSingleResponse>(detailUrl, detailCacheKey, 86_400_000);

  const m = detailResponse.data;
  if (!m) {
    return {
      content: [{ type: "text", text: `Monster "${params.monsterName}" not found.` }],
    };
  }

  const config = await getGameConfig(client);
  const crMap = new Map(config.challengeRatings.map((cr) => [cr.id, cr]));
  const typeMap = new Map(config.monsterTypes.map((t) => [t.id, t.name]));
  const alignMap = new Map(config.alignments.map((a) => [a.id, a.name]));
  const senseMap = new Map(config.senses.map((s) => [s.id, s.name]));

  const cr = crMap.get(m.challengeRatingId);
  const crStr = cr ? `${cr.value}` : "?";
  const xp = cr?.xp ?? 0;
  const typeName = typeMap.get(m.typeId) ?? "Unknown";
  const sizeName = SIZE_MAP[m.sizeId] ?? "Unknown";
  const alignment = alignMap.get(m.alignmentId) ?? "Unaligned";

  const lines: string[] = [];
  lines.push(`# ${m.name}${editionHeaderLabel(m.isLegacy)}`);
  lines.push(`*${sizeName} ${typeName}, ${alignment}*\n`);

  lines.push(`**Armor Class** ${m.armorClass}${m.armorClassDescription ? " " + m.armorClassDescription.trim() : ""}`);
  lines.push(`**Hit Points** ${m.averageHitPoints}${m.hitPointDice?.diceString ? " (" + m.hitPointDice.diceString + ")" : ""}`);

  // Speed
  if (m.movements && m.movements.length > 0) {
    const speeds = m.movements.map((mv) => {
      const name = MOVEMENT_NAMES[mv.movementId] ?? "walk";
      return name === "walk" ? `${mv.speed} ft.` : `${name} ${mv.speed} ft.`;
    });
    lines.push(`**Speed** ${speeds.join(", ")}`);
  }

  // Ability scores
  const statMap = new Map(m.stats?.map((s) => [s.statId, s.value]) ?? []);
  if (m.stats && m.stats.length > 0) {
    lines.push("");
    const statLine = m.stats
      .sort((a, b) => a.statId - b.statId)
      .map((s) => `**${STAT_NAMES[s.statId]}** ${s.value} (${abilityMod(s.value)})`)
      .join(" | ");
    lines.push(statLine);
  }

  lines.push("");

  // Saving throws — the API's bonusModifier is null except when a monster has a
  // manual override; the standard bonus is ability modifier + proficiency bonus.
  if (m.savingThrows && m.savingThrows.length > 0) {
    const profBonus = cr?.proficiencyBonus ?? 0;
    const saves = m.savingThrows
      .map((s) => {
        const bonus =
          s.bonusModifier ?? Math.floor(((statMap.get(s.statId) ?? 10) - 10) / 2) + profBonus;
        return `${STAT_NAMES[s.statId]} ${bonus >= 0 ? "+" : ""}${bonus}`;
      })
      .join(", ");
    lines.push(`**Saving Throws** ${saves}`);
  }

  // Skills
  if (m.skillsHtml) {
    lines.push(`**Skills** ${stripHtml(m.skillsHtml)}`);
  }

  // Damage vulnerabilities / resistances / immunities
  if (m.damageAdjustments && m.damageAdjustments.length > 0) {
    const adjMap = new Map(config.damageAdjustments.map((a) => [a.id, a]));
    const byType: Record<number, string[]> = { 1: [], 2: [], 3: [] };
    for (const id of m.damageAdjustments) {
      const adj = adjMap.get(id);
      if (adj && byType[adj.type]) byType[adj.type].push(adj.name);
    }
    if (byType[3].length > 0) lines.push(`**Damage Vulnerabilities** ${byType[3].join(", ")}`);
    if (byType[1].length > 0) lines.push(`**Damage Resistances** ${byType[1].join(", ")}`);
    if (byType[2].length > 0) lines.push(`**Damage Immunities** ${byType[2].join(", ")}`);
  }

  // Condition immunities
  if (m.conditionImmunitiesHtml) {
    lines.push(`**Condition Immunities** ${stripHtml(m.conditionImmunitiesHtml)}`);
  }

  // Senses
  if (m.senses && m.senses.length > 0) {
    const senseStrs = m.senses.map((s) => {
      const name = senseMap.get(s.senseId) ?? "Unknown";
      return `${name} ${s.notes}`;
    });
    senseStrs.push(`passive Perception ${m.passivePerception}`);
    lines.push(`**Senses** ${senseStrs.join(", ")}`);
  } else {
    lines.push(`**Senses** passive Perception ${m.passivePerception}`);
  }

  // Languages
  if (m.languageDescription) {
    lines.push(`**Languages** ${m.languageDescription}${m.languageNote ? " " + m.languageNote : ""}`);
  }

  // CR
  lines.push(`**Challenge** ${crStr} (${xp.toLocaleString()} XP)`);

  // Traits
  if (m.specialTraitsDescription) {
    lines.push("\n---\n");
    lines.push(stripHtml(m.specialTraitsDescription));
  }

  // Actions
  if (m.actionsDescription) {
    lines.push("\n## Actions\n");
    lines.push(stripHtml(m.actionsDescription));
  }

  // Bonus Actions
  if (m.bonusActionsDescription) {
    lines.push("\n## Bonus Actions\n");
    lines.push(stripHtml(m.bonusActionsDescription));
  }

  // Reactions
  if (m.reactionsDescription) {
    lines.push("\n## Reactions\n");
    lines.push(stripHtml(m.reactionsDescription));
  }

  // Legendary Actions
  if (m.legendaryActionsDescription) {
    lines.push("\n## Legendary Actions\n");
    lines.push(stripHtml(m.legendaryActionsDescription));
  }

  // Mythic Actions
  if (m.mythicActionsDescription) {
    lines.push("\n## Mythic Actions\n");
    lines.push(stripHtml(m.mythicActionsDescription));
  }

  // Restricted content notice
  if (detailResponse.accessType === 4 && (!m.stats || m.stats.length === 0)) {
    lines.push("\n---\n*This monster's full stat block requires content ownership on D&D Beyond.*");
  }

  return {
    content: [{ type: "text", text: lines.join("\n") }],
  };
}

// --- Item types ---

interface DdbItem {
  id: number;
  name: string;
  type: string;
  filterType: string;
  rarity: string;
  requiresAttunement: boolean;
  attunementDescription: string;
  description: string;
  snippet: string;
  weight: number;
  cost: number | null;
  armorClass: number | null;
  damage: { diceString: string } | null;
  properties: Array<{ name: string }> | null;
  isHomebrew: boolean;
  sources: Array<{ sourceId: number }>;
  canAttune: boolean;
  magic: boolean;
  // Unconfirmed whether the live payload actually carries this field (see A1
  // in the PR #12 review-response plan) — optional so a missing flag doesn't
  // silently type-check as `false` (misclassifying every item as 2024).
  isLegacy?: boolean;
}

/**
 * Resolves an item's edition status: prefer D&D Beyond's native `isLegacy`
 * flag when the payload provides one, otherwise derive it from the item's
 * source book the same way classes/backgrounds/feats do (isLegacyBySource) —
 * belt-and-braces, since it's unconfirmed whether `isLegacy` is reliably
 * present on the live items payload. Only ever *fills in* a missing flag;
 * never overrides a native `true`/`false`, which is authoritative where
 * present (as it is for races and monsters).
 */
function withItemLegacyFlag(config: GameConfig | undefined, items: DdbItem[]): (DdbItem & { isLegacy: boolean | undefined })[] {
  return items.map((item) => ({ ...item, isLegacy: item.isLegacy ?? isLegacyBySource(config, item.sources) }));
}

/**
 * Search for items by name, rarity, or type.
 */
export async function searchItems(
  client: DdbClient,
  params: ItemSearchParams
): Promise<ToolResult> {
  const cacheKey = campaignCacheKey("game-data:items", params.campaignId);
  const itemsRaw = await client.get<DdbItem[]>(
    ENDPOINTS.gameData.items(params.campaignId),
    cacheKey,
    86_400_000,
  );

  // Fetch config unconditionally (not just for the source-name filter below)
  // since it also feeds the isLegacy derivation fallback — safely, so a
  // config outage degrades to "edition unknown" rather than failing the
  // whole search.
  const configForEdition = await getGameConfigSafe(client);
  let matched = withItemLegacyFlag(configForEdition, itemsRaw ?? []);

  if (params.name) {
    const searchName = params.name.toLowerCase();
    matched = matched.filter((i) => i.name.toLowerCase().includes(searchName));
  }

  if (params.rarity) {
    const searchRarity = params.rarity.toLowerCase();
    matched = matched.filter((i) => i.rarity?.toLowerCase().includes(searchRarity));
  }

  if (params.type) {
    const searchType = params.type.toLowerCase();
    matched = matched.filter(
      (i) =>
        i.type?.toLowerCase().includes(searchType) ||
        i.filterType?.toLowerCase().includes(searchType)
    );
  }

  if (params.source) {
    const config = await getGameConfig(client);
    const id = resolveSourceId(config, params.source);
    matched = id === undefined ? [] : matched.filter((i) => i.sources?.some((s) => s.sourceId === id));
  }

  // Edition: collapse cross-edition duplicates (e.g. two "Bag of Holding" rows) to
  // the selected edition.
  matched = collapseByEdition(matched, params.edition);

  // Sort by name
  matched.sort((a, b) => a.name.localeCompare(b.name));

  // Paginate results (30 per page)
  const total = matched.length;
  const page = Math.max(1, params.page ?? 1);
  matched = matched.slice((page - 1) * 30, (page - 1) * 30 + 30);

  const configNote = matched.some((i) => i.isLegacy === undefined)
    ? configUnavailableNote(configForEdition, params.edition)
    : "";

  if (matched.length === 0) {
    return {
      content: [{ type: "text", text: `No items found matching the search criteria.${configNote}` }],
    };
  }

  const shown = matched.length;
  const header = total > shown ? `showing ${shown} of ${total} (page ${page})` : `${total} found`;
  const lines = [`# Item Search Results (${header})\n`];
  for (const item of matched) {
    const attune = item.requiresAttunement ? " (attunement)" : "";
    const editionTag = editionSuffix(item.isLegacy, params.edition);
    lines.push(`- **${item.name}**${editionTag} — ${item.rarity || "Common"} ${item.filterType || item.type || ""}${attune} [#${item.id}]`);
  }

  return {
    content: [{ type: "text", text: lines.join("\n") + configNote }],
  };
}

/**
 * Get full details for a specific item by name.
 */
export async function getItem(
  client: DdbClient,
  params: { itemName: string; edition?: Edition; campaignId?: number }
): Promise<ToolResult> {
  const cacheKey = campaignCacheKey("game-data:items", params.campaignId);
  const itemsRaw = await client.get<DdbItem[]>(
    ENDPOINTS.gameData.items(params.campaignId),
    cacheKey,
    86_400_000,
  );
  const configForEdition = await getGameConfigSafe(client);
  const items = withItemLegacyFlag(configForEdition, itemsRaw ?? []);

  const searchName = params.itemName.toLowerCase();

  // Gather all name matches (exact first, else substring) so we can pick the
  // edition-correct variant instead of just taking the first hit.
  let candidates = items.filter((i) => i.name.toLowerCase() === searchName);
  if (candidates.length === 0) {
    candidates = items.filter((i) => i.name.toLowerCase().includes(searchName));
  }

  if (candidates.length === 0) {
    return {
      content: [{ type: "text", text: `Item "${params.itemName}" not found.` }],
    };
  }

  const item = pickByEdition(candidates, params.edition);

  const lines: string[] = [];
  const editionLabel = editionHeaderLabel(item.isLegacy);
  lines.push(`# ${item.name}${editionLabel}`);
  lines.push(`*${item.filterType || item.type || "Item"}, ${item.rarity || "common"}*\n`);

  if (item.requiresAttunement) {
    lines.push(`**Requires Attunement**${item.attunementDescription ? " " + item.attunementDescription : ""}`);
  }

  if (item.weight) lines.push(`**Weight:** ${item.weight} lb.`);
  if (item.armorClass) lines.push(`**AC:** ${item.armorClass}`);
  if (item.damage?.diceString) lines.push(`**Damage:** ${item.damage.diceString}`);

  if (item.properties && item.properties.length > 0) {
    lines.push(`**Properties:** ${item.properties.map((p) => p.name).join(", ")}`);
  }

  lines.push("");
  lines.push(stripHtml(item.description || item.snippet || "No description available."));

  const configNote = item.isLegacy === undefined ? configUnavailableNote(configForEdition, params.edition) : "";
  return {
    content: [{ type: "text", text: lines.join("\n") + configNote }],
  };
}

/** List the account's source books (id + name) as JSON, for client-side pickers. */
export async function listSources(client: DdbClient): Promise<ToolResult> {
  const config = await getGameConfig(client);
  return { content: [{ type: "text", text: JSON.stringify(config.sources ?? []) }] };
}

// --- Feat types ---

interface DdbFeat {
  id: number;
  name: string;
  description: string;
  snippet: string;
  /** Legacy shape from older mocks/tests: a single precomputed string. */
  prerequisite?: string | null;
  /** Real D&D Beyond payload shape: zero or more structured prerequisite entries. */
  prerequisites?: Array<{ description: string }>;
  isHomebrew: boolean;
  sources: Array<{ sourceId: number }>;
  categories?: Array<{ tagName: string }>;
}

/**
 * Normalizes a feat's prerequisite text. D&D Beyond's live payload nests it under
 * `prerequisites[].description`; `prerequisite` (scalar) is kept for callers/tests
 * using the older shape.
 */
function featPrerequisiteText(feat: DdbFeat): string | null {
  if (feat.prerequisites && feat.prerequisites.length > 0) {
    const text = feat.prerequisites.map((p) => p.description).filter(Boolean).join("; ");
    if (text) return text;
  }
  return feat.prerequisite ?? null;
}

/**
 * Search for feats by name.
 */
export async function searchFeats(
  client: DdbClient,
  params: FeatSearchParams
): Promise<ToolResult> {
  const cacheKey = campaignCacheKey("game-data:feats", params.campaignId);
  const feats = await client.get<DdbFeat[]>(
    ENDPOINTS.gameData.feats(params.campaignId),
    cacheKey,
    86_400_000,
  );

  const config = await getGameConfigSafe(client);
  let matched = withLegacyFlag(config, feats ?? []);

  if (params.name) {
    const searchName = params.name.toLowerCase();
    matched = matched.filter((f) => f.name.toLowerCase().includes(searchName));
  }

  if (params.prerequisite) {
    const searchPrereq = params.prerequisite.toLowerCase();
    matched = matched.filter((f) => featPrerequisiteText(f)?.toLowerCase().includes(searchPrereq));
  }

  // Edition: collapse cross-edition duplicates (e.g. two "Chef" feats) to the
  // selected edition.
  matched = collapseByEdition(matched, params.edition);

  matched.sort((a, b) => a.name.localeCompare(b.name));

  const configNote = configUnavailableNote(config, params.edition);

  if (matched.length === 0) {
    return {
      content: [{ type: "text", text: `No feats found matching the search criteria.${configNote}` }],
    };
  }

  const lines = [`# Feat Search Results (${matched.length} found)\n`];
  for (const feat of matched) {
    const prereqText = featPrerequisiteText(feat);
    const prereq = prereqText ? ` (Prerequisite: ${prereqText})` : "";
    const editionTag = editionSuffix(feat.isLegacy, params.edition);
    const desc = feat.snippet || feat.description || "";
    const shortDesc = stripHtml(desc).substring(0, 80);
    lines.push(`- **${feat.name}**${editionTag}${prereq} — ${shortDesc}${shortDesc.length >= 80 ? "..." : ""}`);
  }

  return {
    content: [{ type: "text", text: lines.join("\n") + configNote }],
  };
}

/**
 * Get full details for a specific feat by name.
 */
export async function getFeat(
  client: DdbClient,
  params: { featName: string; edition?: Edition; campaignId?: number }
): Promise<ToolResult> {
  const cacheKey = campaignCacheKey("game-data:feats", params.campaignId);
  const feats = await client.get<DdbFeat[]>(
    ENDPOINTS.gameData.feats(params.campaignId),
    cacheKey,
    86_400_000,
  );

  const config = await getGameConfigSafe(client);
  const annotated = withLegacyFlag(config, feats ?? []);

  const searchName = params.featName.toLowerCase();
  let candidates = annotated.filter((f) => f.name.toLowerCase() === searchName);
  if (candidates.length === 0) {
    candidates = annotated.filter((f) => f.name.toLowerCase().includes(searchName));
  }

  if (candidates.length === 0) {
    return {
      content: [{ type: "text", text: `Feat "${params.featName}" not found.` }],
    };
  }

  const feat = pickByEdition(candidates, params.edition);

  const lines: string[] = [];
  const editionLabel = editionHeaderLabel(feat.isLegacy);
  lines.push(`# ${feat.name}${editionLabel}`);

  const prereqText = featPrerequisiteText(feat);
  if (prereqText) lines.push(`*Prerequisite: ${prereqText}*`);

  const categories = feat.categories?.map((c) => c.tagName).filter(Boolean).join(", ");
  if (categories) lines.push(`*Category: ${categories}*`);

  lines.push("");
  lines.push(stripHtml(feat.description || feat.snippet || "No description available."));

  return {
    content: [{ type: "text", text: lines.join("\n") + configUnavailableNote(config, params.edition) }],
  };
}

// --- Condition lookup ---

// Standard D&D 5e conditions with rules text
const CONDITIONS: Record<string, { name: string; description: string; effects: string[] }> = {
  blinded: {
    name: "Blinded",
    description: "A blinded creature can't see and automatically fails any ability check that requires sight.",
    effects: [
      "Attack rolls against the creature have advantage.",
      "The creature's attack rolls have disadvantage.",
    ],
  },
  charmed: {
    name: "Charmed",
    description: "A charmed creature can't attack the charmer or target the charmer with harmful abilities or magical effects.",
    effects: [
      "The charmer has advantage on any ability check to interact socially with the creature.",
    ],
  },
  deafened: {
    name: "Deafened",
    description: "A deafened creature can't hear and automatically fails any ability check that requires hearing.",
    effects: [],
  },
  exhaustion: {
    name: "Exhaustion",
    description: "Exhaustion is measured in six levels. An effect can give a creature one or more levels of exhaustion.",
    effects: [
      "Level 1: Disadvantage on ability checks",
      "Level 2: Speed halved",
      "Level 3: Disadvantage on attack rolls and saving throws",
      "Level 4: Hit point maximum halved",
      "Level 5: Speed reduced to 0",
      "Level 6: Death",
    ],
  },
  frightened: {
    name: "Frightened",
    description: "A frightened creature has disadvantage on ability checks and attack rolls while the source of its fear is within line of sight.",
    effects: [
      "The creature can't willingly move closer to the source of its fear.",
    ],
  },
  grappled: {
    name: "Grappled",
    description: "A grappled creature's speed becomes 0, and it can't benefit from any bonus to its speed.",
    effects: [
      "The condition ends if the grappler is incapacitated.",
      "The condition also ends if an effect removes the grappled creature from the reach of the grappler.",
    ],
  },
  incapacitated: {
    name: "Incapacitated",
    description: "An incapacitated creature can't take actions or reactions.",
    effects: [],
  },
  invisible: {
    name: "Invisible",
    description: "An invisible creature is impossible to see without the aid of magic or a special sense.",
    effects: [
      "The creature is heavily obscured for the purpose of hiding (can always try to hide).",
      "Attack rolls against the creature have disadvantage.",
      "The creature's attack rolls have advantage.",
    ],
  },
  paralyzed: {
    name: "Paralyzed",
    description: "A paralyzed creature is incapacitated and can't move or speak.",
    effects: [
      "The creature automatically fails Strength and Dexterity saving throws.",
      "Attack rolls against the creature have advantage.",
      "Any attack that hits the creature is a critical hit if the attacker is within 5 feet.",
    ],
  },
  petrified: {
    name: "Petrified",
    description: "A petrified creature is transformed, along with any nonmagical objects it is wearing or carrying, into a solid inanimate substance (usually stone).",
    effects: [
      "Its weight increases by a factor of ten, and it ceases aging.",
      "The creature is incapacitated, can't move or speak, and is unaware of its surroundings.",
      "Attack rolls against the creature have advantage.",
      "The creature automatically fails Strength and Dexterity saving throws.",
      "The creature has resistance to all damage.",
      "The creature is immune to poison and disease.",
    ],
  },
  poisoned: {
    name: "Poisoned",
    description: "A poisoned creature has disadvantage on attack rolls and ability checks.",
    effects: [],
  },
  prone: {
    name: "Prone",
    description: "A prone creature's only movement option is to crawl, unless it stands up and thereby ends the condition.",
    effects: [
      "The creature has disadvantage on attack rolls.",
      "An attack roll against the creature has advantage if the attacker is within 5 feet; otherwise, the attack roll has disadvantage.",
    ],
  },
  restrained: {
    name: "Restrained",
    description: "A restrained creature's speed becomes 0, and it can't benefit from any bonus to its speed.",
    effects: [
      "Attack rolls against the creature have advantage.",
      "The creature's attack rolls have disadvantage.",
      "The creature has disadvantage on Dexterity saving throws.",
    ],
  },
  stunned: {
    name: "Stunned",
    description: "A stunned creature is incapacitated, can't move, and can speak only falteringly.",
    effects: [
      "The creature automatically fails Strength and Dexterity saving throws.",
      "Attack rolls against the creature have advantage.",
    ],
  },
  unconscious: {
    name: "Unconscious",
    description: "An unconscious creature is incapacitated, can't move or speak, and is unaware of its surroundings.",
    effects: [
      "The creature drops whatever it's holding and falls prone.",
      "The creature automatically fails Strength and Dexterity saving throws.",
      "Attack rolls against the creature have advantage.",
      "Any attack that hits the creature is a critical hit if the attacker is within 5 feet.",
    ],
  },
};

// 2024 (SRD 5.2) conditions. Verify text against SRD 5.2 before edits.
const CONDITIONS_2024: Record<string, { name: string; description: string; effects: string[] }> = {
  blinded: {
    name: "Blinded",
    description: "You can't see and automatically fail any ability check that requires sight.",
    effects: ["Attack rolls against you have Advantage, and your attack rolls have Disadvantage."],
  },
  charmed: {
    name: "Charmed",
    description: "You can't attack the charmer or target the charmer with damaging abilities or magical effects.",
    effects: ["The charmer has Advantage on any ability check to interact with you socially."],
  },
  deafened: {
    name: "Deafened",
    description: "You can't hear and automatically fail any ability check that requires hearing.",
    effects: [],
  },
  exhaustion: {
    name: "Exhaustion",
    description: "Exhaustion is cumulative and measured in levels. Each time you receive it you gain 1 level; you die if your Exhaustion level reaches 6.",
    effects: [
      "D20 Tests: every D20 Test you make is reduced by 2 times your Exhaustion level.",
      "Speed: your Speed is reduced by a number of feet equal to 5 times your Exhaustion level.",
      "Recovery: finishing a Long Rest removes 1 level; the condition ends when your level reaches 0.",
    ],
  },
  frightened: {
    name: "Frightened",
    description: "You have Disadvantage on ability checks and attack rolls while the source of your fear is within line of sight.",
    effects: ["You can't willingly move closer to the source of your fear."],
  },
  grappled: {
    name: "Grappled",
    description: "Your Speed is 0 and can't increase.",
    effects: [
      "You have Disadvantage on attack rolls against any target other than the grappler.",
      "The grappler can drag or carry you when it moves, but every foot of movement costs it 1 extra foot unless you are Tiny or two or more sizes smaller than it.",
      "The condition ends if the grappler has the Incapacitated condition or if you are moved outside the grappler's reach.",
    ],
  },
  incapacitated: {
    name: "Incapacitated",
    description: "You can't take any action, Bonus Action, or Reaction.",
    effects: [
      "Your Concentration is broken.",
      "You can't speak.",
      "If you're Incapacitated when you roll Initiative, you have Disadvantage on the roll.",
    ],
  },
  invisible: {
    name: "Invisible",
    description: "You aren't affected by any effect that requires its target to be seen unless the effect's creator can somehow see you. Any equipment you wear or carry is also concealed.",
    effects: [
      "If you're Invisible when you roll Initiative, you have Advantage on the roll.",
      "Attack rolls against you have Disadvantage, and your attack rolls have Advantage. A creature that can somehow see you doesn't get this against you.",
    ],
  },
  paralyzed: {
    name: "Paralyzed",
    description: "You have the Incapacitated condition and your Speed is 0 and can't increase.",
    effects: [
      "You automatically fail Strength and Dexterity saving throws.",
      "Attack rolls against you have Advantage.",
      "Any attack roll that hits you is a Critical Hit if the attacker is within 5 feet of you.",
    ],
  },
  petrified: {
    name: "Petrified",
    description: "You are transformed, along with any nonmagical objects you are wearing and carrying, into a solid inanimate substance (usually stone). Your weight increases by a factor of ten, and you cease aging.",
    effects: [
      "You have the Incapacitated condition and your Speed is 0 and can't increase.",
      "Attack rolls against you have Advantage.",
      "You automatically fail Strength and Dexterity saving throws.",
      "You have Resistance to all damage.",
      "You have Immunity to the Poisoned condition.",
    ],
  },
  poisoned: {
    name: "Poisoned",
    description: "You have Disadvantage on attack rolls and ability checks.",
    effects: [],
  },
  prone: {
    name: "Prone",
    description: "Your only movement options are to crawl or to spend movement equal to half your Speed (round down) to right yourself and end the condition. If your Speed is 0, you can't right yourself.",
    effects: [
      "You have Disadvantage on attack rolls.",
      "An attack roll against you has Advantage if the attacker is within 5 feet of you; otherwise, it has Disadvantage.",
    ],
  },
  restrained: {
    name: "Restrained",
    description: "Your Speed is 0 and can't increase.",
    effects: [
      "Attack rolls against you have Advantage, and your attack rolls have Disadvantage.",
      "You have Disadvantage on Dexterity saving throws.",
    ],
  },
  stunned: {
    name: "Stunned",
    description: "You have the Incapacitated condition.",
    effects: [
      "You automatically fail Strength and Dexterity saving throws.",
      "Attack rolls against you have Advantage.",
    ],
  },
  unconscious: {
    name: "Unconscious",
    description: "You have the Incapacitated and Prone conditions, and you drop whatever you're holding. When the condition ends, you remain Prone.",
    effects: [
      "You're unaware of your surroundings.",
      "Your Speed is 0 and can't increase.",
      "You automatically fail Strength and Dexterity saving throws.",
      "Attack rolls against you have Advantage.",
      "Any attack roll that hits you is a Critical Hit if the attacker is within 5 feet of you.",
    ],
  },
};

/**
 * Get the rules text for a specific condition.
 */
export async function getCondition(
  _client: DdbClient,
  params: { conditionName: string; edition?: "2014" | "2024" }
): Promise<ToolResult> {
  // D2b: defaults to 2024, matching every other edition-aware tool's default
  // (see the shared editionParam description) — was 2014 through v0.6.0, a
  // deliberate but inconsistent choice that became a cross-tool trap once
  // every other compendium entity defaulted to current. Approved as a
  // breaking change 2026-08-28 (see the PR #12 review-response plan, D2b).
  const isLegacy = params.edition === "2014";
  const set = isLegacy ? CONDITIONS : CONDITIONS_2024;
  const searchName = params.conditionName.toLowerCase().trim();
  const condition = set[searchName];

  if (!condition) {
    // Try partial match
    const match = Object.values(set).find(
      (c) => c.name.toLowerCase().includes(searchName)
    );
    if (match) {
      return formatConditionDetails(match, isLegacy);
    }

    const available = Object.values(set).map((c) => c.name).join(", ");
    return {
      content: [
        { type: "text", text: `Condition "${params.conditionName}" not found.\n\nAvailable conditions: ${available}` },
      ],
    };
  }

  return formatConditionDetails(condition, isLegacy);
}

// D2a: label which edition's rules text this is — conditions aren't
// API-backed (a hardcoded table, not collapseByEdition/pickByEdition), so
// this mirrors the five get_* detail headers' *(2014)*/*(2024)* convention
// by hand rather than sharing editionHeaderLabel, which expects a tri-state
// (boolean | undefined) that doesn't apply here: the table selection above
// is always a definite choice, never "undetermined".
function formatConditionDetails(condition: { name: string; description: string; effects: string[] }, isLegacy: boolean): ToolResult {
  const lines: string[] = [];
  lines.push(`# ${condition.name} *(${isLegacy ? "2014" : "2024"})*`);
  lines.push("");
  lines.push(condition.description);

  if (condition.effects.length > 0) {
    lines.push("");
    for (const effect of condition.effects) {
      lines.push(`- ${effect}`);
    }
  }

  return {
    content: [{ type: "text", text: lines.join("\n") }],
  };
}

// --- Class search ---

interface DdbClass {
  id: number;
  name: string;
  description: string;
  hitDice: number;
  isHomebrew: boolean;
  spellCastingAbilityId: number | null;
  primaryAbilities?: number[];
  // No `subclasses` field exists on the real classes() payload — verified
  // live; a class's subclasses are only reachable via a separate request
  // (ENDPOINTS.gameData.subclasses(id), see loadSubclasses below).
  sources: Array<{ sourceId: number }>;
  classFeatures?: Array<{ id: number; name: string; description: string; requiredLevel: number }>;
}

/**
 * Search for character classes.
 */
export async function searchClasses(
  client: DdbClient,
  params: ClassSearchParams
): Promise<ToolResult> {
  const cacheKey = campaignCacheKey("game-data:classes", params.campaignId);
  const classes = await client.get<DdbClass[]>(
    ENDPOINTS.gameData.classes(params.campaignId),
    cacheKey,
    86_400_000,
  );

  const config = await getGameConfigSafe(client);
  let matched = withLegacyFlag(config, classes ?? []);

  if (params.className) {
    const searchName = params.className.toLowerCase();
    matched = matched.filter((c) => c.name.toLowerCase().includes(searchName));
  }

  // Edition: collapse cross-edition duplicates (e.g. two "Fighter" classes) to the
  // selected edition.
  matched = collapseByEdition(matched, params.edition);

  matched.sort((a, b) => a.name.localeCompare(b.name));

  const configNote = configUnavailableNote(config, params.edition);

  if (matched.length === 0) {
    return {
      content: [{ type: "text", text: `No classes found matching the search criteria.${configNote}` }],
    };
  }

  const lines = [`# Class Search Results (${matched.length} found)\n`];
  for (const cls of matched) {
    const hitDie = cls.hitDice ? `d${cls.hitDice}` : "?";
    const spellcasting = cls.spellCastingAbilityId
      ? ` | Spellcasting: ${STAT_NAMES[cls.spellCastingAbilityId] || "Yes"}`
      : "";
    const editionTag = editionSuffix(cls.isLegacy, params.edition);
    lines.push(`- **${cls.name}**${editionTag} — Hit Die: ${hitDie}${spellcasting}`);

    const desc = stripHtml(cls.description || "").substring(0, 100);
    if (desc) lines.push(`  ${desc}${desc.length >= 100 ? "..." : ""}`);
  }

  return {
    content: [{ type: "text", text: lines.join("\n") + configNote }],
  };
}

/**
 * Get full details for a specific class, including its level-by-level class
 * features — useful for comparing how a class changed between the 2014 and 2024
 * rules (e.g. the Ranger's Favored Enemy).
 */
export async function getClass(
  client: DdbClient,
  params: { className: string; edition?: Edition; campaignId?: number }
): Promise<ToolResult> {
  const cacheKey = campaignCacheKey("game-data:classes", params.campaignId);
  const classes = await client.get<DdbClass[]>(
    ENDPOINTS.gameData.classes(params.campaignId),
    cacheKey,
    86_400_000,
  );

  const config = await getGameConfigSafe(client);
  const annotated = withLegacyFlag(config, classes ?? []);

  const searchName = params.className.toLowerCase();
  let candidates = annotated.filter((c) => c.name.toLowerCase() === searchName);
  if (candidates.length === 0) {
    candidates = annotated.filter((c) => c.name.toLowerCase().includes(searchName));
  }

  if (candidates.length === 0) {
    return {
      content: [{ type: "text", text: `Class "${params.className}" not found.` }],
    };
  }

  const cls = pickByEdition(candidates, params.edition);

  const lines: string[] = [];
  const editionLabel = editionHeaderLabel(cls.isLegacy);
  lines.push(`# ${cls.name}${editionLabel}`);

  const hitDie = cls.hitDice ? `d${cls.hitDice}` : "?";
  lines.push(`**Hit Die:** ${hitDie}`);

  if (cls.primaryAbilities && cls.primaryAbilities.length > 0) {
    const abilities = cls.primaryAbilities.map((id) => STAT_NAMES[id] ?? id).join(", ");
    lines.push(`**Primary Abilities:** ${abilities}`);
  }

  if (cls.spellCastingAbilityId) {
    lines.push(`**Spellcasting Ability:** ${STAT_NAMES[cls.spellCastingAbilityId] ?? "Yes"}`);
  }

  if (cls.description) {
    lines.push("");
    lines.push(stripHtml(cls.description));
  }

  if (cls.classFeatures && cls.classFeatures.length > 0) {
    lines.push("\n## Class Features\n");
    const byLevel = [...cls.classFeatures].sort((a, b) => (a.requiredLevel ?? 0) - (b.requiredLevel ?? 0));
    for (const feature of byLevel) {
      lines.push(`### Level ${feature.requiredLevel ?? "?"}: ${feature.name}`);
      lines.push(stripHtml(feature.description || ""));
      lines.push("");
    }
  }

  return {
    content: [{ type: "text", text: lines.join("\n") + configUnavailableNote(config, params.edition) }],
  };
}

// --- Subclass types ---
//
// D&D Beyond has no "get subclass by name" endpoint independent of a class,
// and no endpoint that returns every subclass at once — subclasses are only
// reachable per parent base class via ENDPOINTS.gameData.subclasses(classId).
// Each returned subclass record is shaped like a full DdbClass (it carries
// its own hitDice, primaryAbilities, etc., mirroring the base class shape),
// and critically its `classFeatures` array is the *merged* base-class +
// subclass-only feature list — not the subclass's own features alone. See
// subclassOnlyFeatures() below.

interface DdbSubclassFeature {
  id: number;
  name: string;
  description: string;
  requiredLevel: number;
}

interface DdbSubclass {
  id: number;
  name: string;
  description: string;
  cardDescription?: string | null;
  subclassTagline?: string | null;
  subclassFlavorText?: string | null;
  parentClassId: number;
  spellCastingAbilityId?: number | null;
  primaryAbilities?: number[];
  hitDice?: number;
  isHomebrew?: boolean;
  sources?: Array<{ sourceId: number }>;
  classFeatures?: DdbSubclassFeature[];
}

/**
 * Loads the subclasses available under a given base class definition ID,
 * independent of any character. Cached per class ID for 24h — the same TTL
 * used for classes()/feats()/etc — so a cold `get_subclass` call with no
 * `className` (which has to check every class) only pays the full N-request
 * cost once a day; later lookups reuse the per-class cache entries.
 */
async function loadSubclasses(client: DdbClient, baseClassId: number, campaignId?: number): Promise<DdbSubclass[]> {
  return client.get<DdbSubclass[]>(
    ENDPOINTS.gameData.subclasses(baseClassId, campaignId),
    campaignCacheKey(`subclasses:class:${baseClassId}`, campaignId),
    86_400_000,
  );
}

/** Result of isolating a subclass's own features from its merged base+subclass
 * list. `baseUnavailable` is set when the base class's own feature list came
 * back empty/missing while the subclass has features to diff against it — in
 * that case `features` is deliberately the full (unfiltered) merged list, not
 * `[]`, so callers can tell "nothing to exclude" apart from "couldn't exclude
 * anything" and choose to suppress/flag rather than silently show a wrong
 * answer. */
interface SubclassOnlyFeaturesResult {
  features: DdbSubclassFeature[];
  baseUnavailable: boolean;
}

/**
 * Isolates a subclass's own features from the merged base+subclass list its
 * `classFeatures` array actually carries, by excluding any feature whose ID
 * also appears on the parent base class. ID-diffing (rather than trusting
 * some section/tier flag) is deliberate: nothing in the payload reliably
 * marks a feature as subclass-only, but IDs are stable and the base class's
 * own feature list is already available from getClass/loadSubclasses' caller.
 *
 * Guards against the base class's `classFeatures` coming back empty or
 * missing (unowned source, campaign-narrowed response): with no base IDs to
 * exclude, a naive diff would return the subclass's *entire* merged list —
 * the whole base-class chassis misattributed as subclass-only. See
 * baseUnavailable above.
 */
function subclassOnlyFeatures(subclass: DdbSubclass, baseClass: DdbClass): SubclassOnlyFeaturesResult {
  const subclassFeatures = subclass.classFeatures ?? [];
  const baseFeatures = baseClass.classFeatures ?? [];
  if (baseFeatures.length === 0 && subclassFeatures.length > 0) {
    return { features: subclassFeatures, baseUnavailable: true };
  }
  const baseIds = new Set(baseFeatures.map((f) => f.id));
  return { features: subclassFeatures.filter((f) => !baseIds.has(f.id)), baseUnavailable: false };
}

/** A base class annotated with its computed isLegacy flag (see withLegacyFlag). */
type AnnotatedClass = DdbClass & { isLegacy: boolean | undefined };

/**
 * Resolves candidate base classes for a subclass lookup: by name (respecting
 * edition) when `className` is given, else every class matching the
 * requested edition (or every class in both editions, if neither is given).
 * Shared by getSubclass and searchSubclasses so both narrow the same way.
 */
function resolveCandidateClasses(
  classes: AnnotatedClass[],
  className: string | undefined,
  edition: Edition | undefined,
): AnnotatedClass[] | { error: string } {
  if (!className) {
    return edition ? classes.filter((c) => Boolean(c.isLegacy) === (edition === "2014")) : classes;
  }

  const searchClass = className.toLowerCase();
  let byName = classes.filter((c) => c.name.toLowerCase() === searchClass);
  if (byName.length === 0) byName = classes.filter((c) => c.name.toLowerCase().includes(searchClass));
  if (byName.length === 0) {
    return { error: `Class "${className}" not found.` };
  }

  if (!edition) return byName;
  const editionMatched = byName.filter((c) => Boolean(c.isLegacy) === (edition === "2014"));
  // Fall back to the unfiltered name match rather than erroring outright —
  // e.g. a class that only exists pre-2024 shouldn't 0-result an edition:2024 query.
  return editionMatched.length > 0 ? editionMatched : byName;
}

/** One subclass candidate paired with the base class it was found under. */
interface SubclassMatch {
  subclass: DdbSubclass;
  baseClass: AnnotatedClass;
}

/**
 * Separates fulfilled values from rejected results out of a
 * `Promise.allSettled` batch and counts the rejections, so callers can
 * surface "N of M requests failed" instead of a bare `continue` silently
 * dropping them (as this file's three per-class fan-outs used to). Shared by
 * findSubclassMatches, searchSubclasses, and loadAllClassFeatures so all
 * three report incompleteness the same way.
 */
function settleAll<T>(results: PromiseSettledResult<T>[]): { values: T[]; failureCount: number; total: number } {
  const values: T[] = [];
  let failureCount = 0;
  for (const r of results) {
    if (r.status === "fulfilled") values.push(r.value);
    else failureCount++;
  }
  return { values, failureCount, total: results.length };
}

interface SubclassMatchesResult {
  matches: SubclassMatch[];
  failureCount: number;
  total: number;
}

/**
 * Searches every candidate base class's subclass list for a name match.
 * Exact matches (across all candidate classes) win over partial matches.
 * A class with no subclass content reachable for this account/edition (e.g.
 * legacy content from an unowned sourcebook) resolves as an empty list, not
 * a rejection, and doesn't affect failureCount. A class whose *request*
 * fails (auth expiry, transient error, circuit breaker) is counted via
 * settleAll rather than silently skipped — callers get failureCount/total so
 * they can distinguish "genuinely not found" from "some classes couldn't be
 * checked". Throws only when every candidate class's request failed.
 */
async function findSubclassMatches(
  client: DdbClient,
  candidateClasses: AnnotatedClass[],
  subclassSearchName: string,
  campaignId?: number,
): Promise<SubclassMatchesResult> {
  const searchName = subclassSearchName.toLowerCase();
  const settled = await Promise.allSettled(
    candidateClasses.map(async (baseClass) => ({
      baseClass,
      subclasses: await loadSubclasses(client, baseClass.id, campaignId),
    }))
  );
  const { values, failureCount, total } = settleAll(settled);

  if (failureCount === total && total > 0) {
    throw new Error("Failed to load subclasses: all requests failed. Check your authentication or try again later.");
  }

  const exact: SubclassMatch[] = [];
  const partial: SubclassMatch[] = [];
  for (const { baseClass, subclasses } of values) {
    for (const subclass of subclasses ?? []) {
      if (subclass.name.toLowerCase() === searchName) {
        exact.push({ subclass, baseClass });
      } else if (subclass.name.toLowerCase().includes(searchName)) {
        partial.push({ subclass, baseClass });
      }
    }
  }
  return { matches: exact.length > 0 ? exact : partial, failureCount, total };
}

/**
 * Search for subclasses by name and/or parent class — the character-
 * independent counterpart to searchClasses. Mirrors its conventions
 * (edition collapsing, "(Legacy)"/"[2014]"/"[2024]" tagging).
 */
export async function searchSubclasses(
  client: DdbClient,
  params: SubclassSearchParams,
): Promise<ToolResult> {
  const classesRaw = await client.get<DdbClass[]>(
    ENDPOINTS.gameData.classes(params.campaignId),
    campaignCacheKey("game-data:classes", params.campaignId),
    86_400_000,
  );
  const config = await getGameConfigSafe(client);
  const classes = withLegacyFlag(config, classesRaw ?? []) as AnnotatedClass[];

  const candidates = resolveCandidateClasses(classes, params.className, params.edition);
  if ("error" in candidates) {
    return { content: [{ type: "text", text: candidates.error }] };
  }

  const searchName = (params.name ?? "").toLowerCase();
  const settled = await Promise.allSettled(
    candidates.map(async (baseClass) => ({
      baseClass,
      subclasses: await loadSubclasses(client, baseClass.id, params.campaignId),
    }))
  );
  const { values, failureCount, total: fetchTotal } = settleAll(settled);

  if (failureCount === fetchTotal && fetchTotal > 0) {
    return {
      content: [{
        type: "text",
        text: "Failed to load subclasses: all requests failed. Check your authentication or try again later.",
      }],
    };
  }

  let matches: SubclassMatch[] = [];
  for (const { baseClass, subclasses } of values) {
    for (const subclass of subclasses ?? []) {
      if (!searchName || subclass.name.toLowerCase().includes(searchName)) {
        matches.push({ subclass, baseClass });
      }
    }
  }

  // Edition: collapse cross-edition duplicates (same class + subclass name)
  // to the selected edition. Keyed on class+name, not just name, since two
  // different classes can share a subclass name only in theory — kept safe
  // either way.
  if (params.edition) {
    const byKey = new Map<string, SubclassMatch[]>();
    for (const m of matches) {
      const key = `${m.baseClass.name.toLowerCase()}|${m.subclass.name.toLowerCase()}`;
      const arr = byKey.get(key);
      if (arr) arr.push(m);
      else byKey.set(key, [m]);
    }
    const wantLegacy = params.edition === "2014";
    matches = Array.from(byKey.values()).map(
      (group) => group.find((m) => Boolean(m.baseClass.isLegacy) === wantLegacy) ?? group[0]
    );
  }

  matches.sort((a, b) => {
    const classComp = a.baseClass.name.localeCompare(b.baseClass.name);
    if (classComp !== 0) return classComp;
    return a.subclass.name.localeCompare(b.subclass.name);
  });

  const failureNote = failureCount > 0
    ? `\n\n*Note: ${failureCount} of ${fetchTotal} classes could not be loaded; these results may be incomplete.*`
    : "";
  const configNote = configUnavailableNote(config, params.edition);

  if (matches.length === 0) {
    return { content: [{ type: "text", text: `No subclasses found matching the search criteria.${failureNote}${configNote}` }] };
  }

  const lines = [`# Subclass Search Results (${matches.length} found)\n`];
  for (const { subclass, baseClass } of matches) {
    const editionTag = editionSuffix(baseClass.isLegacy, params.edition);
    const flavor = subclass.cardDescription || stripHtml(subclass.description || "").substring(0, 100);
    lines.push(`- **${subclass.name}**${editionTag} — ${baseClass.name}${flavor ? ` — ${flavor}` : ""}`);
  }

  return { content: [{ type: "text", text: lines.join("\n") + failureNote + configNote }] };
}

/**
 * Get full details for a specific subclass, including its own level-by-level
 * features (isolated from the base class's), independent of any character —
 * so a subclass no roster character has, or levels beyond any character's
 * current level, are still reachable. Mirrors getClass's conventions.
 */
export async function getSubclass(
  client: DdbClient,
  params: { subclassName: string; className?: string; edition?: Edition; campaignId?: number },
): Promise<ToolResult> {
  const classesRaw = await client.get<DdbClass[]>(
    ENDPOINTS.gameData.classes(params.campaignId),
    campaignCacheKey("game-data:classes", params.campaignId),
    86_400_000,
  );
  const config = await getGameConfigSafe(client);
  const classes = withLegacyFlag(config, classesRaw ?? []) as AnnotatedClass[];

  const candidates = resolveCandidateClasses(classes, params.className, params.edition);
  if ("error" in candidates) {
    return { content: [{ type: "text", text: candidates.error }] };
  }

  let matchResult;
  try {
    matchResult = await findSubclassMatches(client, candidates, params.subclassName, params.campaignId);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load subclasses";
    return { content: [{ type: "text", text: message }] };
  }

  let { matches } = matchResult;
  const { failureCount, total: fetchTotal } = matchResult; // stable across the edition-narrowing reassignment below

  if (matches.length === 0) {
    const scope = params.className ? ` under "${params.className}"` : "";
    const failureNote = failureCount > 0
      ? ` ${failureCount} of ${fetchTotal} classes could not be checked (request failures) — it may exist there rather than being genuinely absent.`
      : "";
    return {
      content: [{
        type: "text",
        text: `Subclass "${params.subclassName}"${scope} not found. It may not exist, or its sourcebook may not be owned/available on this D&D Beyond account.${failureNote}`,
      }],
    };
  }

  // Edition: pick the matching variant among same-name candidates.
  if (params.edition) {
    const wantLegacy = params.edition === "2014";
    matches = [matches.find((m) => Boolean(m.baseClass.isLegacy) === wantLegacy) ?? matches[0]];
  }

  const { subclass, baseClass } = matches[0];
  const failureNote = failureCount > 0
    ? `\n\n*Note: ${failureCount} of ${fetchTotal} classes could not be loaded; other subclasses of the same name may exist there.*`
    : "";

  const lines: string[] = [];
  const editionLabel = editionHeaderLabel(baseClass.isLegacy);
  lines.push(`# ${subclass.name}${editionLabel}`);
  lines.push(`*${baseClass.name} subclass*`);

  const flavor = subclass.subclassTagline || subclass.cardDescription;
  if (flavor) lines.push(`\n*${flavor}*`);

  if (subclass.spellCastingAbilityId && subclass.spellCastingAbilityId !== baseClass.spellCastingAbilityId) {
    lines.push(`\n**Spellcasting Ability:** ${STAT_NAMES[subclass.spellCastingAbilityId] ?? "Yes"}`);
  }

  const description = subclass.subclassFlavorText || subclass.description;
  if (description) {
    lines.push("");
    lines.push(stripHtml(description));
  }

  const { features: ownFeaturesRaw, baseUnavailable } = subclassOnlyFeatures(subclass, baseClass);
  const ownFeatures = [...ownFeaturesRaw].sort((a, b) => (a.requiredLevel ?? 0) - (b.requiredLevel ?? 0));

  if (baseUnavailable) {
    // Distinct from the genuine-empty case below: here the subclass *does*
    // have features, but the base class's own feature list came back empty,
    // so nothing could be safely excluded — showing the merged list would
    // misattribute the entire base-class chassis to this subclass.
    lines.push(
      "\n*Base-class feature list unavailable, so subclass-only features can't be isolated; the source may be unowned or campaign-narrowed. Try passing `campaignId`.*"
    );
  } else if (ownFeatures.length > 0) {
    lines.push("\n## Features\n");
    for (const feature of ownFeatures) {
      lines.push(`### Level ${feature.requiredLevel ?? "?"}: ${feature.name}`);
      lines.push(stripHtml(feature.description || ""));
      lines.push("");
    }
  } else {
    lines.push("\n*No subclass-specific features returned for this account/edition — the source may be unowned.*");
  }

  return {
    content: [{ type: "text", text: lines.join("\n") + failureNote + configUnavailableNote(config, params.edition) }],
  };
}

// --- Race types ---

interface DdbRace {
  entityRaceId: number;
  entityRaceTypeId: number;
  fullName: string;
  baseName: string;
  baseRaceName: string;
  description: string;
  longDescription?: string;
  isHomebrew: boolean;
  isLegacy: boolean;
  isSubRace: boolean;
  size: string;
  sources: Array<{ sourceId: number }>;
  racialTraits?: Array<{
    definition: { name: string; description: string; hideOnDetailsPage?: boolean };
  }>;
}

/** Races/species are keyed by fullName/baseName rather than `name`; normalize so
 * pickByEdition/collapseByEdition (which key off `name`) work here too. */
function withRaceName<T extends { fullName: string; baseName: string }>(
  race: T,
): T & { name: string } {
  return { ...race, name: race.fullName || race.baseName };
}

/**
 * Search for character races (species, in 2024 terminology).
 */
export async function searchRaces(
  client: DdbClient,
  params: RaceSearchParams
): Promise<ToolResult> {
  const cacheKey = campaignCacheKey("game-data:races", params.campaignId);
  const races = await client.get<DdbRace[]>(
    ENDPOINTS.gameData.races(params.campaignId),
    cacheKey,
    86_400_000,
  );

  let matched = (races ?? []).filter((r) => r.fullName || r.baseName).map(withRaceName);

  if (params.name) {
    const searchName = params.name.toLowerCase();
    matched = matched.filter((r) => r.name.toLowerCase().includes(searchName));
  }

  // Edition: collapse cross-edition duplicates to the selected edition.
  matched = collapseByEdition(matched, params.edition);

  matched.sort((a, b) => a.name.localeCompare(b.name));

  if (matched.length === 0) {
    return {
      content: [{ type: "text", text: "No races found matching the search criteria." }],
    };
  }

  const lines = [`# Race Search Results (${matched.length} found)\n`];
  for (const race of matched) {
    const desc = stripHtml(race.description || "").substring(0, 100);
    const legacy = editionSuffix(race.isLegacy, params.edition);
    lines.push(`- **${race.name}**${legacy} — ${desc}${desc.length >= 100 ? "..." : ""}`);
  }

  return {
    content: [{ type: "text", text: lines.join("\n") }],
  };
}

/**
 * Get full details for a specific race/species by name, including its racial
 * traits.
 */
export async function getRace(
  client: DdbClient,
  params: { raceName: string; edition?: Edition; campaignId?: number }
): Promise<ToolResult> {
  const cacheKey = campaignCacheKey("game-data:races", params.campaignId);
  const races = await client.get<DdbRace[]>(
    ENDPOINTS.gameData.races(params.campaignId),
    cacheKey,
    86_400_000,
  );

  const named = (races ?? []).filter((r) => r.fullName || r.baseName).map(withRaceName);

  const searchName = params.raceName.toLowerCase();
  let candidates = named.filter((r) => r.name.toLowerCase() === searchName);
  if (candidates.length === 0) {
    candidates = named.filter((r) => r.name.toLowerCase().includes(searchName));
  }

  if (candidates.length === 0) {
    return {
      content: [{ type: "text", text: `Race "${params.raceName}" not found.` }],
    };
  }

  const race = pickByEdition(candidates, params.edition);

  const lines: string[] = [];
  const editionLabel = editionHeaderLabel(race.isLegacy);
  lines.push(`# ${race.name}${editionLabel}`);
  if (race.size) lines.push(`*${race.size}*`);

  lines.push("");
  lines.push(stripHtml(race.longDescription || race.description || "No description available."));

  const traits = (race.racialTraits ?? [])
    .map((t) => t.definition)
    .filter((d) => d && d.name && d.description);
  if (traits.length > 0) {
    lines.push("\n## Traits\n");
    for (const trait of traits) {
      lines.push(`**${trait.name}.** ${stripHtml(trait.description)}`);
    }
  }

  return {
    content: [{ type: "text", text: lines.join("\n") }],
  };
}

// --- Background types ---

interface DdbBackground {
  id: number;
  name: string;
  description: string;
  isHomebrew: boolean;
  sources: Array<{ sourceId: number }>;
  primaryAbilities?: number[];
  skillProficienciesDescription?: string;
  toolProficienciesDescription?: string;
  languagesDescription?: string;
  equipmentDescription?: string;
  featureName?: string;
  featureDescription?: string;
}

/**
 * Search for character backgrounds.
 */
export async function searchBackgrounds(
  client: DdbClient,
  params: BackgroundSearchParams
): Promise<ToolResult> {
  const cacheKey = campaignCacheKey("game-data:backgrounds", params.campaignId);
  const backgrounds = await client.get<DdbBackground[]>(
    ENDPOINTS.gameData.backgrounds(params.campaignId),
    cacheKey,
    86_400_000,
  );

  const config = await getGameConfigSafe(client);
  let matched = withLegacyFlag(config, backgrounds ?? []);

  if (params.name) {
    const searchName = params.name.toLowerCase();
    matched = matched.filter((b) => b.name.toLowerCase().includes(searchName));
  }

  // Edition: collapse cross-edition duplicates (e.g. two "Noble" backgrounds) to
  // the selected edition.
  matched = collapseByEdition(matched, params.edition);

  matched.sort((a, b) => a.name.localeCompare(b.name));

  const configNote = configUnavailableNote(config, params.edition);

  if (matched.length === 0) {
    return {
      content: [{ type: "text", text: `No backgrounds found matching the search criteria.${configNote}` }],
    };
  }

  const lines = [`# Background Search Results (${matched.length} found)\n`];
  for (const bg of matched) {
    const desc = stripHtml(bg.description || "").substring(0, 100);
    const editionTag = editionSuffix(bg.isLegacy, params.edition);
    lines.push(`- **${bg.name}**${editionTag} — ${desc}${desc.length >= 100 ? "..." : ""}`);
  }

  return {
    content: [{ type: "text", text: lines.join("\n") + configNote }],
  };
}

/**
 * Get full details for a specific background by name, including its ability
 * score choices, proficiencies, and granted feature — useful for questions like
 * "what ability scores does the 2024 Noble background offer?"
 */
export async function getBackground(
  client: DdbClient,
  params: { backgroundName: string; edition?: Edition; campaignId?: number }
): Promise<ToolResult> {
  const cacheKey = campaignCacheKey("game-data:backgrounds", params.campaignId);
  const backgrounds = await client.get<DdbBackground[]>(
    ENDPOINTS.gameData.backgrounds(params.campaignId),
    cacheKey,
    86_400_000,
  );

  const config = await getGameConfigSafe(client);
  const annotated = withLegacyFlag(config, backgrounds ?? []);

  const searchName = params.backgroundName.toLowerCase();
  let candidates = annotated.filter((b) => b.name.toLowerCase() === searchName);
  if (candidates.length === 0) {
    candidates = annotated.filter((b) => b.name.toLowerCase().includes(searchName));
  }

  if (candidates.length === 0) {
    return {
      content: [{ type: "text", text: `Background "${params.backgroundName}" not found.` }],
    };
  }

  const bg = pickByEdition(candidates, params.edition);

  const lines: string[] = [];
  const editionLabel = editionHeaderLabel(bg.isLegacy);
  lines.push(`# ${bg.name}${editionLabel}`);

  if (bg.primaryAbilities && bg.primaryAbilities.length > 0) {
    const abilities = bg.primaryAbilities.map((id) => STAT_NAMES[id] ?? id).join(", ");
    lines.push(`**Ability Score Choices:** ${abilities}`);
  }
  if (bg.skillProficienciesDescription) lines.push(`**Skill Proficiencies:** ${stripHtml(bg.skillProficienciesDescription)}`);
  if (bg.toolProficienciesDescription) lines.push(`**Tool Proficiencies:** ${stripHtml(bg.toolProficienciesDescription)}`);
  if (bg.languagesDescription) lines.push(`**Languages:** ${stripHtml(bg.languagesDescription)}`);
  if (bg.equipmentDescription) lines.push(`**Equipment:** ${stripHtml(bg.equipmentDescription)}`);
  if (bg.featureName) {
    lines.push(`**Feature: ${bg.featureName}**${bg.featureDescription ? " " + stripHtml(bg.featureDescription) : ""}`);
  }

  lines.push("");
  lines.push(stripHtml(bg.description || "No description available."));

  return {
    content: [{ type: "text", text: lines.join("\n") + configUnavailableNote(config, params.edition) }],
  };
}

// --- Class feature types ---

/** One class-or-subclass feature flattened for search, tagged with where it
 * comes from. `subclassName` is set only for subclass-only features. */
interface ClassFeatureRow {
  name: string;
  description: string;
  requiredLevel: number;
  classId: number;
  className: string;
  subclassName?: string;
  isLegacy: boolean | undefined;
}

interface LoadAllClassFeaturesResult {
  rows: ClassFeatureRow[];
  failureCount: number;
  total: number;
  /** Base classes (by name) whose own feature list came back empty/missing,
   * so their subclasses' features couldn't be isolated and contributed no
   * rows at all — see subclassOnlyFeatures' baseUnavailable. */
  baseUnavailableClasses: string[];
  /** Whether the shared game config was unreachable this call — needed by
   * the caller to render configUnavailableNote, since config is fetched
   * internally here rather than by the caller. */
  configUnavailable: boolean;
}

/**
 * Builds the full corpus of class + subclass features across every base
 * class, independent of any character. This replaces the old
 * `class-feature/collection` endpoint, which does not exist on the live
 * API — every request to it 404s regardless of query params (confirmed by
 * live probing; see ENDPOINTS.gameData.classFeatureCollection and
 * docs/plans/2026-08-24-subclass-feature-independence-handoff.md). Base-class features come from
 * classes(); subclass-only features come from subclasses() per base class,
 * isolated via subclassOnlyFeatures(). Each underlying request is cached
 * 24h, so repeat searches (and get_subclass/search_subclasses calls that
 * touch the same classes) are cheap after the first cold call.
 *
 * `className`/`edition` narrow the subclass fan-out to matching base classes
 * up front via resolveCandidateClasses, when it can resolve a match — a cold
 * `className: "Paladin"` search no longer pays the full ~24-class request
 * cost. `className` here is matched against the *composite* class+subclass
 * name a ClassFeatureRow renders (e.g. "Paladin (Oath of Glory)"), so a query
 * like `className: "Glory"` must still see every class's subclasses;
 * resolveCandidateClasses only matches base-class names, so on a
 * non-match (`{ error }`) this falls back to scanning every class rather
 * than erroring out, preserving that composite-name matching behavior.
 */
async function loadAllClassFeatures(
  client: DdbClient,
  campaignId?: number,
  className?: string,
  edition?: Edition,
): Promise<LoadAllClassFeaturesResult> {
  const classesRaw = await client.get<DdbClass[]>(
    ENDPOINTS.gameData.classes(campaignId),
    campaignCacheKey("game-data:classes", campaignId),
    86_400_000,
  );
  const config = await getGameConfigSafe(client);
  const allClasses = withLegacyFlag(config, classesRaw ?? []) as AnnotatedClass[];

  const resolved = resolveCandidateClasses(allClasses, className, edition);
  const classes = "error" in resolved ? allClasses : resolved;

  const rows: ClassFeatureRow[] = [];
  for (const cls of classes) {
    for (const f of cls.classFeatures ?? []) {
      rows.push({
        name: f.name,
        description: f.description,
        requiredLevel: f.requiredLevel,
        classId: cls.id,
        className: cls.name,
        isLegacy: cls.isLegacy,
      });
    }
  }

  const settled = await Promise.allSettled(
    classes.map(async (cls) => ({ cls, subclasses: await loadSubclasses(client, cls.id, campaignId) }))
  );
  const { values, failureCount, total } = settleAll(settled);

  const baseUnavailableClasses = new Set<string>();
  for (const { cls, subclasses } of values) {
    for (const sub of subclasses ?? []) {
      const { features, baseUnavailable } = subclassOnlyFeatures(sub, cls);
      if (baseUnavailable) {
        // Contribute no subclass rows for this class — showing the merged
        // list would misattribute the whole base-class chassis. See A2.
        baseUnavailableClasses.add(cls.name);
        continue;
      }
      for (const f of features) {
        rows.push({
          name: f.name,
          description: f.description,
          requiredLevel: f.requiredLevel,
          classId: cls.id,
          className: `${cls.name} (${sub.name})`,
          subclassName: sub.name,
          isLegacy: cls.isLegacy,
        });
      }
    }
  }

  return {
    rows,
    failureCount,
    total,
    baseUnavailableClasses: Array.from(baseUnavailableClasses),
    configUnavailable: config === undefined,
  };
}

/**
 * Search for class features by name, class, or level — covers both
 * base-class and subclass features (e.g. `className: "Paladin"` matches
 * base Paladin features and every Oath's features; `name: "Glory"` finds
 * "Aura of Alacrity" etc. under Oath of Glory without needing to know it's
 * a Paladin subclass first).
 */
export async function searchClassFeatures(
  client: DdbClient,
  params: ClassFeatureSearchParams
): Promise<ToolResult> {
  const { rows, failureCount, total: classFetchTotal, baseUnavailableClasses, configUnavailable } =
    await loadAllClassFeatures(client, params.campaignId, params.className, params.edition);

  if (failureCount === classFetchTotal && classFetchTotal > 0) {
    return {
      content: [{
        type: "text",
        text: "Failed to load class features: all requests failed. Check your authentication or try again later.",
      }],
    };
  }

  let matched = rows;

  if (params.name) {
    const searchName = params.name.toLowerCase();
    matched = matched.filter((f) => f.name.toLowerCase().includes(searchName));
  }

  if (params.className) {
    const searchClass = params.className.toLowerCase();
    matched = matched.filter((f) => f.className.toLowerCase().includes(searchClass));
  }

  if (params.level !== undefined) {
    matched = matched.filter((f) => f.requiredLevel === params.level);
  }

  // Edition: collapse cross-edition duplicates to the selected edition.
  // Keyed on class+subclass+name — not just name — since e.g. "Channel
  // Divinity" is a base feature on both Cleric and Paladin and must not
  // collapse across classes.
  if (params.edition) {
    const byKey = new Map<string, ClassFeatureRow[]>();
    for (const row of matched) {
      const key = `${row.classId}|${row.subclassName ?? ""}|${row.name.toLowerCase()}`;
      const arr = byKey.get(key);
      if (arr) arr.push(row);
      else byKey.set(key, [row]);
    }
    const wantLegacy = params.edition === "2014";
    matched = Array.from(byKey.values()).map(
      (group) => group.find((row) => row.isLegacy === wantLegacy) ?? group[0]
    );
  }

  matched.sort((a, b) => {
    // Sort by class name (subclass rows sort right after their base class,
    // since "Paladin (Oath of Glory)" > "Paladin"), then by level, then name.
    const classComp = a.className.localeCompare(b.className);
    if (classComp !== 0) return classComp;
    if (a.requiredLevel !== b.requiredLevel) return a.requiredLevel - b.requiredLevel;
    return a.name.localeCompare(b.name);
  });

  const matchedTotal = matched.length;
  matched = matched.slice(0, 30);

  // One honest completeness statement, not two: fold A3's per-class fetch
  // failures and A2's base-unavailable classes into a single note.
  const completeness: string[] = [];
  if (failureCount > 0) {
    completeness.push(`${failureCount} of ${classFetchTotal} classes could not be loaded`);
  }
  if (baseUnavailableClasses.length > 0) {
    completeness.push(
      `${baseUnavailableClasses.length} classes have unavailable base-class features, so subclass-only features could not be isolated for them (${baseUnavailableClasses.join(", ")})`
    );
  }
  const completenessNote = completeness.length > 0
    ? `\n\n*Note: ${completeness.join("; ")} — these results may be incomplete.*`
    : "";
  const configNote = configUnavailable && params.edition
    ? "\n\n*Edition could not be determined — D&D Beyond's config endpoint was unreachable, so edition filtering was not applied.*"
    : "";

  if (matched.length === 0) {
    return {
      content: [{ type: "text", text: `No class features found matching the search criteria.${completenessNote}${configNote}` }],
    };
  }

  const lines = [`# Class Feature Search Results (${matchedTotal > 30 ? `showing 30 of ${matchedTotal}` : `${matchedTotal} found`})\n`];
  for (const feature of matched) {
    const level = feature.requiredLevel || "?";
    const editionTag = editionSuffix(feature.isLegacy, params.edition);
    lines.push(`- **${feature.name}**${editionTag} — ${feature.className} level ${level}`);

    const desc = stripHtml(feature.description || "").substring(0, 100);
    if (desc) lines.push(`  ${desc}${desc.length >= 100 ? "..." : ""}`);
  }

  return {
    content: [{ type: "text", text: lines.join("\n") + completenessNote + configNote }],
  };
}

// --- Racial trait types ---

interface DdbRacialTrait {
  id: number;
  name: string;
  description: string;
  snippet: string;
  raceId: number;
  raceName?: string;
  isHomebrew: boolean;
  sources: Array<{ sourceId: number }>;
}

/**
 * Search for racial traits by name or race.
 */
export async function searchRacialTraits(
  client: DdbClient,
  params: RacialTraitSearchParams
): Promise<ToolResult> {
  const cacheKey = "game-data:racial-traits";
  const traits = await client.get<DdbRacialTrait[]>(
    ENDPOINTS.gameData.racialTraitCollection(),
    cacheKey,
    86_400_000,
  );

  const config = await getGameConfigSafe(client);
  let matched = withLegacyFlag(config, traits ?? []);

  if (params.name) {
    const searchName = params.name.toLowerCase();
    matched = matched.filter((t) => t.name.toLowerCase().includes(searchName));
  }

  if (params.raceName) {
    const searchRace = params.raceName.toLowerCase();
    matched = matched.filter(
      (t) => t.raceName?.toLowerCase().includes(searchRace)
    );
  }

  // Edition: collapse cross-edition duplicates (same race/trait name) to the
  // selected edition.
  matched = collapseByEdition(matched, params.edition);

  matched.sort((a, b) => {
    // Sort by race name, then by trait name
    const raceComp = (a.raceName || "").localeCompare(b.raceName || "");
    if (raceComp !== 0) return raceComp;
    return a.name.localeCompare(b.name);
  });

  const total = matched.length;
  matched = matched.slice(0, 30);
  const configNote = configUnavailableNote(config, params.edition);

  if (matched.length === 0) {
    return {
      content: [{ type: "text", text: `No racial traits found matching the search criteria.${configNote}` }],
    };
  }

  const lines = [`# Racial Trait Search Results (${total > 30 ? `showing 30 of ${total}` : `${total} found`})\n`];
  for (const trait of matched) {
    const raceName = trait.raceName || "Unknown";
    const editionTag = editionSuffix(trait.isLegacy, params.edition);
    lines.push(`- **${trait.name}**${editionTag} — ${raceName}`);

    const desc = stripHtml(trait.snippet || trait.description || "").substring(0, 100);
    if (desc) lines.push(`  ${desc}${desc.length >= 100 ? "..." : ""}`);
  }

  return {
    content: [{ type: "text", text: lines.join("\n") + configNote }],
  };
}
