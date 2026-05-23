# Todo Dogfood Regression Fixture

This fixture captures the todo app shape used during Runstead startup-ready dogfood.

It intentionally places a search input before the add-todo input so generated UI smoke flows must prefer stable selectors such as `#todo-input` over broad placeholder selectors.

The fixture is also used by CLI regression tests that seed legacy metric evidence and stale remediation tasks before running `startup ready`.
