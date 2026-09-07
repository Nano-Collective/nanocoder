import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "ava";
import { clearAppConfig, reloadAppConfig } from "@/config/index";
import {
	clearPendingHookContext,
	resetSessionStartHooks,
	SESSION_END_HOOK_HANDLER,
} from "@/services/lifecycle-hooks";
import { setProjectRoot } from "@/services/session-cwd";
import type { HooksConfig } from "@/types/config";
import { TOOL_APPROVAL_REQUIRED_KIND } from "@/constants";
import type { ToolManager } from "@/tools/tool-manager";
import type { LLMClient } from "@/types/core";
import type { PlainConversationOutcome } from "./conversation.js";
import { runPlainShell } from "./shell.js";
import type { RunPlainShellDeps } from "./shell.js";

// Suppress ANSI so any incidental stderr writes stay readable if inspected.
process.env.NO_COLOR = "1";

const FAKE_CLIENT = {} as LLMClient;
const FAKE_TOOL_MANAGER = {
	getAvailableToolNames: () => [],
	getFilteredTools: () => ({}),
	hasTool: () => false,
	getToolEntry: () => undefined,
	getToolValidator: () => undefined,
} as unknown as ToolManager;

interface CapturedShutdown {
	code: number | null;
}

function makeFakeShutdownManager(captured: CapturedShutdown) {
	return () => ({
		// runPlainShell registers its session-end lifecycle hook here; the fake
		// only has to accept the registration, never run it.
		register: () => undefined,
		unregister: () => undefined,
		gracefulShutdown: async (code: number) => {
			captured.code = code;
		},
	});
}

function makeFakeInitializePlain(
	overrides: Partial<{
		client: LLMClient;
		toolManager: ToolManager;
		provider: string;
		model: string;
	}> = {},
) {
	return async () => ({
		client: overrides.client ?? FAKE_CLIENT,
		toolManager: overrides.toolManager ?? FAKE_TOOL_MANAGER,
		provider: overrides.provider ?? "fake-provider",
		model: overrides.model ?? "fake-model",
	});
}

function makeFakeRunPlainConversation(outcome: PlainConversationOutcome) {
	return async () => outcome;
}

function capturingStdout(): { get: () => string; restore: () => void } {
	const original = process.stdout.write.bind(process.stdout);
	let buffer = "";
	// biome-ignore lint/suspicious/noExplicitAny: matching Node's overloaded write signature
	(process.stdout.write as any) = (chunk: any, ...rest: any[]) => {
		buffer += typeof chunk === "string" ? chunk : chunk.toString();
		return true;
	};
	return {
		get: () => buffer,
		restore: () => {
			process.stdout.write = original;
		},
	};
}

function capturingStderr(): { get: () => string; restore: () => void } {
	const original = process.stderr.write.bind(process.stderr);
	let buffer = "";
	// biome-ignore lint/suspicious/noExplicitAny: matching Node's overloaded write signature
	(process.stderr.write as any) = (chunk: any, ...rest: any[]) => {
		buffer += typeof chunk === "string" ? chunk : chunk.toString();
		return true;
	};
	return {
		get: () => buffer,
		restore: () => {
			process.stderr.write = original;
		},
	};
}

// Status/boot/error writes go through `@/plain/writer`, which wraps text in
// ANSI color codes whenever stdout looks like a TTY or FORCE_COLOR is set.
// Tests run under NO_COLOR=1 (set at the top of this file) specifically so
// `color()` is a no-op and these assertions can match plain substrings
// instead of fighting escape sequences.

function baseDeps(
	overrides: Partial<RunPlainShellDeps> = {},
): Partial<RunPlainShellDeps> {
	return {
		loadPreferences: () => ({ trustedDirectories: [] }) as never,
		savePreferences: () => undefined,
		artifacts: {
			cleanupStaleEphemeralSessions: async () => undefined,
			markEphemeralSession: async () => undefined,
			deleteSessionArtifacts: async () => undefined,
		},
		getShutdownManager: makeFakeShutdownManager({ code: null }),
		...overrides,
	};
}

