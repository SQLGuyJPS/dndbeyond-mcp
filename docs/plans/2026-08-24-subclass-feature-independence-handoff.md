# Handoff: Class Feature / Subclass Version Awareness Gaps
**dndbeyond-mcp (dmjohnston89 fork)**

Prepared for: Claude Code
Prepared by: Claude (chat), from a live testing session against the running MCP server
Date of session: 2026-08-24

---

## 1. Purpose

This session used the live MCP server to answer a rules-comparison question (2014 vs. 2024 Paladin: Oath of Glory features). The goal here is to hand off exactly what worked, what broke, and what's structurally missing, so the gaps can be fixed at the code level rather than worked around in every future chat session.

## 2. Environment recap

- Repo: `C:\git\dndbeyond-mcp` (built from source, `dmjohnston89/dndbeyond-mcp` fork — the original `AlexWorland/dndbeyond-mcp` was never published to npm and had dependency vulnerabilities)
- Auth config: `C:\Users\conta\.dndbeyond-mcp\config.json` (plaintext session cookie)
- Claude Desktop config: `%APPDATA%\Claude\claude_desktop_config.json`
- Compendium downloader: v0.5.0, resumable JSON snapshot approach (`extract-compendium.mjs` in the repo is dead code, not what runs)
- Test character used: **Eledar Avestan**, Aasimar Paladin (Oath of Glory) 9, campaign "Veterans United"

## 3. Executive summary

**~40% of the eventual answer came from the MCP server; ~60% required a web fallback.** The web fallback wasn't needed because the server returned wrong or low-quality data — everything it *did* return was accurate, well-formatted primary-source text. It was needed because **there is currently no tool call that can retrieve subclass feature data independent of a specific character's level and roster presence, or independent of rules edition.** That's the single root cause behind every gap below.

## 4. What currently works (do not regress)

| Tool | Call pattern | Result |
|---|---|---|
| `get_character` | `characterName="Eledar Avestan", detail="full"` | Returned complete, accurate class feature *definition text* for every feature the character currently has — including the full multi-level Oath of Glory Spells table (levels 3/5/9/13/17), even though the character is only level 9. This confirms feature definitions are static reference text pulled in whole, not derived/truncated from character level. |
| `get_class` | `className="Paladin", edition="2024"` | Correct, full base-class writeup. |
| `get_class` | `className="Paladin", edition="2014"` | Correct, full legacy base-class writeup. Confirms the `edition` parameter works correctly at the base-class level. |
| `get_feat` | `featName="Glorious Defense"` | Correctly returned "not found" — this is *correct* behavior, since Glorious Defense is a class feature, not a Feat. Not a bug; noted here so it isn't mistaken for one. |

**Takeaway:** the `edition` parameter pattern and the character-scoped "full" detail dump both work well. Whatever fix goes in should follow those same conventions for consistency.

## 5. Confirmed defects

### 5.1 `search_class_features` — 404 on every parameter combination tried
```
search_class_features(className="Paladin", name="Glory")        → 404
search_class_features(className="Paladin")                      → 404
search_class_features(className="Paladin", level=15)             → 404
```
All three calls hit the same endpoint with different filters and all three hard-errored with 404, rather than returning an empty result array. That pattern — failing on *every* input, including the maximally broad `className`-only call — points to the endpoint itself being unreachable or malformed (wrong upstream route, wrong query construction, or a stale endpoint URL in the fork), not to "no data exists." This is the highest-priority item to debug first, since if it's simply broken, fixing it likely closes most of the gap below without any new tool needing to be built.

**Suggested first debugging step:** log the actual outbound HTTP request this tool makes and diff it against a manual request to whatever D&D Beyond endpoint it's meant to hit.

### 5.2 `get_definition` — description doesn't match actual behavior
Tool description reads as a standalone compendium lookup ("Look up a specific feat, spell, class feature, racial trait, or item by name"). In practice:
```
get_definition(name="Peerless Athlete")
→ Error: "Either characterId or characterName must be provided."
```
It's actually character-scoped — it can only resolve definitions for things a specific character already has. Two options:
- **Minimum fix:** update the tool description to state the character-scope requirement explicitly, so future callers don't waste a call on it expecting standalone compendium lookup.
- **Better fix:** if D&D Beyond's underlying API supports a characterless compendium definition lookup, extend `get_definition` (or add a sibling tool) to support that mode.

