import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import { formatOpsSops } from "./startup-automation-format.js";
import type {
  GenerateOpsSopsOptions,
  GenerateOpsSopsResult
} from "./startup-automation-types.js";
import { writeStartupStructuredArtifact } from "./startup-artifacts.js";
import { addStartupEvidence } from "./startup-evidence.js";
import { requireRunsteadStateDb } from "./runstead-root.js";

export async function generateOpsSops(
  options: GenerateOpsSopsOptions = {}
): Promise<GenerateOpsSopsResult> {
  const cwd = resolve(options.cwd ?? process.cwd());
  const state = await requireRunsteadStateDb(cwd);
  const generatedAt = (options.now ?? new Date()).toISOString();
  const sops =
    options.sops === undefined || options.sops.length === 0
      ? ["No SOP input recorded; define recurring operation steps before handoff."]
      : options.sops;
  const markdown = formatOpsSops({
    generatedAt,
    sops,
    owner: options.owner ?? "unassigned",
    workflow: options.workflow ?? "unassigned"
  });

  await mkdir(join(state.root, "startup"), { recursive: true });

  const runtimePath = join(state.root, "startup", "ops-sops.md");

  await writeFile(runtimePath, markdown, "utf8");
  const structuredFiles = [
    await writeStartupStructuredArtifact({
      kind: "startup_ops_sop",
      generatedAt,
      markdownPath: runtimePath,
      data: {
        sops,
        owner: options.owner ?? "unassigned",
        workflow: options.workflow ?? "unassigned"
      }
    })
  ];

  const evidence = await addStartupEvidence({
    cwd,
    type: "ops_sop",
    summary: `Ops SOPs generated (${sops.length} SOP${sops.length === 1 ? "" : "s"})`,
    sourceRefs: [runtimePath, ...structuredFiles],
    content: markdown,
    ...(options.now === undefined ? {} : { now: options.now })
  });

  return {
    root: state.root,
    stateDb: state.stateDb,
    files: [runtimePath],
    structuredFiles,
    evidenceId: evidence.evidence.id,
    sops
  };
}
