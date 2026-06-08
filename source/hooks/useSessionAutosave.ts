import {useEffect, useRef} from 'react';
import {getAppConfig} from '@/config/index';
import {sessionManager} from '@/session/session-manager';
import type {Message} from '@/types/core';
import {formatError} from '@/utils/error-formatter';
import {logWarning} from '@/utils/message-queue';

interface UseSessionAutosaveProps {
	messages: Message[];
	currentProvider: string;
	currentModel: string;
	currentSessionId: string | null;
	setCurrentSessionId: (id: string | null) => void;
}

/**
 * Hook to handle automatic session saving.
 * Updates the current session when currentSessionId is set; otherwise creates a new session.
 * Clears currentSessionId when messages are cleared.
 *
 * Race safety: saves are serialised through a single chained promise stored in
 * saveChainRef. A new save does not start until the previous one resolves, so
 * only one createSession() call can be in-flight per conversation regardless of
 * how many times the effect fires within a single turn.
 *
 * Persistence integrity: the full message array is always written to disk.
 * maxMessages bounds only what is sent to the model (enforced at prompt-build
 * time), not what is stored in the session file.
 */
export function useSessionAutosave({
	messages,
	currentProvider,
	currentModel,
	currentSessionId,
	setCurrentSessionId,
}: UseSessionAutosaveProps) {
	const initPromiseRef = useRef<Promise<boolean> | null>(null);
	const timeoutRef = useRef<NodeJS.Timeout | null>(null);
	const lastSaveRef = useRef<number>(0);

	// Serialises saves: each new save is chained onto the tail of this promise.
	// Replacing void saveSession() calls with promise chaining means two rapid
	// effect invocations cannot both observe currentSessionId === null and both
	// call createSession() — the second save starts only after the first has
	// already called setCurrentSessionId().
	const saveChainRef = useRef<Promise<void>>(Promise.resolve());

	// Clear current session when conversation is cleared
	useEffect(() => {
		if (messages.length === 0 && currentSessionId !== null) {
			setCurrentSessionId(null);
		}
	}, [messages.length, currentSessionId, setCurrentSessionId]);

	// Initialize session manager only when autosave is enabled (avoids creating
	// sessions dir/index and running retention when user has autosave off).
	// /resume initializes the manager when the user explicitly runs it.
	useEffect(() => {
		const config = getAppConfig();
		const autoSave = config.sessions?.autoSave ?? true;
		if (!autoSave) {
			return;
		}

		if (!initPromiseRef.current) {
			initPromiseRef.current = sessionManager
				.initialize()
				.then(() => true)
				.catch(error => {
					logWarning(
						`Session autosave disabled: failed to initialize session storage. ${formatError(error)}`,
					);
					return false;
				});
		}

		return () => {
			if (timeoutRef.current) {
				clearTimeout(timeoutRef.current);
			}
		};
	}, []);

	// Auto-save when messages change (debounced by saveInterval)
	useEffect(() => {
		const config = getAppConfig();
		const sessionConfig = config.sessions;
		const autoSave = sessionConfig?.autoSave ?? true;
		const saveInterval = sessionConfig?.saveInterval ?? 30000;

		if (!autoSave || !initPromiseRef.current || messages.length === 0) {
			return;
		}

		if (timeoutRef.current) {
			clearTimeout(timeoutRef.current);
		}

		const now = Date.now();
		const timeSinceLastSave = now - lastSaveRef.current;

		// Capture all values needed for this save at the time the effect ran.
		// The closure must not close over mutable refs that could change before
		// the chained promise executes.
		const capturedMessages = messages;
		const capturedProvider = currentProvider;
		const capturedModel = currentModel;
		const capturedSessionId = currentSessionId;

		const doSave = async () => {
			try {
				// Wait for initialization to complete before saving
				const initialized = await initPromiseRef.current;
				if (!initialized) return;

				// Derive a human-readable title from the most recent user message.
				// Use the full message array — the model-context cap (maxMessages)
				// is NOT applied here; it is enforced at prompt-build time so that
				// the full conversation history is always preserved on disk.
				const userMessages = capturedMessages.filter(
					msg => msg.role === 'user',
				);
				const lastUserMessage = userMessages[userMessages.length - 1];
				const title = lastUserMessage
					? lastUserMessage.content.substring(0, 50) +
						(lastUserMessage.content.length > 50 ? '...' : '')
					: `Session ${new Date().toLocaleDateString()}`;

				// Re-check capturedSessionId (captured at effect time) to decide
				// create vs update. Because saves are serialised via saveChainRef,
				// a prior save in the same chain will already have called
				// setCurrentSessionId before this closure runs, but React state
				// updates are async — capturedSessionId reflects what React had at
				// effect-fire time, which is the correct value for this save slot.
				if (capturedSessionId) {
					const session = await sessionManager.readSession(capturedSessionId);
					if (session) {
						// Write the full history — no truncation.
						session.messages = capturedMessages;
						session.messageCount = capturedMessages.length;
						session.title = title;
						session.provider = capturedProvider;
						session.model = capturedModel;
						// Don't set lastAccessedAt here — saveSession() handles
						// the timestamp in both the file and index consistently.
						await sessionManager.saveSession(session);
					} else {
						// The stored session was deleted externally; create a fresh one.
						const newSession = await sessionManager.createSession({
							title,
							messageCount: capturedMessages.length,
							provider: capturedProvider,
							model: capturedModel,
							workingDirectory: process.cwd(),
							messages: capturedMessages,
						});
						setCurrentSessionId(newSession.id);
					}
				} else {
					// No session yet for this conversation — create one.
					// Because doSave() runs serially inside saveChainRef, at most
					// one createSession() call executes per conversation even if the
					// effect fired several times before this point.
					const newSession = await sessionManager.createSession({
						title,
						messageCount: capturedMessages.length,
						provider: capturedProvider,
						model: capturedModel,
						workingDirectory: process.cwd(),
						messages: capturedMessages,
					});
					setCurrentSessionId(newSession.id);
				}

				lastSaveRef.current = Date.now();
			} catch (error) {
				console.warn('Failed to auto-save session:', error);
			}
		};

		const schedule = () => {
			// Chain onto the tail of any in-flight save so saves are never
			// concurrent. Errors inside doSave() are swallowed there; the chain
			// itself must not reject so future saves are not blocked.
			saveChainRef.current = saveChainRef.current.then(doSave, doSave);
		};

		if (timeSinceLastSave >= saveInterval) {
			schedule();
		} else {
			const delay = saveInterval - timeSinceLastSave;
			timeoutRef.current = setTimeout(schedule, delay);
		}
	}, [
		messages,
		currentProvider,
		currentModel,
		currentSessionId,
		setCurrentSessionId,
	]);
}