test.serial("plain shell creates a session for artifact tools", async (t) => {
	const shutdown: CapturedShutdown = {code: null};
	const stdout = capturingStdout();
	let sessionId: string | undefined;
	let workingDirectory: string | undefined;
	try {
		await runPlainShell({
			prompt: "do the thing",
			developmentMode: "yolo",
			trustDirectory: true,
			outputFormat: "json",
			deps: baseDeps({
				initializePlain: makeFakeInitializePlain(),
				runPlainConversation: async options => {
					sessionId = options.sessionId;
					workingDirectory = options.workingDirectory;
					return {
						kind: "success",
						finalText: "done",
						reasoning: null,
						toolCalls: [],
					};
				},
				getShutdownManager: makeFakeShutdownManager(shutdown),
			}),
		});
	} finally {
		stdout.restore();
	}

	t.regex(sessionId ?? "", /^[0-9a-f-]{36}$/);
	t.is(workingDirectory, process.cwd());
});

test.serial("plain shell marks and cleans its ephemeral artifact session", async (t) => {
	const shutdown: CapturedShutdown = {code: null};
	const stdout = capturingStdout();
	const calls: string[] = [];
	let conversationSessionId = "";
	try {
		await runPlainShell({
			prompt: "do the thing",
			developmentMode: "yolo",
			trustDirectory: true,
			outputFormat: "json",
			deps: baseDeps({
				initializePlain: makeFakeInitializePlain(),
				runPlainConversation: async options => {
					conversationSessionId = options.sessionId ?? "";
					return {
						kind: "success",
						finalText: "done",
						reasoning: null,
						toolCalls: [],
					};
				},
				artifacts: {
					cleanupStaleEphemeralSessions: async () => {
						calls.push("sweep");
					},
					markEphemeralSession: async sessionId => {
						calls.push(`mark:${sessionId}`);
					},
					deleteSessionArtifacts: async sessionId => {
						calls.push(`delete:${sessionId}`);
					},
				},
				getShutdownManager: makeFakeShutdownManager(shutdown),
			}),
		});
	} finally {
		stdout.restore();
	}

	t.deepEqual(calls, [
		"sweep",
		`mark:${conversationSessionId}`,
		`delete:${conversationSessionId}`,
	]);
});

test.serial("plain shell cleans its ephemeral session when the conversation throws", async (t) => {
	const shutdown: CapturedShutdown = {code: null};
	const stdout = capturingStdout();
	let markedSessionId = "";
	let deletedSessionId = "";
	try {
		await t.throwsAsync(
			runPlainShell({
				prompt: "do the thing",
				developmentMode: "yolo",
				trustDirectory: true,
				outputFormat: "json",
				deps: baseDeps({
					initializePlain: makeFakeInitializePlain(),
					runPlainConversation: async () => {
						throw new Error("conversation failed");
					},
					artifacts: {
						cleanupStaleEphemeralSessions: async () => undefined,
						markEphemeralSession: async sessionId => {
							markedSessionId = sessionId;
						},
						deleteSessionArtifacts: async sessionId => {
							deletedSessionId = sessionId;
						},
					},
					getShutdownManager: makeFakeShutdownManager(shutdown),
				}),
			}),
			{message: "conversation failed"},
		);
	} finally {
		stdout.restore();
	}

	t.regex(markedSessionId, /^[0-9a-f-]{36}$/);
	t.is(deletedSessionId, markedSessionId);
});

