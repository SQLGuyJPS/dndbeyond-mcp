export const DDB_CHARACTER_SERVICE = "https://character-service.dndbeyond.com";
export const DDB_MONSTER_SERVICE = "https://monster-service.dndbeyond.com";
export const DDB_WATERDEEP = "https://www.dndbeyond.com";

export const ENDPOINTS = {
  character: {
    get: (id: number) => `${DDB_CHARACTER_SERVICE}/character/v5/character/${id}?includeCustomItems=true`,
    list: (userId: number) => `${DDB_CHARACTER_SERVICE}/character/v5/characters/list?userId=${userId}`,
    // New-style gameplay endpoints (characterId in body/query, not path)
    updateHp: () => `${DDB_CHARACTER_SERVICE}/character/v5/life/hp/damage-taken`,
    updateLimitedUse: () => `${DDB_CHARACTER_SERVICE}/character/v5/action/limited-use`,
    setInspiration: () => `${DDB_CHARACTER_SERVICE}/character/v5/character/inspiration`,
    condition: () => `${DDB_CHARACTER_SERVICE}/character/v5/condition`,
    rest: {
      short: (characterId: number) => `${DDB_CHARACTER_SERVICE}/character/v5/character/rest/short?characterId=${characterId}`,
      long: (characterId: number) => `${DDB_CHARACTER_SERVICE}/character/v5/character/rest/long?characterId=${characterId}`,
    },
    // Deprecated v5 endpoints (return 404, kept for reference)
    updateSpellSlots: (id: number) => `${DDB_CHARACTER_SERVICE}/character/v5/character/${id}/spell/slots`,
    updateDeathSaves: (id: number) => `${DDB_CHARACTER_SERVICE}/character/v5/character/${id}/life/death-saves`,
    updateCurrency: (id: number) => `${DDB_CHARACTER_SERVICE}/character/v5/character/${id}/inventory/currency`,
    updatePactMagic: (id: number) => `${DDB_CHARACTER_SERVICE}/character/v5/character/${id}/spell/pact-magic`,
    builder: {
      standardBuild: () => `${DDB_CHARACTER_SERVICE}/character/v5/builder/standard-build`,
      quickBuild: () => `${DDB_CHARACTER_SERVICE}/character/v5/builder/quick-build`,
    },
    addClass: () => `${DDB_CHARACTER_SERVICE}/character/v5/class`,
    setBackground: () => `${DDB_CHARACTER_SERVICE}/character/v5/background`,
    setBackgroundChoice: () => `${DDB_CHARACTER_SERVICE}/character/v5/background/choice`,
    setClassFeatureChoice: () => `${DDB_CHARACTER_SERVICE}/character/v5/class/feature/choice`,
    setRaceTraitChoice: () => `${DDB_CHARACTER_SERVICE}/character/v5/race/trait/choice`,
    setFeatChoice: () => `${DDB_CHARACTER_SERVICE}/character/v5/feat/choice`,
    setRace: () => `${DDB_CHARACTER_SERVICE}/character/v5/race`,
    setAbilityScore: () => `${DDB_CHARACTER_SERVICE}/character/v5/character/ability-score`,
    setPreferences: () => `${DDB_CHARACTER_SERVICE}/character/v5/character/preferences`,
    setAbilityScoreType: () => `${DDB_CHARACTER_SERVICE}/character/v5/character/ability-score/type`,
    setClassLevel: () => `${DDB_CHARACTER_SERVICE}/character/v5/class/level`,
    updateName: () => `${DDB_CHARACTER_SERVICE}/character/v5/description/name`,
    updateAlignment: () => `${DDB_CHARACTER_SERVICE}/character/v5/description/alignment`,
    updateLifestyle: () => `${DDB_CHARACTER_SERVICE}/character/v5/description/lifestyle`,
    updateFaith: () => `${DDB_CHARACTER_SERVICE}/character/v5/description/faith`,
    updateTraits: () => `${DDB_CHARACTER_SERVICE}/character/v5/description/traits`,
    updateNotes: () => `${DDB_CHARACTER_SERVICE}/character/v5/description/notes`,
    updateAppearance: (field: string) => `${DDB_CHARACTER_SERVICE}/character/v5/description/${field}`,
    inventory: {
      addItems: () => `${DDB_CHARACTER_SERVICE}/character/v5/inventory/item`,
      setGold: () => `${DDB_CHARACTER_SERVICE}/character/v5/inventory/currency/gold`,
      setStartingType: () => `${DDB_CHARACTER_SERVICE}/character/v5/inventory/starting-type`,
    },
    delete: () => `${DDB_CHARACTER_SERVICE}/character/v5/character`,
  },
  gameData: {
    // campaignId is the mechanism that unlocks content a campaign's DM shared
    // with this account but that the account doesn't own outright — distinct
    // from sharingSetting, which only widens which *owned* content is
    // included. Confirmed live across subclasses, classes, feats, races, and
    // always-known-spells (2026-08-25); see the campaignId param on
    // list_campaigns' sibling tools for the account-facing description.
    items: (campaignId?: number) => {
      const campaign = campaignId ? `&campaignId=${campaignId}` : "";
      return `${DDB_CHARACTER_SERVICE}/character/v5/game-data/items?sharingSetting=2${campaign}`;
    },
    feats: (campaignId?: number) => {
      const campaign = campaignId ? `?campaignId=${campaignId}` : "";
      return `${DDB_CHARACTER_SERVICE}/character/v5/game-data/feats${campaign}`;
    },
    classes: (campaignId?: number) => {
      const campaign = campaignId ? `?campaignId=${campaignId}` : "";
      return `${DDB_CHARACTER_SERVICE}/character/v5/game-data/classes${campaign}`;
    },
    races: (campaignId?: number) => {
      const campaign = campaignId ? `?campaignId=${campaignId}` : "";
      return `${DDB_CHARACTER_SERVICE}/character/v5/game-data/races${campaign}`;
    },
    backgrounds: (campaignId?: number) => {
      const campaign = campaignId ? `?campaignId=${campaignId}` : "";
      return `${DDB_CHARACTER_SERVICE}/character/v5/game-data/backgrounds${campaign}`;
    },
    // sharingSetting=3 returns the broadest spell coverage (campaign/marketplace
    // shared content), e.g. ~548 wizard spells vs ~126 at sharingSetting=2.
    alwaysKnownSpells: (classId: number, classLevel: number = 20, campaignId?: number) => {
      const campaign = campaignId ? `&campaignId=${campaignId}` : "";
      return `${DDB_CHARACTER_SERVICE}/character/v5/game-data/always-known-spells?classId=${classId}&classLevel=${classLevel}&sharingSetting=3${campaign}`;
    },
    alwaysPreparedSpells: (classId: number, classLevel: number = 20, campaignId?: number) => {
      const campaign = campaignId ? `&campaignId=${campaignId}` : "";
      return `${DDB_CHARACTER_SERVICE}/character/v5/game-data/always-prepared-spells?classId=${classId}&classLevel=${classLevel}&sharingSetting=3${campaign}`;
    },
    // NOTE: there is no `class-feature/collection` endpoint on the live API —
    // every variant of it 404s (confirmed by live probing 2026-08-24; see
    // dndbeyond-mcp-class-feature-handoff.md). Base-class features live on
    // `classes()` and subclass features live on `subclasses()` below;
    // searchClassFeatures in src/tools/reference.ts builds its corpus from
    // those two instead of this endpoint. Kept only as a documented dead end
    // so nobody rediscovers and re-wires it.
    classFeatureCollection: () => `${DDB_CHARACTER_SERVICE}/character/v5/game-data/class-feature/collection`,
    racialTraitCollection: () => `${DDB_CHARACTER_SERVICE}/character/v5/game-data/racial-trait/collection`,
    // Subclasses aren't included in classes() (each class record's `subclasses`
    // field doesn't exist on the real payload — only `subclassDefinition`,
    // which is null except on a character's own leveled class). This is the
    // actual character-independent subclass list, keyed by the parent class's
    // definition ID (from classes()/getClass — 2014 and 2024 Paladin are
    // different IDs, so baseClassId already encodes edition). sharingSetting=3
    // matches the broadest-coverage convention used by alwaysKnownSpells;
    // verified live it returns the same set as sharingSetting=2 for both an
    // owned 2024 class and a partially-owned 2014 class, so it's strictly
    // not-worse. Each returned subclass's `classFeatures` is the *merged*
    // base-class + subclass feature list, not the subclass's own features
    // alone — see subclassOnlyFeatures() in src/tools/reference.ts.
    subclasses: (baseClassId: number, campaignId?: number) => {
      const campaign = campaignId ? `&campaignId=${campaignId}` : "";
      return `${DDB_CHARACTER_SERVICE}/character/v5/game-data/subclasses?sharingSetting=3&baseClassId=${baseClassId}${campaign}`;
    },
  },
  monster: {
    search: (search: string = "", skip: number = 0, take: number = 20, showHomebrew?: boolean, sources?: string) => {
      const homebrewParam = showHomebrew ? "&showHomebrew=t" : "";
      const sourcesParam = sources ? `&sources=${encodeURIComponent(sources)}` : "";
      return `${DDB_MONSTER_SERVICE}/v1/Monster?search=${encodeURIComponent(search)}&skip=${skip}&take=${take}${homebrewParam}${sourcesParam}`;
    },
    get: (id: number) => `${DDB_MONSTER_SERVICE}/v1/Monster/${id}`,
    getByIds: (ids: number[]) => {
      const idParams = ids.map((id) => `ids=${id}`).join("&");
      return `${DDB_MONSTER_SERVICE}/v1/Monster?${idParams}`;
    },
  },
  campaign: {
    list: () => `${DDB_WATERDEEP}/api/campaign/stt/active-campaigns`,
    userCampaigns: () => `${DDB_WATERDEEP}/api/campaign/stt/user-campaigns`,
    characters: (campaignId: number) => `${DDB_WATERDEEP}/api/campaign/stt/active-short-characters/${campaignId}`,
  },
  config: {
    json: () => `${DDB_WATERDEEP}/api/config/json`,
  },
} as const;
