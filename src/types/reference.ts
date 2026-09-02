/** Rules edition to select when an entity has both a 2014 ("legacy") and a 2024
 * ("current") variant — e.g. classes, species/races, backgrounds, feats, items,
 * monsters, and spells. */
export type Edition = "2014" | "2024";

/** Unlocks content shared with this account via a specific campaign (e.g. a
 * subclass from a sourcebook the DM shared but the account doesn't own) —
 * distinct from sharingSetting, which only widens *owned*-content coverage. */
export interface CampaignScoped {
  campaignId?: number;
}

export interface SpellSearchParams extends CampaignScoped {
  name?: string;
  level?: number;
  class?: string;
  school?: string;
  concentration?: boolean;
  ritual?: boolean;
  edition?: Edition;
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

export interface ItemSearchParams extends CampaignScoped {
  name?: string;
  rarity?: string;
  type?: string;
  attunement?: boolean;
  source?: string;
  page?: number;
  edition?: Edition;
}

export interface FeatSearchParams extends CampaignScoped {
  name?: string;
  prerequisite?: string;
  edition?: Edition;
}

export interface ClassSearchParams extends CampaignScoped {
  className?: string;
  edition?: Edition;
}

export interface RaceSearchParams extends CampaignScoped {
  name?: string;
  edition?: Edition;
}

export interface BackgroundSearchParams extends CampaignScoped {
  name?: string;
  edition?: Edition;
}

export interface SubclassSearchParams extends CampaignScoped {
  name?: string;
  className?: string;
  edition?: Edition;
}

export interface ClassFeatureSearchParams extends CampaignScoped {
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
