import type { JsonObject } from "@runstead/core";

import type { DashboardSnapshot } from "./dashboard-types.js";

export function dashboardEventPayload(
  snapshot: DashboardSnapshot,
  htmlPath: string,
  dataPath: string
): JsonObject {
  const startupDetails =
    snapshot.startup.status === undefined
      ? {}
      : {
          currentStage: snapshot.startup.status.currentStage,
          nextAction: snapshot.startup.status.nextAction,
          gates: snapshot.startup.status.gates.map((gate) => ({
            stage: gate.stage,
            status: gate.status,
            blockers: gate.blockers.length
          })),
          evidence: {
            total: snapshot.startup.status.evidence.total,
            staleSources: snapshot.startup.status.evidence.staleSources.length,
            sourceKinds: snapshot.startup.status.evidence.sourceKinds
          },
          ...(snapshot.startup.latestRun === undefined
            ? {}
            : {
                latestRun: {
                  id: snapshot.startup.latestRun.id,
                  target: snapshot.startup.latestRun.target,
                  verdict: snapshot.startup.latestRun.verdict,
                  status: snapshot.startup.latestRun.status,
                  timeline: snapshot.startup.latestRun.timeline.length,
                  guidedFlow: snapshot.startup.latestRun.guidedFlow.length,
                  operatorCommands: snapshot.startup.latestRun.operatorCommands.length,
                  uiSmokeArtifacts: snapshot.startup.latestRun.uiSmokeArtifacts.length
                }
              }),
          staleEvidence: snapshot.startup.staleEvidence.length,
          ...(snapshot.startup.agentPatch === undefined
            ? {}
            : {
                agentPatch: {
                  taskId: snapshot.startup.agentPatch.taskId,
                  status: snapshot.startup.agentPatch.status,
                  filesTouched: snapshot.startup.agentPatch.filesTouched.length
                }
              }),
          ...(snapshot.startup.runComparison === undefined
            ? {}
            : {
                runComparison: {
                  latestCompleted:
                    snapshot.startup.runComparison.latestCompleted?.id ?? null,
                  latestBlocked:
                    snapshot.startup.runComparison.latestBlocked?.id ?? null,
                  resolvedBlockers:
                    snapshot.startup.runComparison.resolvedBlockers.length,
                  resolvedBlockerDetails:
                    snapshot.startup.runComparison.resolvedBlockerDetails.length,
                  stillBlocked: snapshot.startup.runComparison.stillBlocked.length
                }
              }),
          timelineGroups: snapshot.startup.timelineGroups.map((group) => ({
            group: group.group,
            items: group.items.length
          }))
        };

  return {
    htmlPath,
    dataPath,
    summary: snapshot.summary,
    daemon: {
      available: snapshot.daemon.available,
      ...(snapshot.daemon.updatedAt === undefined
        ? {}
        : { updatedAt: snapshot.daemon.updatedAt }),
      ...(snapshot.daemon.error === undefined ? {} : { error: snapshot.daemon.error }),
      ...(snapshot.daemon.stale === undefined ? {} : { stale: snapshot.daemon.stale }),
      ...(snapshot.daemon.ageMs === undefined ? {} : { ageMs: snapshot.daemon.ageMs }),
      ...(snapshot.daemon.ciRepairStatus === undefined
        ? {}
        : { ciRepairStatus: snapshot.daemon.ciRepairStatus }),
      ...(snapshot.daemon.branchName === undefined
        ? {}
        : { branchName: snapshot.daemon.branchName }),
      ...(snapshot.daemon.approvalId === undefined
        ? {}
        : { approvalId: snapshot.daemon.approvalId }),
      ...(snapshot.daemon.pullRequest === undefined
        ? {}
        : { pullRequest: snapshot.daemon.pullRequest })
    },
    startup: {
      available: snapshot.startup.available,
      ...startupDetails
    },
    operator: {
      actions: snapshot.operator.actions.length,
      ...(snapshot.operator.recommendedAction === undefined
        ? {}
        : {
            recommendedAction: {
              id: snapshot.operator.recommendedAction.id,
              source: snapshot.operator.recommendedAction.source,
              status: snapshot.operator.recommendedAction.status
            }
          })
    }
  };
}
