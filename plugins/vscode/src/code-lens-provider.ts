import * as vscode from 'vscode';
import type { ChatWebviewProvider } from './chat-webview-provider';

/**
 * Symbols worth a lens. Anything finer-grained (properties, variables) would
 * bury the editor in links. Constructors are included because they read as
 * ordinary methods to the user, and a class lens covers the whole body rather
 * than the constructor on its own.
 */
export const LENS_SYMBOL_KINDS: ReadonlySet<vscode.SymbolKind> = new Set([
	vscode.SymbolKind.Function,
	vscode.SymbolKind.Method,
	vscode.SymbolKind.Constructor,
	vscode.SymbolKind.Class,
]);

/**
 * Caps on the source inlined into a lens prompt. `Generate Tests` on a
 * thousand-line class would otherwise paste the entire body into the
 * conversation and spend a local model's whole context on one turn. The head of
 * a symbol carries the signature and the shape, so a truncated body plus the
 * `file:start-end` locator still leaves the agent enough to work from - it can
 * read the file for the remainder.
 */
export const MAX_LENS_SOURCE_LINES = 200;
export const MAX_LENS_SOURCE_CHARS = 8_000;

export interface TruncatedSource {
	text: string;
	/** Whole lines dropped from the end. Zero when a lone long line was cut. */
	omittedLines: number;
	truncated: boolean;
}

/**
 * Clip `source` to the line and character caps, whichever binds first. At least
 * one line is always kept so the symbol's signature survives.
 */
export function truncateLensSource(
	source: string,
	maxLines: number = MAX_LENS_SOURCE_LINES,
	maxChars: number = MAX_LENS_SOURCE_CHARS,
): TruncatedSource {
	const lines = source.split('\n');

	let keptLines = 0;
	let chars = 0;
	for (const line of lines) {
		if (keptLines >= maxLines) break;
		const next = chars + line.length + (keptLines > 0 ? 1 : 0);
		if (keptLines > 0 && next > maxChars) break;
		chars = next;
		keptLines++;
	}

	if (keptLines === lines.length && chars <= maxChars) {
		return { text: source, omittedLines: 0, truncated: false };
	}

	// A single line over the character cap - minified or generated code - has no
	// line boundary to fall back to, so it is cut mid-line.
	const text = lines.slice(0, keptLines).join('\n').slice(0, maxChars);
	return { text, omittedLines: lines.length - keptLines, truncated: true };
}

export interface CodeLensPromptInput {
	instruction: string;
	/** Workspace-relative path of the clicked symbol's file. */
	relativePath: string;
	/** 1-based, inclusive. */
	startLine: number;
	/** 1-based, inclusive. */
	endLine: number;
	languageId: string;
	source: string;
}

/**
 * Build the prompt a lens click sends. The symbol source is inlined rather than
 * attached as a file: the agent should see the one function the user clicked,
 * not everything around it. The locator is always present, so a truncated body
 * still points at the rest.
 */
export function buildCodeLensPrompt(input: CodeLensPromptInput): string {
	const { text, omittedLines, truncated } = truncateLensSource(input.source);
	const location = `${input.relativePath}:${input.startLine}-${input.endLine}`;

	const parts = [
		input.instruction,
		'',
		location,
		'```' + input.languageId,
		text,
		'```',
	];

	if (truncated) {
		parts.push(
			omittedLines > 0
				? `(truncated - ${omittedLines} more lines; read ${input.relativePath} for the rest)`
				: `(truncated; read ${input.relativePath} for the rest)`,
		);
	}

	return parts.join('\n');
}

export class NanocoderCodeLensProvider
	implements vscode.CodeLensProvider, vscode.Disposable {
	private readonly _onDidChangeCodeLenses = new vscode.EventEmitter<void>();
	public readonly onDidChangeCodeLenses = this._onDidChangeCodeLenses.event;

	public refresh(): void {
		this._onDidChangeCodeLenses.fire();
	}

	public dispose(): void {
		this._onDidChangeCodeLenses.dispose();
	}

	public async provideCodeLenses(
		document: vscode.TextDocument,
		token: vscode.CancellationToken,
	): Promise<vscode.CodeLens[]> {
		// Scoped to the document so a folder-level override wins in a
		// multi-root workspace.
		const config = vscode.workspace.getConfiguration('nanocoder', document.uri);
		if (!config.get<boolean>('codeLens', true)) {
			return [];
		}

		// The language server already knows where the functions are, so nothing
		// here has to parse a single line of source.
		const symbols = await vscode.commands.executeCommand<vscode.DocumentSymbol[]>(
			'vscode.executeDocumentSymbolProvider',
			document.uri,
		);
		if (token.isCancellationRequested || !Array.isArray(symbols)) {
			return [];
		}

		const lenses: vscode.CodeLens[] = [];
		const walk = (nodes: vscode.DocumentSymbol[]) => {
			for (const symbol of nodes) {
				// selectionRange is absent on the legacy SymbolInformation shape
				// some providers still return; skip those rather than throw.
				if (LENS_SYMBOL_KINDS.has(symbol.kind) && symbol.selectionRange) {
					// Anchored on the name so the lens sits on the declaration
					// line instead of above a preceding doc comment, while the
					// command still receives the symbol's whole body.
					const args = [document.uri, symbol.range];
					lenses.push(
						new vscode.CodeLens(symbol.selectionRange, {
							title: 'Explain Code',
							command: 'nanocoder.explainCode',
							arguments: args,
						}),
						new vscode.CodeLens(symbol.selectionRange, {
							title: 'Generate Tests',
							command: 'nanocoder.generateTests',
							arguments: args,
						}),
					);
				}
				walk(symbol.children ?? []);
			}
		};
		walk(symbols);

		return lenses;
	}
}

export async function sendCodeLensPrompt(
	chatProvider: ChatWebviewProvider,
	instruction: string,
	uri?: vscode.Uri,
	range?: vscode.Range,
): Promise<void> {
	// The commands are hidden from the palette, but a keybinding or another
	// extension can still invoke them with no lens arguments.
	if (!uri || !range) {
		vscode.window.showInformationMessage(
			'Nanocoder: use the Explain Code / Generate Tests links above a function to run this.',
		);
		return;
	}

	const document = await vscode.workspace.openTextDocument(uri);
	await chatProvider.sendPrompt(
		buildCodeLensPrompt({
			instruction,
			relativePath: vscode.workspace.asRelativePath(uri),
			startLine: range.start.line + 1,
			endLine: range.end.line + 1,
			languageId: document.languageId,
			source: document.getText(range),
		}),
	);
}
