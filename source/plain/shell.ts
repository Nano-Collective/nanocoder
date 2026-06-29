import path from "node:path";
import { appendToolDefinitionsToPrompt } from "@/ai-sdk-client/tools/system-prompt-assembler";
import { getAppConfig } from "@/config/index";
import { loadPreferences, savePreferences } from "@/config/preferences";
import { resolveTune } from "@/config/tune";
import { runPlainConversation } from "@/plain/conversation";
import { initializePlain } from "@/plain/initialize";
import {
	color,
	writeBoot,
	writeError,
	writeLine,
	writeStatus,
} from "@/plain/writer";
import { getTuneToolMode } from "@/types/config";
import type { DevelopmentMode, Message } from "@/types/core";
import { formatError } from "@/utils/error-formatter";
import { buildSystemPrompt, setLastBuiltPrompt } from "@/utils/prompt-builder";
import { getShutdownManager } from "@/utils/shutdown";

export interface RunPlainShellOptions {
	prompt: string;
	developmentMode: DevelopmentMode;
	cliProvider?: string;
	cliModel?: string;
	trustDirectory: boolean;
	outputFormat: "text" | "json";
}

/**
 * Headless equivalent of `nanocoder run "..."`. Skips Ink entirely:
 * the LLM, tool, MCP, and subagent stacks all initialize without React,
 * and the conversation loop streams to stdout via plain process.stdout.
 *
 * Exit codes:
 * 0  conversation completed naturally
 * 1  initialization or generation error
 * 2  tool approval was required (matches the Ink `run` behavior in
 * `useNonInteractiveMode`)
 */
