import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import { createProgram, inferProgramName } from "./index.js";

describe("cli entrypoint", () => {
  it("exposes runstead and legacy team binaries", async () => {
    const packageJson = JSON.parse(
      await readFile(new URL("../package.json", import.meta.url), "utf8")
    ) as {
      bin: Record<string, string>;
    };

    expect(packageJson.bin.runstead).toBe("./dist/index.js");
    expect(packageJson.bin.team).toBe("./dist/index.js");
  });

  it("uses the invoked binary name for help output", () => {
    expect(inferProgramName("/usr/local/bin/runstead")).toBe("runstead");
    expect(inferProgramName("/usr/local/bin/team")).toBe("team");
    expect(createProgram({ entrypoint: "/usr/local/bin/team" }).name()).toBe("team");
  });

  it("exposes domain pack manifest generation", () => {
    const domain = createProgram().commands.find(
      (command) => command.name() === "domain"
    );

    expect(domain?.commands.map((command) => command.name())).toEqual(
      expect.arrayContaining(["manifest"])
    );
  });
});
