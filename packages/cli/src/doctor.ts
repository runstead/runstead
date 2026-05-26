import { join } from "node:path";

import { checkRuntimeBackend, checkStateDatabase } from "./doctor-runtime-checks.js";
import {
  checkClaudeCodePolicy,
  checkCodexCliPolicy,
  checkCodexDirectPolicy,
  checkTrustedLocalCodexPolicy
} from "./doctor-policy-checks.js";
import {
  checkNodeRuntime,
  type DoctorCheck,
  type DoctorResult,
  type DoctorRunsteadOptions
} from "./doctor-types.js";
import {
  checkCodexDefaultModel,
  checkCodexDirectAuth,
  checkModelProviderCredentials,
  checkModelProviderSelection,
  checkRunsteadInitialized,
  modelProviderResourceId
} from "./doctor-codex-checks.js";
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
  checkClaudeCodeBinary,
  checkClaudeCodePrintProbe,
  checkCodexCliBinary,
  checkCodexCliExecProbe
} from "./doctor-worker-probes.js";
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