test.serial(
	"--json success outcome emits a well-formed report with exit code 0",
	async (t) => {
		const shutdown: CapturedShutdown = { code: null };
		const stdout = capturingStdout();
		try {
			await runPlainShell({
				prompt: "do the thing",
				developmentMode: "auto-accept",
				trustDirectory: true,
				outputFormat: "json",
				deps: baseDeps({
					initializePlain: makeFakeInitializePlain(),
					runPlainConversation: makeFakeRunPlainConversation({
						kind: "success",
						finalText: "all done",
						reasoning: null,
						toolCalls: [],
					}),
					getShutdownManager: makeFakeShutdownManager(shutdown),
				}),
			});
		} finally {
			stdout.restore();
		}

		const report = JSON.parse(stdout.get());
		t.is(report.kind, "success");
		t.is(report.exitCode, 0);
		t.is(report.finalText, "all done");
		t.deepEqual(report.toolCalls, []);
		t.deepEqual(report.filesChanged, []);
		t.is(report.usage, undefined);
		t.is(shutdown.code, 0);
	},
);

test.serial(
	"--json success outcome includes usage block when present in conversation outcome",
	async (t) => {
		const shutdown: CapturedShutdown = { code: null };
		const stdout = capturingStdout();
		try {
			await runPlainShell({
				prompt: "do the thing",
				developmentMode: "auto-accept",
				trustDirectory: true,
				outputFormat: "json",
				deps: baseDeps({
					initializePlain: makeFakeInitializePlain(),
					runPlainConversation: makeFakeRunPlainConversation({
						kind: "success",
						finalText: "all done",
						reasoning: null,
						toolCalls: [],
						usage: {
							inputTokens: 500,
							outputTokens: 100,
							totalTokens: 600,
						},
					}),
					getShutdownManager: makeFakeShutdownManager(shutdown),
				}),
			});
		} finally {
			stdout.restore();
		}

		const report = JSON.parse(stdout.get());
		t.is(report.kind, "success");
		t.is(report.exitCode, 0);
		t.deepEqual(report.usage, {
			inputTokens: 500,
			outputTokens: 100,
			totalTokens: 600,
		});
		t.is(shutdown.code, 0);
	},
);

test.serial(
	"--json error outcome emits exit code 1 and includes the message",
	async (t) => {
		const shutdown: CapturedShutdown = { code: null };
		const stdout = capturingStdout();
		try {
			await runPlainShell({
				prompt: "do the thing",
				developmentMode: "auto-accept",
				trustDirectory: true,
				outputFormat: "json",
				deps: baseDeps({
					initializePlain: makeFakeInitializePlain(),
					runPlainConversation: makeFakeRunPlainConversation({
						kind: "error",
						message: "model exploded",
						finalText: "",
						reasoning: null,
						toolCalls: [],
					}),
					getShutdownManager: makeFakeShutdownManager(shutdown),
				}),
			});
		} finally {
			stdout.restore();
		}

		const report = JSON.parse(stdout.get());
		t.is(report.kind, "error");
		t.is(report.exitCode, 1);
		t.is(report.message, "model exploded");
		t.is(shutdown.code, 1);
	},
);

test.serial(
	"--json tool-approval-required outcome emits exit code 2 and toolNames",
	async (t) => {
		const shutdown: CapturedShutdown = { code: null };
		const stdout = capturingStdout();
		try {
			await runPlainShell({
				prompt: "do the thing",
				developmentMode: "auto-accept",
				trustDirectory: true,
				outputFormat: "json",
				deps: baseDeps({
					initializePlain: makeFakeInitializePlain(),
					runPlainConversation: makeFakeRunPlainConversation({
						kind: TOOL_APPROVAL_REQUIRED_KIND,
						toolNames: ["risky_tool"],
						finalText: "",
						reasoning: null,
						toolCalls: [],
					}),
					getShutdownManager: makeFakeShutdownManager(shutdown),
				}),
			});
		} finally {
			stdout.restore();
		}

		const report = JSON.parse(stdout.get());
		t.is(report.kind, TOOL_APPROVAL_REQUIRED_KIND);
		t.is(report.exitCode, 2);
		t.deepEqual(report.toolNames, ["risky_tool"]);
		t.is(shutdown.code, 2);
	},
);

