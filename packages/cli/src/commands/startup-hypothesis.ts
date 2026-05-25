import type { Command } from "commander";

import { requireRbacPermission } from "../cli-rbac.js";
import {
  collectValues,
  parseStartupHypothesisKind,
  parseStartupHypothesisStatus
} from "../startup-command-parsers.js";

export function registerStartupHypothesisCommand(startup: Command): Command {
  const startupHypothesis = startup
    .command("hypothesis")
    .description("Manage startup hypothesis ledger records.");

  startupHypothesis
    .command("add")
    .description("Add a problem, user, or solution hypothesis.")
    .option("--cwd <path>", "Workspace directory")
    .requiredOption("--kind <kind>", "Hypothesis kind: problem, user, or solution")
    .requiredOption("--statement <text>", "Hypothesis statement")
    .option(
      "--status <status>",
      "Hypothesis status: open, validated, invalidated, or needs-more-evidence",
      "open"
    )
    .option("--source <ref>", "Evidence source reference", collectValues, [])
    .option("--goal <id>", "Associated goal id")
    .option("--actor <id>", "RBAC subject for hypothesis writes", "local-admin")
    .action(
      async (options: {
        cwd?: string;
        kind: string;
        statement: string;
        status: string;
        source: string[];
        goal?: string;
        actor: string;
      }) => {
        await requireRbacPermission({
          ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
          actor: options.actor,
          permission: "evidence.write",
          action: "write startup hypotheses"
        });

        const { addStartupHypothesis } = await import("../startup-evidence.js");
        const result = await addStartupHypothesis({
          ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
          kind: parseStartupHypothesisKind(options.kind),
          statement: options.statement,
          status: parseStartupHypothesisStatus(options.status),
          sourceRefs: options.source,
          ...(options.goal === undefined ? {} : { goalId: options.goal })
        });

        console.log(`Recorded startup hypothesis: ${result.evidence.id}`);
        console.log(`Type: ${result.evidence.type}`);
        console.log(`Artifact: ${result.artifactPath}`);
      }
    );

  return startupHypothesis;
}
