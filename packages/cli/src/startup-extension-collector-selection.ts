import type { ReadinessEvidenceRequirement, ReadinessTarget } from "@runstead/runtime";

import { normalizeStartupExtensionEvidenceType } from "./startup-extension-collector-evidence.js";
import type { StartupExtensionCollectorInput } from "./startup-extension-collector-types.js";
import type { LoadedStartupReadinessExtension } from "./startup-extension-loader.js";

export function startupExtensionCollectorsForTarget(input: {
  extensions: LoadedStartupReadinessExtension[];
  requirements: ReadinessEvidenceRequirement[];
  target: ReadinessTarget;
}): StartupExtensionCollectorInput[] {
  const requiredTypes = new Set(
    input.requirements
      .filter((requirement) => requirement.targets.includes(input.target))
      .flatMap((requirement) =>
        requirement.evidenceTypes.map(normalizeStartupExtensionEvidenceType)
      )
  );

  return input.extensions.flatMap((extension) =>
    extension.contract.collectors
      .filter(
        (collector) =>
          collector.targets.includes(input.target) &&
          collector.producesEvidenceTypes
            .map(normalizeStartupExtensionEvidenceType)
            .some((type) => requiredTypes.has(type))
      )
      .map((collector) => ({ extension, collector }))
  );
}
