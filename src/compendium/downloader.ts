import { appendFile, mkdtemp, mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { ENDPOINTS } from "../api/endpoints.js";
import type { DdbClient } from "../api/client.js";
import type { DdbSpell } from "../types/character.js";

const SCHEMA_VERSION = 1;
const CACHE_TTL_MS = 86_400_000;
const MONSTER_PAGE_SIZE = 20;
const SPELLCASTING_CLASS_IDS = [1, 2, 3, 4, 5, 6, 7, 8];

export const COMPENDIUM_CATEGORIES = [
  "spells",
  "monsters",
  "items",
  "classes",
  "feats",
  "races",
  "backgrounds",
  "game-config",
] as const;

export type CompendiumCategory = typeof COMPENDIUM_CATEGORIES[number];
type JsonRecord = Record<string, unknown>;
type CompendiumData = Record<CompendiumCategory, unknown[]>;
type ProgressHandler = (message: string) => void;

export interface CompendiumCategoryFile {
  schemaVersion: number;
  generatedAt: string;
  category: CompendiumCategory;
  count: number;
  records: unknown[];
}

export interface CompendiumManifest {
  schemaVersion: number;
  generatedAt: string;
  files: Record<CompendiumCategory, {
    path: string;
    count: number;
    bytes: number;
  }>;
}

export interface DownloadSnapshotOptions {
  generatedAt?: string;
  onProgress?: ProgressHandler;
  fresh?: boolean;
}

export interface DownloadDataOptions {
  onProgress?: ProgressHandler;
  checkpointDir?: string;
}

interface CheckpointFile<T> {
  schemaVersion: number;
  category: string;
  count: number;
  records: T[];
}

interface CheckpointResult<T> {
  records: T[];
  restored: boolean;
}

interface MonsterListResponse {
  pagination?: { total?: number };
  data?: JsonRecord[];
}

interface MonsterDetailResponse {
  accessType?: number;
  data?: JsonRecord;
}

const spellRequests = [
  (classId: number) => ENDPOINTS.gameData.alwaysKnownSpells(classId, 1),
  (classId: number) => ENDPOINTS.gameData.alwaysKnownSpells(classId, 20),
  (classId: number) => ENDPOINTS.gameData.alwaysPreparedSpells(classId, 1),
  (classId: number) => ENDPOINTS.gameData.alwaysPreparedSpells(classId, 20),
];

function stringField(record: JsonRecord, field: string): string {
  const value = record[field];
  return typeof value === "string" ? value : "";
}

function recordId(record: JsonRecord): string {
  const id = record.id;
  return typeof id === "number" || typeof id === "string" ? String(id) : "";
}

function sortByName(records: JsonRecord[], getName = (record: JsonRecord) => stringField(record, "name")): JsonRecord[] {
  return [...records].sort((a, b) => {
    const byName = getName(a).localeCompare(getName(b));
    return byName || recordId(a).localeCompare(recordId(b), undefined, { numeric: true });
  });
}

function dedupeByName(
  records: JsonRecord[],
  getName: (record: JsonRecord) => string,
): JsonRecord[] {
  const byName = new Map<string, JsonRecord>();
  for (const record of records) {
    const name = getName(record);
    if (!name) continue;
    const existing = byName.get(name);
    if (!existing || stringField(record, "description").length > stringField(existing, "description").length) {
      byName.set(name, record);
    }
  }
  return sortByName([...byName.values()], getName);
}

async function downloadSpells(client: DdbClient): Promise<DdbSpell[]> {
  const byNameAndEdition = new Map<string, DdbSpell>();

  for (const classId of SPELLCASTING_CLASS_IDS) {
    for (const request of spellRequests) {
      const url = request(classId);
      const spells = await client.get<DdbSpell[]>(
        url,
        `compendium:download:spells:${url}`,
        CACHE_TTL_MS,
      );
      for (const spell of spells ?? []) {
        const definition = spell.definition;
        if (!definition?.name) continue;
        const key = `${definition.name}|${definition.isLegacy ? "legacy" : "current"}`;
        if (!byNameAndEdition.has(key)) byNameAndEdition.set(key, spell);
      }
    }
  }

  return [...byNameAndEdition.values()].sort((a, b) =>
    a.definition.level - b.definition.level
    || a.definition.name.localeCompare(b.definition.name)
    || Number(Boolean(a.definition.isLegacy)) - Number(Boolean(b.definition.isLegacy))
  );
}

function isJsonRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function loadOrDownloadCheckpoint<T>(
  checkpointDir: string | undefined,
  category: string,
  download: () => Promise<T[]>,
  onProgress: ProgressHandler,
  validate: (records: T[]) => boolean = (records) => records.every(isJsonRecord),
): Promise<CheckpointResult<T>> {
  if (!checkpointDir) return { records: await download(), restored: false };

  const checkpointPath = join(checkpointDir, `${category}.json`);
  try {
    const parsed: unknown = JSON.parse(await readFile(checkpointPath, "utf8"));
    if (
      isJsonRecord(parsed)
      && parsed.schemaVersion === SCHEMA_VERSION
      && parsed.category === category
      && Array.isArray(parsed.records)
      && parsed.count === parsed.records.length
      && validate(parsed.records as T[])
    ) {
      return { records: parsed.records as T[], restored: true };
    }
    onProgress(`${category}: ignored invalid checkpoint`);
  } catch (error) {
    if (!isMissingPath(error)) onProgress(`${category}: ignored unreadable checkpoint`);
  }

  const records = await download();
  await mkdir(checkpointDir, { recursive: true });
  const checkpoint: CheckpointFile<T> = {
    schemaVersion: SCHEMA_VERSION,
    category,
    count: records.length,
    records,
  };
  const temporaryPath = `${checkpointPath}.tmp-${process.pid}`;
  await writeFile(temporaryPath, JSON.stringify(checkpoint), "utf8");
  await rename(temporaryPath, checkpointPath);
  return { records, restored: false };
}

async function loadMonsterCheckpoint(
  checkpointPath: string,
  currentIds: Set<number>,
  onProgress: ProgressHandler,
): Promise<Map<number, JsonRecord>> {
  let raw = "";
  try {
    raw = await readFile(checkpointPath, "utf8");
  } catch (error) {
    if (!isMissingPath(error)) throw error;
  }

  const monsters = new Map<number, JsonRecord>();
  let invalidLines = 0;
  for (const line of raw.split("\n")) {
    if (!line) continue;
    try {
      const record: unknown = JSON.parse(line);
      if (!isJsonRecord(record) || typeof record.id !== "number" || !currentIds.has(record.id)) {
        invalidLines++;
        continue;
      }
      monsters.set(record.id, record);
    } catch {
      invalidLines++;
    }
  }

  await mkdir(dirname(checkpointPath), { recursive: true });
  const normalized = [...monsters.values()].map((record) => JSON.stringify(record)).join("\n");
  await writeFile(checkpointPath, normalized ? `${normalized}\n` : "", "utf8");

  if (invalidLines > 0) onProgress(`Monsters: ignored ${invalidLines} invalid checkpoint entries`);
  if (monsters.size > 0) onProgress(`Monsters: resuming with ${monsters.size}/${currentIds.size} downloaded`);
  return monsters;
}

async function downloadMonsters(
  client: DdbClient,
  onProgress: ProgressHandler,
  checkpointDir?: string,
): Promise<JsonRecord[]> {
  const summaryResult = await loadOrDownloadCheckpoint(
    checkpointDir,
    "monster-summaries",
    async () => {
      const summaries: JsonRecord[] = [];
      let skip = 0;
      let total: number | undefined;

      while (total === undefined || summaries.length < total) {
        const response = await client.getRaw<MonsterListResponse>(
          ENDPOINTS.monster.search("", skip, MONSTER_PAGE_SIZE),
          `compendium:download:monsters:${skip}`,
          CACHE_TTL_MS,
        );
        const page = response.data ?? [];
        if (page.length === 0) break;

        summaries.push(...page);
        total = response.pagination?.total;
        skip += page.length;
        onProgress(`Monsters: discovered ${summaries.length}${total === undefined ? "" : `/${total}`}`);

        if (total === undefined && page.length < MONSTER_PAGE_SIZE) break;
      }

      if (total !== undefined && summaries.length < total) {
        throw new Error(`Monster list ended after ${summaries.length} of ${total} records`);
      }
      return summaries;
    },
    onProgress,
    (records) => records.every((record) => isJsonRecord(record) && typeof record.id === "number"),
  );
  const summaries = summaryResult.records;
  onProgress(
    summaryResult.restored
      ? `Monsters: restored ${summaries.length} summaries from checkpoint`
      : checkpointDir
        ? `Monsters: saved ${summaries.length} summaries to checkpoint`
        : `Monsters: discovered ${summaries.length} summaries`,
  );

  const currentIds = new Set<number>();
  for (const summary of summaries) {
    const id = summary.id;
    if (typeof id !== "number") throw new Error("Monster summary is missing a numeric id");
    currentIds.add(id);
  }

  const monsterCheckpointPath = checkpointDir ? join(checkpointDir, "monsters.jsonl") : undefined;
  const monsters = monsterCheckpointPath
    ? await loadMonsterCheckpoint(monsterCheckpointPath, currentIds, onProgress)
    : new Map<number, JsonRecord>();

  for (const summary of summaries) {
    const id = summary.id as number;
    if (monsters.has(id)) continue;

    const response = await client.getRaw<MonsterDetailResponse>(
      ENDPOINTS.monster.get(id),
      `compendium:download:monster:${id}`,
      CACHE_TTL_MS,
    );
    if (!response.data) throw new Error(`Monster ${id} returned no detail data`);
    const monster = { ...response.data, ddbAccessType: response.accessType ?? null };
    if (monsterCheckpointPath) await appendFile(monsterCheckpointPath, `${JSON.stringify(monster)}\n`, "utf8");
    monsters.set(id, monster);

    if (monsters.size % 25 === 0 || monsters.size === currentIds.size) {
      onProgress(`Monsters: downloaded ${monsters.size}/${currentIds.size}`);
    }
  }

  return sortByName([...monsters.values()]);
}

export async function downloadCompendiumData(
  client: DdbClient,
  options: DownloadDataOptions = {},
): Promise<CompendiumData> {
  const onProgress = options.onProgress ?? (() => {});
  onProgress("Downloading game config...");
  const gameConfigResult = await loadOrDownloadCheckpoint(
    options.checkpointDir,
    "game-config",
    async () => [await client.getRaw<JsonRecord>(
      ENDPOINTS.config.json(),
      "compendium:download:game-config",
      CACHE_TTL_MS,
    )],
    onProgress,
    (records) => records.length === 1 && isJsonRecord(records[0]),
  );
  const gameConfig = gameConfigResult.records[0];
  onProgress(
    gameConfigResult.restored
      ? "Game config: restored 1 configuration record from checkpoint"
      : "Game config: downloaded 1 configuration record",
  );

  onProgress("Downloading spells...");
  const spellResult = await loadOrDownloadCheckpoint(
    options.checkpointDir,
    "spells",
    () => downloadSpells(client),
    onProgress,
  );
  const spells = spellResult.records;
  onProgress(
    spellResult.restored
      ? `Spells: restored ${spells.length} unique spells from checkpoint`
      : `Spells: downloaded ${spells.length} unique spells`,
  );

  onProgress("Downloading monsters...");
  const monsters = await downloadMonsters(client, onProgress, options.checkpointDir);

  onProgress("Downloading items...");
  const itemResult = await loadOrDownloadCheckpoint(
    options.checkpointDir,
    "items",
    async () => sortByName(await client.get<JsonRecord[]>(
      ENDPOINTS.gameData.items(),
      "compendium:download:items",
      CACHE_TTL_MS,
    )),
    onProgress,
  );
  const items = itemResult.records;
  onProgress(itemResult.restored
    ? `Items: restored ${items.length} items from checkpoint`
    : `Items: downloaded ${items.length} items`);

  onProgress("Downloading classes...");
  const classResult = await loadOrDownloadCheckpoint(
    options.checkpointDir,
    "classes",
    async () => sortByName(await client.get<JsonRecord[]>(
      ENDPOINTS.gameData.classes(),
      "compendium:download:classes",
      CACHE_TTL_MS,
    )),
    onProgress,
  );
  const classes = classResult.records;
  onProgress(classResult.restored
    ? `Classes: restored ${classes.length} classes from checkpoint`
    : `Classes: downloaded ${classes.length} classes`);

  onProgress("Downloading feats...");
  const featResult = await loadOrDownloadCheckpoint(
    options.checkpointDir,
    "feats",
    async () => dedupeByName(
      await client.get<JsonRecord[]>(ENDPOINTS.gameData.feats(), "compendium:download:feats", CACHE_TTL_MS),
      (record) => stringField(record, "name"),
    ),
    onProgress,
  );
  const feats = featResult.records;
  onProgress(featResult.restored
    ? `Feats: restored ${feats.length} unique feats from checkpoint`
    : `Feats: downloaded ${feats.length} unique feats`);

  onProgress("Downloading races...");
  const raceName = (record: JsonRecord) => stringField(record, "fullName") || stringField(record, "baseName");
  const raceResult = await loadOrDownloadCheckpoint(
    options.checkpointDir,
    "races",
    async () => dedupeByName(
      await client.get<JsonRecord[]>(ENDPOINTS.gameData.races(), "compendium:download:races", CACHE_TTL_MS),
      raceName,
    ),
    onProgress,
  );
  const races = raceResult.records;
  onProgress(raceResult.restored
    ? `Races: restored ${races.length} unique races from checkpoint`
    : `Races: downloaded ${races.length} unique races`);

  onProgress("Downloading backgrounds...");
  const backgroundResult = await loadOrDownloadCheckpoint(
    options.checkpointDir,
    "backgrounds",
    async () => sortByName(await client.get<JsonRecord[]>(
      ENDPOINTS.gameData.backgrounds(),
      "compendium:download:backgrounds",
      CACHE_TTL_MS,
    )),
    onProgress,
  );
  const backgrounds = backgroundResult.records;
  onProgress(backgroundResult.restored
    ? `Backgrounds: restored ${backgrounds.length} backgrounds from checkpoint`
    : `Backgrounds: downloaded ${backgrounds.length} backgrounds`);

  return {
    spells,
    monsters,
    items,
    classes,
    feats,
    races,
    backgrounds,
    "game-config": [gameConfig],
  };
}

function isMissingPath(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

async function installSnapshot(stagingDir: string, outputDir: string): Promise<void> {
  const backupDir = `${stagingDir}-previous`;
  let movedPrevious = false;

  try {
    await rename(outputDir, backupDir);
    movedPrevious = true;
  } catch (error) {
    if (!isMissingPath(error)) throw error;
  }

  try {
    await rename(stagingDir, outputDir);
  } catch (error) {
    if (movedPrevious) {
      try {
        await rename(backupDir, outputDir);
      } catch (rollbackError) {
        throw new AggregateError([error, rollbackError], "Could not install or restore compendium snapshot");
      }
    }
    throw error;
  }

  if (movedPrevious) await rm(backupDir, { recursive: true, force: true });
}

export async function writeCompendiumSnapshot(
  client: DdbClient,
  outputPath: string,
  options: DownloadSnapshotOptions = {},
): Promise<CompendiumManifest> {
  const outputDir = resolve(outputPath);
  const parentDir = dirname(outputDir);
  const generatedAt = options.generatedAt ?? new Date().toISOString();
  const onProgress = options.onProgress ?? (() => {});
  const checkpointDir = join(parentDir, `.${basename(outputDir)}-checkpoint`);

  await mkdir(parentDir, { recursive: true });
  if (options.fresh) {
    await rm(checkpointDir, { recursive: true, force: true });
    onProgress("Cleared saved download checkpoint");
  }
  const stagingDir = await mkdtemp(join(parentDir, `.${basename(outputDir)}-`));

  try {
    const data = await downloadCompendiumData(client, { onProgress, checkpointDir });
    const files = {} as CompendiumManifest["files"];

    for (const category of COMPENDIUM_CATEGORIES) {
      const fileName = `${category}.json`;
      const records = data[category];
      const categoryFile: CompendiumCategoryFile = {
        schemaVersion: SCHEMA_VERSION,
        generatedAt,
        category,
        count: records.length,
        records,
      };
      const json = JSON.stringify(categoryFile);
      const filePath = join(stagingDir, fileName);
      await writeFile(filePath, json, "utf8");
      files[category] = {
        path: fileName,
        count: records.length,
        bytes: (await stat(filePath)).size,
      };
    }

    const manifest: CompendiumManifest = {
      schemaVersion: SCHEMA_VERSION,
      generatedAt,
      files,
    };
    await writeFile(join(stagingDir, "manifest.json"), JSON.stringify(manifest), "utf8");
    await installSnapshot(stagingDir, outputDir);
    try {
      await rm(checkpointDir, { recursive: true, force: true });
    } catch (error) {
      onProgress(`Warning: could not remove download checkpoint: ${error instanceof Error ? error.message : String(error)}`);
    }
    return manifest;
  } catch (error) {
    await rm(stagingDir, { recursive: true, force: true });
    throw error;
  }
}
