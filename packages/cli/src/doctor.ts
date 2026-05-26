import { join } from "node:path";

import { getCodexAuthStatus } from "./codex-auth.js";
import { resolveCodexModel } from "./codex-model.js";
import { checkRuntimeBackend, checkStateDatabase } from "./doctor-runtime-checks.js";
import {
  checkNodeRuntime,
  errorMessage,
  fail,
  pass,
  type DoctorCheck,
  type DoctorResult,
  type DoctorRunsteadOptions
} from "./doctor-types.js";
import {
  checkDaemonHeartbeat,
  checkDirectory,
  checkDomainPackValidation,
  checkGitHubAppConfig,
  checkInstalledDomainPackManifests,
  checkPolicyValidation,
  checkRbacPolicy,
  checkReadableFile,
  checkRuntimeArtifactsIgnored,
  checkTeamPolicy
} from "./doctor-workspace-checks.js";
import {
  claudeCodeWorkerAction,
  codexCliWorkerAction,
  codexDirectWorkerAction,
  codexModelInferenceAction,
  modelProviderApiKeyOptional,
  modelProviderResourceId
} from "./doctor-worker-helpers.js";
import {
  checkClaudeCodeBinary,
  checkClaudeCodePrintProbe,
  checkCodexCliBinary,
  checkCodexCliExecProbe
} from "./doctor-worker-probes.js";
import { resolveModelProvider, type ResolvedModelProvider } from "./model-provider.js";
import { loadPolicyProfileFromFile } from "./policy-loader.js";
import { evaluatePolicy } from "./policy.js";
import { resolveRunsteadRoot } from "./runstead-root.js";
import { runWorkerProcess } from "./wrapped-worker.js";

export type {
  DoctorCheck,
  DoctorCheckStatus,
  DoctorResult,
  DoctorRunsteadOptions
} from "./doctor-types.js";

export async function doctorRunstead(
  options: DoctorRunsteadOptions = {}
): Promise<DoctorResult> {
  const resolvedRoot = await resolveRunsteadRoot(options.cwd);
  const root = resolvedRoot.root;
  const cwd = resolvedRoot.cwd;
  const checks: DoctorCheck[] = [];

  checks.push(checkNodeRuntime(options.nodeVersion ?? process.version));
  checks.push(
    await checkReadableFile("config", "config.yaml", join(root, "config.yaml"))
  );
  checks.push(
    await checkReadableFile(
      "domain-pack",
      "repo-maintenance domain pack",
      join(root, "domains", "repo-maintenance", "domain.yaml")
    )
  );
  checks.push(
    await checkDomainPackValidation(join(root, "domains", "repo-maintenance"))
  );
  checks.push(await checkInstalledDomainPackManifests(root));
  checks.push(
    await checkReadableFile(
      "policy",
      "repo-maintenance policy",
      join(root, "policies", "repo-maintenance.yaml")
    )
  );
  checks.push(
    await checkPolicyValidation(join(root, "policies", "repo-maintenance.yaml"))
  );
  checks.push(await checkRbacPolicy(cwd));
  checks.push(await checkTeamPolicy(cwd));
  checks.push(await checkGitHubAppConfig(cwd, root));
  checks.push(
    await checkDirectory("evidence-dir", "evidence directory", join(root, "evidence"))
  );
  checks.push(await checkDirectory("logs-dir", "logs directory", join(root, "logs")));
  checks.push(
    await checkDirectory(
      "checkpoints-dir",
      "checkpoints directory",
      join(root, "checkpoints")
    )
  );
  checks.push(
    await checkDirectory("daemon-dir", "daemon status directory", join(root, "daemon"))
  );
  checks.push(await checkDaemonHeartbeat(root));
  checks.push(
    await checkDirectory("reports-dir", "reports directory", join(root, "reports"))
  );
  checks.push(await checkStateDatabase(join(root, "state.db")));
  checks.push(
    checkRuntimeBackend(root, options.runtimeBackendEnv ?? process.env, {
      ...(options.runtimeBackendNow === undefined
        ? {}
        : { now: options.runtimeBackendNow })
    })
  );

  if (options.codex === true) {
    checks.push(checkRunsteadInitialized(resolvedRoot));

    const worker = options.worker ?? "codex_direct";
    const wrappedWorkerProbeRunner =
      options.wrappedWorkerProbeRunner ??
      options.codexCliProbeRunner ??
      runWorkerProcess;

    if (worker === "codex_cli") {
      checks.push(await checkCodexCliPolicy(root));
      checks.push(await checkCodexCliBinary(cwd, wrappedWorkerProbeRunner));
      checks.push(
        await checkCodexCliExecProbe({
          cwd,
          ...(options.model === undefined ? {} : { model: options.model }),
          runner: wrappedWorkerProbeRunner
        })
      );
    } else if (worker === "claude_code") {
      checks.push(await checkClaudeCodePolicy(root));
      checks.push(await checkClaudeCodeBinary(cwd, wrappedWorkerProbeRunner));
      checks.push(
        await checkClaudeCodePrintProbe({
          cwd,
          ...(options.model === undefined ? {} : { model: options.model }),
          runner: wrappedWorkerProbeRunner
        })
      );
    } else {
      const modelProvider = await checkModelProviderSelection(
        cwd,
        options.codexModelResolver,
        options.modelProviderEnv
      );

      checks.push(
        await checkTrustedLocalCodexPolicy(
          root,
          modelProvider.selection === undefined
            ? "chatgpt_codex"
            : modelProviderResourceId(modelProvider.selection)
        )
      );
      checks.push(await checkCodexDirectPolicy(root));
      checks.push(modelProvider.check);
      if (modelProvider.selection?.profile.apiMode === "codex_responses") {
        checks.push(await checkCodexDirectAuth(options.codexAuthStatus));
        checks.push(await checkCodexDefaultModel(cwd, options.codexModelResolver));
      } else if (modelProvider.selection !== undefined) {
        checks.push(
          checkModelProviderCredentials(
            modelProvider.selection,
            options.modelProviderEnv ?? process.env
          )
        );
      }
    }

    checks.push(await checkRuntimeArtifactsIgnored(root));
  }

  return {
    ok: checks.every((check) => check.status === "pass"),
    root,
    checks
  };
}

