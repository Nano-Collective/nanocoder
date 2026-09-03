import test from "ava";
import { dropOrphanedToolResults } from "@/ai-sdk-client/converters/message-converter";
import { getAppConfig, reloadAppConfig } from "@/config/index";
import { TOOL_APPROVAL_REQUIRED_KIND } from "@/constants";
import { setToolManagerGetter, setToolRegistryGetter } from "@/message-handler";
import {
	resetSessionContextLimit,
	setSessionContextLimit,
} from "@/models/models-dev-client.js";
import {
	resetAutoCompactSession,
	setAutoCompactStrategy,
	setAutoCompactThreshold,
} from "@/utils/auto-compact.js";
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
				usage: partial.usage,
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

test("nudges through empty responses up to the cap, then returns error", async (t) => {
	// Default maxEmptyTurns = 2: initial empty + 2 nudged retries = 3 calls.
	const client = makeFakeClient({
		responses: [
			{ choices: [{ message: { role: "assistant", content: "" } }] },
			{ choices: [{ message: { role: "assistant", content: "" } }] },
			{ choices: [{ message: { role: "assistant", content: "" } }] },
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
		t.regex(outcome.message, /produced no output after 3 attempts/i);
	}
});

test("recovers when a nudge after an empty response gets the model talking", async (t) => {
	const client = makeFakeClient({
		responses: [
			{ choices: [{ message: { role: "assistant", content: "" } }] },
			{ choices: [{ message: { role: "assistant", content: "recovered" } }] },
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

	// finalText stays empty here because the fake client never streams tokens;
	// the success outcome (driven by the message content) is the behavior under test.
	t.is(outcome.kind, "success");
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

	t.is(outcome.kind, TOOL_APPROVAL_REQUIRED_KIND);
	if (outcome.kind === TOOL_APPROVAL_REQUIRED_KIND) {
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

test("forwards the plain session context to artifact tools", async (t) => {
	const toolCall: ToolCall = {
		id: "call-artifact",
		function: {name: "write_walkthrough", arguments: {}},
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
			{choices: [{message: {role: "assistant", content: "done"}}]},
		],
	});
	const toolManager = makeFakeToolManager({
		knownTools: new Set(["write_walkthrough"]),
	});
	let receivedSessionId: string | undefined;
	let receivedWorkingDirectory: string | undefined;
	setToolRegistryGetter(() => ({
		write_walkthrough: (async (_args, options) => {
			receivedSessionId = options?.sessionId;
			receivedWorkingDirectory = options?.workingDirectory;
			return "Walkthrough saved";
		}) as ToolHandler,
	}));

	await runPlainConversation({
		client,
		toolManager,
		systemMessage: SYSTEM,
		initialMessages: [USER],
		developmentMode: "yolo",
		nonInteractiveAlwaysAllow: [],
		abortSignal: new AbortController().signal,
		sessionId: "11111111-1111-4111-8111-111111111111",
		workingDirectory: "/tmp/plain-artifacts",
	});

	t.is(receivedSessionId, "11111111-1111-4111-8111-111111111111");
	t.is(receivedWorkingDirectory, "/tmp/plain-artifacts");
});

test("does not nudge task-only plain work for a walkthrough", async (t) => {
	let callCount = 0;
	let nudge = "";
	const client = {
		...makeFakeClient({responses: []}),
		chat: async (messages: Message[]): Promise<LLMChatResponse> => {
			callCount++;
			if (callCount === 1) {
				return {
					choices: [
						{
							message: {
								role: "assistant",
								content: "",
								tool_calls: [
									{
										id: "tasks",
										function: {
											name: "write_tasks",
											arguments: {tasks: [{title: "Implement"}]},
										},
									},
								],
							},
						},
					],
				};
			}
			if (callCount === 2) {
				return {
					choices: [
						{message: {role: "assistant", content: "Implementation complete."}},
					],
				};
			}
			if (callCount === 3) {
				nudge = messages.at(-1)?.content ?? "";
				return {
					choices: [
						{
							message: {
								role: "assistant",
								content: "",
								tool_calls: [
									{
										id: "walkthrough",
										function: {
											name: "write_walkthrough",
											arguments: {},
										},
									},
								],
							},
						},
					],
				};
			}
			return {
				choices: [{message: {role: "assistant", content: "Confirmed."}}],
			};
		},
	} as LLMClient;
	const toolManager = makeFakeToolManager({
		knownTools: new Set(["write_tasks", "write_walkthrough"]),
	});
	setToolRegistryGetter(() => ({
		write_tasks: (async () => "Tasks updated") as ToolHandler,
		write_walkthrough: (async () => "Walkthrough saved") as ToolHandler,
	}));

	const outcome = await runPlainConversation({
		client,
		toolManager,
		systemMessage: SYSTEM,
		initialMessages: [USER],
		developmentMode: "yolo",
		nonInteractiveAlwaysAllow: [],
		abortSignal: new AbortController().signal,
		sessionId: "11111111-1111-4111-8111-111111111111",
	});

	t.is(outcome.kind, "success");
	t.is(callCount, 2);
	t.false(nudge.includes("write_walkthrough"));
});

test("keeps the pre-nudge answer as plain JSON finalText", async (t) => {
	let callCount = 0;
	const client = {
		...makeFakeClient({responses: []}),
		chat: async (_messages: Message[], _tools: unknown, callbacks: any) => {
			callCount++;
			if (callCount === 1) {
				callbacks.onToken?.("Implementation complete.");
				return {
					choices: [
						{message: {role: "assistant", content: "Implementation complete."}},
					],
				};
			}
			if (callCount === 2) {
				return {
					choices: [
						{
							message: {
								role: "assistant",
								content: "",
								tool_calls: [
									{
										id: "walkthrough",
										function: {
											name: "write_walkthrough",
											arguments: {},
										},
									},
								],
							},
						},
					],
				};
			}
			callbacks.onToken?.("Confirmed.");
			return {
				choices: [{message: {role: "assistant", content: "Confirmed."}}],
			};
		},
	} as LLMClient;
	const toolManager = makeFakeToolManager({
		knownTools: new Set(["write_walkthrough"]),
	});
	setToolRegistryGetter(() => ({
		write_walkthrough: (async () => "Walkthrough saved") as ToolHandler,
	}));

	const outcome = await runPlainConversation({
		client,
		toolManager,
		systemMessage: SYSTEM,
		initialMessages: [
			{role: "user", content: "<approved_plan>Implement it.</approved_plan>"},
		],
		developmentMode: "yolo",
		nonInteractiveAlwaysAllow: [],
		abortSignal: new AbortController().signal,
		outputFormat: "json",
		sessionId: "11111111-1111-4111-8111-111111111111",
		enforceWalkthrough: true,
	});

	t.is(outcome.kind, "success");
	t.is(outcome.finalText, "Implementation complete.");
	t.is(callCount, 3);
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
				usage: partial.usage,
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

test.serial(
	"accumulates token usage across multiple turns",
	async (t) => {
		const calls: RecordedCall[] = [];
		const client = makeRecordingClient(
			[
				{
					choices: [
						{
							message: {
								role: "assistant",
								content: "",
								tool_calls: [
									{
										id: "call_1",
										type: "function",
										function: { name: "safe_tool", arguments: {} },
									},
								],
							},
						},
					],
					usage: { inputTokens: 100, outputTokens: 20, totalTokens: 120 },
				},
				{
					choices: [
						{
							message: {
								role: "assistant",
								content: "all done",
							},
						},
					],
					usage: { inputTokens: 150, outputTokens: 30, totalTokens: 180 },
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

		t.is(outcome.kind, "success");
		t.deepEqual(outcome.usage, {
			inputTokens: 250,
			outputTokens: 50,
			totalTokens: 300,
		});
	},
);

test.serial(
	"omits usage property when no turn reports usage",
	async (t) => {
		const client = makeFakeClient({
			responses: [
				{
					choices: [
						{
							message: {
								role: "assistant",
								content: "no usage here",
							},
						},
					],
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
		t.is(outcome.usage, undefined);
	},
);

test.serial(
	"omits usage property when the provider reports an empty usage object",
	async (t) => {
		// The real client always returns a `usage` object; providers with no
		// telemetry leave every field undefined. That must stay indistinguishable
		// from no usage at all, not surface as an all-zero block.
		const client = makeFakeClient({
			responses: [
				{
					choices: [
						{
							message: {
								role: "assistant",
								content: "no usage here",
							},
						},
					],
					usage: {},
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
		t.is(outcome.usage, undefined);
	},
);

test.serial(
	"derives totalTokens from input+output when the provider omits it",
	async (t) => {
		const client = makeFakeClient({
			responses: [
				{
					choices: [
						{
							message: {
								role: "assistant",
								content: "all done",
							},
						},
					],
					usage: { inputTokens: 100, outputTokens: 20 },
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
		t.deepEqual(outcome.usage, {
			inputTokens: 100,
			outputTokens: 20,
			totalTokens: 120,
		});
	},
);

test.serial(
	"counts a partially reported turn without zeroing the other fields",
	async (t) => {
		// Only outputTokens reported: the turn still counts, and the derived total
		// falls back to input+output rather than reading as zero spend.
		const client = makeFakeClient({
			responses: [
				{
					choices: [
						{
							message: {
								role: "assistant",
								content: "all done",
							},
						},
					],
					usage: { outputTokens: 42 },
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
		t.deepEqual(outcome.usage, {
			inputTokens: 0,
			outputTokens: 42,
			totalTokens: 42,
		});
	},
);

// --- Agent-loop retry limits (nanocoder.retries) — issue #897 ---

function repeatingToolResponse(): Partial<LLMChatResponse> {
	return {
		choices: [
			{
				message: {
					role: "assistant",
					content: "",
					tool_calls: [
						{
							id: "call-loop",
							function: { name: "safe_tool", arguments: { path: "/tmp/x" } },
						},
					],
				},
			},
		],
	};
}

// Scope a retry-limit override to one test; afterEach.always reloads config,
// but restore explicitly so a mid-test failure cannot leak into another test.
async function withRetryLimit<K extends "maxRepeatedToolCalls" | "maxEmptyTurns" | "maxMalformedRetries">(
	key: K,
	value: number,
	body: () => Promise<void>,
): Promise<void> {
	const retries = getAppConfig().retries;
	if (!retries) throw new Error("resolved config must carry retry limits");
	const original = retries[key];
	retries[key] = value;
	try {
		await body();
	} finally {
		retries[key] = original;
	}
}

test.serial(
	"repeated identical tool calls hard-stop at the default limit",
	async (t) => {
		// Default maxRepeatedToolCalls = 3: the tool executes on turns 1 and 2;
		// turn 3's identical call trips the cap before executing.
		const calls: RecordedCall[] = [];
		const client = makeRecordingClient(
			[repeatingToolResponse(), repeatingToolResponse(), repeatingToolResponse()],
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

		t.is(outcome.kind, "error");
		if (outcome.kind === "error") {
			t.regex(outcome.message, /repeated the same tool call 3 times/i);
			t.regex(outcome.message, /maxRepeatedToolCalls/);
		}
		t.is(calls.length, 3, "third identical turn trips the cap");
		t.is(handlerCalls, 2, "the capped turn must not execute the tool again");
	},
);

test.serial(
	"a retry-limit stop does not print its message itself",
	async (t) => {
		// The message travels back on the `error` outcome and the caller
		// (runPlainShell) prints it once. Printing it here too double-printed it.
		const client = makeRecordingClient(
			[
				repeatingToolResponse(),
				repeatingToolResponse(),
				repeatingToolResponse(),
			],
			[],
		);
		const toolManager = makeFakeToolManager({
			knownTools: new Set(["safe_tool"]),
			needsApprovalByName: { safe_tool: false },
		});
		setToolRegistryGetter(() => ({
			safe_tool: (async () => "tool-output") as ToolHandler,
		}));

		const stderrChunks: string[] = [];
		const originalWrite = process.stderr.write.bind(process.stderr);
		process.stderr.write = ((chunk: string | Uint8Array) => {
			stderrChunks.push(chunk.toString());
			return true;
		}) as typeof process.stderr.write;

		let outcome: Awaited<ReturnType<typeof runPlainConversation>>;
		try {
			outcome = await runPlainConversation({
				client,
				toolManager,
				systemMessage: SYSTEM,
				initialMessages: [USER],
				developmentMode: "auto-accept",
				nonInteractiveAlwaysAllow: [],
				abortSignal: new AbortController().signal,
			});
		} finally {
			process.stderr.write = originalWrite;
		}

		t.is(outcome.kind, "error");
		t.false(
			stderrChunks.join("").includes("maxRepeatedToolCalls"),
			"the stop message must be printed by the caller only",
		);
	},
);

test.serial(
	"identical tool calls one under the limit do not trip the cap",
	async (t) => {
		const calls: RecordedCall[] = [];
		const client = makeRecordingClient(
			[
				repeatingToolResponse(),
				repeatingToolResponse(),
				{ choices: [{ message: { role: "assistant", content: "all done" } }] },
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

		t.is(outcome.kind, "success");
		t.is(calls.length, 3);
	},
);

test.serial(
	"different tool calls between repeats reset the streak",
	async (t) => {
		const otherToolResponse: Partial<LLMChatResponse> = {
			choices: [
				{
					message: {
						role: "assistant",
						content: "",
						tool_calls: [
							{
								id: "call-other",
								function: { name: "other_tool", arguments: {} },
							},
						],
					},
				},
			],
		};
		const calls: RecordedCall[] = [];
		const client = makeRecordingClient(
			[
				repeatingToolResponse(),
				repeatingToolResponse(),
				otherToolResponse,
				repeatingToolResponse(),
				{ choices: [{ message: { role: "assistant", content: "all done" } }] },
			],
			calls,
		);
		const toolManager = makeFakeToolManager({
			knownTools: new Set(["safe_tool", "other_tool"]),
			needsApprovalByName: { safe_tool: false, other_tool: false },
		});
		setToolRegistryGetter(() => ({
			safe_tool: (async () => "tool-output") as ToolHandler,
			other_tool: (async () => "other-output") as ToolHandler,
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
		t.is(calls.length, 5, "streak resets on a different signature");
	},
);

function unknownToolResponse(): Partial<LLMChatResponse> {
	return {
		choices: [
			{
				message: {
					role: "assistant",
					content: "",
					tool_calls: [
						{
							id: "call-ghost",
							function: { name: "ghost_tool", arguments: { x: 1 } },
						},
					],
				},
			},
		],
	};
}

test.serial(
	"repeated unknown-tool calls count toward the repeated-call cap",
	async (t) => {
		// A model stuck calling a nonexistent tool must trip
		// maxRepeatedToolCalls rather than draining tokens until maxTurns.
		const calls: RecordedCall[] = [];
		const client = makeRecordingClient(
			[unknownToolResponse(), unknownToolResponse(), unknownToolResponse()],
			calls,
		);
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
			t.regex(outcome.message, /repeated the same tool call 3 times/i);
			t.regex(outcome.message, /maxRepeatedToolCalls/);
		}
		t.is(calls.length, 3, "third identical unknown-tool turn trips the cap");
		t.is(
			outcome.toolCalls.filter((c) => c.error?.includes("Unknown tool")).length,
			3,
			"every unknown-tool turn is logged as an error",
		);
	},
);

test.serial(
	"unknown-tool calls one under the cap still let the model recover",
	async (t) => {
		const calls: RecordedCall[] = [];
		const client = makeRecordingClient(
			[
				unknownToolResponse(),
				unknownToolResponse(),
				{ choices: [{ message: { role: "assistant", content: "all done" } }] },
			],
			calls,
		);
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
		t.is(calls.length, 3, "the recovery turn runs to natural completion");
	},
);

test.serial(
	"repeated-tool-call cap honors a custom configured limit",
	async (t) => {
		await withRetryLimit("maxRepeatedToolCalls", 2, async () => {
			const calls: RecordedCall[] = [];
			const client = makeRecordingClient(
				[repeatingToolResponse(), repeatingToolResponse()],
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

			t.is(outcome.kind, "error");
			if (outcome.kind === "error") {
				t.regex(outcome.message, /repeated the same tool call 2 times/i);
			}
			t.is(calls.length, 2, "configured limit of 2 trips on the second turn");
		});
	},
);

test.serial(
	"empty-turn cap honors a custom configured limit of zero",
	async (t) => {
		await withRetryLimit("maxEmptyTurns", 0, async () => {
			const client = makeFakeClient({
				responses: [
					{ choices: [{ message: { role: "assistant", content: "" } }] },
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
				t.regex(outcome.message, /produced no output after 1 attempt\b/i);
			}
		});
	},
);

test.serial(
	"malformed tool calls self-correct up to the cap, then hard-stop",
	async (t) => {
		// Default maxMalformedRetries = 2: initial + 2 retries = 3 calls.
		// '[tool_use: name]' is a shape the XML parser rejects as malformed.
		const malformed: Partial<LLMChatResponse> = {
			choices: [
				{ message: { role: "assistant", content: "[tool_use: safe_tool]" } },
			],
			toolsDisabled: true,
		};
		const calls: RecordedCall[] = [];
		const client = makeRecordingClient([malformed, malformed, malformed], calls);
		const toolManager = makeFakeToolManager({
			knownTools: new Set(["safe_tool"]),
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

		t.is(outcome.kind, "error");
		if (outcome.kind === "error") {
			t.regex(outcome.message, /malformed tool calls 3 times/i);
			t.regex(outcome.message, /maxMalformedRetries/);
		}
		t.is(calls.length, 3);

		// The self-correction feedback must reach the model on retry turns.
		const retryTurnMessages = calls[1].messages;
		const feedback = retryTurnMessages.find(
			(m) =>
				m.role === "user" &&
				/contained a malformed tool call/i.test(String(m.content)),
		);
		t.truthy(feedback, "retry turn must carry the parse-error feedback");
	},
);

test.serial(
	"malformed tool call recovers when the model self-corrects",
	async (t) => {
		const client = makeFakeClient({
			responses: [
				{
					choices: [
						{ message: { role: "assistant", content: "[tool_use: safe_tool]" } },
					],
					toolsDisabled: true,
				},
				{
					choices: [{ message: { role: "assistant", content: "recovered" } }],
					toolsDisabled: true,
				},
			],
		});
		const toolManager = makeFakeToolManager({
			knownTools: new Set(["safe_tool"]),
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

		t.is(outcome.kind, "success");
	},
);

test.serial(
	"unknown-tool feedback reaches the model instead of being pruned as orphaned",
	async (t) => {
		// The error result is only delivered if its tool_call is in history:
		// dropOrphanedToolResults strips any result whose call is missing, which
		// would leave the next turn's context identical and the model repeating
		// the same ghost call until the repeated-call cap trips.
		const calls: RecordedCall[] = [];
		const client = makeRecordingClient(
			[
				unknownToolResponse(),
				{ choices: [{ message: { role: "assistant", content: "recovered" } }] },
			],
			calls,
		);
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
		t.is(calls.length, 2);

		const retryMessages = calls[1].messages;
		const assistant = retryMessages.find((m) => m.role === "assistant");
		t.true(
			(assistant?.tool_calls ?? []).some((tc) => tc.id === "call-ghost"),
			"the ghost call must be in the assistant message",
		);
		const delivered = dropOrphanedToolResults(retryMessages);
		t.true(
			delivered.some(
				(m) => m.role === "tool" && m.tool_call_id === "call-ghost",
			),
			"the unknown-tool error must survive orphan pruning",
		);
	},
);

test.serial(
	"a turn mixing a valid and an unknown call keeps every tool_call paired",
	async (t) => {
		const calls: RecordedCall[] = [];
		const client = makeRecordingClient(
			[
				{
					choices: [
						{
							message: {
								role: "assistant",
								content: "",
								tool_calls: [
									{
										id: "call-good",
										function: { name: "safe_tool", arguments: {} },
									},
									{
										id: "call-ghost",
										function: { name: "ghost_tool", arguments: {} },
									},
								],
							},
						},
					],
				},
				{ choices: [{ message: { role: "assistant", content: "recovered" } }] },
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

		await runPlainConversation({
			client,
			toolManager,
			systemMessage: SYSTEM,
			initialMessages: [USER],
			developmentMode: "auto-accept",
			nonInteractiveAlwaysAllow: [],
			abortSignal: new AbortController().signal,
		});

		const retryMessages = calls[1].messages;
		const emitted = retryMessages.flatMap((m) => m.tool_calls ?? []);
		t.is(emitted.length, 2);
		const resultIds = new Set(
			retryMessages
				.filter((m) => m.role === "tool")
				.map((m) => m.tool_call_id),
		);
		for (const toolCall of emitted) {
			t.true(
				resultIds.has(toolCall.id),
				`tool call ${toolCall.id} must have a paired result`,
			);
		}
	},
);

test.serial(
	"a malformed turn's streamed text is rolled back out of finalText",
	async (t) => {
		// The rejected turn's tokens land in the accumulator before the parse
		// error is known; a later successful run must not ship them.
		const responses = [
			{ content: "[tool_use: safe_tool]", toolsDisabled: true },
			{ content: "the real answer", toolsDisabled: true },
		];
		let callIndex = 0;
		const client = {
			getCurrentModel: () => "fake-model",
			setModel: () => undefined,
			getContextSize: () => 100_000,
			getAvailableModels: async () => ["fake-model"],
			getProviderConfig: () => ({}) as never,
			clearContext: async () => undefined,
			getTimeout: () => undefined,
			chat: async (
				_messages: Message[],
				_tools: Record<string, AISDKCoreTool>,
				callbacks: { onToken?: (token: string) => void },
			) => {
				const response = responses[callIndex++];
				callbacks.onToken?.(response.content);
				return {
					choices: [
						{ message: { role: "assistant", content: response.content } },
					],
					toolsDisabled: response.toolsDisabled,
				} as LLMChatResponse;
			},
		} as unknown as LLMClient;
		const toolManager = makeFakeToolManager({
			knownTools: new Set(["safe_tool"]),
		});

		const outcome = await runPlainConversation({
			client,
			toolManager,
			systemMessage: SYSTEM,
			initialMessages: [USER],
			developmentMode: "auto-accept",
			nonInteractiveAlwaysAllow: [],
			abortSignal: new AbortController().signal,
			outputFormat: "json",
		});

		t.is(outcome.kind, "success");
		t.is(outcome.finalText, "the real answer");
	},
);
test("plain runs do not force a walkthrough by default", async t => {
	let callCount = 0;
	const client = {
		...makeFakeClient({responses: []}),
		chat: async (): Promise<LLMChatResponse> => {
			callCount++;
			return {
				choices: [
					{message: {role: "assistant", content: "Implementation complete."}},
				],
			};
		},
	} as LLMClient;
	const toolManager = makeFakeToolManager({
		knownTools: new Set(["write_walkthrough"]),
	});
	setToolRegistryGetter(() => ({
		write_walkthrough: (async () => "Walkthrough saved") as ToolHandler,
	}));

	const outcome = await runPlainConversation({
		client,
		toolManager,
		systemMessage: SYSTEM,
		initialMessages: [
			{role: "user", content: "<approved_plan>Implement it.</approved_plan>"},
		],
		developmentMode: "yolo",
		nonInteractiveAlwaysAllow: [],
		abortSignal: new AbortController().signal,
		sessionId: "11111111-1111-4111-8111-111111111111",
	});

	t.is(outcome.kind, "success");
	t.is(callCount, 1, "the ephemeral plain run must not spend a nudge turn");
});

test.serial(
	"compacts history before the next model turn when over the token threshold",
	async (t) => {
		resetAutoCompactSession();
		resetSessionContextLimit();
		setSessionContextLimit(100);
		setAutoCompactStrategy("mechanical");
		setAutoCompactThreshold(50);

		const filler = "old context sentence. ".repeat(60);
		const toolCall: ToolCall = {
			id: "call-compact",
			function: { name: "safe_tool", arguments: {} },
		};
		const payloads: Message[][] = [];
		let callIndex = 0;
		const client = {
			getCurrentModel: () => "gpt-4",
			setModel: () => undefined,
			getContextSize: () => 100_000,
			getAvailableModels: async () => ["gpt-4"],
			getProviderConfig: () => ({ name: "openai" }),
			clearContext: async () => undefined,
			getTimeout: () => undefined,
			chat: async (messages: Message[]) => {
				payloads.push(messages);
				callIndex++;
				if (callIndex === 1) {
					return {
						choices: [
							{
								message: {
									role: "assistant",
									content: "",
									tool_calls: [toolCall],
								},
							},
						],
					} as LLMChatResponse;
				}
				return {
					choices: [{ message: { role: "assistant", content: "done" } }],
				} as LLMChatResponse;
			},
		} as unknown as LLMClient;

		const toolManager = makeFakeToolManager({
			knownTools: new Set(["safe_tool"]),
			needsApprovalByName: { safe_tool: false },
		});
		setToolRegistryGetter(() => ({
			safe_tool: (async () => "ok") as ToolHandler,
		}));

		try {
			const outcome = await runPlainConversation({
				client,
				toolManager,
				systemMessage: SYSTEM,
				initialMessages: [
					{ role: "user", content: filler },
					{ role: "assistant", content: "ack" },
					{ role: "user", content: "call the tool" },
				],
				developmentMode: "auto-accept",
				nonInteractiveAlwaysAllow: [],
				abortSignal: new AbortController().signal,
			});

			t.is(outcome.kind, "success");
			t.is(payloads.length, 2);
			const secondHistory = payloads[1]
				.slice(1)
				.map((m) => (typeof m.content === "string" ? m.content : ""))
				.join("");
			t.true(secondHistory.length < filler.length);
			t.false(
				payloads[1].some(
					(m) => typeof m.content === "string" && m.content.includes(filler),
				),
				"the verbose turn must be compressed out of the next model turn",
			);
			t.true(
				secondHistory.includes("call the tool"),
				"compaction must keep the recent turn, not empty the history",
			);
		} finally {
			resetAutoCompactSession();
			resetSessionContextLimit();
		}
	},
);
