import http from "node:http";

const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <title>Todo MVP</title>
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <style>
      body { font-family: system-ui, sans-serif; margin: 2rem; }
      main { max-width: 42rem; }
      form, .filters { display: flex; gap: 0.5rem; margin: 1rem 0; }
      input, button { font: inherit; padding: 0.55rem 0.7rem; }
      li { display: flex; gap: 0.5rem; align-items: center; margin: 0.4rem 0; }
      li.done span { text-decoration: line-through; color: #4b5563; }
    </style>
  </head>
  <body>
    <main>
      <h1>Todo MVP</h1>
      <p>Plan launch tasks with local persistence and search.</p>
      <label for="todo-search">Search todos</label>
      <input id="todo-search" name="search" data-testid="todo-search" placeholder="Search todos" autocomplete="off">
      <form id="todo-form">
        <label for="todo-input">New todo</label>
        <input id="todo-input" name="todo" data-testid="todo-input" placeholder="Add todo" autocomplete="off">
        <button id="add-todo" data-testid="add-todo" type="submit">Add todo</button>
      </form>
      <div class="filters">
        <button id="filter-active" data-testid="filter-active" type="button">Active</button>
        <button id="filter-all" data-testid="filter-all" type="button">All</button>
      </div>
      <ul id="todo-list" data-testid="todo-list"></ul>
    </main>
    <script>
      const storageKey = "runstead.todo-dogfood-regression.todos";
      const form = document.querySelector("#todo-form");
      const input = document.querySelector("#todo-input");
      const search = document.querySelector("#todo-search");
      const list = document.querySelector("#todo-list");
      const filterActive = document.querySelector("#filter-active");
      const filterAll = document.querySelector("#filter-all");
      let filter = "all";
      let todos = JSON.parse(localStorage.getItem(storageKey) || "[]");

      function save() {
        localStorage.setItem(storageKey, JSON.stringify(todos));
      }

      function render() {
        const query = search.value.trim().toLowerCase();
        list.innerHTML = "";
        todos
          .filter((todo) => filter === "all" || !todo.done)
          .filter((todo) => todo.text.toLowerCase().includes(query))
          .forEach((todo, index) => {
            const item = document.createElement("li");
            item.className = todo.done ? "done" : "";
            item.setAttribute("data-testid", "todo-item");
            const toggle = document.createElement("button");
            toggle.type = "button";
            toggle.textContent = todo.done ? "Undo" : "Complete";
            toggle.setAttribute("data-testid", "toggle-todo");
            toggle.addEventListener("click", () => {
              todos[index].done = !todos[index].done;
              save();
              render();
            });
            const text = document.createElement("span");
            text.textContent = todo.text;
            item.append(toggle, text);
            list.append(item);
          });
      }

      form.addEventListener("submit", (event) => {
        event.preventDefault();
        const text = input.value.trim();
        if (text.length === 0) return;
        todos.push({ text, done: false });
        input.value = "";
        save();
        render();
      });
      search.addEventListener("input", render);
      filterActive.addEventListener("click", () => {
        filter = "active";
        render();
      });
      filterAll.addEventListener("click", () => {
        filter = "all";
        render();
      });
      render();
    </script>
  </body>
</html>`;

const server = http.createServer((_request, response) => {
  response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  response.end(html);
});

server.listen(Number(process.env.PORT ?? 3000), "127.0.0.1");
process.on("SIGTERM", () => server.close(() => process.exit(0)));
