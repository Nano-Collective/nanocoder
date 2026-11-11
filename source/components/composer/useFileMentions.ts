import {useCallback, useEffect, useState} from 'react';
import {useUIStateContext} from '@/hooks/useUIState';
import {getToolManager} from '@/message-handler';
import type {InputState} from '@/types/hooks';
import {
	getCurrentFileMention,
	getFileCompletions,
} from '@/utils/file-autocomplete';
import {handleFileMention} from '@/utils/file-mention-handler';
import {fuzzyScoreFilePath} from '@/utils/fuzzy-matching';
import {handleResourceMention} from '@/utils/resource-mention-handler';

export interface MentionCompletion {
	path: string;
	displayPath: string;
	resourceName?: string;
	score: number;
}

// An MCP resource shares the file-mention `@` trigger and completion list,
// distinguished from a filesystem path by this prefix so selecting it knows
// which resolver to call. `resource.uri` can itself contain colons (e.g.
// `file:///…`), so the prefix only wraps the leading `serverName` and is
// split off with a bounded split rather than a plain `:` join/parse.
const MCP_RESOURCE_PATH_PREFIX = 'mcp-resource:';

function encodeMCPResourcePath(serverName: string, uri: string): string {
	return `${MCP_RESOURCE_PATH_PREFIX}${serverName}:${uri}`;
}

export function decodeMCPResourcePath(
	path: string,
): {serverName: string; uri: string} | null {
	if (!path.startsWith(MCP_RESOURCE_PATH_PREFIX)) return null;
	const rest = path.slice(MCP_RESOURCE_PATH_PREFIX.length);
	const separatorIndex = rest.indexOf(':');
	if (separatorIndex === -1) return null;
	return {
		serverName: rest.slice(0, separatorIndex),
		uri: rest.slice(separatorIndex + 1),
	};
}

/**
 * MCP resources from every connected server, scored against the partial
 * `@mention` the same way local files are, and merged into the same
 * completion list. Mirrors `getFileCompletions`'s shape and score-based
 * filtering so the two sources sort together without special-casing.
 */
async function getMCPResourceCompletions(partialPath: string): Promise<
	Array<{
		path: string;
		displayPath: string;
		resourceName: string;
		score: number;
		isDirectory: boolean;
	}>
> {
	const mcpClient = getToolManager()?.getMCPClient();
	if (!mcpClient) return [];

	return mcpClient
		.getAllResources()
		.map(resource => ({
			path: encodeMCPResourcePath(resource.serverName, resource.uri),
			// displayPath is for the completion list UI only — it must never be
			// used as the resourceName passed to handleResourceMention, or the
			// "(serverName)" suffix it carries gets stamped a second time by the
			// assembled prompt header (see prompt-processor.ts's RESOURCE case).
			displayPath: `${resource.name} (${resource.serverName})`,
			resourceName: resource.name,
			score: fuzzyScoreFilePath(resource.name, partialPath),
			isDirectory: false,
		}))
		.filter(c => c.score > 0);
}

interface UseFileMentionsOptions {
	/** The composer's current text. */
	input: string;
	/** The composer's current text plus placeholder content. */
	currentState: InputState;
	setInputState: (state: InputState) => void;
	/**
	 * Called after a mention replaces the input, so TextInput remounts with
	 * the caret at the end. Must be stable across renders.
	 */
	onInputReplaced: () => void;
}

/**
 * `@` mentions in the composer: the file / MCP-resource autocomplete list for
 * the mention under the caret, its selection, attaching the selected entry as
 * a placeholder, and attaching files handed over by the file explorer.
 */
