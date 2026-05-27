export type AgentReportOutputFormat = "text" | "json" | "markdown";

export interface AgentReportOutputOptions {
  json?: boolean;
  markdown?: boolean;
}

export interface AgentReportOutputRenderers {
  text(): string;
  json(): string;
  markdown(): string;
}

export function agentReportOutputFormat(
  options: AgentReportOutputOptions
): AgentReportOutputFormat {
  if (options.json === true && options.markdown === true) {
    throw new Error("agent report accepts only one of --json or --markdown");
  }

  if (options.json === true) {
    return "json";
  }

  return options.markdown === true ? "markdown" : "text";
}

export function formatAgentReportOutput(
  format: AgentReportOutputFormat,
  renderers: AgentReportOutputRenderers
): string {
  switch (format) {
    case "json":
      return renderers.json().trimEnd();
    case "markdown":
      return renderers.markdown();
    case "text":
      return renderers.text();
  }
}
