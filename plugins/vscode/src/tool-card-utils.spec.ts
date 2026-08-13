import test from 'ava';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

/**
 * `media/tool-card-utils.js` ships as a plain browser script, so it is loaded
 * into a VM context here rather than imported. The IIFE assigns onto
 * `globalThis`, which inside a VM context is the sandbox.
 */
const source = readFileSync(
	fileURLToPath(new URL('../media/tool-card-utils.js', import.meta.url)),
	'utf8',
);

const sandbox: Record<string, any> = {};
vm.createContext(sandbox);
vm.runInContext(source, sandbox);

const {
	TOOL_VERBS,
	humanizeToolTitle,
	extractFileName,
	hasDiffContent,
	resolveEditCardState,
	isSettled,
} = sandbox.NanocoderToolCardUtils;

console.log('\ntool-card-utils.spec.ts');

// ============================================================================
// humanizeToolTitle
// ============================================================================

test('humanizeToolTitle - swaps a known tool prefix for its verb', t => {
	t.is(humanizeToolTitle('read_file: source/app.ts'), 'Reading source/app.ts');
	t.is(humanizeToolTitle('execute_bash: pnpm test'), 'Running pnpm test');
	t.is(
		humanizeToolTitle('lsp_get_diagnostics: source/cli.tsx'),
		'Checking diagnostics in source/cli.tsx',
	);
});

test('humanizeToolTitle - passes through titles with no known prefix', t => {
	t.is(humanizeToolTitle('some_mcp_tool: thing'), 'some_mcp_tool: thing');
	t.is(humanizeToolTitle('Delegate to reviewer'), 'Delegate to reviewer');
	t.is(humanizeToolTitle(''), 'Tool Call');
	t.is(humanizeToolTitle(undefined), 'Tool Call');
});

test('humanizeToolTitle - carries no entries that can never fire', t => {
	// fetch_url and web_search take a url/query, so buildToolCallMeta leaves
	// their title as the bare tool name - there is no ": " to split on.
	for (const name of ['fetch_url', 'web_search']) {
		t.false(
			Object.hasOwn(TOOL_VERBS, name),
			name + ' never produces a "<name>: <target>" title',
		);
		t.is(humanizeToolTitle(name), name);
	}

	// Edit-kind tools render as edit cards and never reach the tool list.
	for (const name of ['string_replace', 'write_file']) {
		t.false(
			Object.hasOwn(TOOL_VERBS, name),
			name + ' is routed to an edit card by ACP kind',
		);
	}
});

// ============================================================================
// extractFileName
// ============================================================================

test('extractFileName - takes the basename from either separator', t => {
	t.is(extractFileName('read_file: source/app/App.tsx'), 'App.tsx');
	t.is(extractFileName('write_file: C:\\repo\\source\\cli.tsx'), 'cli.tsx');
	t.is(extractFileName('string_replace: notes.md'), 'notes.md');
});

test('extractFileName - strips a trailing quote from a stringified argument', t => {
	t.is(extractFileName('write_file: "source/a.ts"'), 'a.ts');
});

test('extractFileName - falls back when there is no title', t => {
	t.is(extractFileName(''), 'File');
	t.is(extractFileName(undefined), 'File');
});

// ============================================================================
// hasDiffContent - gates the "Open Diff" affordance
// ============================================================================

test('hasDiffContent - false for the queued announcement', t => {
	// The agent announces queued calls with no content at all, so nothing is
	// registered with DiffManager yet.
	t.false(hasDiffContent({ status: 'pending' }));
	t.false(hasDiffContent({ status: 'pending', content: [] }));
	t.false(hasDiffContent(undefined));
});

test('hasDiffContent - true once a diff block with a path arrives', t => {
	t.true(
		hasDiffContent({
			content: [
				{ type: 'diff', path: '/repo/a.ts', oldText: 'a', newText: 'b' },
			],
		}),
	);
});

test('hasDiffContent - false for content the host would not register', t => {
	// handleDiffs requires both type === 'diff' and a path.
	t.false(hasDiffContent({ content: [{ type: 'diff', oldText: 'a' }] }));
	t.false(
		hasDiffContent({
			content: [{ type: 'content', content: { type: 'text', text: 'hi' } }],
		}),
	);
	t.false(hasDiffContent({ content: [null, undefined] }));
	t.false(hasDiffContent({ content: 'not-an-array' }));
});

// ============================================================================
// resolveEditCardState - status-aware label
// ============================================================================

test('resolveEditCardState - reads in the tense of the actual status', t => {
	t.is(resolveEditCardState({ status: 'pending' }).action, 'Edit');
	t.is(resolveEditCardState({ status: 'in_progress' }).action, 'Editing');
	t.is(resolveEditCardState({ status: 'completed' }).action, 'Edited');
	t.is(resolveEditCardState({ status: 'success' }).action, 'Edited');
});

test('resolveEditCardState - a queued card never claims the edit happened', t => {
	// The regression: cards were hardcoded to "Edited" the moment they appeared,
	// before the tool had run or even been approved.
	const queued = resolveEditCardState({ status: 'pending' });
	t.is(queued.action, 'Edit');
	t.is(queued.tone, 'circle');
});

test('resolveEditCardState - defaults to pending when status is absent', t => {
	t.is(resolveEditCardState({}).action, 'Edit');
	t.is(resolveEditCardState(undefined).action, 'Edit');
	t.is(resolveEditCardState({ status: 'something_new' }).action, 'Edit');
});

test('resolveEditCardState - separates cancel and deny out of failed', t => {
	// The agent reports both as `failed` with an explanatory rawOutput.
	const cancelled = resolveEditCardState({
		status: 'failed',
		rawOutput: 'Cancelled by user',
	});
	t.is(cancelled.status, 'cancelled');
	t.is(cancelled.action, 'Cancelled edit to');
	t.is(cancelled.tone, 'cancelled');

	const denied = resolveEditCardState({
		status: 'failed',
		rawOutput: 'Denied by user',
	});
	t.is(denied.status, 'denied');
	t.is(denied.action, 'Denied edit to');
	t.is(denied.tone, 'cancelled');
});

test('resolveEditCardState - a genuine failure stays an error', t => {
	const failed = resolveEditCardState({
		status: 'failed',
		rawOutput: 'Error: ENOENT no such file',
	});
	t.is(failed.status, 'failed');
	t.is(failed.action, 'Failed to edit');
	t.is(failed.tone, 'error');
});

test('resolveEditCardState - every status maps to a real icon bucket', t => {
	const icons = ['circle', 'pending', 'success', 'error', 'cancelled'];
	for (const status of [
		'pending',
		'in_progress',
		'completed',
		'failed',
		'cancelled',
		'denied',
	]) {
		const state = resolveEditCardState({ status });
		t.true(icons.includes(state.tone), status + ' -> ' + state.tone);
		t.truthy(state.action);
	}
});

// ============================================================================
// isSettled - controls when approval buttons come down
// ============================================================================

test('isSettled - only terminal states settle', t => {
	t.false(isSettled('pending'));
	t.false(isSettled('in_progress'));
	t.true(isSettled('completed'));
	t.true(isSettled('failed'));
	t.true(isSettled('cancelled'));
	t.true(isSettled('denied'));
});
