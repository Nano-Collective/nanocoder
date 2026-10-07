type MaybePromise<T> = T | Promise<T>;

export interface ToolExecuteBeforeContext {
	readonly toolName: string;
	readonly toolArgs: Readonly<Record<string, unknown>>;
}

export interface ToolExecuteAfterContext {
	readonly toolName: string;
	readonly toolArgs: Readonly<Record<string, unknown>>;
	readonly toolResult: string;
}

export interface SessionCompactingContext {
	readonly messageCount: number;
}

export interface TuiPromptAppendContext {
	readonly prompt: string;
}

export interface PermissionAskedContext {
	readonly toolName: string;
	readonly toolArgs: Readonly<Record<string, unknown>>;
}

export type PermissionVote =
	| {readonly decision: 'deny'; readonly reason: string}
	| {readonly decision: 'defer'};

export interface PluginHooks {
	readonly 'tool.execute.before'?: (
		ctx: ToolExecuteBeforeContext,
	) => MaybePromise<{readonly block: string} | void>;
	readonly 'tool.execute.after'?: (
		ctx: ToolExecuteAfterContext,
	) => MaybePromise<{readonly append: string} | void>;
	readonly 'session.compacting'?: (
		ctx: SessionCompactingContext,
	) => MaybePromise<void>;
	readonly 'tui.prompt.append'?: (
		ctx: TuiPromptAppendContext,
	) => MaybePromise<string | void>;
	readonly 'permission.asked'?: (
		ctx: PermissionAskedContext,
	) => MaybePromise<PermissionVote>;
}

export interface NanocoderPlugin {
	readonly apiVersion: 1;
	readonly name: string;
	readonly hooks?: PluginHooks;
}
