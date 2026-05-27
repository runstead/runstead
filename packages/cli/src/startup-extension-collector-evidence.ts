import type { ReadinessTarget } from "@runstead/runtime";
import {
  validateRunsteadCollectorOutput,
  type RunsteadEvidenceCollector
} from "@runstead/sdk";

import { addStartupEvidence, type StartupGateStage } from "./startup-evidence.js";
import {
  collectorEvidenceContent,
  collectorEvidenceSources,
  normalizeStartupExtensionEvidenceType,
  parseCollectorEvidenceItems,
  stringValue
} from "./startup-extension-collector-evidence-payload.js";
import type { LoadedStartupReadinessExtension } from "./startup-extension-loader.js";

export { normalizeStartupExtensionEvidenceType } from "./startup-extension-collector-evidence-payload.js";

export async function recordExtensionCollectorEvidence(input: {
  cwd: string;
  target: ReadinessTarget;
  stage: StartupGateStage;
  extension: LoadedStartupReadinessExtension;
  collector: RunsteadEvidenceCollector;
  stdout: string;
  now?: Date;
}): Promise<string[]> {
  const items = parseCollectorEvidenceItems(input.stdout);
  const evidenceIds: string[] = [];

  for (const item of items) {
    const type = normalizeStartupExtensionEvidenceType(
      stringValue(item.type) ?? stringValue(item.evidenceType) ?? ""
    );
    const produced = new Set(
      input.collector.producesEvidenceTypes.map(normalizeStartupExtensionEvidenceType)
    );

    if (!produced.has(type)) {
      throw new Error(
        `collector produced ${type || "unknown"} but declares ${input.collector.producesEvidenceTypes.join(", ")}`
      );
    }

    const outputValidation = validateRunsteadCollectorOutput(input.collector, item);

    if (!outputValidation.valid) {
      throw new Error(
        `collector output failed outputSchema validation: ${outputValidation.issues.join("; ")}`
      );
    }

    const content = collectorEvidenceContent({
      item,
      target: input.target,
      extensionId: input.extension.contract.extensionId,
      collector: input.collector
    });
    const result = await addStartupEvidence({
      cwd: input.cwd,
      type,
      summary:
        stringValue(item.summary) ??
        `Extension ${input.extension.contract.extensionId}/${input.collector.id} evidence`,
      content: JSON.stringify(content),
      sourceRefs: [
        `extension:${input.extension.contract.extensionId}/${input.collector.id}`
      ],
      sources: collectorEvidenceSources({
        item,
        extensionId: input.extension.contract.extensionId,
        collector: input.collector,
        ...(input.now === undefined ? {} : { now: input.now })
      }),
      gate: input.stage,
      ...(input.now === undefined ? {} : { now: input.now })
    });

    evidenceIds.push(result.evidence.id);
  }

  if (evidenceIds.length === 0) {
    throw new Error("collector stdout did not contain evidence records");
  }

  return evidenceIds;
}
