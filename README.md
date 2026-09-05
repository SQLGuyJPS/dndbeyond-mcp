# dndbeyond-mcp

A TypeScript MCP (Model Context Protocol) server for D&D Beyond. Gives Claude (and other MCP-compatible AI assistants) access to your D&D Beyond characters, campaigns, spells, monsters, items, and more.

> **This is a fork** of [AlexWorland/dndbeyond-mcp](https://github.com/AlexWorland/dndbeyond-mcp). It adds **edition-aware reference lookups** (2014 vs 2024) for spells, conditions, monsters, items, classes, species/races, backgrounds, feats, class features, and racial traits — resolved via D&D Beyond's `isLegacy` flag where present, or derived from the entity's source book otherwise — plus `get_class`, `get_race`, `get_background`, and `get_feat` detail lookups, character-independent `search_subclasses`/`get_subclass`, additional reference tools (races, backgrounds, class features, racial traits, source books), optional `campaignId` support across the reference tools, a resumable **compendium snapshot downloader**, **damage/condition resistances in monster stat blocks**, and makes **`check_auth` a real session-liveness probe**. It is the MCP backend for [dndtools](https://github.com/dmjohnston89/dndtools) and is **built from source** (not published to npm — see Installation). Released via annotated tags (current: **`v0.7.0`**); see [Fork changes](#fork-changes).

> **Disclaimer:** This project uses unofficial, reverse-engineered D&D Beyond endpoints. It is not affiliated with, endorsed by, or supported by D&D Beyond or Wizards of the Coast. Endpoints may change without notice.

## Features

- **Character Management** — Read character sheets, update HP, spell slots, death saves, currency
- **Campaign Access** — List campaigns, view party rosters
- **Reference Lookups** — Search and retrieve spells, monsters, magic items, feats, conditions, classes, subclasses, species/races, backgrounds, class features, and racial traits — **edition-aware** (2014/2024) across all of them, so you can compare rules between editions or pin a lookup to a specific ruleset
- **Compendium Snapshots** — Download resumable, structured JSON snapshots of D&D Beyond reference data for offline/resilient access
- **Workflow Prompts** — Session prep, encounter building, level-up guidance, spell recommendations
- **Browser-Based Auth** — Playwright-powered login flow (no manual cookie extraction)

## Installation

This fork is **not published to npm**, so `npx dndbeyond-mcp` will not work. Build it from source and check out the pinned release tag:

```bash
git clone https://github.com/dmjohnston89/dndbeyond-mcp
cd dndbeyond-mcp
git checkout v0.7.0
npm ci
npm run build
```

The built server entrypoint is `build/src/index.js`.

## Setup

Before using the server, authenticate with D&D Beyond:

```bash
npm run setup
```

This opens a browser window where you log into D&D Beyond normally. The server captures your session cookie automatically and saves it to `~/.dndbeyond-mcp/config.json`.

## Download a Compendium Snapshot

After authenticating, export the reference content available to your account as compact JSON:

```bash
npm run compendium:download
```

The command writes a manifest plus separate files for spells, monsters, items, classes, feats,
races, backgrounds, and game configuration to `~/.dndbeyond-mcp/compendium`. Interrupted
downloads resume from a checkpoint next to the output directory, and a completed snapshot
replaces the previous one atomically (the old snapshot is kept until the new one is fully
written).

Use `--output` for a different directory or `--fresh` to discard a saved checkpoint:

```bash
npm run compendium:download -- --output ./compendium
npm run compendium:download -- --fresh
```

**Snapshots only include content your account owns outright due to copyright/IP concerns.** The downloader calls every reference endpoint without a `campaignId`, so it never pulls in content shared with you via a campaign (see `campaignId` under [Reference](#reference) below) and never enumerates your campaigns to discover what's shared. A snapshot persists to disk after the session ends, so including campaign-shared content would risk leaving a user holding an offline copy of someone else's paid sourcebook content after that campaign's access or sharing is revoked. Live tool calls don't have this problem, since nothing persists beyond the existing TTL cache — see `campaignId` under [Reference](#reference) for those.

## Claude Desktop Configuration

Add this to your Claude Desktop configuration file, pointing at the built entrypoint (absolute path):

**macOS:** `~/Library/Application Support/Claude/claude_desktop_config.json`
**Windows:** `%APPDATA%\Claude\claude_desktop_config.json`

```json
{
  "mcpServers": {
    "dndbeyond": {
      "command": "node",
      "args": ["/abs/path/to/dndbeyond-mcp/build/src/index.js"]
    }
  }
}
```

After adding the configuration, restart Claude Desktop.

## Tools

### Character
- `get_character` — Full character sheet by ID or name
- `list_characters` — All your characters
- `update_hp` — Apply damage or healing
- `update_spell_slots` — Use or restore spell slots
- `update_death_saves` — Record death saves
- `update_currency` — Modify gold/silver/copper
- `use_ability` — Decrement limited-use features

### Campaign
- `list_campaigns` — Your active campaigns
- `get_campaign_characters` — All characters in a campaign

### Reference
All `search_*` / `get_*` reference tools below accept an optional `edition` (`2014`/`2024`): on a search it collapses same-name 2014/2024 duplicates to the requested edition (tagging a row only when it had to fall back to the other edition), and with no `edition` given it lists every variant, tagging legacy ones `(Legacy)`; on a `get_*` it selects the matching variant and labels its header `*(2014)*`/`*(2024)*`. Monsters, items, races, and spells resolve edition via D&D Beyond's native `isLegacy` flag; classes, backgrounds, feats, class features, and racial traits, whose payloads don't carry that flag, derive it from the entity's primary source book (2014-ruleset sourcebooks vs. 2024-ruleset ones) — items apply the same source-derived fallback too, since it's unconfirmed whether the live items payload reliably carries a native flag. If D&D Beyond's shared config endpoint (which the source-derivation path depends on) is unreachable, edition can't be determined for those entity types — rows are tagged `[edition unknown]`/`*(edition undetermined)*` rather than a guessed, possibly-wrong edition, and a one-line note explains why.

Most of these tools (spells, items, feats, classes, subclasses, races, backgrounds, class features) also accept an optional `campaignId`: it unlocks content a campaign's DM shared with your account but that you don't own outright (e.g. a subclass from a sourcebook only the DM owns) — distinct from the account's normal owned-content view. Get valid IDs from `list_campaigns`. (`search_racial_traits` doesn't take it yet — see [Known issues](#known-issues).)

**`campaignId` is opt-in, not automatic.** It's `undefined` by default on every call, so a lookup only sees campaign-shared content when `campaignId` is explicitly passed — there's no server-side fallback that retries an empty/not-found result against the account's campaigns. Whether an AI assistant driving these tools chooses to call `list_campaigns` and retry with `campaignId` after an initial miss is up to that assistant's own judgment in the moment, not something this server enforces or guarantees. See [Known issues](#known-issues) for the compendium downloader's related gap.

- `search_spells` / `get_spell` — Spell lookup with filters
- `search_monsters` / `get_monster` — Monster stat blocks
- `search_items` / `get_item` — Magic item catalog
- `search_feats` / `get_feat` — Feat discovery and full feat text
- `get_condition` — Condition rules; accepts an optional `edition` (`2014`/`2024`, default `2024`). **Breaking change in `v0.7.0`:** previously defaulted to `2014` — see [Fork changes](#fork-changes).
- `search_classes` / `get_class` — Base class info; `get_class` includes the full level-by-level base class feature list, useful for comparing e.g. the 2014 vs 2024 Ranger's Favored Enemy
- `search_subclasses` / `get_subclass` — Subclass info, independent of any character: works even if nobody on your roster has the subclass, and always returns the full level-by-level progression regardless of any character's actual level. `className` narrows the search to one class and is recommended for speed (omitting it scans every class); `get_subclass` includes the subclass's own tenets/flavor text where D&D Beyond provides it
- `search_races` / `get_race` — Race/species lookup by name; `get_race` includes full racial traits
- `search_backgrounds` / `get_background` — Background lookup by name; `get_background` includes ability score choices, proficiencies, and the granted feature
- `search_class_features` — Class feature lookup by name, class, or level; covers both base-class and subclass features (e.g. `name: "Glory"` finds Oath of Glory's features without knowing they're on a Paladin subclass)
- `search_racial_traits` — Racial trait lookup by name or race
- `list_sources` — Source book IDs/names from D&D Beyond config

### Utility
- `setup_auth` — Re-run login flow
- `check_auth` — Verify the session is live (performs a real cobalt-token liveness probe against D&D Beyond, not just a config-file existence check)

## Resources

| URI | Description |
|-----|-------------|
| `dndbeyond://characters` | Your character list |
| `dndbeyond://character/{id}` | Character sheet |
| `dndbeyond://character/{id}/spells` | Spell list |
| `dndbeyond://character/{id}/inventory` | Inventory |
| `dndbeyond://campaigns` | Your campaigns |
| `dndbeyond://campaign/{id}/party` | Party roster |

## Prompts

| Prompt | Purpose |
|--------|---------|
| `character-summary` | Full character rundown |
| `session-prep` | DM session preparation |
| `encounter-builder` | Balanced encounter design |
| `spell-advisor` | Spell recommendations |
| `level-up-guide` | Level-up walkthrough |
| `rules-lookup` | Rules clarification |

## Fork changes

Released as annotated tags (dndtools pins one by tag):

- **`v0.2.0`** — Edition-aware **conditions**: a 2024 (SRD 5.2) condition set plus an `edition` parameter on `get_condition` (default `2014`).
- **`v0.3.0`** — Edition-aware **monster search + lookup**: `search_monsters` / `get_monster` resolve the requested edition via D&D Beyond's `isLegacy` flag — preferring the selected edition, collapsing cross-edition duplicate names, and keeping/tagging other-edition-only results. Mirrors the existing `get_spell` edition handling.
- **`v0.4.0`** — `check_auth` is now a **real session-liveness probe**: it performs a cobalt-token exchange against D&D Beyond rather than only checking whether a config file exists, so callers can detect an expired-but-present cookie.
- **`v0.4.1`** — Dependency audit fix (`npm audit fix`); dropped the unused `undici` dependency.
- **`v0.5.0`** — Added `search_races`, `search_backgrounds`, `search_class_features`, `search_racial_traits`, and `list_sources` reference tools, and a resumable **compendium snapshot downloader** (`npm run compendium:download`) that exports spells/monsters/items/classes/feats/races/backgrounds/game-config as structured JSON.
- **`v0.6.0`** — `get_monster` now includes **damage resistances/immunities/vulnerabilities and condition immunities** (previously fetched but discarded); fixed monster **saving-throw bonuses** rendering as `+null` for standard (non-overridden) proficiencies by computing them from the ability modifier and CR proficiency bonus.
- **`v0.7.0`** — `search_class_features` **was dead since `v0.5.0`** (its `class-feature/collection` endpoint 404s on every input against the live API) and is now rebuilt from `classes()` + `subclasses()`, fixing a latent cross-class collapse bug along the way (same-named base features on different classes, e.g. Channel Divinity on Cleric vs. Paladin, now key on class+name instead of colliding). Beyond that:
  - **Edition-aware lookups extended to every remaining compendium entity**: `get_class`, `get_race`/species, `get_background`, and `get_feat` detail tools; `edition` + tagging wired into `search_classes`, `search_races`, `search_backgrounds`, `search_feats`, `search_class_features`, `search_racial_traits`, `search_items`/`get_item`, and — newly — `search_spells`/`get_spell` (previously the only search tool with no `edition` param at all). Classes/backgrounds/feats/class features/racial traits derive edition from source book via `isLegacyBySource()` when no native flag exists; a config outage now degrades honestly to an explicit `[edition unknown]`/`*(edition undetermined)*` tag instead of a silently-wrong `[2024]` guess.
  - **Character-independent `search_subclasses` / `get_subclass`**, built on `game-data/subclasses` (the `class-feature/collection` endpoint used previously doesn't exist on the live API). Works even if no character on the roster has the subclass, and always returns the full level-by-level progression rather than capping at any character's current level.
  - **`campaignId` support** threaded through the reference tools (spells, items, feats, classes, subclasses, class features, races, backgrounds) so campaign-shared content surfaces when explicitly requested — opt-in only, never automatic (see [Reference](#reference)).
  - `get_item`, `get_monster`, and `get_spell` now label their header with the returned edition, matching the other `get_*` detail tools.
  - A cold `search_class_features` call with `className` set now narrows its subclass fetches to the matching class up front instead of fanning out across every class.
  - A subclass whose base class returned no feature list of its own (unowned source, campaign-narrowed response) no longer misattributes the entire base-class feature set to that subclass — `get_subclass` and `search_class_features` now say so explicitly instead of guessing.
  - **Fixed a no-`edition`-argument inconsistency** in every compendium `get_*` detail tool (`get_class`, `get_background`, `get_feat`, `get_item`, `get_race`, `get_spell`, `get_subclass`): when `edition` was omitted, these silently returned whichever variant the live API happened to list first — frequently 2014 — rather than the same 2024 default `search_*`/`get_condition` already used. Fixed once in the shared `pickByEdition` helper (plus `get_subclass`'s equivalent inline selection logic) rather than per call site, so this can't be reintroduced by a future handler forgetting a guard. Confirmed via a 30-test behavioral suite (`docs/plans/2026-08-31-edition-awareness-test-plan.md`) that also validated the rest of this release's edition-awareness work end to end.
  - **`list_sources`** now takes an optional `nameFilter` — matched against both the source's short code and its full title — since the unfiltered list runs to ~53k characters on a typical account. `resolveSourceId` (used internally by `search_items`'/`search_monsters`' `source` filter) had the same short-code-only matching gap and was fixed alongside it.
- **`v0.7.0` breaking change** — `get_condition` now **defaults to `2024`** (current) instead of `2014`, matching every other edition-aware tool's default. The old default was a deliberate `v0.2.0` choice that became a cross-tool trap once every compendium entity became edition-aware: the same conversation could get 2024 rules from `get_class` and 2014 rules from `get_condition` with neither call passing `edition`. Pass `edition: "2014"` explicitly to keep the old behavior.

## Known issues

- **`search_racial_traits` returns an error against the live API.** D&D Beyond's `racial-trait/collection` endpoint doesn't return the flat list the tool expects — its real envelope nests the trait list under `data.definitionData`, which comes back empty for every query-parameter combination tried so far. This is a pre-existing defect (not introduced by the edition-awareness or `campaignId` work) and is tracked for a follow-up fix.
- **Compendium snapshots don't include campaign-shared content, by design.** `npm run compendium:download` never passes `campaignId`, so a snapshot only ever contains content the account owns outright — not content shared via a campaign (see `campaignId` under [Reference](#reference)). This isn't a gap to close: a snapshot persists to disk, so pulling in campaign-shared content would risk leaving someone holding an offline copy of paid sourcebook content after their access to that campaign is revoked. Not planned, on copyright/IP grounds.

## Security

This server stores your D&D Beyond session cookie locally at `~/.dndbeyond-mcp/config.json`. The cookie provides full access to your D&D Beyond account. Never share this file. The server only communicates with `dndbeyond.com` domains.

## License

MIT
