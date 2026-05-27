export type AgentInspectPresetId = "inspect:smoke" | "inspect:standard";

export function localAgentInspectPresetId(value: string): AgentInspectPresetId {
  if (value === "smoke") {
    return "inspect:smoke";
  }
  if (value === "standard") {
    return "inspect:standard";
  }

  throw new Error("--depth must be smoke or standard");
}
