import test from "ava";
import { reloadAppConfig } from "@/config/index";
import { setToolManagerGetter, setToolRegistryGetter } from "@/message-handler";
import type { ToolManager } from "@/tools/tool-manager";
import type {
	AISDKCoreTool,
	LLMChatResponse,
	LLMClient,
	Message,
	ToolCall,
	ToolEntry,
	ToolHandler,
} from "@/types/core";
import { runPlainConversation } from "./conversation.js";

// Suppress ANSI in test output so tokens streamed to stdout stay readable.
process.env.NO_COLOR = "1";

interface FakeClientOptions {
	responses: Array<Partial<LLMChatResponse>>;
}

function makeFakeClient(options: FakeClientOptions): LLMClient {
	let callIndex = 0;
	return {
		getCurrentModel: () => "fake-model",
		setModel: () => undefined,
		getContextSize: () => 100_000,
		getAvailableModels: async () => ["fake-model"],
		getProviderConfig: () => ({}) as never,
		clearContext: async () => undefined,
		getTimeout: () => undefined,
		chat: async () => {
			const partial = options.responses[callIndex++];
			if (!partial) {
				throw new Error("FakeClient ran out of canned responses");
			}
			return {
				choices: partial.choices ?? [
					{ message: { role: "assistant", content: "" } },
				],
				toolsDisabled: partial.toolsDisabled,
			} as LLMChatResponse;
		},
	} as unknown as LLMClient;
}

interface FakeToolManagerOptions {
	knownTools?: Set<string>;
	needsApprovalByName?: Record<string, boolean>;
}

function makeFakeToolManager(opts: FakeToolManagerOptions = {}): ToolManager {
	const known = opts.knownTools ?? new Set<string>();
	const approvals = opts.needsApprovalByName ?? {};
	return {
		getAvailableToolNames: () => Array.from(known),
		getFilteredTools: () => {
			const filtered: Record<string, AISDKCoreTool> = {};
			for (const name of known) {
				filtered[name] = {} as AISDKCoreTool;
			}
			return filtered;
		},
		hasTool: (name: string) => known.has(name),
		getToolEntry: (name: string): ToolEntry | undefined => {
			if (!known.has(name)) return undefined;
			return {
				name,
				tool: {} as unknown as AISDKCoreTool,
				handler: (async () => "ok") as ToolHandler,
				approval: approvals[name] ?? false,
			};
		},
		getToolValidator: () => undefined,
	} as unknown as ToolManager;
}

const SYSTEM: Message = { role: "system", content: "sys" };
const USER: Message = { role: "user", content: "hi" };

test.beforeEach(() => {
	setToolRegistryGetter(() => ({}));
	setToolManagerGetter(() => null);
});

test("returns success when model emits content and no tool calls", async (t) => {
	const client = makeFakeClient({
		responses: [
			{
				choices: [{ message: { role: "assistant", content: "hello world" } }],
			},
		],
	});
	const toolManager = makeFakeToolManager();

	const outcome = await runPlainConversation({
		client,
		toolManager,
		systemMessage: SYSTEM,
		initialMessages: [USER],
		developmentMode: "auto-accept",
		nonInteractiveAlwaysAllow: [],
		abortSignal: new AbortController().signal,
	});

	t.is(outcome.kind, "success");
});

test("returns error when model emits empty response with no tool calls", async (t) => {
	const client = makeFakeClient({
		responses: [
			{
				choices: [{ message: { role: "assistant", content: "" } }],
			},
		],
	});
	const toolManager = makeFakeToolManager();

	const outcome = await runPlainConversation({
		client,
		toolManager,
		systemMessage: SYSTEM,
		initialMessages: [USER],
		developmentMode: "auto-accept",
		nonInteractiveAlwaysAllow: [],
		abortSignal: new AbortController().signal,
	});

	t.is(outcome.kind, "error");
	if (outcome.kind === "error") {
		t.regex(outcome.message, /empty response/i);
	}
});

