import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import { formatGtmVerification } from "./startup-automation-format.js";
import type {
  VerifyGtmArtifactsOptions,
  VerifyGtmArtifactsResult
} from "./startup-automation-types.js";
import { writeStartupStructuredArtifact } from "./startup-artifacts.js";
import { addStartupEvidence } from "./startup-evidence.js";
import { requireRunsteadStateDb } from "./runstead-root.js";

export async function verifyGtmArtifacts(
  options: VerifyGtmArtifactsOptions = {}
): Promise<VerifyGtmArtifactsResult> {
  const cwd = resolve(options.cwd ?? process.cwd());
  const state = await requireRunsteadStateDb(cwd);
  const generatedAt = (options.now ?? new Date()).toISOString();
  const claims =
    options.claims === undefined || options.claims.length === 0
      ? ["No GTM claim input recorded; verify launch promises before publishing."]
      : options.claims;
  const markdown = formatGtmVerification({
    generatedAt,
    claims,
    evidenceRefs: options.evidenceRefs ?? [],
    productState: options.productState ?? "unrecorded"
  });

  await mkdir(join(state.root, "startup"), { recursive: true });

  const runtimePath = join(state.root, "startup", "gtm-artifacts.md");

  await writeFile(runtimePath, markdown, "utf8");
  const structuredFiles = [
    await writeStartupStructuredArtifact({
      kind: "startup_gtm_artifact",
      generatedAt,
      markdownPath: runtimePath,
      data: {
        claims,
        evidenceRefs: options.evidenceRefs ?? [],
        productState: options.productState ?? "unrecorded"
      }
    })
  ];

  const evidence = await addStartupEvidence({
    cwd,
    type: "gtm_artifact",
    summary: `GTM artifacts verified (${claims.length} claim${claims.length === 1 ? "" : "s"})`,
    sourceRefs: [runtimePath, ...structuredFiles, ...(options.evidenceRefs ?? [])],
    content: JSON.stringify(
      {
        markdown,
        claims,
        evidenceRefs: options.evidenceRefs ?? [],
        productState: options.productState ?? "unrecorded"
      },
      null,
      2
    ),
    ...(options.now === undefined ? {} : { now: options.now })
  });

  return {
    root: state.root,
    stateDb: state.stateDb,
    files: [runtimePath],
    structuredFiles,
    evidenceId: evidence.evidence.id,
    claims
  };
}
