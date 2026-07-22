#!/usr/bin/env node
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DdbClient } from "../api/client.js";
import { TtlCache } from "../cache/lru.js";
import { writeCompendiumSnapshot } from "../compendium/downloader.js";
import { CircuitBreaker, RateLimiter } from "../resilience/index.js";

export interface CompendiumCliOptions {
  help: boolean;
  outputDir: string;
  fresh: boolean;
}

export const COMPENDIUM_DOWNLOAD_USAGE = `Usage: npm run compendium:download -- [--output <path>]

Downloads D&D Beyond reference content as compact JSON files.

Options:
  --output <path>  Output directory (default: ~/.dndbeyond-mcp/compendium)
  --fresh          Discard any saved monster checkpoint and start again
  --help           Show this help message`;

export function parseCompendiumArgs(args: string[], homeDir = homedir()): CompendiumCliOptions {
  let outputDir = join(homeDir, ".dndbeyond-mcp", "compendium");
  let help = false;
  let fresh = false;
  let outputSeen = false;

  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === "--help") {
      help = true;
      continue;
    }
    if (arg === "--output") {
      if (outputSeen) throw new Error("--output may only be specified once");
      const value = args[++index];
      if (!value || value.startsWith("--")) throw new Error("--output requires a path");
      outputDir = resolve(value);
      outputSeen = true;
      continue;
    }
    if (arg === "--fresh") {
      if (fresh) throw new Error("--fresh may only be specified once");
      fresh = true;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  return { help, outputDir, fresh };
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
}

export async function runCompendiumDownload(args: string[]): Promise<void> {
  const options = parseCompendiumArgs(args);
  if (options.help) {
    console.log(COMPENDIUM_DOWNLOAD_USAGE);
    return;
  }

  const startedAt = Date.now();
  const client = new DdbClient(
    new TtlCache<unknown>(86_400_000),
    new CircuitBreaker(5, 30_000),
    new RateLimiter(2, 1000),
  );

  console.log("Downloading D&D Beyond compendium...");
  console.log(`Output: ${options.outputDir}`);
  const manifest = await writeCompendiumSnapshot(client, options.outputDir, {
    onProgress: (message) => console.log(message),
    fresh: options.fresh,
  });

  console.log("\nCompendium download complete:");
  for (const [category, file] of Object.entries(manifest.files)) {
    console.log(`  ${category}: ${file.count} records (${formatBytes(file.bytes)})`);
  }
  console.log(`Elapsed: ${((Date.now() - startedAt) / 1000).toFixed(1)}s`);
  console.log(`Output: ${options.outputDir}`);
}

const entryPoint = process.argv[1] ? resolve(process.argv[1]) : "";
if (entryPoint === fileURLToPath(import.meta.url)) {
  runCompendiumDownload(process.argv.slice(2)).catch((error) => {
    console.error(`Compendium download failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
