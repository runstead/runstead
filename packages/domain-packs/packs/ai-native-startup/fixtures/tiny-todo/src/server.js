import http from "node:http";

import { createTodoStore } from "./todo.js";

const store = createTodoStore(["Ship MVP", "Record evidence"]);
store.complete("2");

const server = http.createServer((_request, response) => {
  response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  response.end(renderTodoApp());
});

server.listen(Number(process.env.PORT ?? 3000), "127.0.0.1");
process.on("SIGTERM", () => server.close(() => process.exit(0)));

function renderTodoApp() {
  const items = store
    .list()
    .map(
      (item) =>
        `<li><label><input type="checkbox" ${item.completed ? "checked" : ""}> ${item.title}</label></li>`
    )
    .join("");

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Todo MVP</title>
  </head>
  <body>
    <main>
      <h1>Todo MVP</h1>
      <form>
        <label for="todo-title">New todo</label>
        <input id="todo-title" name="title" value="Invite beta user">
        <button type="submit">Add task</button>
      </form>
      <section aria-label="Launch checklist">
        <h2>Launch checklist</h2>
        <ul>${items}</ul>
      </section>
    </main>
  </body>
</html>`;
}
