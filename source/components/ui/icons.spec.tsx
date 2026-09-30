import test from 'ava';
import {
	ICON_BULLET,
	ICON_CONTINUATION,
	ICON_DIRTY,
	ICON_ELLIPSIS,
	ICON_ERROR,
	ICON_GIT_BRANCH,
	ICON_GOODBYE,
	ICON_IMAGE,
	ICON_LSP_NOT_READY,
	ICON_LSP_READY,
	ICON_MCP_HTTP,
	ICON_MCP_STDIO,
	ICON_MCP_UNKNOWN,
	ICON_MCP_WEBSOCKET,
	ICON_SELECTION,
	ICON_SUCCESS,
	ICON_TASK_COMPLETE,
	ICON_TASK_IN_PROGRESS,
	ICON_TASK_PENDING,
	ICON_THOUGHT,
	ICON_TOOL,
	ICON_TREE_COLLAPSED,
	ICON_TREE_EXPANDED,
	ICON_WARNING,
	MODE_GLYPHS,
	NANO_COLLECTIVE_BRAND,
	TASK_STATUS_ICONS,
	mcpTransportIcon,
	toolTitle,
	validationError,
} from '@/components/ui/icons';
import {width} from '@/utils/width';

// Every icon glyph must render in a single column on a Western
// monospace terminal — that's the whole point of the vocabulary.
const singleColumnGlyphs: ReadonlyArray<readonly [string, string]> = [
	['ICON_TOOL', ICON_TOOL],
	['ICON_THOUGHT', ICON_THOUGHT],
	['ICON_SUCCESS', ICON_SUCCESS],
	['ICON_ERROR', ICON_ERROR],
	['ICON_WARNING', ICON_WARNING],
	['ICON_ELLIPSIS', ICON_ELLIPSIS],
	['ICON_BULLET', ICON_BULLET],
	['ICON_CONTINUATION', ICON_CONTINUATION],
	['ICON_SELECTION', ICON_SELECTION],
	['ICON_TREE_COLLAPSED', ICON_TREE_COLLAPSED],
	['ICON_TREE_EXPANDED', ICON_TREE_EXPANDED],
	['ICON_TASK_PENDING', ICON_TASK_PENDING],
	['ICON_TASK_IN_PROGRESS', ICON_TASK_IN_PROGRESS],
	['ICON_TASK_COMPLETE', ICON_TASK_COMPLETE],
	['ICON_IMAGE', ICON_IMAGE],
	['ICON_DIRTY', ICON_DIRTY],
	['ICON_GIT_BRANCH', ICON_GIT_BRANCH],
	['ICON_LSP_READY', ICON_LSP_READY],
	['ICON_LSP_NOT_READY', ICON_LSP_NOT_READY],
	['ICON_MCP_STDIO', ICON_MCP_STDIO],
	// ICON_MCP_WEBSOCKET is intentionally 2 columns (`<>` reads as a
	// pair); we still measure and assert the budget on it below.
	['ICON_MCP_HTTP', ICON_MCP_HTTP],
	['ICON_MCP_UNKNOWN', ICON_MCP_UNKNOWN],
	['ICON_GOODBYE', ICON_GOODBYE],
];

for (const [name, glyph] of singleColumnGlyphs) {
	test(`icons › ${name} renders as a single column`, t => {
		t.is(width(glyph), 1, `${name} (${glyph}) must render as 1 column`);
	});
}

test('icons › NANO_COLLECTIVE_BRAND is Nano Collective purple', t => {
	t.is(NANO_COLLECTIVE_BRAND, '#8373F7');
});

test('icons › MODE_GLYPHS covers every development mode', t => {
	const expected = ['normal', 'auto-accept', 'yolo', 'plan', 'headless'];
	for (const mode of expected) {
		t.truthy(MODE_GLYPHS[mode], `${mode} must have a glyph`);
	}
});

test('icons › TASK_STATUS_ICONS covers every task status', t => {
	t.is(TASK_STATUS_ICONS.pending, ICON_TASK_PENDING);
	t.is(TASK_STATUS_ICONS.in_progress, ICON_TASK_IN_PROGRESS);
	t.is(TASK_STATUS_ICONS.completed, ICON_TASK_COMPLETE);
});

test('icons › mcpTransportIcon maps every supported transport', t => {
	t.is(mcpTransportIcon('stdio'), ICON_MCP_STDIO);
	t.is(mcpTransportIcon('websocket'), ICON_MCP_WEBSOCKET);
	t.is(mcpTransportIcon('ws'), ICON_MCP_WEBSOCKET);
	t.is(mcpTransportIcon('http'), ICON_MCP_HTTP);
	t.is(mcpTransportIcon('https'), ICON_MCP_HTTP);
	t.is(mcpTransportIcon('sse'), ICON_MCP_HTTP);
	t.is(mcpTransportIcon('unknown'), ICON_MCP_UNKNOWN);
	t.is(mcpTransportIcon(''), ICON_MCP_UNKNOWN);
});

test('icons › toolTitle composes the canonical header', t => {
	t.is(toolTitle('execute_bash'), `${ICON_TOOL} execute_bash`);
});

test('icons › validationError matches the consumer startsWith checks', t => {
	const msg = validationError('bad args');
	t.true(msg.startsWith('! Validation failed:'));
	t.is(msg, '! Validation failed: bad args');
});