test.serial(
	"filesChanged collects paths only from mutating tool calls, deduped",
	async (t) => {
		const shutdown: CapturedShutdown = { code: null };
		const stdout = capturingStdout();
		try {
			await runPlainShell({
				prompt: "edit some files",
				developmentMode: "auto-accept",
				trustDirectory: true,
				outputFormat: "json",
				deps: baseDeps({
					initializePlain: makeFakeInitializePlain(),
					runPlainConversation: makeFakeRunPlainConversation({
						kind: "success",
						finalText: "edited",
						reasoning: null,
						toolCalls: [
							{
								name: "write_file",
								arguments: { path: "/repo/a.ts" },
								result: "ok",
								error: null,
							},
							{
								// Same path written twice — should be deduped.
								name: "diff_edit",
								arguments: { path: "/repo/a.ts" },
								result: "ok",
								error: null,
							},
							{
								// write_file accepts file_path as a legacy alias.
								name: "write_file",
								arguments: { file_path: "/repo/b.ts" },
								result: "ok",
								error: null,
							},
							{
								// Non-mutating tool: should not contribute a path.
								name: "read_file",
								arguments: { path: "/repo/c.ts" },
								result: "contents",
								error: null,
							},
							{
								// Mutating tool that failed: still logs result/error
								// pass-through, but contributes no file since the call
								// itself errored before any path-bearing args mattered
								// for this assertion (failure handling is covered by
								// the isError tests in conversation.spec.ts).
								name: "string_replace",
								arguments: { path: "/repo/d.ts" },
								result: null,
								error: "failed to apply patch",
							},
						],
					}),
					getShutdownManager: makeFakeShutdownManager(shutdown),
				}),
			});
		} finally {
			stdout.restore();
		}

		const report = JSON.parse(stdout.get());
		t.is(report.kind, "success");
		t.deepEqual(
			new Set(report.filesChanged),
			new Set(["/repo/a.ts", "/repo/b.ts", "/repo/d.ts"]),
		);
		t.is(report.filesChanged.length, 3);

		const failedCall = report.toolCalls.find(
			(tc: { name: string }) => tc.name === "string_replace",
		);
		t.is(failedCall.result, null);
		t.is(failedCall.error, "failed to apply patch");
	},
);

test.serial(
	"untrusted directory short-circuits with exit code 1 and no initializePlain call",
	async (t) => {
		const shutdown: CapturedShutdown = { code: null };
		const stdout = capturingStdout();
		let initCalled = false;
		try {
			await runPlainShell({
				prompt: "do the thing",
				developmentMode: "auto-accept",
				trustDirectory: false,
				outputFormat: "json",
				deps: baseDeps({
					loadPreferences: () => ({ trustedDirectories: [] }) as never,
					initializePlain: async () => {
						initCalled = true;
						return makeFakeInitializePlain()();
					},
					getShutdownManager: makeFakeShutdownManager(shutdown),
				}),
			});
		} finally {
			stdout.restore();
			delete process.env.NANOCODER_TRUST_DIRECTORY;
		}

		const report = JSON.parse(stdout.get());
		t.is(report.kind, "error");
		t.is(report.exitCode, 1);
		t.regex(report.message, /not trusted/i);
		t.is(shutdown.code, 1);
		t.false(
			initCalled,
			"an untrusted directory must short-circuit before init",
		);
	},
);

test.serial(
	"a directory already in trustedDirectories is treated as trusted",
	async (t) => {
		const shutdown: CapturedShutdown = { code: null };
		const stdout = capturingStdout();
		const cwd = process.cwd();
		try {
			await runPlainShell({
				prompt: "do the thing",
				developmentMode: "auto-accept",
				trustDirectory: false,
				outputFormat: "json",
				deps: baseDeps({
					loadPreferences: () => ({ trustedDirectories: [cwd] }) as never,
					initializePlain: makeFakeInitializePlain(),
					runPlainConversation: makeFakeRunPlainConversation({
						kind: "success",
						finalText: "trusted via preferences",
						reasoning: null,
						toolCalls: [],
					}),
					getShutdownManager: makeFakeShutdownManager(shutdown),
				}),
			});
		} finally {
			stdout.restore();
		}

		const report = JSON.parse(stdout.get());
		t.is(report.kind, "success");
		t.is(shutdown.code, 0);
	},
);

