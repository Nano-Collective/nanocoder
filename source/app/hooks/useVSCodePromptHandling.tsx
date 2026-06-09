import path from 'node:path';
import {useCallback, useMemo, useRef} from 'react';
import {generateCorrelationId} from '@/utils/logging';
import type {Logger} from '@/utils/logging/types';
import type {ActiveEditorState} from '@/vscode/vscode-server';

interface VSCodePromptContext {
	filePath?: string;
	selection?: string;
	fileName?: string;
	startLine?: number;
	endLine?: number;
	cursorPosition?: {line: number; character: number};
}

interface VSCodePromptDispatcher {
	/**
	 * Stable callback handed to `useVSCodeServer` for prompts pushed in from
	 * the extension. Builds a fully formatted message (with file/selection
	 * context) and forwards it to whichever `handleMessageSubmit` is currently
	 * bound via {@link bindMessageSubmit}.
	 */
	handleVSCodePrompt: (prompt: string, context?: VSCodePromptContext) => void;
	/**
	 * Bind (or re-bind) the chat input's `handleMessageSubmit`. Called once
	 * `useAppHandlers` produces it; the dispatcher needs to exist earlier than
	 * that because `useVSCodeServer` consumes the prompt callback.
	 */
	bindMessageSubmit: (handleMessageSubmit: (message: string) => void) => void;
}

function buildPromptWithContext(
	prompt: string,
	context?: VSCodePromptContext,
): string {
	if (context?.selection && context?.fileName) {
		const lineInfo =
			context.startLine && context.endLine
				? ` (lines ${context.startLine}-${context.endLine})`
				: '';
		return `${prompt}\n\n[@${context.fileName}${lineInfo}]<!--vscode-context-->\n\`\`\`\n${context.selection}\n\`\`\`<!--/vscode-context-->`;
	}
	if (context?.fileName) {
		const relPath = context.filePath
			? path.relative(process.cwd(), context.filePath)
			: context.fileName;
		return `${prompt}\n\n[@${context.fileName}]<!--vscode-context-->\nFile: ${relPath}<!--/vscode-context-->`;
	}
	return prompt;
}

function buildPromptWithActiveEditor(
	message: string,
	editor: ActiveEditorState | null,
): string {
	if (!editor?.fileName) return message;

	// Bash (!) and slash (/) commands are handled locally — appending the
	// editor pill would either corrupt the bash command or attach noise to
	// a slash command that never reaches the LLM.
	const trimmed = message.trim();
	if (trimmed.startsWith('!') || trimmed.startsWith('/')) return message;

	const hasSelection = !!editor.selection && editor.startLine && editor.endLine;
	if (hasSelection) {
		return `${message}\n\n[@${editor.fileName} (lines ${editor.startLine}-${editor.endLine})]<!--vscode-context-->\n\`\`\`\n${editor.selection}\n\`\`\`<!--/vscode-context-->`;
	}

	const relPath = editor.filePath
		? path.relative(process.cwd(), editor.filePath)
		: editor.fileName;
	return `${message}\n\n[@${editor.fileName}]<!--vscode-context-->\nFile: ${relPath}<!--/vscode-context-->`;
}

/**
 * Owns the prompt dispatcher half of the VS Code integration. Returns a
 * stable `handleVSCodePrompt` for `useVSCodeServer` plus a `bindMessageSubmit`
 * setter that App calls after `useAppHandlers` is constructed. The split
 * exists because `useVSCodeServer` runs before `useAppHandlers`, but
 * VS Code prompts can only be answered once the chat input is alive.
 */
export function useVSCodePromptDispatcher({
	logger,
}: {
	logger: Logger;
}): VSCodePromptDispatcher {
	const handleMessageSubmitRef = useRef<((message: string) => void) | null>(
		null,
	);

	const handleVSCodePrompt = useCallback(
		(prompt: string, context?: VSCodePromptContext) => {
			const correlationId = generateCorrelationId();

			logger.info('VS Code prompt received', {
				promptLength: prompt.length,
				hasContext: !!context,
				filePath: context?.filePath,
				hasSelection: !!context?.selection,
				cursorPosition: context?.cursorPosition,
				correlationId,
			});

			const fullPrompt = buildPromptWithContext(prompt, context);

			logger.debug('VS Code enhanced prompt prepared', {
				enhancedPromptLength: fullPrompt.length,
				correlationId,
			});

			if (handleMessageSubmitRef.current) {
				handleMessageSubmitRef.current(fullPrompt);
			} else {
				logger.warn(
					'VS Code prompt received but handleMessageSubmit not ready',
					{
						correlationId,
					},
				);
			}
		},
		[logger],
	);

	const bindMessageSubmit = useCallback(
		(handleMessageSubmit: (message: string) => void) => {
			handleMessageSubmitRef.current = handleMessageSubmit;
		},
		[],
	);

	return useMemo(
		() => ({handleVSCodePrompt, bindMessageSubmit}),
		[handleVSCodePrompt, bindMessageSubmit],
	);
}

/**
 * Wraps the chat input submission with the active VS Code editor pill so the
 * user's typed message is augmented with file/selection context when an
 * editor is focused.
 */
export function useUserSubmit({
	handleMessageSubmit,
	activeEditor,
}: {
	handleMessageSubmit: (
		message: string,
		displayValue?: string,
	) => Promise<void>;
	activeEditor: ActiveEditorState | null;
}): (message: string, displayValue: string) => Promise<void> {
	return useCallback(
		(message: string, displayValue: string) => {
			// Append the editor pill to both copies: `message` (sent to the LLM,
			// with @-mentions already expanded) and `displayValue` (the bubble,
			// with @-mentions kept as [@file] placeholders). Keeping them in sync
			// is what stops the placeholder display from falling back to the raw
			// expanded message.
			const fullPrompt = buildPromptWithActiveEditor(message, activeEditor);
			const fullDisplay = buildPromptWithActiveEditor(
				displayValue,
				activeEditor,
			);
			return handleMessageSubmit(fullPrompt, fullDisplay);
		},
		[activeEditor, handleMessageSubmit],
	);
}
