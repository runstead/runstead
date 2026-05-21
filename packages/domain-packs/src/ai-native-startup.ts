import { fileURLToPath } from "node:url";

import type { DomainPack } from "./domain-pack.js";

export const aiNativeStartupPack = {
  id: "ai-native-startup",
  schemaVersion: 1,
  version: "0.1.0",
  name: "AI-native Startup",
  description:
    "Govern AI-coded MVP work with startup-specific context, measurement, readiness, and verifier evidence.",
  compatibility: {
    runsteadMinVersion: "0.0.0"
  },
  goalTemplates: ["validate-problem", "build-mvp", "scale-ops"],
  taskTypes: [
    "collect_customer_evidence",
    "check_disconfirming_evidence",
    "run_build_gate",
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
  supportedWorkers: ["shell", "claude_code", "codex_cli", "codex_direct"],
  migrations: [
    {
      fromVersion: "0.0.0",
      toVersion: "0.1.0",
      description:
        "Install initial startup lifecycle tasks, security policy, fixtures, and launch readiness evidence contracts.",
      steps: [
        "Install the ai-native-startup domain pack into .runstead/domains.",
        "Generate startup context, measurement framework, repo readiness, and security baseline evidence.",
        "Run launch readiness report once evidence is recorded."
      ]
    }
  ],
  repoTemplates: [
    {
      id: "saas",
      label: "AI-coded SaaS",
      description:
        "Auth, database, billing, analytics, support, deployment, and launch gates.",
      requiredSignals: [
        "auth",
        "database",
        "billing",
        "analytics",
        "support",
        "deployment"
      ]
    },
    {
      id: "chrome-extension",
      label: "Chrome Extension",
      description:
        "Extension manifest, permissions, store review, privacy notes, and release rollback.",
      requiredSignals: ["manifest", "permissions", "privacy", "store_review"]
    },
    {
      id: "api-service",
      label: "API Service",
      description:
        "HTTP surface, schema contract, auth, rate limits, observability, and rollback.",
      requiredSignals: ["api_contract", "auth", "rate_limit", "observability"]
    },
    {
      id: "landing-waitlist",
      label: "Landing + Waitlist",
      description:
        "Public claim evidence, waitlist funnel, consent, analytics, and launch copy gates.",
      requiredSignals: ["gtm_claims", "waitlist", "consent", "analytics"]
    }
  ],
  gateThresholds: {
    mvp: {
      maxCriticalBlockers: 0,
      maxMajorBlockers: 1,
      minimumEvidenceCompleteness: 0.7,
      minimumReportQuality: 0.7
    },
    launch: {
      maxCriticalBlockers: 0,
      maxMajorBlockers: 0,
      minimumEvidenceCompleteness: 0.9,
      minimumReportQuality: 0.85
    },
    scale: {
      maxCriticalBlockers: 0,
      maxMajorBlockers: 0,
      minimumEvidenceCompleteness: 0.95,
      minimumReportQuality: 0.9
    }
  },
  reportSections: [
    {
      id: "repo-readiness",
      title: "Repository Readiness",
      description: "Scripts, CI, verifier evidence, and protected path review.",
      evidenceTypes: ["startup_repo_readiness", "command_output"]
    },
    {
      id: "measurement",
      title: "Measurement Readiness",
      description: "Activation, retention, false-positive, cohort, and trend signals.",
      evidenceTypes: ["startup_measurement_framework", "startup_metric_snapshot"]
    },
    {
      id: "security-launch-risk",
      title: "Security And Launch Risk",
      description:
        "Secrets, dependencies, license, rollback, privacy, and third-party integration risk.",
      evidenceTypes: ["startup_security_baseline", "startup_rollback_plan"]
    }
  ],
  evalQuality: {
    minimumScore: 0.85,
    requiredContracts: [
      "verifier_report_recorded",
      "launch_readiness_report_ready",
      "scale_gate_passed"
    ]
  }
} satisfies DomainPack;

export function getAiNativeStartupPackDir(): string {
  return fileURLToPath(new URL("../packs/ai-native-startup", import.meta.url));
}
