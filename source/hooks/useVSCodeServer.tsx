import {readFile} from 'node:fs/promises';
import {useCallback, useEffect, useRef, useState} from 'react';
import {DEFAULT_PORT, getVSCodeServer, VSCodeServer} from '@/vscode/index';
import type {DiagnosticInfo} from '@/vscode/protocol';
import type {ActiveEditorState} from '@/vscode/vscode-server';

interface UseVSCodeServerProps {
	enabled: boolean;
	port?: number;
	currentModel?: string;
	currentProvider?: string;
	onPrompt?: (
		prompt: string,
		context?: {
			filePath?: string;
			selection?: string;
			cursorPosition?: {line: number; character: number};
		},
	) => void;
	onDiagnosticsReceived?: (diagnostics: DiagnosticInfo[]) => void;
}

interface UseVSCodeServerReturn {
	isConnected: boolean;
	connectionCount: number;
	actualPort: number | null;
	requestedPort: number;
	activeEditor: ActiveEditorState | null;
	dismissActiveEditor: () => void;
	sendAssistantMessage: (content: string, isGenerating?: boolean) => void;
	notifyFileChange: (
		filePath: string,
		originalContent: string,
		newContent: string,
		toolName: string,
		toolArgs: Record<string, unknown>,
	) => string | null;
	requestDiagnostics: (filePath?: string) => void;
	updateStatus: () => void;
}

// Signature that identifies a specific active-editor state for dismissal.
// If the live state matches this key, we suppress the pill. When VS Code
// pushes a different state (new file, changed selection), the key differs
// and the pill reappears. Exported for unit testing.
export function activeEditorKey(
	state: ActiveEditorState | null,
): string | null {
	if (!state?.filePath) return null;
	return `${state.filePath}:${state.startLine ?? ''}-${state.endLine ?? ''}`;
}

/**
 * Hook to manage VS Code server integration
 */
