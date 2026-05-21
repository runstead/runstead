import assert from "node:assert/strict";
import { test } from "node:test";

import { createTodoStore } from "../src/todo.js";

test("adds and completes todos", () => {
  const store = createTodoStore(["ship MVP"]);
  const item = store.add("record evidence");

  assert.equal(store.complete(item.id), true);
  assert.deepEqual(store.list(), [
    { id: "1", title: "ship MVP", completed: false },
    { id: "2", title: "record evidence", completed: true }
  ]);
});
