export interface GenerateStartupLaunchGitSummaryOptions {
  cwd?: string;
  remote?: string;
  now?: Date;
}

export interface GenerateStartupLaunchGitSummaryResult {
  root: string;
  stateDb: string;
  markdownPath: string;
  jsonPath: string;
  evidenceId: string;
  summary: StartupLaunchGitSummary;
  nextCommands: string[];
}

export interface StartupLaunchGitSummary {
  generatedAt: string;
  isGitRepo: boolean;
  branch?: string;
  headSha?: string;
  upstream?: string;
  ahead?: number;
  behind?: number;
  changedFiles: string[];
  stagedFiles: string[];
  untrackedFiles: string[];
  remote: {
    name: string;
    detected: boolean;
    url?: string;
    github?: {
      owner: string;
      repo: string;
    };
  };
  ciDetected: boolean;
  ciProviders: string[];
  suggestedCommitMessage: string;
  recommendedBranch: string;
  launchActions: string[];
}