test.serial(
	"NANOCODER_TRUST_DIRECTORY=1 trusts the cwd and persists it via savePreferences",
	async (t) => {
		const shutdown: CapturedShutdown = { code: null };
		const stdout = capturingStdout();
		let savedWith: { trustedDirectories?: string[] } | null = null;
		process.env.NANOCODER_TRUST_DIRECTORY = "1";
		try {
			await runPlainShell({
				prompt: "do the thing",
				developmentMode: "auto-accept",
				trustDirectory: false,
				outputFormat: "json",
				deps: baseDeps({
					loadPreferences: () => ({ trustedDirectories: [] }) as never,
					savePreferences: (prefs) => {
						savedWith = prefs as { trustedDirectories?: string[] };
					},
					initializePlain: makeFakeInitializePlain(),
					runPlainConversation: makeFakeRunPlainConversation({
						kind: "success",
						finalText: "trusted via env var",
						reasoning: null,
						toolCalls: [],
					}),
					getShutdownManager: makeFakeShutdownManager(shutdown),
				}),
			});
		} finally {
			stdout.restore();
			delete process.env.NANOCODER_TRUST_DIRECTORY;
		}

		const report = JSON.parse(stdout.get());
		t.is(report.kind, "success");
		t.is(shutdown.code, 0);
		t.truthy(savedWith);
		t.true(
			(savedWith?.trustedDirectories ?? []).some(
				(dir) => dir === process.cwd(),
			),
		);
	},
);

test.serial(
	'initializePlain failure is reported as a kind:"error" exit-1 report',
	async (t) => {
		const shutdown: CapturedShutdown = { code: null };
		const stdout = capturingStdout();
		try {
			await runPlainShell({
				prompt: "do the thing",
				developmentMode: "auto-accept",
				trustDirectory: true,
				outputFormat: "json",
				deps: baseDeps({
					initializePlain: async () => {
						throw new Error("no provider configured");
					},
					getShutdownManager: makeFakeShutdownManager(shutdown),
				}),
			});
		} finally {
			stdout.restore();
		}

		const report = JSON.parse(stdout.get());
		t.is(report.kind, "error");
		t.is(report.exitCode, 1);
		t.regex(report.message, /no provider configured/);
		t.is(shutdown.code, 1);
	},
);

// --- Text mode (outputFormat: 'text') ---
//
// Unlike --json, text mode writes status/boot/error/"done" lines to stderr
// via @/plain/writer and exits through shutdown(), not emitJsonReport(). No
// JSON is ever written to stdout in this mode.

test.serial(
	'text success outcome writes boot info and "done" to stderr',
	async (t) => {
		const shutdown: CapturedShutdown = { code: null };
		const stdout = capturingStdout();
		const stderr = capturingStderr();
		try {
			await runPlainShell({
				prompt: "do the thing",
				developmentMode: "auto-accept",
				trustDirectory: true,
				outputFormat: "text",
				deps: baseDeps({
					initializePlain: makeFakeInitializePlain({
						provider: "acme-provider",
						model: "acme-model",
					}),
					runPlainConversation: makeFakeRunPlainConversation({
						kind: "success",
						finalText: "all done",
						reasoning: null,
						toolCalls: [],
					}),
					getShutdownManager: makeFakeShutdownManager(shutdown),
				}),
			});
		} finally {
			stdout.restore();
			stderr.restore();
		}

		// Text mode never writes a JSON report to stdout — only the EOL writeLine()
		// calls around the conversation, plus whatever runPlainConversation itself
		// streamed (nothing here, since it's stubbed).
		t.false(stdout.get().includes('"kind"'));
		t.regex(stderr.get(), /acme-provider/);
		t.regex(stderr.get(), /acme-model/);
		t.regex(stderr.get(), /done/);
		t.is(shutdown.code, 0);
	},
);

