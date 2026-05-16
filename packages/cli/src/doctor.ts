import { constants } from "node:fs";
import { access, readFile, readdir, stat } from "node:fs/promises";
import { isAbsolute, join } from "node:path";

import {
  validateDomainPackDir,
  verifyDomainPackManifest
} from "@runstead/domain-packs";

import { getCodexAuthStatus, type CodexAuthStatus } from "./codex-auth.js";
import { resolveCodexModel, type ResolveCodexModelResult } from "./codex-model.js";
import { resolveModelProvider, type ResolvedModelProvider } from "./model-provider.js";
import { loadPolicyProfileFromFile } from "./policy-loader.js";
import { evaluatePolicy } from "./policy.js";
import { resolveRunsteadRoot } from "./runstead-root.js";
import { missingRequiredStateTables } from "./state-schema.js";
import {
  runWorkerProcess,
  workerCommand,
  type WorkerProcessRunner,
  type WrappedWorkerKind
} from "./wrapped-worker.js";

export type DoctorCheckStatus = "pass" | "fail";

export interface DoctorCheck {
  id: string;
  label: string;
  status: DoctorCheckStatus;
  message: string;
}

export interface DoctorResult {
  ok: boolean;
  root: string;
  checks: DoctorCheck[];
}

export interface DoctorRunsteadOptions {
  cwd?: string;
  codex?: boolean;
  worker?: "codex_direct" | WrappedWorkerKind;
  model?: string;
  codexAuthStatus?: () => Promise<
    Pick<CodexAuthStatus, "loggedIn" | "accessTokenExpired" | "authPath">
  >;
  codexModelResolver?: (options: { cwd?: string }) => Promise<ResolveCodexModelResult>;
  codexCliProbeRunner?: WorkerProcessRunner;
  wrappedWorkerProbeRunner?: WorkerProcessRunner;
  modelProviderEnv?: NodeJS.ProcessEnv;
}

