import assert from "node:assert/strict";
import { test } from "node:test";

import { activationRate, readinessSummary } from "../src/app.js";

test("computes activation rate", () => {
  assert.equal(activationRate({ signups: 10, activated: 6 }), 0.6);
});

test("summarizes readiness", () => {
  assert.deepEqual(
    readinessSummary({
      accountId: "acct_1",
      verifiersPassed: true,
      metricAboveThreshold: true
    }),
    {
      accountId: "acct_1",
      ready: true,
      generatedAt: "1970-01-01T00:00:00.000Z"
    }
  );
});
