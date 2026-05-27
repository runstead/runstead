import type { RunsteadEvidenceCollector } from "@runstead/sdk";

import type { LoadedStartupReadinessExtension } from "./startup-extension-loader.js";

export interface StartupExtensionCollectorExecutionResult {
  extensionId: string;
  collectorId: string;
  status: "passed" | "blocked" | "skipped";
  command?: string;
  evidenceIds: string[];
  blockers: string[];
  warnings: string[];
}

export interface StartupExtensionCollectorInput {
  extension: LoadedStartupReadinessExtension;
  collector: RunsteadEvidenceCollector;
}
