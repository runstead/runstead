import { describe, expect, it } from "vitest";

import { startupExtensionCollectorPreflight } from "./startup-extension-collector-preflight.js";
import type { StartupExtensionCollectorInput } from "./startup-extension-collector-types.js";

describe("startup extension collector preflight", () => {
  it("blocks collectors when required secrets are missing", () => {
    expect(
      startupExtensionCollectorPreflight(
        collectorInput({
          command: "node scripts/collector.mjs",
          requiredSecrets: ["POSTHOG_API_KEY", "POSTHOG_PROJECT_ID"]
        }),
        { POSTHOG_API_KEY: "set", POSTHOG_PROJECT_ID: "" }
      )
    ).toEqual({
      extensionId: "growth-readiness",
      collectorId: "activation-local",
      status: "blocked",
      command: "node scripts/collector.mjs",
      evidenceIds: [],
      blockers: [
        "extension growth-readiness/activation-local requires secrets: POSTHOG_PROJECT_ID"
      ],
      warnings: []
    });
  });

  it("skips collectors without a command execution contract", () => {
    expect(
      startupExtensionCollectorPreflight(
        collectorInput({
          requiredSecrets: []
        }),
        {}
      )
    ).toEqual({
      extensionId: "growth-readiness",
      collectorId: "activation-local",
      status: "skipped",
      evidenceIds: [],
      blockers: [],
      warnings: [
        "extension growth-readiness/activation-local has no command execution contract"
      ]
    });
  });
});

function collectorInput(options: {
  command?: string;
  requiredSecrets: string[];
}): StartupExtensionCollectorInput {
  return {
    extension: {
      path: ".runstead/extensions/growth-readiness.yaml",
      contract: {
        extensionId: "growth-readiness"
      }
    },
    collector: {
      id: "activation-local",
      requiredSecrets: options.requiredSecrets,
      ...(options.command === undefined ? {} : { command: options.command })
    }
  } as StartupExtensionCollectorInput;
}