test.serial(
	"text mode recalls relevant project memories and surfaces the count on stderr",
	async (t) => {
		const shutdown: CapturedShutdown = { code: null };
		const stdout = capturingStdout();
		const stderr = capturingStderr();
		const calls: Array<{ systemPrompt: string; query: string }> = [];
		try {
			await runPlainShell({
				prompt: "refactor the auth module",
				developmentMode: "auto-accept",
				trustDirectory: true,
				outputFormat: "text",
				deps: baseDeps({
					initializePlain: makeFakeInitializePlain(),
					runPlainConversation: makeFakeRunPlainConversation({
						kind: "success",
						finalText: "all done",
						reasoning: null,
						toolCalls: [],
					}),
					getShutdownManager: makeFakeShutdownManager(shutdown),
					appendRelevantProjectContextWithCount: async (systemPrompt, query) => {
						calls.push({ systemPrompt, query });
						return {
							systemPrompt: `${systemPrompt}\n\n## Project Context\n\n- Auth uses Clerk.`,
							memoryCount: 2,
						};
					},
				}),
			});
		} finally {
			stdout.restore();
			stderr.restore();
		}

		t.is(calls.length, 1);
		t.is(calls[0]?.query, "refactor the auth module");
		t.regex(stderr.get(), /Recalling 2 project memories\.\.\./);
		t.is(shutdown.code, 0);
	},
);

test.serial(
	"text mode stays silent when no relevant memories are recalled",
	async (t) => {
		const shutdown: CapturedShutdown = { code: null };
		const stdout = capturingStdout();
		const stderr = capturingStderr();
		try {
			await runPlainShell({
				prompt: "do the thing",
				developmentMode: "auto-accept",
				trustDirectory: true,
				outputFormat: "text",
				deps: baseDeps({
					initializePlain: makeFakeInitializePlain(),
					runPlainConversation: makeFakeRunPlainConversation({
						kind: "success",
						finalText: "all done",
						reasoning: null,
						toolCalls: [],
					}),
					getShutdownManager: makeFakeShutdownManager(shutdown),
					appendRelevantProjectContextWithCount: async (systemPrompt) => ({
						systemPrompt,
						memoryCount: 0,
					}),
				}),
			});
		} finally {
			stdout.restore();
			stderr.restore();
		}

		t.false(stderr.get().includes("Recalling"));
		t.is(shutdown.code, 0);
	},
);

test.serial(
	"text error outcome writes the error message to stderr with exit code 1",
	async (t) => {
		const shutdown: CapturedShutdown = { code: null };
		const stdout = capturingStdout();
		const stderr = capturingStderr();
		try {
			await runPlainShell({
				prompt: "do the thing",
				developmentMode: "auto-accept",
				trustDirectory: true,
				outputFormat: "text",
				deps: baseDeps({
					initializePlain: makeFakeInitializePlain(),
					runPlainConversation: makeFakeRunPlainConversation({
						kind: "error",
						message: "model exploded",
						finalText: "",
						reasoning: null,
						toolCalls: [],
					}),
					getShutdownManager: makeFakeShutdownManager(shutdown),
				}),
			});
		} finally {
			stdout.restore();
			stderr.restore();
		}

		t.regex(stderr.get(), /model exploded/);
		t.is(shutdown.code, 1);
	},
);

test.serial(
	"text tool-approval-required outcome writes guidance to stderr with exit code 2",
	async (t) => {
		const shutdown: CapturedShutdown = { code: null };
		const stdout = capturingStdout();
		const stderr = capturingStderr();
		try {
			await runPlainShell({
				prompt: "do the thing",
				developmentMode: "auto-accept",
				trustDirectory: true,
				outputFormat: "text",
				deps: baseDeps({
					initializePlain: makeFakeInitializePlain(),
					runPlainConversation: makeFakeRunPlainConversation({
						kind: TOOL_APPROVAL_REQUIRED_KIND,
						toolNames: ["risky_tool"],
						finalText: "",
						reasoning: null,
						toolCalls: [],
					}),
					getShutdownManager: makeFakeShutdownManager(shutdown),
				}),
			});
		} finally {
			stdout.restore();
			stderr.restore();
		}

		t.regex(stderr.get(), /Tool approval required for: risky_tool/);
		t.regex(stderr.get(), /auto-accept|yolo/);
		t.is(shutdown.code, 2);
	},
);

