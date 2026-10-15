import test from 'ava';
import * as vscode from 'vscode';
import {
	buildCodeLensPrompt,
	MAX_LENS_SOURCE_LINES,
	NanocoderCodeLensProvider,
	sendCodeLensPrompt,
	truncateLensSource,
} from './code-lens-provider';

const {__test} = vscode as unknown as {__test: any};

const NEVER_CANCELLED = {
	isCancellationRequested: false,
	onCancellationRequested: () => ({dispose: () => {}}),
} as unknown as vscode.CancellationToken;

const DOCUMENT = {
	uri: vscode.Uri.file('/repo/src/thing.ts'),
} as unknown as vscode.TextDocument;

function symbol(
	name: string,
	kind: vscode.SymbolKind,
	children: any[] = [],
): any {
	return {
		name,
		kind,
		range: new vscode.Range(0, 0, 10, 0),
		selectionRange: new vscode.Range(0, 6, 0, 6 + name.length),
		children,
	};
}

test.beforeEach(() => {
	__test.reset();
});

test('provideCodeLenses - keeps lensable kinds and walks nested children', async t => {
	__test.executeCommand = async () => [
		symbol('Widget', vscode.SymbolKind.Class, [
			symbol('constructor', vscode.SymbolKind.Constructor),
			symbol('render', vscode.SymbolKind.Method),
			// Fields and properties are deliberately skipped - a lens on every
			// one of them would bury the editor.
			symbol('count', vscode.SymbolKind.Property),
			symbol('label', vscode.SymbolKind.Field),
		]),
		symbol('helper', vscode.SymbolKind.Function, [
			// Nested one level deeper than any top-level symbol, so it only
			// shows up if the walk actually recurses.
			symbol('inner', vscode.SymbolKind.Function),
		]),
		symbol('total', vscode.SymbolKind.Variable),
	];

	const lenses = await new NanocoderCodeLensProvider().provideCodeLenses(
		DOCUMENT,
		NEVER_CANCELLED,
	);

	// Class, Constructor, Method, Function, nested Function - two lenses each.
	t.is(lenses.length, 10);
	t.deepEqual(
		[...new Set(lenses.map(lens => lens.command?.title))],
		['Explain Code', 'Generate Tests'],
	);
	t.deepEqual(
		[...new Set(lenses.map(lens => lens.command?.command))],
		['nanocoder.explainCode', 'nanocoder.generateTests'],
	);
	// The lens is anchored on the name, but the command carries the whole body.
	t.is((lenses[0].command?.arguments?.[1] as vscode.Range).end.line, 10);
});

test('provideCodeLenses - skips legacy symbols with no selectionRange', async t => {
	const legacy = symbol('legacy', vscode.SymbolKind.Function);
	legacy.selectionRange = undefined;
	__test.executeCommand = async () => [legacy];

	const lenses = await new NanocoderCodeLensProvider().provideCodeLenses(
		DOCUMENT,
		NEVER_CANCELLED,
	);

	t.deepEqual(lenses, []);
});

test('provideCodeLenses - short-circuits when nanocoder.codeLens is false', async t => {
	let symbolProviderCalls = 0;
	__test.configuration = (_section: string, key: string, fallback: unknown) =>
		key === 'codeLens' ? false : fallback;
	__test.executeCommand = async () => {
		symbolProviderCalls++;
		return [symbol('helper', vscode.SymbolKind.Function)];
	};

	const lenses = await new NanocoderCodeLensProvider().provideCodeLenses(
		DOCUMENT,
		NEVER_CANCELLED,
	);

	t.deepEqual(lenses, []);
	// Bailing before the symbol request is the point: the language server is
	// not asked to do work whose result is thrown away.
	t.is(symbolProviderCalls, 0);
});

test('buildCodeLensPrompt - instruction, locator, then fenced source', t => {
	const prompt = buildCodeLensPrompt({
		instruction: 'Explain what this code does.',
		relativePath: 'src/thing.ts',
		startLine: 12,
		endLine: 14,
		languageId: 'typescript',
		source: 'function add(a, b) {\n\treturn a + b;\n}',
	});

	t.is(
		prompt,
		[
			'Explain what this code does.',
			'',
			'src/thing.ts:12-14',
			'```typescript',
			'function add(a, b) {',
			'\treturn a + b;',
			'}',
			'```',
		].join('\n'),
	);
});

test('buildCodeLensPrompt - caps a long symbol and points at the file', t => {
	const source = Array.from(
		{length: MAX_LENS_SOURCE_LINES + 40},
		(_unused, i) => `\tline ${i};`,
	).join('\n');

	const prompt = buildCodeLensPrompt({
		instruction: 'Write unit tests for this code.',
		relativePath: 'src/huge.ts',
		startLine: 1,
		endLine: MAX_LENS_SOURCE_LINES + 40,
		languageId: 'typescript',
		source,
	});

	t.true(prompt.includes('\tline 0;'));
	t.false(prompt.includes(`\tline ${MAX_LENS_SOURCE_LINES};`));
	t.true(prompt.endsWith('(truncated - 40 more lines; read src/huge.ts for the rest)'));
	// The locator survives truncation, so the agent can still find the rest.
	t.true(prompt.includes(`src/huge.ts:1-${MAX_LENS_SOURCE_LINES + 40}`));
});

test('truncateLensSource - leaves a short symbol untouched', t => {
	const source = 'const a = 1;\nconst b = 2;';
	t.deepEqual(truncateLensSource(source), {
		text: source,
		omittedLines: 0,
		truncated: false,
	});
});

test('truncateLensSource - cuts a single line that busts the char cap', t => {
	const result = truncateLensSource('x'.repeat(500), 200, 100);
	t.is(result.text.length, 100);
	t.is(result.omittedLines, 0);
	t.true(result.truncated);
});

test('truncateLensSource - char cap can bind before the line cap', t => {
	const result = truncateLensSource('abcd\nabcd\nabcd\nabcd', 200, 12);
	t.is(result.text, 'abcd\nabcd');
	t.is(result.omittedLines, 2);
	t.true(result.truncated);
});

test('sendCodeLensPrompt - hands the built prompt to the chat view', async t => {
	__test.asRelativePath = () => 'src/thing.ts';
	__test.openTextDocument = async () => ({
		languageId: 'typescript',
		getText: () => 'const answer = 42;',
	});

	const sent: string[] = [];
	const chatProvider = {
		sendPrompt: async (text: string) => {
			sent.push(text);
		},
	} as any;

	await sendCodeLensPrompt(
		chatProvider,
		'Explain what this code does.',
		vscode.Uri.file('/repo/src/thing.ts'),
		new vscode.Range(11, 0, 13, 1),
	);

	t.deepEqual(sent, [
		[
			'Explain what this code does.',
			'',
			// The range is 0-based; the locator the agent sees is not.
			'src/thing.ts:12-14',
			'```typescript',
			'const answer = 42;',
			'```',
		].join('\n'),
	]);
});

test('sendCodeLensPrompt - explains itself when invoked without lens arguments', async t => {
	let sendPromptCalls = 0;
	const chatProvider = {
		sendPrompt: async () => {
			sendPromptCalls++;
		},
	} as any;

	// A keybinding or another extension can reach the command directly, with
	// nothing to describe.
	await sendCodeLensPrompt(chatProvider, 'Explain what this code does.');

	t.is(sendPromptCalls, 0);
	t.deepEqual(
		__test.shownMessages.map((m: any) => m.kind),
		['info'],
	);
	t.regex(__test.shownMessages[0].message, /Explain Code \/ Generate Tests/);
});
