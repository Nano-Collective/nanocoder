import test from 'ava';
import {
	ICON_BULLET,
	ICON_CONTINUATION,
	ICON_DIRTY,
	ICON_ELLIPSIS,
	ICON_EDITOR,
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
	mcpTransportIcon,
} from '@/components/ui/icons';
import stringWidth from 'string-width';
import {width} from '@/utils/width';

// Every icon glyph must measure as a single column under our internal
// string-width configuration (which uses ambiguousIsNarrow: true).
// This guarantees internal alignment, even though some glyphs are East-Asian Ambiguous
// and may render wider in CJK-configured terminals.
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
	['ICON_MCP_WEBSOCKET', ICON_MCP_WEBSOCKET],
	['ICON_MCP_HTTP', ICON_MCP_HTTP],
	['ICON_MCP_UNKNOWN', ICON_MCP_UNKNOWN],
	['ICON_EDITOR', ICON_EDITOR],
];

// Note: ICON_GOODBYE ('ツ', EAW=W) is intentionally excluded from singleColumnGlyphs
// because it is a Wide glyph that consumes 2 columns regardless of ambiguousIsNarrow.
// The development-mode labels are also excluded because some modes (like
// 'auto-accept' and 'yolo') intentionally span multiple columns.

for (const [name, glyph] of singleColumnGlyphs) {
	test(`icons › ${name} measures as a single column internally`, t => {
		t.is(width(glyph), 1, `${name} (${glyph}) must measure as 1 column under our string-width config`);
	});
}

test('icons › mcpTransportIcon maps every supported transport', t => {
	t.is(mcpTransportIcon('stdio'), ICON_MCP_STDIO);
	t.is(mcpTransportIcon('websocket'), ICON_MCP_WEBSOCKET);
	t.is(mcpTransportIcon('http'), ICON_MCP_HTTP);
	t.is(mcpTransportIcon('unknown'), ICON_MCP_UNKNOWN);
	t.is(mcpTransportIcon(''), ICON_MCP_UNKNOWN);
});

// Glyphs that carry state a user must not misread are chosen so they stay one
// column even in a CJK-configured terminal, where East-Asian-Ambiguous glyphs
// (such as `○` or `◎`) are drawn two columns wide.
const narrowEverywhere: ReadonlyArray<readonly [string, string]> = [
	['ICON_WARNING', ICON_WARNING],
	['ICON_ERROR', ICON_ERROR],
	['ICON_SUCCESS', ICON_SUCCESS],
	['ICON_DIRTY', ICON_DIRTY],
	['ICON_LSP_NOT_READY', ICON_LSP_NOT_READY],
];

for (const [name, glyph] of narrowEverywhere) {
	test(`icons › ${name} is one column even where ambiguous glyphs are wide`, t => {
		t.is(stringWidth(glyph, {ambiguousIsNarrow: false}), 1);
	});
}
