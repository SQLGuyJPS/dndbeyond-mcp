#!/usr/bin/env node
/**
 * Scrubs a raw character-service v5 payload for commit as a frozen test
 * fixture — the capture -> freeze rule from
 * docs/plans/2026-09-05-character-fixes-integration-plan.md §3.2.
 *
 * Manual and generated characters are used once to capture ground truth;
 * this is what's committed instead of the real payload, so regression
 * protection lives in tier 1 forever without any contributor owning the
 * source character.
 *
 * Usage: node build/src/scripts/scrub-fixture.js <input.json> <output.json> <placeholderName>
 */
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SYNTHETIC_ID = 900000001;
const SYNTHETIC_USER_ID = 900000002;
const SYNTHETIC_CAMPAIGN_ID = 900000003;

const FREE_TEXT_FIELDS = [
  "personalityTraits", "ideals", "bonds", "flaws", "appearance",
  "personalPossessions", "backstory", "otherNotes", "allies", "organizations",
];

const URL_FIELDS = [
  "readonlyUrl", "avatarUrl", "largeAvatarUrl", "portraitAvatarUrl",
  "detailsBackgroundAvatarUrl", "detailsForegroundAvatarUrl", "coverImageUrl", "backdropUrl",
];

/**
 * Recursively blanks any key in URL_FIELDS and strips HTML description/
 * longDescription-style prose isn't touched — mechanical text (spell/feat/
 * item descriptions) is rules content, not account-identifying, and stays.
 */
function stripUrls(node: unknown): void {
  if (node == null || typeof node !== "object") return;
  if (Array.isArray(node)) {
    for (const item of node) stripUrls(item);
    return;
  }
  for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
    if (URL_FIELDS.includes(key) && typeof value === "string") {
      (node as Record<string, unknown>)[key] = null;
    } else {
      stripUrls(value);
    }
  }
}

export interface ScrubOptions {
  placeholderName: string;
  /** Set false to keep the campaign (rare — only when a fixture specifically needs one). */
  stripCampaign?: boolean;
  /** The real values to check the scrubbed output never contains (denylist). */
  denylist: string[];
}

/** Replaces every verbatim occurrence of `from` inside string leaves (e.g. a
 * renamed item's `characterValues` entry — "Niko's Adamantine Longsword" —
 * carries the character's real name even though the top-level `name` field
 * is scrubbed separately). */
function replaceInStrings(node: unknown, from: string, to: string): void {
  if (node == null || typeof node !== "object") return;
  if (Array.isArray(node)) {
    for (const item of node) replaceInStrings(item, from, to);
    return;
  }
  for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
    if (typeof value === "string" && value.includes(from)) {
      (node as Record<string, unknown>)[key] = value.split(from).join(to);
    } else {
      replaceInStrings(value, from, to);
    }
  }
}

export function scrubCharacterFixture(raw: Record<string, unknown>, options: ScrubOptions): Record<string, unknown> {
  const scrubbed: Record<string, unknown> = JSON.parse(JSON.stringify(raw));

  const originalName = typeof scrubbed.name === "string" ? scrubbed.name : null;

  scrubbed.id = SYNTHETIC_ID;
  scrubbed.userId = SYNTHETIC_USER_ID;
  scrubbed.username = "scrubbed-user";
  scrubbed.socialName = null;
  scrubbed.name = options.placeholderName;

  if (originalName) replaceInStrings(scrubbed, originalName, options.placeholderName);

  if (options.stripCampaign !== false && scrubbed.campaign) {
    scrubbed.campaign = { id: SYNTHETIC_CAMPAIGN_ID, name: "Test Campaign" };
  }

  const traits = scrubbed.traits as Record<string, unknown> | undefined;
  if (traits) for (const field of FREE_TEXT_FIELDS) if (field in traits) traits[field] = null;

  const notes = scrubbed.notes as Record<string, unknown> | undefined;
  if (notes) for (const field of FREE_TEXT_FIELDS) if (field in notes) notes[field] = null;

  stripUrls(scrubbed);

  // Fail loudly rather than silently commit account data. Preserves
  // modifiers/actions/stats/bonusStats/overrideStats/inventory/classes/race/
  // feats/options/characterValues/customItems/spells/classSpells — nothing
  // above touches those.
  const serialized = JSON.stringify(scrubbed).toLowerCase();
  for (const forbidden of options.denylist) {
    if (!forbidden) continue;
    if (serialized.includes(forbidden.toLowerCase())) {
      throw new Error(`Scrub failed: output still contains denylisted value "${forbidden}"`);
    }
  }

  return scrubbed;
}

const entryPoint = process.argv[1] ? resolve(process.argv[1]) : "";
if (entryPoint === fileURLToPath(import.meta.url)) {
  const [inputPath, outputPath, placeholderName, ...denylist] = process.argv.slice(2);
  if (!inputPath || !outputPath || !placeholderName) {
    console.error("Usage: scrub-fixture.js <input.json> <output.json> <placeholderName> [denylistTerm ...]");
    process.exitCode = 1;
  } else {
    const raw = JSON.parse(await readFile(inputPath, "utf-8"));
    const scrubbed = scrubCharacterFixture(raw, { placeholderName, denylist });
    await writeFile(outputPath, JSON.stringify(scrubbed, null, 2) + "\n", "utf-8");
    console.log(`Scrubbed ${inputPath} -> ${outputPath}`);
  }
}
