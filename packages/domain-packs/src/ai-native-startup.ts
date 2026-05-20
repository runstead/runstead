import { fileURLToPath } from "node:url";

import type { DomainPack } from "./domain-pack.js";

export const aiNativeStartupPack = {
  id: "ai-native-startup",
  version: "0.1.0",
  name: "AI-native Startup",
  description:
    "Govern AI-coded MVP work with startup-specific context, measurement, readiness, and verifier evidence.",
  compatibility: {
    runsteadMinVersion: "0.0.0"
  },
  goalTemplates: ["build-mvp", "scale-ops"],
  taskTypes: [
    "generate_agent_context",
    "define_measurement_framework",
    "inspect_repo_readiness",
    "run_mvp_verifiers",
    "map_founder_bottlenecks",
    "register_workflow_automation",
    "generate_ops_sops",
    "triage_support_evidence",
    "verify_gtm_artifacts"
  ],
  defaultPolicy: "policies/startup-mvp.yaml",
  defaultVerifiers: [
    "startup_context",
    "measurement_framework",
    "repo_readiness",
    "command"
  ],
  requiredTools: ["filesystem", "shell", "git"],
  supportedWorkers: ["shell", "claude_code", "codex_cli", "codex_direct"]
} satisfies DomainPack;

export function getAiNativeStartupPackDir(): string {
  return fileURLToPath(new URL("../packs/ai-native-startup", import.meta.url));
}
