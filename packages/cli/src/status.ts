import { constants } from "node:fs";
import { access, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";

export interface RunsteadStatus {
  initialized: boolean;
  root: string;
  domain?: string;
}

export async function getRunsteadStatus(cwd = process.cwd()): Promise<RunsteadStatus> {
  const root = join(resolve(cwd), ".runstead");
  const configPath = join(root, "config.yaml");

  try {
    await access(configPath, constants.R_OK);
  } catch {
    return {
      initialized: false,
      root
    };
  }

  const config = await readFile(configPath, "utf8");
  const domain = /^domain:\s*(?<domain>[^\n]+)$/m.exec(config)?.groups?.domain;

  const status: RunsteadStatus = {
    initialized: true,
    root
  };

  if (domain !== undefined) {
    status.domain = domain;
  }

  return status;
}