test.serial(
	"text mode: untrusted directory writes the trust message to stderr with exit code 1",
	async (t) => {
		const shutdown: CapturedShutdown = { code: null };
		const stdout = capturingStdout();
		const stderr = capturingStderr();
		let initCalled = false;
		try {
			await runPlainShell({
				prompt: "do the thing",
				developmentMode: "auto-accept",
				trustDirectory: false,
				outputFormat: "text",
				deps: baseDeps({
					loadPreferences: () => ({ trustedDirectories: [] }) as never,
					initializePlain: async () => {
						initCalled = true;
						return makeFakeInitializePlain()();
					},
					getShutdownManager: makeFakeShutdownManager(shutdown),
				}),
			});
		} finally {
			stdout.restore();
			stderr.restore();
		}

		t.regex(stderr.get(), /not trusted/i);
		t.is(shutdown.code, 1);
		t.false(initCalled);
	},
);

test.serial(
	"text mode: initializePlain failure writes the formatted error to stderr with exit code 1",
	async (t) => {
		const shutdown: CapturedShutdown = { code: null };
		const stdout = capturingStdout();
		const stderr = capturingStderr();
		try {
			await runPlainShell({
				prompt: "do the thing",
				developmentMode: "auto-accept",
				trustDirectory: true,
				outputFormat: "text",
				deps: baseDeps({
					initializePlain: async () => {
						throw new Error("no provider configured");
					},
					getShutdownManager: makeFakeShutdownManager(shutdown),
				}),
			});
		} finally {
			stdout.restore();
			stderr.restore();
		}

		t.regex(stderr.get(), /no provider configured/);
		t.is(shutdown.code, 1);
	},
);

// ---------------------------------------------------------------------------
// Lifecycle hooks in the headless shell.
//
// `run` / --plain is a session too, so it fires session-start, session-end and
// user-prompt-submit. None of that is exercised by the TUI's tests, and a veto
// here has to stop the run before any model call rather than after one.
// ---------------------------------------------------------------------------

const HOOK_DIR = join(tmpdir(), `nanocoder-plain-hooks-${Date.now()}`);

function withPlainHooks(hooks: HooksConfig): void {
	writeFileSync(
		join(HOOK_DIR, "agents.config.json"),
		JSON.stringify({ nanocoder: { hooks } }),
		"utf-8",
	);
	reloadAppConfig();
}

// Portable hook bodies: `sh -c` on POSIX, `cmd /c` on Windows.
const hookNode = (script: string) => `node -e "${script}"`;

