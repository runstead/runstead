import type { StartupGateStage, addStartupEvidence } from "../startup-evidence.js";

export interface LocalReadinessEvidenceInput {
  cwd: string;
  type: string;
  summary: string;
  sourceRefs: string[];
  sources: Parameters<typeof addStartupEvidence>[0]["sources"];
  content: Record<string, unknown>;
  gate: StartupGateStage;
  owner?: string;
  remediationTask?: string;
  acceptanceCriteria?: string;
  now: Date;
  force?: boolean;
}
