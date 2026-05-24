import { describe, expect, it } from "vitest";

import {
  runtimeExecutionSemantics,
  runtimeFinalTaskStatus,
  runtimeTaskResultStatus,
  runtimeWorkerRunStatusFromTaskStatus
} from "./index.js";

describe("@runstead/runtime execution semantics", () => {
  it("separates implementation, verification, and agent completion", () => {
    expect(
      runtimeExecutionSemantics({
        worker: {
          kind: "governed",
          status: "failed",
          toolCalls: 3,
          budgetExhausted: true
        },
        verifier: {
          status: "passed",
          taskStatus: "completed"
        }
      })
    ).toEqual({
      implementation: "applied",
      verification: "passed",
      agentCompletion: "budget_exhausted"
    });
  });

  it("treats budget-exhausted governed runs with passing verifiers as completed with warnings", () => {
    const worker = {
      kind: "governed" as const,
      status: "failed" as const,
      toolCalls: 4,
      budgetExhausted: true
    };
    const taskStatus = runtimeFinalTaskStatus({
      worker,
      verifier: {
        status: "passed",
        taskStatus: "completed"
      }
    });

    expect(taskStatus).toBe("completed");
    expect(runtimeTaskResultStatus({ taskStatus, worker })).toBe(
      "completed_with_warnings"
    );
    expect(runtimeWorkerRunStatusFromTaskStatus(taskStatus)).toBe("completed");
  });

  it("treats late governed worker failure as a warning when verification passed", () => {
    const worker = {
      kind: "governed" as const,
      status: "failed" as const,
      toolCalls: 3
    };
    const taskStatus = runtimeFinalTaskStatus({
      worker,
      verifier: {
        status: "passed",
        taskStatus: "completed"
      }
    });

    expect(
      runtimeExecutionSemantics({ worker, verifier: { status: "passed" } })
    ).toEqual({
      implementation: "applied",
      verification: "passed",
      agentCompletion: "failed"
    });
    expect(taskStatus).toBe("completed");
    expect(runtimeTaskResultStatus({ taskStatus, worker })).toBe(
      "completed_with_warnings"
    );
  });

  it("keeps waiting approval and blocked states resumable", () => {
    expect(
      runtimeFinalTaskStatus({
        worker: {
          kind: "governed",
          status: "waiting_approval",
          toolCalls: 1
        }
      })
    ).toBe("waiting_approval");

    expect(
      runtimeFinalTaskStatus({
        worker: {
          kind: "governed",
          status: "blocked",
          toolCalls: 1
        }
      })
    ).toBe("blocked");
  });

  it("keeps governed interruption distinct from ordinary failure", () => {
    const worker = {
      kind: "governed" as const,
      status: "interrupted" as const,
      toolCalls: 0
    };

    expect(runtimeExecutionSemantics({ worker })).toEqual({
      implementation: "not_applied",
      verification: "skipped",
      agentCompletion: "interrupted"
    });
    expect(runtimeFinalTaskStatus({ worker })).toBe("interrupted");
    expect(
      runtimeTaskResultStatus({
        taskStatus: "interrupted",
        worker
      })
    ).toBe("interrupted");
    expect(runtimeWorkerRunStatusFromTaskStatus("interrupted")).toBe("interrupted");
  });
});