function checkRunsteadInitialized(resolvedRoot: {
  root: string;
  source: "runstead" | "team" | "missing";
}): DoctorCheck {
  if (resolvedRoot.source === "runstead") {
    return pass("runstead-initialized", ".runstead initialization", resolvedRoot.root);
  }

  if (resolvedRoot.source === "team") {
    return fail(
      "runstead-initialized",
      ".runstead initialization",
      "legacy .team state found; migrate to .runstead before using Codex Direct"
    );
  }

  return fail(
    "runstead-initialized",
    ".runstead initialization",
    `Runstead is not initialized at ${resolvedRoot.root}`
  );
}

async function checkTrustedLocalCodexPolicy(
  root: string,
  modelResourceId: string
): Promise<DoctorCheck> {
  try {
    const policy = await loadPolicyProfileFromFile(
      join(root, "policies", "repo-maintenance.yaml")
    );
    const workerDecision = evaluatePolicy({
      policy,
      action: codexDirectWorkerAction()
    });
    const modelDecision = evaluatePolicy({
      policy,
      action: codexModelInferenceAction(modelResourceId)
    });

    if (workerDecision.decision !== "allow" || modelDecision.decision !== "allow") {
      return fail(
        "trusted-local-policy",
        "trusted-local provider policy",
        `worker=${workerDecision.decision} model=${modelDecision.decision} provider=${modelResourceId}; use init --profile trusted-local or run upgrade`
      );
    }

    return pass(
      "trusted-local-policy",
      "trusted-local provider policy",
      `worker rule ${workerDecision.ruleId ?? "default"}, model rule ${modelDecision.ruleId ?? "default"}`
    );
  } catch (error) {
    return fail(
      "trusted-local-policy",
      "trusted-local provider policy",
      errorMessage(error)
    );
  }
}

async function checkCodexDirectPolicy(root: string): Promise<DoctorCheck> {
  try {
    const policy = await loadPolicyProfileFromFile(
      join(root, "policies", "repo-maintenance.yaml")
    );
    const decision = evaluatePolicy({
      policy,
      action: codexDirectWorkerAction()
    });

    return decision.decision === "allow"
      ? pass(
          "codex-direct-policy",
          "codex_direct policy",
          decision.ruleId ?? "default allow"
        )
      : fail(
          "codex-direct-policy",
          "codex_direct policy",
          `decision=${decision.decision}; Codex Direct requires allow`
        );
  } catch (error) {
    return fail("codex-direct-policy", "codex_direct policy", errorMessage(error));
  }
}

