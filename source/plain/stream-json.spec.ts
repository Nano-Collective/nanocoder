import test from "ava";
import {
	createStdoutStreamJsonSink,
	STREAM_JSON_TOOL_RESULT_MAX_CHARS,
	truncateStreamJsonToolResult,
	type StreamJsonEvent,
} from "./stream-json.js";

// Suppress ANSI in test output.
process.env.NO_COLOR = "1";

test("truncateStreamJsonToolResult passes short content through", (t) => {
	t.is(truncateStreamJsonToolResult("ok"), "ok");
	t.is(truncateStreamJsonToolResult(null), null);
});

test("truncateStreamJsonToolResult caps long content with a marker", (t) => {
	const content = "x".repeat(STREAM_JSON_TOOL_RESULT_MAX_CHARS + 50);
	const truncated = truncateStreamJsonToolResult(content);
	t.truthy(truncated);
	t.true(truncated!.length < content.length);
	t.regex(truncated!, /truncated, 50 more characters/);
});

test("createStdoutStreamJsonSink writes one JSON object per line", (t) => {
	const original = process.stdout.write.bind(process.stdout);
	let buffer = "";
	// biome-ignore lint/suspicious/noExplicitAny: matching Node's overloaded write signature
	(process.stdout.write as any) = (chunk: any) => {
		buffer += typeof chunk === "string" ? chunk : chunk.toString();
		return true;
	};
	try {
		const sink = createStdoutStreamJsonSink();
		sink({ type: "session_start", sessionId: "s-1" });
		sink({ type: "assistant_text", turn: 1, delta: "hi" });
	} finally {
		process.stdout.write = original;
	}
	const lines = buffer.trim().split("\n");
	t.is(lines.length, 2);
	t.deepEqual(JSON.parse(lines[0]) as StreamJsonEvent, {
		type: "session_start",
		sessionId: "s-1",
	});
	t.deepEqual(JSON.parse(lines[1]) as StreamJsonEvent, {
		type: "assistant_text",
		turn: 1,
		delta: "hi",
	});
});