export async function runPlainShell(
	options: RunPlainShellOptions,
): Promise<void> {
	const {
		prompt,
		developmentMode,
		cliProvider,
		cliModel,
		trustDirectory,
		outputFormat,
	} = options;

	const isJson = outputFormat === "json";

	if (!ensureDirectoryTrust(trustDirectory)) {
		if (isJson) {
			const cwd = path.resolve(process.cwd());
			emitJsonReport({
				kind: "error",
				exitCode: 1,
				finalText: "",
				reasoning: null,
				toolCalls: [],
				filesChanged: [],
				message: `Directory ${cwd} is not trusted. Pass --trust-directory or set NANOCODER_TRUST_DIRECTORY=1 to bypass the disclaimer for this run.`,
			});
		} else {
			const cwd = path.resolve(process.cwd());
			writeError(
				`Directory ${cwd} is not trusted. Pass --trust-directory or set ` +
					`NANOCODER_TRUST_DIRECTORY=1 to bypass the disclaimer for this run.`,
			);
		}
		await getShutdownManager().gracefulShutdown(1);
		return;
	}

	let init;
	try {
		init = await initializePlain({ cliProvider, cliModel });
	} catch (error) {
		const formattedErr = formatError(error);
		if (isJson) {
			emitJsonReport({
				kind: "error",
				exitCode: 1,
				finalText: "",
				reasoning: null,
				toolCalls: [],
				filesChanged: [],
				message: formattedErr,
			});
		} else {
			writeError(formattedErr);
		}
		await getShutdownManager().gracefulShutdown(1);
		return;
	}

	const { client, toolManager, provider, model } = init;

	// Traditional status writes go to stderr via plain/writer, leaving stdout clean
	writeBoot(provider, model, developmentMode);

	const tune = resolveTune(getAppConfig(), undefined, loadPreferences());
	const tuneToolMode = getTuneToolMode(tune);
	const toolsDisabled =
		tuneToolMode !== "native" || isToolCallingDisabled(provider, model);
	const fallbackToolFormat: "xml" | "json" =
		tuneToolMode === "json" ? "json" : "xml";
	const availableNames = toolManager.getAvailableToolNames(
		tune,
		developmentMode,
		undefined,
		model,
	);
	const basePrompt = buildSystemPrompt(
		developmentMode,
		tune,
		availableNames,
		toolsDisabled,
		getAppConfig().systemPrompt,
		model,
	);
	const toolsForPrompt = toolsDisabled
		? toolManager.getFilteredTools(availableNames)
		: {};
	const systemContent = appendToolDefinitionsToPrompt(
		basePrompt,
		toolsDisabled,
		fallbackToolFormat,
		toolsForPrompt,
	);
	setLastBuiltPrompt(systemContent);

	const systemMessage: Message = { role: "system", content: systemContent };
	const initialMessages: Message[] = [{ role: "user", content: prompt }];

	const abortController = new AbortController();
	const sigint = () => abortController.abort();
	process.on("SIGINT", sigint);

	const nonInteractiveAlwaysAllow = getAppConfig().alwaysAllow ?? [];

	if (!isJson) {
		writeLine();
	}

	const outcome = await runPlainConversation({
		client,
		toolManager,
		systemMessage,
		initialMessages,
		developmentMode,
		nonInteractiveAlwaysAllow,
		abortSignal: abortController.signal,
		tune,
		model,
		outputFormat,
	});
	process.off("SIGINT", sigint);

	if (isJson) {
		const exitCode =
			outcome.kind === "success" ? 0 : outcome.kind === "error" ? 1 : 2;

		const mutatingTools = [
			"write_to_file",
			"create_file",
			"string_replace",
			"edit_file",
		];
		const filesChangedSet = new Set<string>();

		const formattedToolCalls = (outcome.toolCalls || []).map((tc) => {
			if (mutatingTools.includes(tc.name)) {
				const filePath = tc.arguments?.path || tc.arguments?.file_path;
				if (typeof filePath === "string") {
					filesChangedSet.add(filePath);
				}
			}
			return {
				name: tc.name,
				arguments: tc.arguments || {},
				result: tc.result ?? null,
				error: tc.error ?? null,
			};
		});

		emitJsonReport({
			kind: outcome.kind,
			exitCode,
			finalText: outcome.finalText || "",
			reasoning: outcome.reasoning || null,
			toolCalls: formattedToolCalls,
			filesChanged: Array.from(filesChangedSet),
			...(outcome.kind === "error" && { message: outcome.message }),
			...(outcome.kind === "tool-approval-required" && {
				toolNames: outcome.toolNames,
			}),
		});

		await getShutdownManager().gracefulShutdown(exitCode);
		return;
	}

	switch (outcome.kind) {
		case "success":
			await shutdown(0);
			return;
		case "tool-approval-required":
			writeError(
				`Tool approval required for: ${outcome.toolNames.join(", ")}. ` +
					`Re-run with --mode auto-accept or --mode yolo, or add the tools to ` +
					`agents.config.json "alwaysAllow".`,
			);
			await shutdown(2);
			return;
		case "error":
			writeError(outcome.message);
			await shutdown(1);
			return;
	}
}

function isToolCallingDisabled(provider: string, model: string): boolean {
	const config = getAppConfig();
	const providerConfig = config.providers?.find((p) => p.name === provider);
	if (!providerConfig) return false;
	return providerConfig.disableToolModels?.includes(model) ?? false;
}

function ensureDirectoryTrust(trustDirectoryFlag: boolean): boolean {
	if (trustDirectoryFlag) return true;
	const cwd = path.resolve(process.cwd());
	const preferences = loadPreferences();
	const trusted = (preferences.trustedDirectories ?? []).some(
		(dir) => path.resolve(dir) === cwd,
	);
	if (trusted) return true;

	if (process.env.NANOCODER_TRUST_DIRECTORY === "1") {
		const updated = preferences.trustedDirectories ?? [];
		updated.push(cwd);
		savePreferences({ ...preferences, trustedDirectories: updated });
		writeStatus(`Marked ${cwd} as trusted (NANOCODER_TRUST_DIRECTORY=1).`);
		return true;
	}

	return false;
}

function emitJsonReport(report: unknown): void {
	process.stdout.write(JSON.stringify(report, null, 2) + "\n");
}

async function shutdown(code: number): Promise<void> {
	if (code === 0) {
		writeLine();
		writeStatus(color("green", "done"));
	}
	await getShutdownManager().gracefulShutdown(code);
}
