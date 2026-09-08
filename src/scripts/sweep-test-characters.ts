#!/usr/bin/env node
/**
 * Lists owned characters and deletes any leftover MCPTEST- fixtures — the
 * hygiene helper called for by docs/plans/2026-09-05-character-fixes-integration-plan.md
 * §3.2. Live write tests build fresh `MCPTEST-`-prefixed characters and delete
 * them in `afterAll`; a crashed run can leave one behind, and DDB enforces a
 * `characterSlotLimit` (visible in the list payload) that leftover fixtures eat
 * into. Run this after any live-test run you're not sure completed cleanly.
 */
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DdbClient } from "../api/client.js";
import { TtlCache } from "../cache/lru.js";
import { CircuitBreaker, RateLimiter } from "../resilience/index.js";
import { getUserId } from "../api/auth.js";
import { ENDPOINTS } from "../api/endpoints.js";
import { MCPTEST_PREFIX } from "../utils/test-fixtures.js";

interface OwnedCharacterListItem {
  id: number;
  name: string;
}

interface OwnedCharacterListData {
  characterSlotLimit: number | null;
  characters: OwnedCharacterListItem[];
}

export async function sweepTestCharacters(dryRun = false): Promise<{ found: number; deleted: number[] }> {
  const cache = new TtlCache<unknown>(30_000);
  const circuitBreaker = new CircuitBreaker(5, 30_000);
  const rateLimiter = new RateLimiter(3, 1000);
  const client = new DdbClient(cache, circuitBreaker, rateLimiter);

  const userId = await getUserId();
  if (!userId) {
    throw new Error("Not authenticated (no User.ID cookie). Run `npm run setup` first.");
  }

  const list = await client.get<OwnedCharacterListData>(
    ENDPOINTS.character.list(userId),
    `sweep:${userId}:${Date.now()}`,
    0
  );

  const orphans = list.characters.filter((c) => c.name.startsWith(MCPTEST_PREFIX));
  if (orphans.length === 0) {
    console.log("No orphaned MCPTEST- characters found.");
    return { found: 0, deleted: [] };
  }

  console.log(`Found ${orphans.length} orphaned MCPTEST- character(s):`);
  for (const c of orphans) console.log(`  ${c.id}  ${c.name}`);

  if (dryRun) {
    console.log("Dry run — not deleting. Re-run without --dry-run to delete.");
    return { found: orphans.length, deleted: [] };
  }

  const deleted: number[] = [];
  for (const c of orphans) {
    await client.delete(ENDPOINTS.character.delete(), { characterId: c.id });
    console.log(`  Deleted ${c.id} (${c.name})`);
    deleted.push(c.id);
  }

  if (list.characterSlotLimit !== null) {
    console.log(`Account character slot limit: ${list.characterSlotLimit}`);
  }

  return { found: orphans.length, deleted };
}

const entryPoint = process.argv[1] ? resolve(process.argv[1]) : "";
if (entryPoint === fileURLToPath(import.meta.url)) {
  const dryRun = process.argv.includes("--dry-run");
  sweepTestCharacters(dryRun).catch((error) => {
    console.error(`Sweep failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
