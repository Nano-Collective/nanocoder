import {getAppConfig} from '@/config/index';
import type {LLMClient, Message} from '@/types/core';
import {getLogger} from '@/utils/logging';
import {type SessionManager, sessionManager} from './session-manager';
import {resolveTitleClient} from './title-client';
import {
	extractToolSummaries,
	generateSessionTitle,
	isWeakTitle,
} from './title-generator';

/** Local models can be slow, but a cosmetic title is never worth hanging on. */
const TITLE_TIMEOUT_MS = 20_000;

/** Stops two turns finishing close together from both launching a call. */
const inFlight = new Set<string>();

export interface MaybeGenerateTitleOptions {
	sessionId: string;
	/** The conversation so far. Only the first turn is ever read. */
	messages: Message[];
	/** The session's own client. Used unless config names an override. */
	client: LLMClient;
	/** Injected so tests can point at a temp directory. */
	manager?: SessionManager;
	/** Called only when a title was actually persisted, for live UI updates. */
	onTitle?: (title: string) => void;
}

/**
 * Give a session a real name, at most once, and only when the cheap heuristic
 * title is too thin to be useful. Every failure path is silent: the heuristic
 * title stands and the turn is unaffected.
 *
 * Both call sites invoke this as a bare `void`, so it must never reject. An
 * unhandled rejection would end a turn, or the process, for the sake of a
 * cosmetic title. The preconditions below read config and the session store,
 * either of which can throw, so the whole body is wrapped rather than just the
 * model call.
 */
export async function maybeGenerateTitle(
	options: MaybeGenerateTitleOptions,
): Promise<void> {
	try {
		await runTitleGeneration(options);
	} catch (error) {
		getLogger().debug(`Session title generation failed: ${error}`);
	}
}

async function runTitleGeneration(
	options: MaybeGenerateTitleOptions,
): Promise<void> {
	const {sessionId, messages, client, onTitle} = options;
	const manager = options.manager ?? sessionManager;

	if (getAppConfig().sessions?.smartTitles === false) return;
	if (inFlight.has(sessionId)) return;

	const firstUser = messages.find(m => m.role === 'user');
	if (!firstUser || typeof firstUser.content !== 'string') return;
	if (!messages.some(m => m.role === 'assistant')) return;
	if (!isWeakTitle(firstUser.content)) return;

	const toolSummaries = extractToolSummaries(messages);
	const userMessageCount = messages.filter(m => m.role === 'user').length;
	if (userMessageCount < 2 && toolSummaries.length === 0) return;

	const session = await manager.readSession(sessionId);
	if (!session) return;
	if (session.titleManuallySet || session.titleGenerated) return;

	inFlight.add(sessionId);
	// Not the session's own controller: AcpSession.cancel() swaps that one out,
	// so borrowing it would leave this call attached to a stale controller.
	const timeout = new AbortController();
	const timer = setTimeout(() => timeout.abort(), TITLE_TIMEOUT_MS);

	try {
		const assistantReply = messages.find(
			m => m.role === 'assistant' && m.content.trim().length > 0,
		)?.content;

		const titleClient = await resolveTitleClient(client);
		const title = await generateSessionTitle(
			titleClient,
			{firstUserMessage: firstUser.content, toolSummaries, assistantReply},
			timeout.signal,
		);
		if (!title) return;

		// Re-read: the user may have renamed the session while we were waiting.
		// Without this the generator races a manual rename and wins.
		const fresh = await manager.readSession(sessionId);
		if (!fresh || fresh.titleManuallySet || fresh.titleGenerated) return;

		// saveSession, never renameSession - the latter sets titleManuallySet,
		// which would make an AI title indistinguishable from the user's own.
		await manager.saveSession({...fresh, title, titleGenerated: true});
		onTitle?.(title);
	} finally {
		// Runs on the throw path too, so a failure cannot wedge the session
		// out of ever being titled again.
		clearTimeout(timer);
		inFlight.delete(sessionId);
	}
}