export async function doctorRunstead(
  options: DoctorRunsteadOptions = {}
): Promise<DoctorResult> {
  const resolvedRoot = await resolveRunsteadRoot(options.cwd);
  const root = resolvedRoot.root;
  const cwd = resolvedRoot.cwd;
  const checks: DoctorCheck[] = [];

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

async function checkCodexCliBinary(
  cwd: string,
  runner: WorkerProcessRunner
): Promise<DoctorCheck> {
  try {
    const result = await runner("codex", ["--version"], {
      cwd,
      timeoutMs: 10_000,
      maxOutputBytes: 20_000
    });
    const output = `${result.stdout}${result.stderr}`.trim();

    return result.exitCode === 0
      ? pass("codex-cli-binary", "Codex CLI binary", output || "codex found")
      : fail(
          "codex-cli-binary",
          "Codex CLI binary",
          `codex --version exited ${result.exitCode}: ${output}`
        );
  } catch (error) {
    return fail("codex-cli-binary", "Codex CLI binary", errorMessage(error));
  }
}

async function checkClaudeCodeBinary(
  cwd: string,
  runner: WorkerProcessRunner
): Promise<DoctorCheck> {
  try {
    const result = await runner("claude", ["--version"], {
      cwd,
      timeoutMs: 10_000,
      maxOutputBytes: 20_000
    });
    const output = `${result.stdout}${result.stderr}`.trim();

    return result.exitCode === 0
      ? pass(
          "claude-code-binary",
          "Claude Code CLI binary",
          output || "claude found"
        )
      : fail(
          "claude-code-binary",
          "Claude Code CLI binary",
          `claude --version exited ${result.exitCode}: ${output}`
        );
  } catch (error) {
    return fail("claude-code-binary", "Claude Code CLI binary", errorMessage(error));
  }
}

async function checkCodexCliExecProbe(options: {
  cwd: string;
  model?: string;
  runner: WorkerProcessRunner;
}): Promise<DoctorCheck> {
  const prompt =
    'Return exactly this JSON and nothing else: {"runstead_codex_cli_probe":true}';
  const command = workerCommand("codex_cli", prompt, {
    workspace: options.cwd,
    ...(options.model === undefined ? {} : { model: options.model })
  });

  try {
    const result = await options.runner(command.command, command.args, {
      cwd: options.cwd,
      timeoutMs: 120_000,
      maxOutputBytes: 120_000
    });
    const stdout = result.stdout.trim();
    const stderr = result.stderr.trim();
    const authHint = codexCliAuthHint(stderr);

    if (result.exitCode !== 0) {
      return fail(
        "codex-cli-exec",
        "Codex CLI exec probe",
        [
          `codex exec exited ${result.exitCode}`,
          ...(stdout.length === 0 ? [] : [`stdout=${truncateDoctorMessage(stdout)}`]),
          ...(stderr.length === 0 ? [] : [`stderr=${truncateDoctorMessage(stderr)}`]),
          authHint
        ]
          .filter((line): line is string => line !== undefined)
          .join("; ")
      );
    }

    if (!stdout.includes('"runstead_codex_cli_probe":true')) {
      return fail(
        "codex-cli-exec",
        "Codex CLI exec probe",
        [
          "codex exec completed but did not return the expected probe JSON",
          ...(stdout.length === 0
            ? ["stdout was empty"]
            : [`stdout=${truncateDoctorMessage(stdout)}`]),
          ...(stderr.length === 0 ? [] : [`stderr=${truncateDoctorMessage(stderr)}`]),
          authHint
        ]
          .filter((line): line is string => line !== undefined)
          .join("; ")
      );
    }

    return pass(
      "codex-cli-exec",
      "Codex CLI exec probe",
      [
        `ok${
          options.model === undefined
            ? " using Codex CLI default model"
            : ` using model=${options.model}`
        }`,
        ...(stderr.length === 0 ? [] : [`stderr=${truncateDoctorMessage(stderr)}`]),
        authHint
      ]
        .filter((line): line is string => line !== undefined)
        .join("; ")
    );
  } catch (error) {
    return fail("codex-cli-exec", "Codex CLI exec probe", errorMessage(error));
  }
}

async function checkClaudeCodePrintProbe(options: {
  cwd: string;
  model?: string;
  runner: WorkerProcessRunner;
}): Promise<DoctorCheck> {
  const prompt =
    'Return exactly this JSON and nothing else: {"runstead_claude_code_probe":true}';
  const command = workerCommand("claude_code", prompt, {
    ...(options.model === undefined ? {} : { model: options.model })
  });

  try {
    const result = await options.runner(command.command, command.args, {
      cwd: options.cwd,
      timeoutMs: 120_000,
      maxOutputBytes: 120_000
    });
    const stdout = result.stdout.trim();
    const stderr = result.stderr.trim();
    const authHint = claudeCodeAuthHint(`${stdout}\n${stderr}`);

    if (result.exitCode !== 0) {
      return fail(
        "claude-code-print",
        "Claude Code CLI print probe",
        [
          `claude -p exited ${result.exitCode}`,
          ...(stdout.length === 0 ? [] : [`stdout=${truncateDoctorMessage(stdout)}`]),
          ...(stderr.length === 0 ? [] : [`stderr=${truncateDoctorMessage(stderr)}`]),
          authHint
        ]
          .filter((line): line is string => line !== undefined)
          .join("; ")
      );
    }

    if (!stdout.includes('"runstead_claude_code_probe":true')) {
      return fail(
        "claude-code-print",
        "Claude Code CLI print probe",
        [
          "claude -p completed but did not return the expected probe JSON",
          ...(stdout.length === 0
            ? ["stdout was empty"]
            : [`stdout=${truncateDoctorMessage(stdout)}`]),
          ...(stderr.length === 0 ? [] : [`stderr=${truncateDoctorMessage(stderr)}`]),
          authHint
        ]
          .filter((line): line is string => line !== undefined)
          .join("; ")
      );
    }

    return pass(
      "claude-code-print",
      "Claude Code CLI print probe",
      [
        `ok${
          options.model === undefined
            ? " using Claude Code CLI default model"
            : ` using model=${options.model}`
        }`,
        ...(stderr.length === 0 ? [] : [`stderr=${truncateDoctorMessage(stderr)}`]),
        authHint
      ]
        .filter((line): line is string => line !== undefined)
        .join("; ")
    );
  } catch (error) {
    return fail("claude-code-print", "Claude Code CLI print probe", errorMessage(error));
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

async function checkRuntimeArtifactsIgnored(root: string): Promise<DoctorCheck> {
  const path = join(root, ".gitignore");
  const required = [
    "state.db",
    "state.db-*",
    "evidence/",
    "logs/",
    "checkpoints/",
    "daemon/",
    "reports/",
    "manager.lock"
  ];

  try {
    const lines = new Set((await readFile(path, "utf8")).split(/\r?\n/));
    const missing = required.filter((entry) => !lines.has(entry));

    return missing.length === 0
      ? pass("runtime-artifacts-ignore", "runtime artifacts ignore", path)
      : fail(
          "runtime-artifacts-ignore",
          "runtime artifacts ignore",
          `missing entries: ${missing.join(", ")}`
        );
  } catch (error) {
    return fail(
      "runtime-artifacts-ignore",
      "runtime artifacts ignore",
      errorMessage(error)
    );
  }
}

function codexDirectWorkerAction() {
  return {
    actionId: "doctor_codex_direct_worker",
    actionType: "worker.native.start",
    resource: {
      type: "native_worker",
      id: "codex_direct"
    }
  };
}

function codexCliWorkerAction() {
  return {
    actionId: "doctor_codex_cli_worker",
    actionType: "worker.external.start",
    resource: {
      type: "process",
      id: "codex_cli"
    }
  };
}

function claudeCodeWorkerAction() {
  return {
    actionId: "doctor_claude_code_worker",
    actionType: "worker.external.start",
    resource: {
      type: "process",
      id: "claude_code"
    }
  };
}

function codexModelInferenceAction(resourceId = "chatgpt_codex") {
  return {
    actionId: "doctor_codex_model_inference",
    actionType: "model.inference.request",
    resource: {
      type: "model_provider",
      id: resourceId
    },
    context: {
      sideEffects: ["network_write_external", "llm_data_egress"]
    }
  };
}

function codexCliAuthHint(stderr: string): string | undefined {
  const normalized = stderr.toLowerCase();

  return normalized.includes("invalid_token") ||
    normalized.includes("authrequired") ||
    normalized.includes("not authorized")
    ? "Codex CLI reported a local CLI/MCP auth problem; this is separate from Runstead Codex Direct login"
    : undefined;
}

function claudeCodeAuthHint(output: string): string | undefined {
  const normalized = output.toLowerCase();

  return normalized.includes("login") ||
    normalized.includes("not authenticated") ||
    normalized.includes("api key") ||
    normalized.includes("anthropic_api_key") ||
    normalized.includes("oauth") ||
    normalized.includes("subscription") ||
    normalized.includes("credit balance") ||
    normalized.includes("invalid x-api-key") ||
    normalized.includes("invalid api key")
    ? "Claude Code CLI reported a local Claude auth/profile problem; this is separate from Runstead Codex Direct login"
    : undefined;
}

function truncateDoctorMessage(value: string, maxLength = 500): string {
  return value.length <= maxLength ? value : `${value.slice(0, maxLength)}...`;
}

function modelProviderResourceId(selection: ResolvedModelProvider): string {
  return selection.provider === "codex" ? "chatgpt_codex" : selection.provider;
}

function modelProviderApiKeyOptional(selection: ResolvedModelProvider): boolean {
  return selection.provider === "custom" || selection.provider === "lmstudio";
}

async function checkReadableFile(
  id: string,
  label: string,
  path: string
): Promise<DoctorCheck> {
  try {
    await access(path, constants.R_OK);

    const pathStat = await stat(path);
    if (!pathStat.isFile()) {
      return fail(id, label, `${path} is not a file`);
    }

    return pass(id, label, path);
  } catch (error) {
    return fail(id, label, errorMessage(error));
  }
}

async function checkDirectory(
  id: string,
  label: string,
  path: string
): Promise<DoctorCheck> {
  try {
    const pathStat = await stat(path);

    if (!pathStat.isDirectory()) {
      return fail(id, label, `${path} is not a directory`);
    }

    return pass(id, label, path);
  } catch (error) {
    return fail(id, label, errorMessage(error));
  }
}

async function checkStateDatabase(path: string): Promise<DoctorCheck> {
  try {
    await access(path, constants.R_OK);
    const { DatabaseSync } = await import("node:sqlite");
    const database = new DatabaseSync(path, { readOnly: true });

    try {
      const rows = database
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
        .all() as { name: string }[];
      const missing = missingRequiredStateTables(rows.map((row) => row.name));

      if (missing.length > 0) {
        return fail("state-db", "state.db", `missing tables: ${missing.join(", ")}`);
      }

      return pass("state-db", "state.db", path);
    } finally {
      database.close();
    }
  } catch (error) {
    return fail("state-db", "state.db", errorMessage(error));
  }
}

async function checkDomainPackValidation(path: string): Promise<DoctorCheck> {
  try {
    const result = await validateDomainPackDir(path);

    if (!result.valid) {
      return fail(
        "domain-pack-validation",
        "repo-maintenance domain pack validation",
        result.issues
          .filter((issue) => issue.severity === "error")
          .map((issue) => issue.code)
          .join(", ")
      );
    }

    return pass(
      "domain-pack-validation",
      "repo-maintenance domain pack validation",
      path
    );
  } catch (error) {
    return fail(
      "domain-pack-validation",
      "repo-maintenance domain pack validation",
      errorMessage(error)
    );
  }
}

async function checkInstalledDomainPackManifests(root: string): Promise<DoctorCheck> {
  const domainsRoot = join(root, "domains");

  try {
    const entries = await readdir(domainsRoot, { withFileTypes: true });
    const domainDirs = entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => String(entry.name))
      .sort();

    if (domainDirs.length === 0) {
      return fail(
        "domain-pack-manifests",
        "installed domain pack manifests",
        "no installed domain packs"
      );
    }

    const failed: string[] = [];

    for (const id of domainDirs) {
      const result = await verifyDomainPackManifest(join(domainsRoot, id));

      if (!result.valid) {
        failed.push(`${id}: ${result.issues.map((issue) => issue.code).join(", ")}`);
      }
    }

    if (failed.length > 0) {
      return fail(
        "domain-pack-manifests",
        "installed domain pack manifests",
        failed.join("; ")
      );
    }

    return pass(
      "domain-pack-manifests",
      "installed domain pack manifests",
      `verified ${domainDirs.length} domain pack manifest(s)`
    );
  } catch (error) {
    return fail(
      "domain-pack-manifests",
      "installed domain pack manifests",
      errorMessage(error)
    );
  }
}

async function checkDaemonHeartbeat(root: string): Promise<DoctorCheck> {
  const path = join(root, "daemon", "status.json");

  try {
    await access(path, constants.F_OK);
  } catch {
    return pass("daemon-heartbeat", "daemon heartbeat", "not recorded");
  }

  try {
    const value = JSON.parse(await readFile(path, "utf8")) as unknown;

    if (!isRecord(value)) {
      return fail("daemon-heartbeat", "daemon heartbeat", "status is not an object");
    }

    const cwd = value.cwd;
    const pid = value.pid;
    const tick = value.tick;
    const updatedAt = value.updatedAt;
    const ranTask = value.ranTask;
    const valid =
      typeof cwd === "string" &&
      typeof pid === "number" &&
      typeof tick === "number" &&
      typeof updatedAt === "string" &&
      typeof ranTask === "boolean";

    if (!valid) {
      return fail(
        "daemon-heartbeat",
        "daemon heartbeat",
        "status is missing required fields"
      );
    }

    return pass("daemon-heartbeat", "daemon heartbeat", `tick ${tick} at ${updatedAt}`);
  } catch (error) {
    return fail("daemon-heartbeat", "daemon heartbeat", errorMessage(error));
  }
}

async function checkPolicyValidation(path: string): Promise<DoctorCheck> {
  try {
    await loadPolicyProfileFromFile(path);

    return pass("policy-validation", "repo-maintenance policy validation", path);
  } catch (error) {
    return fail(
      "policy-validation",
      "repo-maintenance policy validation",
      errorMessage(error)
    );
  }
}

async function checkRbacPolicy(cwd: string): Promise<DoctorCheck> {
  try {
    const { loadRbacPolicy } = await import("./rbac.js");

    await loadRbacPolicy({ cwd });

    return pass("rbac-policy", "RBAC policy validation", "valid");
  } catch (error) {
    return fail("rbac-policy", "RBAC policy validation", errorMessage(error));
  }
}

async function checkTeamPolicy(cwd: string): Promise<DoctorCheck> {
  try {
    const { compileTeamPolicyProfile, loadTeamPolicy } =
      await import("./team-policy.js");
    const policy = await loadTeamPolicy({ cwd });

    compileTeamPolicyProfile(policy);

    return pass("team-policy", "team policy validation", "valid");
  } catch (error) {
    return fail("team-policy", "team policy validation", errorMessage(error));
  }
}

async function checkGitHubAppConfig(cwd: string, root: string): Promise<DoctorCheck> {
  const path = join(root, "github-app.yaml");

  try {
    await access(path, constants.F_OK);
  } catch {
    return pass("github-app-config", "GitHub App config", "not configured");
  }

  try {
    const { loadGitHubAppConfig } = await import("./github-app.js");
    const config = await loadGitHubAppConfig({ cwd });
    const privateKeyPath = isAbsolute(config.privateKeyPath)
      ? config.privateKeyPath
      : join(root, config.privateKeyPath);

    await access(privateKeyPath, constants.R_OK);

    return pass("github-app-config", "GitHub App config", `app ${config.appId}`);
  } catch (error) {
    return fail("github-app-config", "GitHub App config", errorMessage(error));
  }
}

function pass(id: string, label: string, message: string): DoctorCheck {
  return {
    id,
    label,
    status: "pass",
    message
  };
}

function fail(id: string, label: string, message: string): DoctorCheck {
  return {
    id,
    label,
    status: "fail",
    message
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
