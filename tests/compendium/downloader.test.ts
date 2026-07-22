import { mkdtemp, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  COMPENDIUM_CATEGORIES,
  downloadCompendiumData,
  writeCompendiumSnapshot,
} from "../../src/compendium/downloader.js";
import type { DdbClient } from "../../src/api/client.js";
import type { DdbSpell } from "../../src/types/character.js";

function spell(id: number, name: string, level: number, isLegacy = false): DdbSpell {
  return {
    id,
    definition: {
      name,
      level,
      school: "Evocation",
      description: `${name} description`,
      range: null,
      duration: null,
      activation: null,
      components: [],
      componentsDescription: null,
      concentration: false,
      ritual: false,
      isLegacy,
    },
    prepared: false,
    alwaysPrepared: false,
    usesSpellSlot: level > 0,
  };
}

function completeMockClient(options: { failMonsterId?: number; failCategory?: "backgrounds" } = {}): {
  client: DdbClient;
  get: ReturnType<typeof vi.fn>;
  getRaw: ReturnType<typeof vi.fn>;
} {
  const spells = [
    spell(3, "Fireball", 3, true),
    spell(2, "Spark", 0),
    spell(1, "Fireball", 3),
  ];

  const get = vi.fn(async (url: string) => {
    if (url.includes("always-known-spells") || url.includes("always-prepared-spells")) return spells;
    if (url.includes("/items")) return [{ id: 2, name: "Zebra Blade" }, { id: 1, name: "Adamantine Armor" }];
    if (url.includes("/classes")) return [{ id: 2, name: "Wizard" }, { id: 1, name: "Bard" }];
    if (url.includes("/feats")) {
      return [
        { id: 1, name: "Alert", description: "Short" },
        { id: 2, name: "Alert", description: "A much longer description" },
        { id: 3, name: "Chef", description: "Cook" },
      ];
    }
    if (url.includes("/races")) {
      return [
        { id: 1, fullName: "Elf", description: "Short" },
        { id: 2, fullName: "Elf", description: "A much longer description" },
        { id: 3, fullName: "Dwarf", description: "Stout" },
      ];
    }
    if (url.includes("/backgrounds")) {
      if (options.failCategory === "backgrounds") throw new Error("backgrounds failed");
      return [{ id: 2, name: "Sage" }, { id: 1, name: "Acolyte" }];
    }
    throw new Error(`Unexpected GET ${url}`);
  });

  const getRaw = vi.fn(async (url: string) => {
    if (url.includes("/api/config/json")) return { challengeRatings: [{ id: 1, value: 0 }] };
    if (url.includes("/v1/Monster?")) {
      const secondPage = url.includes("skip=1");
      return {
        pagination: { total: 2 },
        data: secondPage ? [{ id: 2, name: "Aboleth" }] : [{ id: 1, name: "Zombie" }],
      };
    }
    if (url.endsWith("/v1/Monster/1")) {
      if (options.failMonsterId === 1) throw new Error("monster 1 failed");
      return { accessType: 1, data: { id: 1, name: "Zombie", actionsDescription: "Slam" } };
    }
    if (url.endsWith("/v1/Monster/2")) {
      if (options.failMonsterId === 2) throw new Error("monster 2 failed");
      return { accessType: 4, data: { id: 2, name: "Aboleth", customField: { retained: true } } };
    }
    throw new Error(`Unexpected raw GET ${url}`);
  });

  return {
    client: { get, getRaw } as unknown as DdbClient,
    get,
    getRaw,
  };
}

function failingClient(): DdbClient {
  return {
    get: vi.fn().mockRejectedValue(new Error("spell endpoint failed")),
    getRaw: vi.fn().mockResolvedValue({ challengeRatings: [] }),
  } as unknown as DdbClient;
}

