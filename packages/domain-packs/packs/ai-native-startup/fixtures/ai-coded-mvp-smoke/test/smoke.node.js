import assert from "node:assert/strict";
import { test } from "node:test";

import { activationEvent } from "../src/index.js";

test("creates activation event", () => {
  assert.equal(activationEvent({ id: "user_1" }).type, "activation");
});
