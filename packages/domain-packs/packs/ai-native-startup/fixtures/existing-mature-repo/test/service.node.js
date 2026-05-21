import assert from "node:assert/strict";
import { test } from "node:test";

import { readinessScore } from "../src/service.js";

test("computes readiness score", () => {
  assert.equal(
    readinessScore({
      ciPassing: true,
      rollbackReady: true,
      observabilityReady: true,
      supportReady: true
    }),
    1
  );
});
