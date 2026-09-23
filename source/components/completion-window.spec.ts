import test from "ava";
import { visibleCompletionWindow } from "./completion-window";

test("shows every row when the list is shorter than the window", (t) => {
	const window = visibleCompletionWindow(["a", "b", "c"], 2, 5);
	t.deepEqual(window, { start: 0, end: 3, items: ["a", "b", "c"] });
});

test("keeps a selection past the first page inside the window", (t) => {
	const items = ["0", "1", "2", "3", "4", "5", "6", "7"];
	const window = visibleCompletionWindow(items, 6, 5);
	t.true(window.items.includes("6"));
	t.true(window.start + window.items.indexOf("6") === 6);
});
