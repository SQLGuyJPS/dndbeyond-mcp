import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { parseCompendiumArgs } from "../../src/scripts/download-compendium.js";

describe("parseCompendiumArgs", () => {
  it("defaults to ~/.dndbeyond-mcp/compendium with no flags", () => {
    const options = parseCompendiumArgs([], "/home/dm");
    expect(options).toEqual({
      help: false,
      outputDir: join("/home/dm", ".dndbeyond-mcp", "compendium"),
      fresh: false,
    });
  });

  it("accepts a custom --output path", () => {
    const options = parseCompendiumArgs(["--output", "/tmp/snapshot"], "/home/dm");
    expect(options.outputDir).toBe(resolve("/tmp/snapshot"));
  });

  it("sets fresh when --fresh is passed", () => {
    const options = parseCompendiumArgs(["--fresh"], "/home/dm");
    expect(options.fresh).toBe(true);
  });

  it("sets help when --help is passed", () => {
    const options = parseCompendiumArgs(["--help"], "/home/dm");
    expect(options.help).toBe(true);
  });

  it("rejects --output given twice", () => {
    expect(() => parseCompendiumArgs(["--output", "/a", "--output", "/b"], "/home/dm"))
      .toThrow("--output may only be specified once");
  });

  it("rejects --output with no path", () => {
    expect(() => parseCompendiumArgs(["--output"], "/home/dm"))
      .toThrow("--output requires a path");
  });

  it("rejects an unknown flag", () => {
    expect(() => parseCompendiumArgs(["--bogus"], "/home/dm"))
      .toThrow("Unknown argument: --bogus");
  });
});
