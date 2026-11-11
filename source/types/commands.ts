import type {ApiCallRecord, ApiUsageSnapshot, Message} from '@/types/core';

/** What every command declares, whichever way it runs. */
interface CommandMetadata {
	name: string;
	description: string;
	/**
	 * Opt into a live spinner while the handler runs. Set this on commands that
	 * do a slow round-trip (LLM call, network) before returning, so the UI is
	 * not silent for seconds. Present tense, no trailing ellipsis.
	 */
	progressLabel?: string;
	/** Echo the submitted slash command into chat before showing its result. */
	echoInvocation?: boolean;
	/**
	 * Leave the command out of the `/help` list. It still runs, completes in
	 * the slash menu, and has its own `/help <name>` page.
	 */
	hidden?: boolean;
}

/**
 * A command that only reads what it is given and returns something to show:
 * a React element, a string, or nothing.
 */
export interface Command<T = React.ReactElement | void>
	extends CommandMetadata {
	handler: (
		args: string[],
		messages: Message[],
		metadata: {
			provider: string;
			model: string;
			tokens: number;
			getMessageTokens: (message: Message) => number;
			client?: import('@/types/core').LLMClient | null;
			tune?: import('@/types/config').TuneConfig;
			developmentMode?: import('@/types/core').DevelopmentMode;
			lastApiUsage?: ApiUsageSnapshot | null;
			apiCallHistory?: ApiCallRecord[];
			sessionId?: string;
		},
	) => Promise<T>;
}

/**
 * The app state a stateful command may use. The dispatcher builds it from the
 * submission options; it holds only what commands actually need, so grow it
 * when a command needs something new rather than reaching for the options.
 */
export interface CommandContext {
	/** Arguments after the command name. */
	args: string[];
	/**
	 * Everything after the command name, untouched (VS Code context included),
	 * for commands that parse quoted arguments or must see the raw split.
	 */
	argText: string;
	/** The conversation as it stood when the command was submitted. */
	messages: Message[];
	provider: string;
	model: string;
	addToChatQueue: (component: React.ReactNode) => void;
	/** Clear the transcript, the model context and per-conversation caches. */
	clearMessages: () => Promise<void>;
	/** Tell the app a conversation was cleared (remounts the transcript). */
	notifyCleared: () => void;
	renameSession: (name: string) => void;
	showStatus: () => void;
	enterModelSelectionMode: () => void;
	/** The models.dev browser (`/model browse`). */
	enterModelDatabaseMode: () => void;
	enterSettingsMode: (
		tab?: import('@/app/components/settings-constants').SettingsTabId,
	) => void;
	enterExplorerMode: () => void;
	enterIdeSelectionMode: () => void;
	enterTune: () => void;
	/** Opens the checkpoint picker; the picker completes the command. */
	enterCheckpointLoadMode: (
		checkpoints: import('@/types/checkpoint').CheckpointListItem[],
		currentMessageCount: number,
	) => void;
	/** Missing where sessions are unavailable. */
	enterSessionSelectorMode?: (showAll?: boolean) => void;
	/** Missing where sessions are unavailable. */
	resumeSession?: (
		session: import('@/session/session-manager').Session,
	) => void | Promise<void>;
	/** Missing where model switching is unavailable. */
	switchModel?: (provider: string, model: string) => Promise<boolean>;
	/** Send a prompt to the model as a new chat turn. */
	submitChatMessage: (message: string, displayValue?: string) => Promise<void>;
}

/**
 * How a stateful command hands the prompt back to the user.
 * - `done`: ready for input now.
 * - `done-after-render`: ready once the output it queued has rendered. The
 *   dispatcher holds completion for `DELAY_COMMAND_COMPLETE_MS`.
 * - `handed-off`: something the command started (a chat turn, a picker) now
 *   owns the prompt and signals completion itself.
 * - `{show}`: output to queue, handled exactly like a read-only command's
 *   result, for commands that only sometimes need app state.
 */
export type CommandCompletion =
	| 'done'
	| 'done-after-render'
	| 'handed-off'
	| {show: React.ReactElement | string | void};

/**
 * A command that changes app state (clears the chat, renames the session,
 * opens a mode). It is dispatched with a `CommandContext` and reports when it
 * is finished by what it returns.
 */
export interface StatefulCommand extends CommandMetadata {
	run: (context: CommandContext) => Promise<CommandCompletion>;
}

export type AnyCommand = Command | StatefulCommand;

export function isStatefulCommand(
	command: AnyCommand,
): command is StatefulCommand {
	return 'run' in command;
}

/**
 * A slash command registered without eagerly importing its module. The
 * `load()` thunk is invoked only when the command is first executed, which
 * keeps the built-in command modules out of startup. Metadata (name,
 * description) must be duplicated here so the command picker can render
 * without triggering the lazy load.
 */
export interface LazyCommand {
	name: string;
	description: string;
	/**
	 * Mirrors `Command.progressLabel`. Duplicated here for the same reason as
	 * `description`: the spinner must be shown before `load()` resolves, so it
	 * cannot be read off the lazily-imported module.
	 */
	progressLabel?: string;
	/** Mirrors `Command.echoInvocation` without loading the command module. */
	echoInvocation?: boolean;
	/** Mirrors `Command.hidden`, so `/help` can filter without a load. */
	hidden?: boolean;
	load: () => Promise<AnyCommand>;
}

export interface ParsedCommand {
	isCommand: boolean;
	command?: string;
	args?: string[];
	fullCommand?: string;
	// Bash command properties
	isBashCommand?: boolean;
	bashCommand?: string;
}

export interface CustomCommandMetadata {
	description?: string;
	aliases?: string[];
	parameters?: string[];
	// Skill-like fields (all optional)
	tags?: string[];
	triggers?: string[];
	estimatedTokens?: number;
	category?: string;
	version?: string;
	author?: string;
	examples?: string[];
	references?: string[];
	dependencies?: string[];
}

export interface CommandResource {
	name: string;
	path: string;
	type: 'script' | 'template' | 'document' | 'config';
	description?: string;
	executable?: boolean;
}

export interface CustomCommand {
	name: string;
	path: string;
	namespace?: string;
	fullName: string; // e.g., "refactor:dry" or just "test"
	metadata: CustomCommandMetadata;
	content: string; // The markdown content without frontmatter
	// Skill-like fields (populated for commands with auto-injection capabilities)
	source?: 'personal' | 'project';
	lastModified?: Date;
	loadedResources?: CommandResource[];
	/**
	 * Event subscriptions declared in the file's frontmatter, if any.
	 * Target is implicit (this command). Resolved by the skill registrar.
	 */
	subscribe?: import('@/types/skills').SkillTrigger[];
}

export interface ParsedCustomCommand {
	metadata: CustomCommandMetadata;
	content: string;
	/**
	 * Event subscriptions declared in the file's frontmatter, if any. Target
	 * is implicit (the command itself) and resolved by the skill registrar.
	 */
	subscribe?: import('@/types/skills').SkillTrigger[];
}
