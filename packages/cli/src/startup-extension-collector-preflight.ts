import type {
  StartupExtensionCollectorExecutionResult,
  StartupExtensionCollectorInput
} from "./startup-extension-collector-types.js";

export function startupExtensionCollectorPreflight(
  input: StartupExtensionCollectorInput,
  env: NodeJS.ProcessEnv = process.env
): StartupExtensionCollectorExecutionResult | undefined {
  const { extension, collector } = input;
  const missingSecrets = collector.requiredSecrets.filter(
    (secret) => env[secret] === undefined || env[secret] === ""
  );

  if (missingSecrets.length > 0) {
    return {
      extensionId: extension.contract.extensionId,
      collectorId: collector.id,
      status: "blocked",
      ...(collector.command === undefined ? {} : { command: collector.command }),
      evidenceIds: [],
      blockers: [
        `extension ${extension.contract.extensionId}/${collector.id} requires secrets: ${missingSecrets.join(", ")}`
      ],
      warnings: []
    };
  }

  if (collector.command === undefined) {
    return {
      extensionId: extension.contract.extensionId,
      collectorId: collector.id,
      status: "skipped",
      evidenceIds: [],
      blockers: [],
      warnings: [
        `extension ${extension.contract.extensionId}/${collector.id} has no command execution contract`
      ]
    };
  }

  return undefined;
}