export function useVSCodeServer({
	enabled,
	port = DEFAULT_PORT,
	currentModel,
	currentProvider,
	onPrompt,
	onDiagnosticsReceived,
}: UseVSCodeServerProps): UseVSCodeServerReturn {
	const serverRef = useRef<VSCodeServer | null>(null);
	const [isConnected, setIsConnected] = useState(false);
	const [connectionCount, setConnectionCount] = useState(0);
	const [actualPort, setActualPort] = useState<number | null>(null);
	const [rawActiveEditor, setRawActiveEditor] =
		useState<ActiveEditorState | null>(null);
	const [dismissedKey, setDismissedKey] = useState<string | null>(null);

	// Store callbacks in refs to avoid re-creating server on callback changes
	const onPromptRef = useRef(onPrompt);
	const onDiagnosticsReceivedRef = useRef(onDiagnosticsReceived);
	const currentModelRef = useRef(currentModel);
	const currentProviderRef = useRef(currentProvider);

	// Keep refs up to date
	useEffect(() => {
		onPromptRef.current = onPrompt;
	}, [onPrompt]);

	useEffect(() => {
		onDiagnosticsReceivedRef.current = onDiagnosticsReceived;
	}, [onDiagnosticsReceived]);

	useEffect(() => {
		currentModelRef.current = currentModel;
	}, [currentModel]);

	useEffect(() => {
		currentProviderRef.current = currentProvider;
	}, [currentProvider]);

	// Initialize server on mount if enabled
	useEffect(() => {
		if (!enabled) {
			return;
		}

		const initServer = async () => {
			const server = await getVSCodeServer(port);
			serverRef.current = server;

			// Set up callbacks using refs
			server.onCallbacks({
				onPrompt: (prompt, context) => {
					onPromptRef.current?.(prompt, context);
				},
				onDiagnosticsResponse: diagnostics => {
					onDiagnosticsReceivedRef.current?.(diagnostics);
				},
				onActiveEditor: state => {
					setRawActiveEditor(state.filePath ? state : null);
				},
				onConnect: () => {
					setIsConnected(true);
					setConnectionCount(server.getConnectionCount());
					// Send current status
					if (currentModelRef.current || currentProviderRef.current) {
						server.sendStatus(
							currentModelRef.current,
							currentProviderRef.current,
						);
					}
				},
				onDisconnect: () => {
					const hasConnections = server.hasConnections();
					setIsConnected(hasConnections);
					setConnectionCount(server.getConnectionCount());
					if (!hasConnections) {
						setRawActiveEditor(null);
						setDismissedKey(null);
					}
				},
			});

			// Start the server
			await server.start();
			setActualPort(server.getPort());
		};

		void initServer();

		// Cleanup on unmount
		return () => {
			if (serverRef.current) {
				void serverRef.current.stop();
				serverRef.current = null;
			}
		};
	}, [enabled, port]);

	// Update status when model/provider changes
	useEffect(() => {
		if (serverRef.current && enabled && isConnected) {
			serverRef.current.sendStatus(currentModel, currentProvider);
		}
	}, [enabled, currentModel, currentProvider, isConnected]);

	const sendAssistantMessage = useCallback(
		(content: string, isGenerating = false) => {
			if (serverRef.current && enabled) {
				serverRef.current.sendAssistantMessage(content, isGenerating);
			}
		},
		[enabled],
	);

	const notifyFileChange = useCallback(
		(
			filePath: string,
			originalContent: string,
			newContent: string,
			toolName: string,
			toolArgs: Record<string, unknown>,
		): string | null => {
			if (serverRef.current && enabled && isConnected) {
				return serverRef.current.sendFileChange(
					filePath,
					originalContent,
					newContent,
					toolName,
					toolArgs,
				);
			}
			return null;
		},
		[enabled, isConnected],
	);

	const requestDiagnostics = useCallback(
		(filePath?: string) => {
			if (serverRef.current && enabled) {
				serverRef.current.requestDiagnostics(filePath);
			}
		},
		[enabled],
	);

	const updateStatus = useCallback(() => {
		if (serverRef.current && enabled) {
			serverRef.current.sendStatus(currentModel, currentProvider);
		}
	}, [enabled, currentModel, currentProvider]);

	// Suppress the pill when the live state matches the dismissed key. As
	// soon as VS Code pushes a different file/selection the key differs and
	// the pill reappears.
	const rawKey = activeEditorKey(rawActiveEditor);
	const activeEditor =
		rawKey && rawKey === dismissedKey ? null : rawActiveEditor;

	const dismissActiveEditor = useCallback(() => {
		setDismissedKey(activeEditorKey(rawActiveEditor));
	}, [rawActiveEditor]);

	return {
		isConnected,
		connectionCount,
		actualPort,
		requestedPort: port,
		activeEditor,
		dismissActiveEditor,
		sendAssistantMessage,
		notifyFileChange,
		requestDiagnostics,
		updateStatus,
	};
}

/**
 * Check if VS Code mode was requested via CLI flag
 */
export function isVSCodeModeEnabled(): boolean {
	return process.argv.includes('--vscode');
}

/**
 * Get VS Code server port from CLI args or default
 */
export function getVSCodePort(): number {
	const portArgIndex = process.argv.findIndex(
		arg => arg === '--vscode-port' || arg === '-p',
	);
	if (portArgIndex !== -1 && process.argv[portArgIndex + 1]) {
		const port = parseInt(process.argv[portArgIndex + 1], 10);
		if (!isNaN(port) && port > 0 && port < 65536) {
			return port;
		}
	}
	return DEFAULT_PORT;
}

/**
 * Helper to create file change notification with automatic content reading
 */
export async function createFileChangeFromTool(
	filePath: string,
	newContent: string,
	_toolName: string,
	_toolArgs: Record<string, unknown>,
): Promise<{
	originalContent: string;
	newContent: string;
}> {
	let originalContent = '';
	try {
		originalContent = await readFile(filePath, 'utf-8');
	} catch {
		// File doesn't exist or can't be read - that's fine for create operations
	}

	return {
		originalContent,
		newContent,
	};
}
