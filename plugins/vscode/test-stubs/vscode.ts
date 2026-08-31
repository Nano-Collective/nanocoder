/**
 * Runtime stand-in for the `vscode` module.
 *
 * The real module is injected by the extension host and cannot be resolved from
 * plain Node, so nothing under `plugins/vscode/src` that imports it was
 * loadable by AVA. The root tsconfig maps the bare `vscode` specifier here (see
 * its `paths` entry) so the extension's units can be exercised without an
 * extension host.
 *
 * Only the surface the extension actually touches is implemented. Anything a
 * test needs to steer is overridable through `__test`.
 */

export class Position {
	constructor(
		public readonly line: number,
		public readonly character: number,
	) {}
}

export class Range {
	public readonly start: Position;
	public readonly end: Position;

	constructor(start: Position, end: Position);
	constructor(
		startLine: number,
		startCharacter: number,
		endLine: number,
		endCharacter: number,
	);
	constructor(
		a: Position | number,
		b?: Position | number,
		c?: number,
		d?: number,
	) {
		if (typeof a === 'number') {
			this.start = new Position(a, b as number);
			this.end = new Position(c as number, d as number);
		} else {
			this.start = a;
			this.end = b as Position;
		}
	}

	get isEmpty(): boolean {
		return (
			this.start.line === this.end.line &&
			this.start.character === this.end.character
		);
	}
}

export class Selection extends Range {}

export interface Command {
	title: string;
	command: string;
	arguments?: unknown[];
}

export class CodeLens {
	constructor(
		public readonly range: Range,
		public readonly command?: Command,
	) {}

	get isResolved(): boolean {
		return this.command !== undefined;
	}
}

export class Disposable {
	constructor(private readonly _callOnDispose: () => void) {}
	dispose(): void {
		this._callOnDispose();
	}
}

export class EventEmitter<T> {
	private readonly _listeners = new Set<(e: T) => unknown>();

	// A bound property, not a method: consumers hand `emitter.event` out
	// directly as their public `onDidX`.
	public readonly event = (listener: (e: T) => unknown) => {
		this._listeners.add(listener);
		return new Disposable(() => this._listeners.delete(listener));
	};

	fire(data: T): void {
		for (const listener of [...this._listeners]) listener(data);
	}

	dispose(): void {
		this._listeners.clear();
	}
}

export class Uri {
	private constructor(
		public readonly scheme: string,
		public readonly fsPath: string,
	) {}

	static file(fsPath: string): Uri {
		return new Uri('file', fsPath);
	}

	static joinPath(base: Uri, ...parts: string[]): Uri {
		return new Uri(base.scheme, [base.fsPath, ...parts].join('/'));
	}

	get path(): string {
		return this.fsPath;
	}

	with(_change: Record<string, unknown>): Uri {
		return this;
	}

	toString(): string {
		return `${this.scheme}://${this.fsPath}`;
	}
}

export enum SymbolKind {
	File = 0,
	Module = 1,
	Namespace = 2,
	Package = 3,
	Class = 4,
	Method = 5,
	Property = 6,
	Field = 7,
	Constructor = 8,
	Enum = 9,
	Interface = 10,
	Function = 11,
	Variable = 12,
	Constant = 13,
	String = 14,
	Number = 15,
	Boolean = 16,
	Array = 17,
	Object = 18,
	Key = 19,
	Null = 20,
	EnumMember = 21,
	Struct = 22,
	Event = 23,
	Operator = 24,
	TypeParameter = 25,
}

export enum ConfigurationTarget {
	Global = 1,
	Workspace = 2,
	WorkspaceFolder = 3,
}

export enum StatusBarAlignment {
	Left = 1,
	Right = 2,
}

export enum DiagnosticSeverity {
	Error = 0,
	Warning = 1,
	Information = 2,
	Hint = 3,
}

export enum ViewColumn {
	Active = -1,
	One = 1,
}

/**
 * Test-controlled behaviour. Every hook falls back to an inert default, so a
 * test only overrides what it cares about; `reset()` restores all of them.
 */
export const __test = {
	/** Backs `workspace.getConfiguration(section, scope).get(key, default)`. */
	configuration: (_section: string, _key: string, fallback: unknown): unknown =>
		fallback,
	/** Backs `commands.executeCommand`. */
	executeCommand: async (_command: string, ..._args: unknown[]): Promise<any> =>
		undefined,
	/** Backs `workspace.openTextDocument`. */
	openTextDocument: async (_uri: Uri): Promise<any> => ({
		languageId: 'plaintext',
		getText: () => '',
	}),
	/** Backs `workspace.asRelativePath`. */
	asRelativePath: (target: Uri | string): string =>
		typeof target === 'string' ? target : target.fsPath,
	/** Messages surfaced through `window.show*Message`, newest last. */
	shownMessages: [] as {kind: 'info' | 'warning' | 'error'; message: string}[],

	reset(): void {
		__test.configuration = (_s, _k, fallback) => fallback;
		__test.executeCommand = async () => undefined;
		__test.openTextDocument = async () => ({
			languageId: 'plaintext',
			getText: () => '',
		});
		__test.asRelativePath = target =>
			typeof target === 'string' ? target : target.fsPath;
		__test.shownMessages = [];
	},
};

const noopDisposable = new Disposable(() => {});

export const workspace = {
	workspaceFolders: undefined as {uri: Uri}[] | undefined,
	textDocuments: [] as unknown[],
	getConfiguration(section: string, _scope?: unknown) {
		return {
			get: <T>(key: string, fallback?: T): T =>
				__test.configuration(section, key, fallback) as T,
			update: async () => undefined,
		};
	},
	openTextDocument: (uri: Uri) => __test.openTextDocument(uri),
	asRelativePath: (target: Uri | string) => __test.asRelativePath(target),
	onDidChangeConfiguration: () => noopDisposable,
	onDidChangeTextDocument: () => noopDisposable,
};

export const commands = {
	executeCommand: (command: string, ...args: unknown[]) =>
		__test.executeCommand(command, ...args),
	registerCommand: () => noopDisposable,
};

export const window = {
	activeTextEditor: undefined as unknown,
	showInformationMessage: async (message: string) => {
		__test.shownMessages.push({kind: 'info', message});
		return undefined;
	},
	showWarningMessage: async (message: string) => {
		__test.shownMessages.push({kind: 'warning', message});
		return undefined;
	},
	showErrorMessage: async (message: string) => {
		__test.shownMessages.push({kind: 'error', message});
		return undefined;
	},
	createOutputChannel: (_name: string) => ({
		appendLine: () => {},
		append: () => {},
		show: () => {},
		dispose: () => {},
	}),
	createStatusBarItem: () => ({
		text: '',
		tooltip: '',
		command: '',
		show: () => {},
		hide: () => {},
		dispose: () => {},
	}),
	createTerminal: () => ({sendText: () => {}, show: () => {}, dispose: () => {}}),
	showTextDocument: async () => undefined,
	showOpenDialog: async () => undefined,
	registerWebviewViewProvider: () => noopDisposable,
	onDidChangeActiveTextEditor: () => noopDisposable,
	onDidChangeTextEditorSelection: () => noopDisposable,
};

export const languages = {
	registerCodeLensProvider: () => noopDisposable,
	getDiagnostics: () => [] as unknown[],
};

export const extensions = {
	getExtension: (_id: string) => undefined as unknown,
};

export const env = {
	clipboard: {
		writeText: async (_text: string) => undefined,
		readText: async () => '',
	},
};
