import {useCallback, useEffect, useRef} from 'react';
import {getAppConfig} from '@/config/index';
import {sessionManager} from '@/session/session-manager';
import type {Message} from '@/types/core';
import {formatError} from '@/utils/error-formatter';
import {logWarning} from '@/utils/message-queue';
import {getShutdownManager} from '@/utils/shutdown';

interface UseSessionAutosaveProps {
	messages: Message[];
	currentProvider: string;
	currentModel: string;
	currentSessionId: string | null;
	setCurrentSessionId: (id: string | null) => void;
}

const SHUTDOWN_HANDLER_NAME = 'session-autosave-flush';

/**
 * Hook to handle automatic session saving.
 * Updates the current session when currentSessionId is set; otherwise creates a new session.
 * Clears currentSessionId when messages are cleared.
 *
 * Race safety: saves are serialised through a single chained promise stored in
 * saveChainRef. A new save does not start until the previous one resolves.
 * Critically, runSave reads currentSessionIdRef.current AFTER the
 * initPromiseRef await so it sees the value set by any prior save in the same
 * chain - not the stale captured value from effect-fire time. This guarantees
 * at most one createSession() call per conversation even when the effect fires
 * several times before React flushes any setCurrentSessionId update.
 *
 * Persistence integrity: the full message array is always written to disk.
 * maxMessages bounds only what is sent to the model (enforced in the
 * conversation loop before the LLM call), not what is stored in the
 * session file.
 *
 * Flush-on-exit: the debounced save (default 30s) means a quit right after
 * the last message could lose the tail. A shutdown handler (registered once
 * below, priority -10 so it runs before cli.tsx's terminal-teardown handler)
 * chains one final save with the live messages/provider/model onto the same
 * saveChainRef the debounced path uses, so it can never race a pending save.
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
	const saveChainRef = useRef<Promise<void>>(Promise.resolve());

	// Live mirror of currentSessionId. runSave reads this ref after the
	// initPromiseRef await (i.e. at execution time, not effect-fire time) so
	// it sees the ID written by any prior save in the same chain.
	const currentSessionIdRef = useRef<string | null>(currentSessionId);
	useEffect(() => {
		currentSessionIdRef.current = currentSessionId;
	}, [currentSessionId]);

	// Live mirrors of messages/provider/model for flush(), which runs at exit
	// time (not from the messages-changed effect below) and needs whatever was
	// most recently rendered, not a value captured at some earlier effect fire.
	const messagesRef = useRef<Message[]>(messages);
	const providerRef = useRef<string>(currentProvider);
	const modelRef = useRef<string>(currentModel);
	useEffect(() => {
		messagesRef.current = messages;
	}, [messages]);
	useEffect(() => {
		providerRef.current = currentProvider;
	}, [currentProvider]);
	useEffect(() => {
		modelRef.current = currentModel;
	}, [currentModel]);

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

	// Core save routine, shared by the debounced auto-save effect and flush().
	const runSave = useCallback(
		async (
			capturedMessages: Message[],
			capturedProvider: string,
			capturedModel: string,
		) => {
			try {
				// Wait for initialization to complete before saving
				const initialized = await initPromiseRef.current;
				if (!initialized || capturedMessages.length === 0) return;

				// Read the live session ID AFTER the await above. Any prior save
				// in this chain has already called setCurrentSessionId (and updated
				// currentSessionIdRef.current) by this point, so we correctly take
				// the update path instead of calling createSession() again.
				const liveSessionId = currentSessionIdRef.current;

				// Derive a human-readable title from the most recent user message.
				// The full message array is always written - maxMessages bounds only
				// what is sent to the model (sliced in the conversation loop).
				const userMessages = capturedMessages.filter(
					msg => msg.role === 'user',
				);
				const lastUserMessage = userMessages[userMessages.length - 1];
				const title = lastUserMessage
					? lastUserMessage.content.substring(0, 50) +
						(lastUserMessage.content.length > 50 ? '...' : '')
					: `Session ${new Date().toLocaleDateString()}`;

				if (liveSessionId) {
					const session = await sessionManager.readSession(liveSessionId);
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
						// Update the ref immediately so any subsequent save in this
						// chain takes the update path, not another createSession().
						currentSessionIdRef.current = newSession.id;
						setCurrentSessionId(newSession.id);
					}
				} else {
					// No session yet for this conversation — create one.
					// Because runSave() runs serially inside saveChainRef and reads
					// the live ref, at most one createSession() call executes per
					// conversation even if it's invoked several times in a row.
					const newSession = await sessionManager.createSession({
						title,
						messageCount: capturedMessages.length,
						provider: capturedProvider,
						model: capturedModel,
						workingDirectory: process.cwd(),
						messages: capturedMessages,
					});
					// Update the ref immediately so any subsequent save in this
					// chain takes the update path, not another createSession().
					currentSessionIdRef.current = newSession.id;
					setCurrentSessionId(newSession.id);
				}

				lastSaveRef.current = Date.now();
			} catch (error) {
				console.warn('Failed to auto-save session:', error);
			}
		},
		[setCurrentSessionId],
	);

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

		// Capture message content at effect-fire time. Provider/model are also
		// captured here since they describe this particular save slot.
		// Note: we do NOT capture currentSessionId here - runSave reads the live
		// ref at execution time so it sees any ID set by a prior save in the chain.
		const capturedMessages = messages;
		const capturedProvider = currentProvider;
		const capturedModel = currentModel;

		const schedule = () => {
			// Chain onto the tail of any in-flight save so saves are never
			// concurrent. Errors inside runSave() are swallowed there; the chain
			// itself must not reject so future saves are not blocked.
			const doSave = () =>
				runSave(capturedMessages, capturedProvider, capturedModel);
			saveChainRef.current = saveChainRef.current.then(doSave, doSave);
		};

		if (timeSinceLastSave >= saveInterval) {
			schedule();
		} else {
			const delay = saveInterval - timeSinceLastSave;
			timeoutRef.current = setTimeout(schedule, delay);
		}
	}, [messages, currentProvider, currentModel, runSave]);

	// Final synchronous-ish flush on exit: cancels any pending debounced timer
	// and chains one last save with the live (ref) messages onto the same
	// saveChainRef the debounced path uses, so it can't race a save already
	// in flight. No-ops if autosave was never initialized (disabled) or there
	// are no messages to persist.
	const flush = useCallback(async () => {
		if (!initPromiseRef.current) return;
		if (timeoutRef.current) {
			clearTimeout(timeoutRef.current);
			timeoutRef.current = null;
		}
		const capturedMessages = messagesRef.current;
		const capturedProvider = providerRef.current;
		const capturedModel = modelRef.current;
		const finalSave = () =>
			runSave(capturedMessages, capturedProvider, capturedModel);
		saveChainRef.current = saveChainRef.current.then(finalSave, finalSave);
		await saveChainRef.current;
	}, [runSave]);

	// Register the flush as a shutdown handler once. Priority -10 runs it
	// before cli.tsx's 'tui-exit-render' handler (priority 0), so the save
	// completes while the process is still fully alive.
	useEffect(() => {
		const manager = getShutdownManager();
		manager.register({
			name: SHUTDOWN_HANDLER_NAME,
			priority: -10,
			handler: flush,
		});
		return () => manager.unregister(SHUTDOWN_HANDLER_NAME);
	}, [flush]);
}
