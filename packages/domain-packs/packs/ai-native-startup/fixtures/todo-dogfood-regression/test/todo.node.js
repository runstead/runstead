import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const server = await readFile(new URL("../src/server.js", import.meta.url), "utf8");

assert.match(server, /id="todo-search"/);
assert.match(server, /id="todo-input"/);
assert.match(server, /localStorage/);
console.log("todo dogfood regression fixture ok");