test("executes a tool call that does not need approval and recurses to success", async (t) => {
	const toolCall: ToolCall = {
		id: "call-1",
		function: { name: "safe_tool", arguments: {} },
	};
	const client = makeFakeClient({
		responses: [
			{
				choices: [
					{
						message: {
							role: "assistant",
							content: "",
							tool_calls: [toolCall],
						},
					},
				],
			},
			{
				choices: [{ message: { role: "assistant", content: "all done" } }],
			},
		],
	});
	const toolManager = makeFakeToolManager({
		knownTools: new Set(["safe_tool"]),
		needsApprovalByName: { safe_tool: false },
	});
	let handlerCalls = 0;
	setToolRegistryGetter(() => ({
		safe_tool: (async () => {
			handlerCalls++;
			return "tool-output";
		}) as ToolHandler,
	}));

	const outcome = await runPlainConversation({
		client,
		toolManager,
		systemMessage: SYSTEM,
		initialMessages: [USER],
		developmentMode: "auto-accept",
		nonInteractiveAlwaysAllow: [],
		abortSignal: new AbortController().signal,
	});

	t.is(outcome.kind, "success");
	t.is(handlerCalls, 1);
});

test("returns tool-approval-required when a tool needs approval and mode is not yolo", async (t) => {
	const toolCall: ToolCall = {
		id: "call-1",
		function: { name: "risky_tool", arguments: {} },
	};
	const client = makeFakeClient({
		responses: [
			{
				choices: [
					{
						message: {
							role: "assistant",
							content: "",
							tool_calls: [toolCall],
						},
					},
				],
			},
		],
	});
	const toolManager = makeFakeToolManager({
		knownTools: new Set(["risky_tool"]),
		needsApprovalByName: { risky_tool: true },
	});

	const outcome = await runPlainConversation({
		client,
		toolManager,
		systemMessage: SYSTEM,
		initialMessages: [USER],
		developmentMode: "auto-accept",
		nonInteractiveAlwaysAllow: [],
		abortSignal: new AbortController().signal,
	});

	t.is(outcome.kind, "tool-approval-required");
	if (outcome.kind === "tool-approval-required") {
		t.deepEqual(outcome.toolNames, ["risky_tool"]);
	}
});

test("yolo mode bypasses needsApproval and executes the tool", async (t) => {
	const toolCall: ToolCall = {
		id: "call-1",
		function: { name: "risky_tool", arguments: {} },
	};
	const client = makeFakeClient({
		responses: [
			{
				choices: [
					{
						message: {
							role: "assistant",
							content: "",
							tool_calls: [toolCall],
						},
					},
				],
			},
			{
				choices: [{ message: { role: "assistant", content: "done" } }],
			},
		],
	});
	const toolManager = makeFakeToolManager({
		knownTools: new Set(["risky_tool"]),
		needsApprovalByName: { risky_tool: true },
	});
	let handlerCalls = 0;
	setToolRegistryGetter(() => ({
		risky_tool: (async () => {
			handlerCalls++;
			return "tool-output";
		}) as ToolHandler,
	}));

	const outcome = await runPlainConversation({
		client,
		toolManager,
		systemMessage: SYSTEM,
		initialMessages: [USER],
		developmentMode: "yolo",
		nonInteractiveAlwaysAllow: [],
		abortSignal: new AbortController().signal,
	});

	t.is(outcome.kind, "success");
	t.is(handlerCalls, 1);
});

test("alwaysAllow list bypasses needsApproval", async (t) => {
	const toolCall: ToolCall = {
		id: "call-1",
		function: { name: "risky_tool", arguments: {} },
	};
	const client = makeFakeClient({
		responses: [
			{
				choices: [
					{
						message: {
							role: "assistant",
							content: "",
							tool_calls: [toolCall],
						},
					},
				],
			},
			{
				choices: [{ message: { role: "assistant", content: "done" } }],
			},
		],
	});
	const toolManager = makeFakeToolManager({
		knownTools: new Set(["risky_tool"]),
		needsApprovalByName: { risky_tool: true },
	});
	setToolRegistryGetter(() => ({
		risky_tool: (async () => "ok") as ToolHandler,
	}));

	const outcome = await runPlainConversation({
		client,
		toolManager,
		systemMessage: SYSTEM,
		initialMessages: [USER],
		developmentMode: "auto-accept",
		nonInteractiveAlwaysAllow: ["risky_tool"],
		abortSignal: new AbortController().signal,
	});

	t.is(outcome.kind, "success");
});