describe("downloadCompendiumData", () => {
  it("downloads every endpoint, deduplicates records, and sorts deterministically", async () => {
    const { client, get, getRaw } = completeMockClient();
    const progress = vi.fn();

    const data = await downloadCompendiumData(client, { onProgress: progress });

    const spellCalls = get.mock.calls.filter(([url]) => String(url).includes("spells"));
    expect(spellCalls).toHaveLength(32);
    expect(spellCalls.filter(([url]) => String(url).includes("always-known-spells"))).toHaveLength(16);
    expect(spellCalls.filter(([url]) => String(url).includes("always-prepared-spells"))).toHaveLength(16);
    expect(data.spells.map((entry) => {
      const value = entry as DdbSpell;
      return `${value.definition.name}:${value.definition.isLegacy ? "legacy" : "current"}`;
    })).toEqual(["Spark:current", "Fireball:current", "Fireball:legacy"]);

    expect(data.monsters).toEqual([
      { id: 2, name: "Aboleth", customField: { retained: true }, ddbAccessType: 4 },
      { id: 1, name: "Zombie", actionsDescription: "Slam", ddbAccessType: 1 },
    ]);
    expect(getRaw.mock.calls.filter(([url]) => String(url).includes("/v1/Monster?"))).toHaveLength(2);
    expect(getRaw.mock.calls.filter(([url]) => String(url).includes("/v1/Monster/"))).toHaveLength(2);
    expect(data.items.map((entry) => (entry as { name: string }).name)).toEqual(["Adamantine Armor", "Zebra Blade"]);
    expect(data.classes.map((entry) => (entry as { name: string }).name)).toEqual(["Bard", "Wizard"]);
    expect(data.feats).toEqual([
      { id: 2, name: "Alert", description: "A much longer description" },
      { id: 3, name: "Chef", description: "Cook" },
    ]);
    expect(data.races).toEqual([
      { id: 3, fullName: "Dwarf", description: "Stout" },
      { id: 2, fullName: "Elf", description: "A much longer description" },
    ]);
    expect(data.backgrounds.map((entry) => (entry as { name: string }).name)).toEqual(["Acolyte", "Sage"]);
    expect(data["game-config"]).toEqual([{ challengeRatings: [{ id: 1, value: 0 }] }]);
    expect(progress.mock.calls.map(([message]) => message)).toEqual(expect.arrayContaining([
      "Game config: downloaded 1 configuration record",
      "Spells: downloaded 3 unique spells",
      "Items: downloaded 2 items",
      "Classes: downloaded 2 classes",
      "Feats: downloaded 2 unique feats",
      "Races: downloaded 2 unique races",
      "Backgrounds: downloaded 2 backgrounds",
    ]));
  });

  it("rejects a truncated monster listing instead of publishing partial data", async () => {
    const { client, getRaw } = completeMockClient();
    getRaw.mockReset();
    getRaw
      .mockResolvedValueOnce({ challengeRatings: [] })
      .mockResolvedValueOnce({ pagination: { total: 2 }, data: [{ id: 1, name: "Zombie" }] })
      .mockResolvedValueOnce({ pagination: { total: 2 }, data: [] });

    await expect(downloadCompendiumData(client)).rejects.toThrow("Monster list ended after 1 of 2 records");
  });

  it("restores every completed section after a later section fails", async () => {
    const root = await mkdtemp(join(tmpdir(), "ddb-compendium-"));
    const checkpointDir = join(root, ".compendium-checkpoint");

    try {
      await expect(downloadCompendiumData(
        completeMockClient({ failCategory: "backgrounds" }).client,
        { checkpointDir },
      )).rejects.toThrow("backgrounds failed");
      expect((await readdir(checkpointDir)).sort()).toEqual([
        "classes.json",
        "feats.json",
        "game-config.json",
        "items.json",
        "monster-summaries.json",
        "monsters.jsonl",
        "races.json",
        "spells.json",
      ]);

      const resumed = completeMockClient();
      const progress = vi.fn();
      await downloadCompendiumData(resumed.client, { checkpointDir, onProgress: progress });

      expect(resumed.get.mock.calls.map(([url]) => String(url))).toEqual([
        expect.stringContaining("/backgrounds"),
      ]);
      expect(resumed.getRaw).not.toHaveBeenCalled();
      expect(progress).toHaveBeenCalledWith("Spells: restored 3 unique spells from checkpoint");
      expect(progress).toHaveBeenCalledWith("Items: restored 2 items from checkpoint");
      expect(progress).toHaveBeenCalledWith("Races: restored 2 unique races from checkpoint");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe("writeCompendiumSnapshot", () => {
  it("writes parseable category files and a manifest with exact counts and sizes", async () => {
    const root = await mkdtemp(join(tmpdir(), "ddb-compendium-"));
    const outputDir = join(root, "compendium");
    const generatedAt = "2026-07-10T00:00:00.000Z";

    try {
      const manifest = await writeCompendiumSnapshot(completeMockClient().client, outputDir, { generatedAt });
      expect((await readdir(outputDir)).sort()).toEqual([
        ...COMPENDIUM_CATEGORIES.map((category) => `${category}.json`),
        "manifest.json",
      ].sort());

      for (const category of COMPENDIUM_CATEGORIES) {
        const filePath = join(outputDir, `${category}.json`);
        const parsed = JSON.parse(await readFile(filePath, "utf8"));
        expect(parsed).toMatchObject({
          schemaVersion: 1,
          generatedAt,
          category,
          count: parsed.records.length,
        });
        expect(manifest.files[category]).toEqual({
          path: `${category}.json`,
          count: parsed.records.length,
          bytes: (await stat(filePath)).size,
        });
      }

      expect(JSON.parse(await readFile(join(outputDir, "manifest.json"), "utf8"))).toEqual(manifest);
      const monsters = JSON.parse(await readFile(join(outputDir, "monsters.json"), "utf8"));
      expect(monsters.records[0].customField).toEqual({ retained: true });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("preserves an existing snapshot when downloading fails", async () => {
    const root = await mkdtemp(join(tmpdir(), "ddb-compendium-"));
    const outputDir = join(root, "compendium");

    try {
      await mkdir(outputDir);
      await writeFile(join(outputDir, "sentinel.json"), "old snapshot", "utf8");

      await expect(writeCompendiumSnapshot(failingClient(), outputDir)).rejects.toThrow("spell endpoint failed");
      expect(await readFile(join(outputDir, "sentinel.json"), "utf8")).toBe("old snapshot");
      expect((await readdir(root)).filter((name) => name.startsWith(".compendium-")))
        .toEqual([".compendium-checkpoint"]);
      expect(JSON.parse(await readFile(join(root, ".compendium-checkpoint", "game-config.json"), "utf8")))
        .toMatchObject({ category: "game-config", count: 1 });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("keeps completed sections but leaves no destination or staging directory on failure", async () => {
    const root = await mkdtemp(join(tmpdir(), "ddb-compendium-"));
    const outputDir = join(root, "compendium");

    try {
      await expect(writeCompendiumSnapshot(failingClient(), outputDir)).rejects.toThrow("spell endpoint failed");
      expect(await readdir(root)).toEqual([".compendium-checkpoint"]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("resumes monster details from a persistent checkpoint after failure", async () => {
    const root = await mkdtemp(join(tmpdir(), "ddb-compendium-"));
    const outputDir = join(root, "compendium");
    const checkpointPath = join(root, ".compendium-checkpoint", "monsters.jsonl");

    try {
      await expect(writeCompendiumSnapshot(completeMockClient({ failMonsterId: 2 }).client, outputDir))
        .rejects.toThrow("monster 2 failed");
      expect((await readdir(join(root, ".compendium-checkpoint"))).sort()).toEqual([
        "game-config.json",
        "monster-summaries.json",
        "monsters.jsonl",
        "spells.json",
      ]);
      const checkpointRecords = (await readFile(checkpointPath, "utf8")).trim().split("\n").map(JSON.parse);
      expect(checkpointRecords).toEqual([
        { id: 1, name: "Zombie", actionsDescription: "Slam", ddbAccessType: 1 },
      ]);

      const resumed = completeMockClient();
      const progress = vi.fn();
      await writeCompendiumSnapshot(resumed.client, outputDir, { onProgress: progress });

      const detailCalls = resumed.getRaw.mock.calls
        .map(([url]) => String(url))
        .filter((url) => url.includes("/v1/Monster/"));
      expect(detailCalls).toEqual([expect.stringContaining("/v1/Monster/2")]);
      expect(resumed.get.mock.calls.filter(([url]) => String(url).includes("spells"))).toHaveLength(0);
      expect(resumed.getRaw.mock.calls.filter(([url]) => String(url).includes("/api/config/json"))).toHaveLength(0);
      expect(resumed.getRaw.mock.calls.filter(([url]) => String(url).includes("/v1/Monster?"))).toHaveLength(0);
      expect(progress).toHaveBeenCalledWith("Spells: restored 3 unique spells from checkpoint");
      expect(progress).toHaveBeenCalledWith("Monsters: restored 2 summaries from checkpoint");
      expect(progress).toHaveBeenCalledWith("Monsters: resuming with 1/2 downloaded");
      expect(await readdir(root)).toEqual(["compendium"]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("discards a saved checkpoint when fresh mode is requested", async () => {
    const root = await mkdtemp(join(tmpdir(), "ddb-compendium-"));
    const outputDir = join(root, "compendium");

    try {
      await expect(writeCompendiumSnapshot(completeMockClient({ failMonsterId: 2 }).client, outputDir))
        .rejects.toThrow("monster 2 failed");

      const restarted = completeMockClient();
      const progress = vi.fn();
      await writeCompendiumSnapshot(restarted.client, outputDir, { fresh: true, onProgress: progress });

      const detailCalls = restarted.getRaw.mock.calls
        .map(([url]) => String(url))
        .filter((url) => url.includes("/v1/Monster/"));
      expect(detailCalls).toHaveLength(2);
      expect(progress).toHaveBeenCalledWith("Cleared saved download checkpoint");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
