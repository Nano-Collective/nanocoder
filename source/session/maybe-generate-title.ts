import {getAppConfig} from '@/config/index';
import type {LLMClient, Message} from '@/types/core';
import {getLogger} from '@/utils/logging';
import {type SessionManager, sessionManager} from './session-manager';
import {resolveTitleClient} from './title-client';
import {
	extractToolSummaries,
	extractUserMessages,
	generateSessionTitle,
	isWeakTitle,
} from './title-generator';

/** Local models can be slow, but a cosmetic title is never worth hanging on. */
const TITLE_TIMEOUT_MS = 20_000;

/** Stops two turns finishing close together from both launching a call. */
const inFlight = new Set<string>();

/** Test seam. Production code never calls this. */
export function resetTitleGenerationState(): void {
	inFlight.clear();
}

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
	/** Test seam, so the wedged-provider case need not wait the real 20s. */
	timeoutMs?: number;
}

/**
 * Give a session a real name, at most once, and only when the cheap heuristic
 * title is too thin to be useful. Every failure path is silent: the heuristic
 * title stands and the turn is unaffected.
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
	const timeoutMs = options.timeoutMs ?? TITLE_TIMEOUT_MS;
	const manager = options.manager ?? sessionManager;

	// Every guard from here to inFlight.add() is synchronous. Nothing may await
	// in between, or two turns finishing together both pass the check and both
	// make a call - the exact case this set exists to prevent.
	if (getAppConfig().sessions?.smartTitles === false) return;
	if (inFlight.has(sessionId)) return;

	const firstUser = messages.find(m => m.role === 'user');
	if (!firstUser || typeof firstUser.content !== 'string') return;
	if (!messages.some(m => m.role === 'assistant')) return;
	if (!isWeakTitle(firstUser.content)) return;

	const toolSummaries = extractToolSummaries(messages);
	const userMessages = extractUserMessages(messages);
	if (userMessages.length < 2 && toolSummaries.length === 0) return;

	inFlight.add(sessionId);
	// Not the session's own controller: AcpSession.cancel() swaps that one out,
	// so borrowing it would leave this call attached to a stale controller.
	const timeout = new AbortController();
	let timer: ReturnType<typeof setTimeout> | undefined;

	try {
		const session = await manager.readSession(sessionId);
		if (!session) return;
		if (session.titleManuallySet || session.titleGenerated) return;

		const assistantReply = messages.find(
			m =>
				m.role === 'assistant' &&
				typeof m.content === 'string' &&
				m.content.trim().length > 0,
		)?.content;

		// The abort signal asks the provider to stop; the race is what makes the
		// bound hold. A provider that ignores the signal would otherwise leave
		// this promise unsettled, and with it the inFlight entry, so the session
		// could never be titled again for the process lifetime.
		const deadline = new Promise<null>(resolve => {
			timer = setTimeout(() => {
				timeout.abort();
				resolve(null);
			}, timeoutMs);
		});

		const title = await Promise.race([
			(async () => {
				const titleClient = await resolveTitleClient(client);
				return generateSessionTitle(
					titleClient,
					{userMessages, toolSummaries, assistantReply},
					timeout.signal,
				);
			})(),
			deadline,
		]);
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
		if (timer) clearTimeout(timer);
		inFlight.delete(sessionId);
	}
}