test("unknown tool produces an error result that is fed back to the model", async (t) => {
	const toolCall: ToolCall = {
		id: "call-1",
		function: { name: "no_such_tool", arguments: {} },
	};
	const client = makeFakeClient({
		responses: [
			{
				choices: [
					{
						message: {
							role: "assistant",
							content: "",
							tool_calls: [toolCall],
						},
					},
				],
			},
			{
				choices: [{ message: { role: "assistant", content: "recovered" } }],
			},
		],
	});
	const toolManager = makeFakeToolManager(); // no known tools

	const outcome = await runPlainConversation({
		client,
		toolManager,
		systemMessage: SYSTEM,
		initialMessages: [USER],
		developmentMode: "auto-accept",
		nonInteractiveAlwaysAllow: [],
		abortSignal: new AbortController().signal,
	});

	t.is(outcome.kind, "success");
});

test("unknown tool is logged with an error and no result, and is flagged as an error", async (t) => {
	const toolCall: ToolCall = {
		id: "call-1",
		function: { name: "no_such_tool", arguments: {} },
	};
	const client = makeFakeClient({
		responses: [
			{
				choices: [
					{
						message: {
							role: "assistant",
							content: "",
							tool_calls: [toolCall],
						},
					},
				],
			},
			{
				choices: [{ message: { role: "assistant", content: "recovered" } }],
			},
		],
	});
	const toolManager = makeFakeToolManager(); // no known tools

	const outcome = await runPlainConversation({
		client,
		toolManager,
		systemMessage: SYSTEM,
		initialMessages: [USER],
		developmentMode: "auto-accept",
		nonInteractiveAlwaysAllow: [],
		abortSignal: new AbortController().signal,
	});

	t.is(outcome.toolCalls.length, 1);
	const logged = outcome.toolCalls[0];
	t.is(logged.name, "no_such_tool");
	t.is(logged.result, null);
	t.truthy(logged.error);
	t.regex(String(logged.error), /unknown tool/i);
});

test("aborted signal short-circuits with an error outcome", async (t) => {
	const client = makeFakeClient({
		responses: [
			{
				choices: [
					{ message: { role: "assistant", content: "should not run" } },
				],
			},
		],
	});
	const toolManager = makeFakeToolManager();
	const controller = new AbortController();
	controller.abort();

	const outcome = await runPlainConversation({
		client,
		toolManager,
		systemMessage: SYSTEM,
		initialMessages: [USER],
		developmentMode: "auto-accept",
		nonInteractiveAlwaysAllow: [],
		abortSignal: controller.signal,
	});

	t.is(outcome.kind, "error");
});

// --- Tool execution error telemetry (isError) ---
//
// processToolUse is responsible for catching a handler throw and returning a
// ToolResult with isError: true (the failure message itself stays in
// `content`, since that's what's sent back to the model). These tests verify
// runPlainConversation reads that flag correctly when building toolCallsLog,
// rather than looking for a nonexistent `.error` property on ToolResult.

test("a tool handler that throws is logged as an error, not a successful result", async (t) => {
	const toolCall: ToolCall = {
		id: "call-1",
		function: { name: "failing_tool", arguments: {} },
	};
	const client = makeFakeClient({
		responses: [
			{
				choices: [
					{
						message: {
							role: "assistant",
							content: "",
							tool_calls: [toolCall],
						},
					},
				],
			},
			{
				choices: [{ message: { role: "assistant", content: "recovered" } }],
			},
		],
	});
	const toolManager = makeFakeToolManager({
		knownTools: new Set(["failing_tool"]),
		needsApprovalByName: { failing_tool: false },
	});
	setToolRegistryGetter(() => ({
		failing_tool: (async () => {
			throw new Error("disk is on fire");
		}) as ToolHandler,
	}));

	const outcome = await runPlainConversation({
		client,
		toolManager,
		systemMessage: SYSTEM,
		initialMessages: [USER],
		developmentMode: "auto-accept",
		nonInteractiveAlwaysAllow: [],
		abortSignal: new AbortController().signal,
	});

	// The conversation still recovers (the error is fed back to the model as
	// a tool message), but the telemetry log must distinguish the failure.
	t.is(outcome.kind, "success");
	t.is(outcome.toolCalls.length, 1);

	const logged = outcome.toolCalls[0];
	t.is(logged.name, "failing_tool");
	t.is(
		logged.result,
		null,
		"a failed tool call must not be reported as a successful result",
	);
	t.truthy(logged.error, "a failed tool call must populate the error field");
	t.regex(String(logged.error), /disk is on fire/);
});

