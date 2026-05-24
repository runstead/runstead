import { z } from "zod";

export const STANDARD_VERIFIER_NAMES = ["test", "lint", "typecheck", "build"] as const;

export type StandardVerifierName = (typeof STANDARD_VERIFIER_NAMES)[number];

export const CommandVerifierInputSchema = z.object({
  name: z.string().trim().min(1),
  command: z.string().trim().min(1)
});

export type CommandVerifierInput = z.infer<typeof CommandVerifierInputSchema>;

export interface CommandVerifierResult {
  verifier: string;
  exitCode: number | null;
  timedOut: boolean;
  forceKilled: boolean;
  evidenceId: string;
  policyDecisionId?: string;
  approvalId?: string;
}

export function defineCommandVerifier(
  input: CommandVerifierInput
): CommandVerifierInput {
  return CommandVerifierInputSchema.parse(input);
}

export function isStandardVerifierName(name: string): name is StandardVerifierName {
  return STANDARD_VERIFIER_NAMES.includes(name as StandardVerifierName);
}

export function commandVerifierResultPassed(result: CommandVerifierResult): boolean {
  return result.exitCode === 0 && result.timedOut === false && result.forceKilled === false;
}

export function commandVerifierResultsPassed(
  results: CommandVerifierResult[]
): boolean {
  return results.length > 0 && results.every(commandVerifierResultPassed);
}