test.serial(
	"plain shell prepends session-start hook output to the prompt",
	async (t) => {
		const previousCwd = process.cwd();
		const previousConfigDir = process.env.NANOCODER_CONFIG_DIR;
		mkdirSync(HOOK_DIR, { recursive: true });
		process.env.NANOCODER_CONFIG_DIR = join(HOOK_DIR, "no-global-config");
		process.chdir(HOOK_DIR);
		setProjectRoot(HOOK_DIR);
		clearPendingHookContext();
		resetSessionStartHooks();

		const stdout = capturingStdout();
		let firstUserMessage = "";
		try {
			withPlainHooks({
				"session-start": [{ command: hookNode("console.log('branch: main')") }],
			});
			await runPlainShell({
				prompt: "what changed?",
				developmentMode: "yolo",
				trustDirectory: true,
				outputFormat: "json",
				deps: baseDeps({
					initializePlain: makeFakeInitializePlain(),
					runPlainConversation: async (options) => {
						firstUserMessage = String(
							options.initialMessages.find((m) => m.role === "user")?.content ?? "",
						);
						return {
							kind: "success",
							finalText: "done",
							reasoning: null,
							toolCalls: [],
						};
					},
					getShutdownManager: makeFakeShutdownManager({ code: null }),
				}),
			});
		} finally {
			stdout.restore();
			process.chdir(previousCwd);
			if (previousConfigDir === undefined) {
				delete process.env.NANOCODER_CONFIG_DIR;
			} else {
				process.env.NANOCODER_CONFIG_DIR = previousConfigDir;
			}
			setProjectRoot(previousCwd);
			clearAppConfig();
			clearPendingHookContext();
			resetSessionStartHooks();
		}

		t.true(
			firstUserMessage.startsWith(
				"<hook-context>\nbranch: main\n</hook-context>\n\n",
			),
			`expected the hook context in front of the prompt, got: ${firstUserMessage}`,
		);
		t.true(firstUserMessage.endsWith("what changed?"));
	},
);

test.serial(
	"a user-prompt-submit veto stops the run before any model call",
	async (t) => {
		const previousCwd = process.cwd();
		const previousConfigDir = process.env.NANOCODER_CONFIG_DIR;
		mkdirSync(HOOK_DIR, { recursive: true });
		process.env.NANOCODER_CONFIG_DIR = join(HOOK_DIR, "no-global-config");
		process.chdir(HOOK_DIR);
		setProjectRoot(HOOK_DIR);
		clearPendingHookContext();
		resetSessionStartHooks();

		const shutdown: CapturedShutdown = { code: null };
		const stdout = capturingStdout();
		let conversationRan = false;
		try {
			withPlainHooks({
				"user-prompt-submit": [
					{
						name: "guard",
						command: hookNode("console.log('not on a Friday');process.exit(1)"),
					},
				],
			});
			await runPlainShell({
				prompt: "ship it",
				developmentMode: "yolo",
				trustDirectory: true,
				outputFormat: "json",
				deps: baseDeps({
					initializePlain: makeFakeInitializePlain(),
					runPlainConversation: async () => {
						conversationRan = true;
						return {
							kind: "success",
							finalText: "done",
							reasoning: null,
							toolCalls: [],
						};
					},
					getShutdownManager: makeFakeShutdownManager(shutdown),
				}),
			});
		} finally {
			stdout.restore();
			process.chdir(previousCwd);
			if (previousConfigDir === undefined) {
				delete process.env.NANOCODER_CONFIG_DIR;
			} else {
				process.env.NANOCODER_CONFIG_DIR = previousConfigDir;
			}
			setProjectRoot(previousCwd);
			clearAppConfig();
			clearPendingHookContext();
			resetSessionStartHooks();
		}

		t.false(conversationRan, "the model must never be reached");
		t.is(shutdown.code, 1, "and the run exits non-zero");
		t.true(
			stdout.get().includes("not on a Friday"),
			"the hook's reason is reported",
		);
	},
);

test.serial("plain shell registers a session-end hook handler", async (t) => {
	const registered: string[] = [];
	const stdout = capturingStdout();
	try {
		await runPlainShell({
			prompt: "do the thing",
			developmentMode: "yolo",
			trustDirectory: true,
			outputFormat: "json",
			deps: baseDeps({
				initializePlain: makeFakeInitializePlain(),
				runPlainConversation: async () => ({
					kind: "success",
					finalText: "done",
					reasoning: null,
					toolCalls: [],
				}),
				getShutdownManager: () =>
					({
						register: (handler: { name: string }) => {
							registered.push(handler.name);
						},
						unregister: () => undefined,
						gracefulShutdown: async () => undefined,
					}) as never,
			}),
		});
	} finally {
		stdout.restore();
	}

	t.true(
		registered.includes(SESSION_END_HOOK_HANDLER),
		`session-end must be registered for every exit path, got: ${registered.join(", ")}`,
	);
});
