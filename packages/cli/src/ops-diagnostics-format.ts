import type { DoctorCheck } from "./doctor.js";
import type { OpsDiagnosticsSummary } from "./ops-diagnostics-types.js";

export function formatOpsDiagnostics(input: {
  summary: OpsDiagnosticsSummary;
  doctorChecks: DoctorCheck[];
}): string {
  return [
    "# Runstead Ops Diagnostics",
    "",
    `Generated: ${input.summary.generatedAt}`,
    `Doctor: ${input.summary.doctorOk ? "ok" : "failed"}`,
    "",
    "## Doctor Checks",
    "",
    listItems(
      input.doctorChecks.map((check) => `${check.status} ${check.id}: ${check.message}`)
    ),
    "",
    "## Daemon",
    "",
    input.summary.daemon === undefined
      ? "- daemon heartbeat not recorded"
      : listItems([
          `tick=${input.summary.daemon.tick}`,
          `stale=${input.summary.daemon.stale ?? false}`,
          `updated=${input.summary.daemon.updatedAt}`
        ]),
    "",
    "## Manager Lock",
    "",
    listItems([
      `status=${input.summary.managerLock.status}`,
      `owner=${input.summary.managerLock.ownerId ?? "none"}`,
      `heartbeat=${input.summary.managerLock.heartbeatAt ?? "none"}`
    ]),
    "",
    "## State Tables",
    "",
    listItems(
      Object.entries(input.summary.stateTables).map(
        ([table, count]) => `${table}: ${count}`
      )
    ),
    "",
    "## Artifact Directories",
    "",
    listItems(
      Object.entries(input.summary.artifacts).map(
        ([directory, snapshot]) =>
          `${directory}: ${snapshot.files} files, ${snapshot.bytes} bytes`
      )
    ),
    "",
    "## Retention And GC",
    "",
    listItems(input.summary.retention.cleanupCandidates),
    "",
    "## Timeout And Retry Profiles",
    "",
    listItems(
      Object.entries(input.summary.timeoutProfiles).map(
        ([profile, value]) => `${profile}: ${value}`
      )
    ),
    ""
  ].join("\n");
}

function listItems(items: string[]): string {
  return items.length === 0 ? "- none" : items.map((item) => `- ${item}`).join("\n");
}
