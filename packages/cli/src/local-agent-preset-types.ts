export type LocalAgentPresetMode = "read-only" | "edit" | "repair";
export type LocalAgentVerifierPolicy = "none" | "optional" | "required" | "auto";

export interface LocalAgentPresetInput {
  prompt?: string;
  verifierNames?: string[];
}

export interface LocalAgentPreset {
  id: string;
  mode: LocalAgentPresetMode;
  maxTurns: number;
  maxToolCalls: number;
  maxFailedToolCalls: number;
  checkpoint: boolean;
  verifierPolicy: LocalAgentVerifierPolicy;
  promptTemplate(input: LocalAgentPresetInput): string;
}
