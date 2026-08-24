/** Rules edition to select when an entity has both a 2014 ("legacy") and a 2024
 * ("current") variant — e.g. classes, species/races, backgrounds, feats, items,
 * monsters, and spells. */
export type Edition = "2014" | "2024";

export interface SpellSearchParams {
  name?: string;
  level?: number;
  class?: string;
  school?: string;
  concentration?: boolean;
  ritual?: boolean;
}

export interface MonsterSearchParams {
  name?: string;
  cr?: number;
  type?: string;
  size?: string;
  environment?: string;
  page?: number;
  showHomebrew?: boolean;
  source?: string;
  edition?: Edition;
}

export interface ItemSearchParams {
  name?: string;
  rarity?: string;
  type?: string;
  attunement?: boolean;
  source?: string;
  page?: number;
  edition?: Edition;
}

export interface FeatSearchParams {
  name?: string;
  prerequisite?: string;
  edition?: Edition;
}

export interface ClassSearchParams {
  className?: string;
  edition?: Edition;
}

export interface RaceSearchParams {
  name?: string;
  edition?: Edition;
}

export interface BackgroundSearchParams {
  name?: string;
  edition?: Edition;
}

export interface SubclassSearchParams {
  name?: string;
  className?: string;
  edition?: Edition;
}

export interface ClassFeatureSearchParams {
  name?: string;
  className?: string;
  level?: number;
  edition?: Edition;
}

export interface RacialTraitSearchParams {
  name?: string;
  raceName?: string;
  edition?: Edition;
}
