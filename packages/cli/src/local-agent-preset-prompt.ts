import type { LocalAgentPresetInput } from "./local-agent-preset-types.js";

export function structuredPresetPrompt(input: {
  id: string;
  purpose: string;
  focus: string | undefined;
  requiredPlan: string[];
  stopRules: string[];
  outputContract: string[];
}): string {
  return [
    `Task preset: ${input.id}`,
    `Purpose: ${input.purpose}`,
    ...optionalFocus(input.focus),
    "",
    "Required plan:",
    ...numbered(input.requiredPlan),
    "",
    "Stop rules:",
    ...bulleted(input.stopRules),
    "",
    "Output contract:",
    ...bulleted(input.outputContract)
  ].join("\n");
}

export function verifierFocus(input: LocalAgentPresetInput): string | undefined {
  const parts = [
    ...(input.verifierNames === undefined || input.verifierNames.length === 0
      ? []
      : [`Configured verifiers: ${input.verifierNames.join(", ")}`]),
    ...(input.prompt === undefined || input.prompt.trim().length === 0
      ? []
      : [input.prompt.trim()])
  ];

  return parts.length === 0 ? undefined : parts.join("\n");
}

function optionalFocus(focus: string | undefined): string[] {
  return focus === undefined || focus.trim().length === 0
    ? []
    : ["", "User focus:", focus.trim()];
}

function numbered(items: string[]): string[] {
  return items.map((item, index) => `${index + 1}. ${item}`);
}

function bulleted(items: string[]): string[] {
  return items.map((item) => `- ${item}`);
}
