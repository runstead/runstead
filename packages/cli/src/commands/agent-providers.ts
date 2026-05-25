import type { Command } from "commander";

interface AgentProvidersCliOptions {
  json?: boolean;
}

export function registerAgentProvidersCommand(command: Command): void {
  command
    .command("providers")
    .description("List model providers available to codex_direct local agents.")
    .option("--json", "Print provider metadata as JSON")
    .action(async (options: AgentProvidersCliOptions) => {
      const { listModelProviderProfiles } = await import("../model-provider.js");
      const providers = listModelProviderProfiles().map((profile) => ({
        id: profile.id,
        displayName: profile.displayName,
        apiMode: profile.apiMode,
        aliases: profile.aliases ?? [],
        baseUrl: profile.defaultBaseUrl ?? null,
        env: profile.envVars
      }));

      if (options.json === true) {
        console.log(JSON.stringify(providers, null, 2));
        return;
      }

      console.log(
        [
          "Supported model providers:",
          ...providers.map((provider) =>
            [
              `- ${provider.id} (${provider.displayName})`,
              `  mode: ${provider.apiMode}`,
              `  base URL: ${provider.baseUrl ?? "configure model.baseUrl or pass --base-url"}`,
              `  API key env: ${provider.env.length === 0 ? "runstead codex login" : provider.env.join(", ")}`,
              ...(provider.aliases.length === 0
                ? []
                : [`  aliases: ${provider.aliases.join(", ")}`])
            ].join("\n")
          )
        ].join("\n")
      );
    });
}
