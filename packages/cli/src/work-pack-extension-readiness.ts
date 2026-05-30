import type { WorkPackComponent } from "@runstead/domain-packs";

import {
  loadStartupReadinessExtensions,
  type LoadedStartupReadinessExtension
} from "./startup-extension-loader.js";

export type WorkPackExtensionReadinessStatus =
  | "ready"
  | "missing"
  | "missing_secrets"
  | "contract_only";

export interface WorkPackExtensionReadiness {
  extension: string;
  status: WorkPackExtensionReadinessStatus;
  path?: string;
  domains: string[];
  collectors: string[];
  verifiers: string[];
  gates: string[];
  requiredSecrets: string[];
  missingSecrets: string[];
  requiredEvidenceTypes: string[];
  reason: string;
}

export interface WorkPackExtensionReadinessReport {
  root: string;
  discoveredPaths: string[];
  issues: string[];
  readiness: WorkPackExtensionReadiness[];
}

export async function evaluateWorkPackExtensionReadiness(input: {
  cwd: string;
  domain: string;
  components?: WorkPackComponent[];
  env?: Record<string, string | undefined>;
}): Promise<WorkPackExtensionReadinessReport> {
  const loaded = await loadStartupReadinessExtensions({
    cwd: input.cwd,
    domain: input.domain
  });
  const readiness = loaded.extensions.map((extension) =>
    extensionReadiness(extension, input.env ?? process.env)
  );
  const loadedIds = new Set(readiness.map((extension) => extension.extension));
  const missingDeclaredExtensions = (input.components ?? [])
    .filter((component) => component.kind === "extension")
    .filter((component) => !loadedIds.has(component.id))
    .map((component) => missingExtensionReadiness(component));

  return {
    root: loaded.root,
    discoveredPaths: loaded.discoveredPaths,
    issues: loaded.issues,
    readiness: [...readiness, ...missingDeclaredExtensions]
  };
}

function extensionReadiness(
  extension: LoadedStartupReadinessExtension,
  env: Record<string, string | undefined>
): WorkPackExtensionReadiness {
  const { contract } = extension;
  const missingSecrets = contract.requiredSecrets.filter(
    (name) => !hasCredential(env[name])
  );
  const executableCollectors = contract.collectors.filter(
    (collector) => collector.command !== undefined
  );
  const hasExecutableSurface =
    executableCollectors.length > 0 || contract.verifiers.length > 0;

  if (!hasExecutableSurface) {
    return {
      extension: contract.extensionId,
      status: "contract_only",
      path: extension.path,
      domains: [...contract.domains],
      collectors: contract.collectors.map((collector) => collector.id),
      verifiers: contract.verifiers.map((verifier) => verifier.id),
      gates: contract.gates.map((gate) => gate.id),
      requiredSecrets: [...contract.requiredSecrets],
      missingSecrets,
      requiredEvidenceTypes: [...contract.requiredEvidenceTypes],
      reason:
        "extension contract exists, but no executable collector command or verifier is registered"
    };
  }

  if (missingSecrets.length > 0) {
    return {
      extension: contract.extensionId,
      status: "missing_secrets",
      path: extension.path,
      domains: [...contract.domains],
      collectors: contract.collectors.map((collector) => collector.id),
      verifiers: contract.verifiers.map((verifier) => verifier.id),
      gates: contract.gates.map((gate) => gate.id),
      requiredSecrets: [...contract.requiredSecrets],
      missingSecrets,
      requiredEvidenceTypes: [...contract.requiredEvidenceTypes],
      reason: `missing extension secret env ${missingSecrets.join(", ")}`
    };
  }

  return {
    extension: contract.extensionId,
    status: "ready",
    path: extension.path,
    domains: [...contract.domains],
    collectors: contract.collectors.map((collector) => collector.id),
    verifiers: contract.verifiers.map((verifier) => verifier.id),
    gates: contract.gates.map((gate) => gate.id),
    requiredSecrets: [...contract.requiredSecrets],
    missingSecrets: [],
    requiredEvidenceTypes: [...contract.requiredEvidenceTypes],
    reason: "extension contract has executable collectors or verifiers"
  };
}

function missingExtensionReadiness(
  component: WorkPackComponent
): WorkPackExtensionReadiness {
  return {
    extension: component.id,
    status: "missing",
    domains: [],
    collectors: [],
    verifiers: [],
    gates: [],
    requiredSecrets: [],
    missingSecrets: [],
    requiredEvidenceTypes: [],
    reason: "work pack declares this extension, but no workspace manifest is loaded"
  };
}

function hasCredential(value: string | undefined): boolean {
  return value !== undefined && value.trim().length > 0;
}