test("a successful tool handler is logged with a result and a null error", async (t) => {
	const toolCall: ToolCall = {
		id: "call-1",
		function: { name: "safe_tool", arguments: {} },
	};
	const client = makeFakeClient({
		responses: [
			{
				choices: [
					{
						message: {
							role: "assistant",
							content: "",
							tool_calls: [toolCall],
						},
					},
				],
			},
			{
				choices: [{ message: { role: "assistant", content: "all done" } }],
			},
		],
	});
	const toolManager = makeFakeToolManager({
		knownTools: new Set(["safe_tool"]),
		needsApprovalByName: { safe_tool: false },
	});
	setToolRegistryGetter(() => ({
		safe_tool: (async () => "tool-output") as ToolHandler,
	}));

	const outcome = await runPlainConversation({
		client,
		toolManager,
		systemMessage: SYSTEM,
		initialMessages: [USER],
		developmentMode: "auto-accept",
		nonInteractiveAlwaysAllow: [],
		abortSignal: new AbortController().signal,
	});

	t.is(outcome.kind, "success");
	t.is(outcome.toolCalls.length, 1);

	const logged = outcome.toolCalls[0];
	t.is(logged.name, "safe_tool");
	t.is(logged.error, null);
	t.truthy(logged.result);
	t.regex(String(logged.result), /tool-output/);
});

test("multiple tool calls in one turn log success and failure independently", async (t) => {
	const okCall: ToolCall = {
		id: "call-ok",
		function: { name: "ok_tool", arguments: {} },
	};
	const badCall: ToolCall = {
		id: "call-bad",
		function: { name: "bad_tool", arguments: {} },
	};
	const client = makeFakeClient({
		responses: [
			{
				choices: [
					{
						message: {
							role: "assistant",
							content: "",
							tool_calls: [okCall, badCall],
						},
					},
				],
			},
			{
				choices: [{ message: { role: "assistant", content: "done" } }],
			},
		],
	});
	const toolManager = makeFakeToolManager({
		knownTools: new Set(["ok_tool", "bad_tool"]),
		needsApprovalByName: { ok_tool: false, bad_tool: false },
	});
	setToolRegistryGetter(() => ({
		ok_tool: (async () => "fine") as ToolHandler,
		bad_tool: (async () => {
			throw new Error("boom");
		}) as ToolHandler,
	}));

	const outcome = await runPlainConversation({
		client,
		toolManager,
		systemMessage: SYSTEM,
		initialMessages: [USER],
		developmentMode: "auto-accept",
		nonInteractiveAlwaysAllow: [],
		abortSignal: new AbortController().signal,
	});

	t.is(outcome.kind, "success");
	t.is(outcome.toolCalls.length, 2);

	const ok = outcome.toolCalls.find((tc) => tc.name === "ok_tool");
	const bad = outcome.toolCalls.find((tc) => tc.name === "bad_tool");

	t.truthy(ok);
	t.is(ok?.error, null);
	t.regex(String(ok?.result), /fine/);

	t.truthy(bad);
	t.is(bad?.result, null);
	t.regex(String(bad?.error), /boom/);
});

// --- Turn ceiling + graceful final-turn wrap-up ---

interface RecordedCall {
	messages: Message[];
	tools: Record<string, AISDKCoreTool>;
}

