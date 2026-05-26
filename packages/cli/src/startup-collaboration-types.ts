export interface GenerateStartupCollaborationDigestOptions {
  cwd?: string;
  owner?: string;
  reviewer?: string;
  notify?: string[];
  expiryWindowDays?: number;
  now?: Date;
}

export interface StartupCollaborationDigestResult {
  root: string;
  stateDb: string;
  files: string[];
  jsonPath: string;
  evidenceId: string;
  pendingApprovals: StartupCollaborationApproval[];
  riskAcceptances: StartupRiskAcceptance[];
  expiryReminders: string[];
  notifications: string[];
}

export interface StartupCollaborationApproval {
  id: string;
  status: string;
  risk: string;
  reason: string;
  actionId: string;
  requestedBy: string;
  expiresAt?: string;
  decidedBy?: string;
}

export interface StartupRiskAcceptance {
  evidenceId: string;
  gate: string;
  decision: string;
  reason: string;
  owner: string;
  blocker?: string;
  expiresAt?: string;
  comment?: string;
}