async function checkCodexCliPolicy(root: string): Promise<DoctorCheck> {
  try {
    const policy = await loadPolicyProfileFromFile(
      join(root, "policies", "repo-maintenance.yaml")
    );
    const decision = evaluatePolicy({
      policy,
      action: codexCliWorkerAction()
    });

    return decision.decision === "allow"
      ? pass("codex-cli-policy", "codex_cli policy", decision.ruleId ?? "default allow")
      : fail(
          "codex-cli-policy",
          "codex_cli policy",
          `decision=${decision.decision}; codex_cli local agent runs require trusted external worker policy`
        );
  } catch (error) {
    return fail("codex-cli-policy", "codex_cli policy", errorMessage(error));
  }
}

async function checkClaudeCodePolicy(root: string): Promise<DoctorCheck> {
  try {
    const policy = await loadPolicyProfileFromFile(
      join(root, "policies", "repo-maintenance.yaml")
    );
    const decision = evaluatePolicy({
      policy,
      action: claudeCodeWorkerAction()
    });

    return decision.decision === "allow"
      ? pass(
          "claude-code-policy",
          "claude_code policy",
          decision.ruleId ?? "default allow"
        )
      : fail(
          "claude-code-policy",
          "claude_code policy",
          `decision=${decision.decision}; claude_code local agent runs require trusted external worker policy`
        );
  } catch (error) {
    return fail("claude-code-policy", "claude_code policy", errorMessage(error));
  }
}

async function checkModelProviderSelection(
  cwd: string,
  codexModelResolver?: DoctorRunsteadOptions["codexModelResolver"],
  env?: NodeJS.ProcessEnv
): Promise<{
  check: DoctorCheck;
  selection?: ResolvedModelProvider;
}> {
  try {
    const selection = await resolveModelProvider({
      cwd,
      ...(env === undefined ? {} : { env })
    });
    let model = selection.model;
    let modelSource: string | undefined = selection.modelSource;

    if (model === undefined && selection.profile.apiMode === "codex_responses") {
      const result = await (codexModelResolver ?? resolveCodexModel)({ cwd });

      model = result.model;
      modelSource = result.source;
    }

    if (model === undefined) {
      return {
        selection,
        check: fail(
          "model-provider",
          "model provider",
          `provider=${selection.provider}; no model selected; configure model.name or pass --model`
        )
      };
    }

    return {
      selection,
      check: pass(
        "model-provider",
        "model provider",
        `provider=${selection.provider} model=${model} mode=${selection.profile.apiMode} source=${selection.providerSource}/${modelSource ?? "unknown"}`
      )
    };
  } catch (error) {
    return {
      check: fail("model-provider", "model provider", errorMessage(error))
    };
  }
}

function checkModelProviderCredentials(
  selection: ResolvedModelProvider,
  env: NodeJS.ProcessEnv
): DoctorCheck {
  if (modelProviderApiKeyOptional(selection)) {
    return pass(
      "model-provider-auth",
      `${selection.profile.displayName} credentials`,
      "API key optional for local OpenAI-compatible endpoints"
    );
  }

  const envNames =
    selection.apiKeyEnv === undefined
      ? selection.profile.envVars
      : [selection.apiKeyEnv];
  const configured = envNames.find((name) => {
    const value = env[name]?.trim();

    return value !== undefined && value.length > 0;
  });

  if (configured !== undefined) {
    return pass(
      "model-provider-auth",
      `${selection.profile.displayName} credentials`,
      `using ${configured}`
    );
  }

  return fail(
    "model-provider-auth",
    `${selection.profile.displayName} credentials`,
    `missing API key; set ${envNames.join(" or ")} or configure model.apiKeyEnv`
  );
}

async function checkCodexDirectAuth(
  authStatus?: DoctorRunsteadOptions["codexAuthStatus"]
): Promise<DoctorCheck> {
  try {
    const status = await (authStatus ?? (() => getCodexAuthStatus()))();

    if (!status.loggedIn) {
      return fail(
        "codex-auth",
        "Codex Direct login",
        `not logged in; run runstead codex login (auth store: ${status.authPath})`
      );
    }

    if (status.accessTokenExpired === true) {
      return fail(
        "codex-auth",
        "Codex Direct login",
        "access token expired; run runstead codex login"
      );
    }

    return pass("codex-auth", "Codex Direct login", "logged in");
  } catch (error) {
    return fail("codex-auth", "Codex Direct login", errorMessage(error));
  }
}

async function checkCodexDefaultModel(
  cwd: string,
  resolver?: DoctorRunsteadOptions["codexModelResolver"]
): Promise<DoctorCheck> {
  try {
    const result = await (resolver ?? resolveCodexModel)({ cwd });

    return pass(
      "codex-default-model",
      "Codex default model",
      `${result.model} (${result.source})`
    );
  } catch (error) {
    return fail("codex-default-model", "Codex default model", errorMessage(error));
  }
}
