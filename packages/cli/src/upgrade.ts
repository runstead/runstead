import { resolve } from "node:path";

import type { DoctorCheck } from "./doctor.js";
import { doctorRunstead } from "./doctor.js";
import { initRunstead } from "./init.js";
import { resolveRunsteadRoot } from "./runstead-root.js";

export interface UpgradeRunsteadStateOptions {
  cwd?: string;
}

export interface UpgradeRunsteadStateResult {
  root: string;
  stateDb: string;
  checks: DoctorCheck[];
}

export async function upgradeRunsteadState(
  options: UpgradeRunsteadStateOptions = {}
): Promise<UpgradeRunsteadStateResult> {
  const cwd = resolve(options.cwd ?? process.cwd());
  const resolved = await resolveRunsteadRoot(cwd);

  if (resolved.source === "missing") {
    throw new Error(`Runstead is not initialized at ${resolved.root}. Run init first.`);
  }

  if (resolved.source === "team") {
    throw new Error(
      "Runstead upgrade requires .runstead state. Run migrate .team .runstead first."
    );
  }

  const initialized = await initRunstead({ cwd });
  const doctor = await doctorRunstead({ cwd });

  if (!doctor.ok) {
    const failed = doctor.checks
      .filter((check) => check.status === "fail")
      .map((check) => check.id)
      .join(", ");

    throw new Error(`Runstead upgrade left an unhealthy state: ${failed}`);
  }

  return {
    root: initialized.root,
    stateDb: initialized.stateDb,
    checks: doctor.checks
  };
}

export function formatUpgradeRunsteadReport(
  result: UpgradeRunsteadStateResult
): string {
  return [
    `Upgraded ${result.root}`,
    `State: ${result.stateDb}`,
    `Checks: ${result.checks.length} passed`
  ].join("\n");
}