function makeRecordingClient(
	responses: Array<Partial<LLMChatResponse>>,
	calls: RecordedCall[],
): LLMClient {
	let callIndex = 0;
	return {
		getCurrentModel: () => "fake-model",
		setModel: () => undefined,
		getContextSize: () => 100_000,
		getAvailableModels: async () => ["fake-model"],
		getProviderConfig: () => ({}) as never,
		clearContext: async () => undefined,
		getTimeout: () => undefined,
		chat: async (messages: Message[], tools: Record<string, AISDKCoreTool>) => {
			calls.push({ messages, tools });
			const partial = responses[callIndex++];
			if (!partial) {
				throw new Error("RecordingClient ran out of canned responses");
			}
			return {
				choices: partial.choices ?? [
					{ message: { role: "assistant", content: "" } },
				],
				toolsDisabled: partial.toolsDisabled,
			} as LLMChatResponse;
		},
	} as unknown as LLMClient;
}

test.afterEach.always(() => {
	delete process.env.NANOCODER_MAX_TURNS;
	reloadAppConfig();
});

test.serial(
	"forces a tool-free final answer on the configured last turn instead of erroring",
	async (t) => {
		process.env.NANOCODER_MAX_TURNS = "2";
		reloadAppConfig();

		const loopingCall: ToolCall = {
			id: "call-1",
			function: { name: "safe_tool", arguments: {} },
		};
		const calls: RecordedCall[] = [];
		const client = makeRecordingClient(
			[
				// Turn 0: model keeps calling a tool, so the loop would continue.
				{
					choices: [
						{
							message: {
								role: "assistant",
								content: "",
								tool_calls: [loopingCall],
							},
						},
					],
				},
				// Turn 1 (final): tools are stripped, model produces a final answer.
				{
					choices: [
						{ message: { role: "assistant", content: "final answer" } },
					],
				},
			],
			calls,
		);
		const toolManager = makeFakeToolManager({
			knownTools: new Set(["safe_tool"]),
			needsApprovalByName: { safe_tool: false },
		});
		setToolRegistryGetter(() => ({
			safe_tool: (async () => "tool-output") as ToolHandler,
		}));

		const outcome = await runPlainConversation({
			client,
			toolManager,
			systemMessage: SYSTEM,
			initialMessages: [USER],
			developmentMode: "auto-accept",
			nonInteractiveAlwaysAllow: [],
			abortSignal: new AbortController().signal,
		});

		// Ends cleanly with the final answer rather than the post-loop error.
		t.is(outcome.kind, "success");
		t.is(calls.length, 2);

		// Non-final turn sees real tools.
		t.true("safe_tool" in calls[0].tools);

		// Final turn strips tools and injects the wrap-up instruction as the
		// last message (without persisting it for the earlier turn).
		t.deepEqual(calls[1].tools, {});
		const lastMessage = calls[1].messages[calls[1].messages.length - 1];
		t.is(lastMessage.role, "user");
		t.regex(String(lastMessage.content), /do not call any more tools/i);
		const firstTurnHasNotice = calls[0].messages.some((m) =>
			/do not call any more tools/i.test(String(m.content)),
		);
		t.false(firstTurnHasNotice);
	},
);

test.serial(
	"ignores XML tool calls on the final turn so the fallback path also finalizes",
	async (t) => {
		process.env.NANOCODER_MAX_TURNS = "1";
		reloadAppConfig();

		const calls: RecordedCall[] = [];
		const client = makeRecordingClient(
			[
				// Single (final) turn: an XML-fallback response that still emits a
				// tool call in text. It must be treated as content, not executed.
				{
					choices: [
						{
							message: {
								role: "assistant",
								content:
									'Here is my answer.\n<tool_call>{"name":"safe_tool","arguments":{}}</tool_call>',
							},
						},
					],
					toolsDisabled: true,
				},
			],
			calls,
		);
		const toolManager = makeFakeToolManager({
			knownTools: new Set(["safe_tool"]),
			needsApprovalByName: { safe_tool: false },
		});
		let handlerCalls = 0;
		setToolRegistryGetter(() => ({
			safe_tool: (async () => {
				handlerCalls++;
				return "tool-output";
			}) as ToolHandler,
		}));

		const outcome = await runPlainConversation({
			client,
			toolManager,
			systemMessage: SYSTEM,
			initialMessages: [USER],
			developmentMode: "auto-accept",
			nonInteractiveAlwaysAllow: [],
			abortSignal: new AbortController().signal,
		});

		t.is(outcome.kind, "success");
		t.is(handlerCalls, 0, "final-turn XML tool call must not execute");
		t.is(calls.length, 1);
	},
);