### 5.3 No subclass resolution via class-search tools
```
search_classes(className="Oath of Glory")        → no results
get_class(className="Oath of Glory", edition="2024") → "Class not found."
```
Both tools appear scoped to base classes only (Paladin, Wizard, etc.) and don't resolve subclass names at all, in either edition. This isn't necessarily a bug — it may be working as designed — but it means subclasses have **zero addressable entry point** outside of a character who has one.

## 6. The core structural gap (root cause)

There is no tool that answers: **"give me subclass X's full feature list, across all levels, in edition Y, independent of any character."**

Consequences observed directly in this session:
- Couldn't retrieve **2014 Oath of Glory** at all — no character on the roster has that legacy subclass, and there's no character-independent path to it.
- Couldn't retrieve **level 15 (Glorious Defense) or level 20 (Living Legend)** for 2024 Oath of Glory — the only test character is level 9, and feature definitions are capped at what the character has actually gained.
- Couldn't retrieve subclass **flavor text / tenets** at all — not part of `get_class` output, and no subclass-specific endpoint exists.
- Edition comparison for a subclass is only possible by coincidence — i.e., only if the DM happens to have one character per edition per subclass sitting on their roster.

## 7. Suggested fix / new tool surface

Propose a new tool, tentatively `get_subclass`, mirroring the existing `get_class` signature and conventions:

```
get_subclass(subclassName: string, className?: string, edition?: "2014" | "2024")
```

- Should return the **full level-by-level feature list** for the subclass (e.g., all of levels 3/7/15/20 for Oath of Glory), not just what a given character has unlocked — mirroring how `get_class` already returns the full base-class progression regardless of any character's actual level.
- Should respect the existing `edition` convention (`get_class`, `get_background`, `get_feat`, etc. all already support this cleanly) so 2014 vs. 2024 comparisons become a single parameter swap instead of requiring two different characters.
- Should include subclass flavor text / tenets if available from the underlying data source, since that's currently unreachable by any tool.
- `className` as an optional disambiguator, since subclass names aren't always unique across classes.

If `search_class_features` turns out to be the intended home for this functionality once its 404s are fixed, that may be the faster path — worth deciding which of "fix existing tool" vs. "add new tool" based on what the 404 root-cause investigation turns up.

## 8. Suggested acceptance tests for the fix

Once implemented, these should all succeed and return non-empty, correct data:

1. `get_subclass("Oath of Glory", className="Paladin", edition="2014")` → returns all 6 legacy features (Oath Spells, Peerless Athlete, Inspiring Smite, Aura of Alacrity, Glorious Defense, Living Legend) with correct level tags (3, 3, 3, 7, 15, 20).
2. `get_subclass("Oath of Glory", className="Paladin", edition="2024")` → returns the same 6 feature slots with **2024-specific text**, notably: Peerless Athlete duration = 1 hour (no carry/push/drag/lift doubling); Inspiring Smite with no bonus-action requirement, triggered by any Paladin's Smite spell; Aura of Alacrity described as scaling with Aura of Protection; Living Legend duration = 10 minutes.
3. Same call with **no character on the roster holding that subclass/level** should still succeed — this is the actual regression test for the root cause, since the current gap only shows up when no matching character exists.
4. A level-9 character with this subclass should not artificially cap the tool's output at level 9 — full progression through level 20 should return regardless of any character's current level.

## 9. Priority ranking

1. **Debug `search_class_features` 404s** — cheapest possible fix if it's a broken/stale endpoint, and may resolve most of the gap on its own.
2. **Build/extend `get_subclass`** (or fix `search_class_features` into that role) — closes the structural gap directly.
3. **Fix `get_definition` description** — low effort, prevents future wasted calls and confusion.
4. **Investigate subclass flavor text availability** — lower priority, nice-to-have for full parity with what a DM sees on the D&D Beyond site.
