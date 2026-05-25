import { parsePositiveInteger } from "./startup-command-parsers.js";
import type { StartupEvidenceSourceInput } from "./startup-evidence.js";

export interface StartupEvidenceSourceOptions {
  sourceUri?: string;
  sourceKind?: string;
  capturedAt?: string;
  freshnessDays?: string;
  sourceHash?: string;
}

export function evidenceSourceDetails(options: StartupEvidenceSourceOptions): {
  sources?: StartupEvidenceSourceInput[];
} {
  const hasSourceDetail =
    options.sourceUri !== undefined ||
    options.sourceKind !== undefined ||
    options.capturedAt !== undefined ||
    options.freshnessDays !== undefined ||
    options.sourceHash !== undefined;

  if (!hasSourceDetail) {
    return {};
  }

  if (options.sourceUri === undefined) {
    throw new Error("--source-uri is required when source detail options are used");
  }

  return {
    sources: [
      {
        uri: options.sourceUri,
        ...(options.sourceKind === undefined ? {} : { kind: options.sourceKind }),
        ...(options.capturedAt === undefined ? {} : { capturedAt: options.capturedAt }),
        ...(options.freshnessDays === undefined
          ? {}
          : {
              freshnessDays: parsePositiveInteger(
                options.freshnessDays,
                "--freshness-days"
              )
            }),
        ...(options.sourceHash === undefined ? {} : { hash: options.sourceHash })
      }
    ]
  };
}