export function useFileMentions({
	input,
	currentState,
	setInputState,
	onInputReplaced,
}: UseFileMentionsOptions) {
	const [isActive, setIsActive] = useState(false);
	const [completions, setCompletions] = useState<MentionCompletion[]>([]);
	const [selectedIndex, setSelectedIndex] = useState(0);
	const {pendingFileMentions, setPendingFileMentions} = useUIStateContext();

	// Consume pending file mentions from the explorer and attach each one as a
	// placeholder, exactly as if it had been typed and selected.
	useEffect(() => {
		if (pendingFileMentions.length === 0) return;

		const attachFiles = async () => {
			let state = currentState;
			let displayValue = state.displayValue;

			for (const filePath of pendingFileMentions) {
				const mentionText = `@${filePath}`;
				displayValue = displayValue
					? `${displayValue} ${mentionText}`
					: mentionText;

				const result = await handleFileMention(
					filePath,
					displayValue,
					state.placeholderContent,
					mentionText,
				);

				if (result) {
					state = result;
					displayValue = result.displayValue;
				}
			}

			setInputState(state);
			onInputReplaced();
			setPendingFileMentions([]);
		};

		void attachFiles();
	}, [
		pendingFileMentions,
		currentState,
		setInputState,
		onInputReplaced,
		setPendingFileMentions,
	]);

	// Recompute the list whenever the input changes.
	useEffect(() => {
		const runFileAutocomplete = async () => {
			const mention = getCurrentFileMention(input, input.length);

			if (mention) {
				setIsActive(true);
				const cwd = process.cwd();
				const [files, resources] = await Promise.all([
					getFileCompletions(mention.mention, cwd),
					getMCPResourceCompletions(mention.mention),
				]);
				setCompletions(
					[...files, ...resources]
						.sort((a, b) => b.score - a.score)
						.slice(0, 20),
				);
				setSelectedIndex(0); // Reset selection when completions change
			} else {
				setIsActive(false);
				setCompletions([]);
				setSelectedIndex(0);
			}
		};

		void runFileAutocomplete();
	}, [input]);

	/** Close the list until the input changes again (Escape, Space, Ctrl+R). */
	const dismiss = useCallback(() => {
		setIsActive(false);
		setCompletions([]);
	}, []);

	/**
	 * Move the highlighted entry, wrapping at either end. Returns false (and
	 * does nothing) when there is no list to move through.
	 */
	const moveSelection = (direction: 'up' | 'down'): boolean => {
		if (!isActive || completions.length === 0) return false;
		setSelectedIndex(prev =>
			direction === 'up'
				? prev > 0
					? prev - 1
					: completions.length - 1
				: prev < completions.length - 1
					? prev + 1
					: 0,
		);
		return true;
	};

	/**
	 * Attach the highlighted entry in place of the mention under the caret.
	 * Resolves true when the input was replaced.
	 */
	const selectCurrent = useCallback(async () => {
		if (!isActive || completions.length === 0) {
			return false;
		}

		const mention = getCurrentFileMention(input, input.length);
		if (!mention) {
			return false;
		}

		const selectedPath = completions[selectedIndex]?.path;
		if (!selectedPath) {
			return false;
		}

		// The original mention text (the @... part being replaced).
		const mentionText = input.substring(mention.startIndex, mention.endIndex);

		// An MCP resource and a filesystem file share this completion list and
		// are resolved by different readers, told apart by the path prefix.
		const decoded = decodeMCPResourcePath(selectedPath);
		const mcpClient = decoded ? getToolManager()?.getMCPClient() : undefined;
		const result =
			decoded && mcpClient
				? await handleResourceMention(
						mcpClient,
						decoded.serverName,
						decoded.uri,
						completions[selectedIndex]?.resourceName ?? decoded.uri,
						currentState.displayValue,
						currentState.placeholderContent,
						mentionText,
					)
				: await handleFileMention(
						selectedPath,
						currentState.displayValue,
						currentState.placeholderContent,
						mentionText,
					);

		if (result) {
			setInputState(result);
			setIsActive(false);
			setCompletions([]);
			setSelectedIndex(0);
			onInputReplaced();
			return true;
		}

		return false;
	}, [
		isActive,
		completions,
		selectedIndex,
		input,
		currentState,
		setInputState,
		onInputReplaced,
	]);

	return {
		isActive,
		completions,
		selectedIndex,
		dismiss,
		moveSelection,
		selectCurrent,
	};
}
