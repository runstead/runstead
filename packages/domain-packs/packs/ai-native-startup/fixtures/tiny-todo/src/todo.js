export function createTodoStore(initialItems = []) {
  const items = initialItems.map((item, index) => ({
    id: String(index + 1),
    title: item,
    completed: false
  }));

  return {
    add(title) {
      const item = {
        id: String(items.length + 1),
        title,
        completed: false
      };
      items.push(item);
      return item;
    },
    complete(id) {
      const item = items.find((candidate) => candidate.id === id);

      if (item === undefined) {
        return false;
      }

      item.completed = true;
      return true;
    },
    list() {
      return items.map((item) => ({ ...item }));
    }
  };
}
