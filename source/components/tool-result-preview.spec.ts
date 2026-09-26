import test from "ava";
import { formatSubagentToolResult } from "./tool-result-preview";

test("does not append an ellipsis to a short tool result", (t) => {
	t.is(
		formatSubagentToolResult("list_directory", "OK"),
		"⚒ list_directory: OK",
	);
});

test("appends an ellipsis only after the truncation limit", (t) => {
	const content = "x".repeat(120);
	t.is(
		formatSubagentToolResult("read_file", content),
		`⚒ read_file: ${"x".repeat(100)}...`,
	);
});
