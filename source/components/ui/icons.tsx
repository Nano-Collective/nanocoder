/**
 * Consistent terminal icon vocabulary for Nanocoder.
 *
 * Design principles
 * -----------------
 * 1. Single-column monochrome glyphs — every icon here is measured as exactly
 *    one column (with the deliberate exception of the wide `ICON_GOODBYE`
 *    glyph). We never depend on emoji fonts, variation selectors, or
 *    Powerline/Nerd Fonts private-use codepoints.
 * 2. Some glyphs here (e.g. `○`, `◐`, `❯`, `∴`) are East-Asian-Ambiguous: one
 *    column in a Western terminal, two in a CJK-configured one. They are
 *    measured as narrow (`ambiguousIsNarrow: true`, the UAX #11 default, which
 *    `width()` in `source/utils/width.ts` uses). Where a glyph conveys state
 *    that matters, prefer one that is narrow either way — `!`, `*`, `◌`.
 * 3. Semantic consistency — one glyph per concept. If two callers need the same
 *    affordance, they share the same constant.
 * 4. Color carries meaning — glyphs are anchors only; `useTheme().colors`
 *    tokens (`tool`, `success`, `warning`, `error`, `info`, `secondary`,
 *    `primary`, `text`) differentiate intents, never the glyph itself.
 *
 * The vocabulary is intentionally small (~25 glyphs). Adding more should be a
 * deliberate decision; the rule of thumb is: prefer a colored version of an
 * existing glyph over introducing a new one.
 */

import type {DevelopmentMode} from '@/types/core';

/** Forward chevron — the universal "tool happened / action forward" glyph. */
export const ICON_TOOL = '\u00BB'; // »

/** "Thinking" marker (the therefore sign). Quiet enough to accompany a
 *  streaming spinner without stealing attention. */
export const ICON_THOUGHT = '\u2234'; // ∴

/** Success — already the de-facto codebase standard. */
export const ICON_SUCCESS = '\u2713'; // ✓

/** Error / failure. */
export const ICON_ERROR = '\u2717'; // ✗

/** Warning. ASCII, so it is one column in every locale and reads as a
 *  warning rather than "blocked". */
export const ICON_WARNING = '!';

/** Ellipsis indicating truncation / continuation. */
export const ICON_ELLIPSIS = '\u2026'; // …

/** Bullet — used at the start of list rows and inline metadata items. */
export const ICON_BULLET = '\u25AA'; // ▪

/** Status dot — used for live agent progress indication. */
const ICON_STATUS_DOT = '\u25CF'; // ●

/** Continuation / sub-hint row marker (lines beneath a parent item). */
export const ICON_CONTINUATION = '↳';

/** Row marker in command listings (`/commands`, `/skills`, `/agents`,
 *  `/tools`). A single angle quote (`›`), the lighter sibling of the
 *  double-angle `ICON_TOOL` (`»`). */
export const ICON_LIST_ROW = '\u203A'; // ›
/** Selection / highlight marker in pickers and lists. Unifies the previous
 *  mix of `❯` (U+276F) and `▸` (U+25B8). */
export const ICON_SELECTION = '\u276F'; // ❯
/** Tree node: collapsed (click to expand). */
export const ICON_TREE_COLLAPSED = '>';

/** Tree node: expanded (click to collapse). */
export const ICON_TREE_EXPANDED = 'v';

/** Task list — pending / in-progress / complete. */
export const ICON_TASK_PENDING = '\u25CB'; // ○
export const ICON_TASK_IN_PROGRESS = '\u25D0'; // half-filled circle
export const ICON_TASK_COMPLETE = '\u2713'; // ✓

export const ICON_IMAGE = '\u29C9'; // ⧉

/** "Modified / unsaved" status (e.g. dirty JSON buffer). An asterisk, the
 *  usual unsaved-changes marker, and one column in every locale. */
export const ICON_DIRTY = '*';

/** Git branch indicator (using the classic alternative branch symbol). */
export const ICON_GIT_BRANCH = '\u2387'; // ⎇

/** Forward-chevron dev-mode marker (single = neutral). */
const ICON_MODE_NORMAL = '\u23F5'; // ⏵
/** Double chevron — auto-accept (running). */
const ICON_MODE_AUTO_ACCEPT = '\u23F5\u23F5'; // ⏵⏵
/** Triple chevron — yolo (full auto). */
const ICON_MODE_YOLO = '\u23F5\u23F5\u23F5'; // ⏵⏵⏵
/** Pause — plan mode (waiting for plan approval). */
const ICON_MODE_PLAN = '\u23F8'; // ⏸
/** Double chevron — headless (scripted; same look as auto-accept, different colour). */
const ICON_MODE_HEADLESS = ICON_MODE_AUTO_ACCEPT;
/** Architect mode marker. */
const ICON_MODE_ARCHITECT = '\u25C8'; // ◈

export const DEVELOPMENT_MODE_LABELS: Record<DevelopmentMode, string> = {
	normal: `${ICON_MODE_NORMAL} normal mode on`,
	'auto-accept': `${ICON_MODE_AUTO_ACCEPT} auto-accept mode on`,
	yolo: `${ICON_MODE_YOLO} yolo mode on`,
	plan: `${ICON_MODE_PLAN} plan mode on`,
	architect: `${ICON_MODE_ARCHITECT} architect mode on`,
	headless: `${ICON_MODE_HEADLESS} headless mode on`,
};

export const DEVELOPMENT_MODE_LABELS_NARROW: Record<DevelopmentMode, string> = {
	normal: `${ICON_MODE_NORMAL} normal`,
	'auto-accept': `${ICON_MODE_AUTO_ACCEPT} auto`,
	yolo: `${ICON_MODE_YOLO} yolo`,
	plan: `${ICON_MODE_PLAN} plan`,
	architect: `${ICON_MODE_ARCHITECT} architect`,
	headless: `${ICON_MODE_HEADLESS} headless`,
};

/** MCP transport markers: arrows for stdio, a wave for websocket, a tab arrow for http. */
export const ICON_MCP_STDIO = '\u21C4'; // ⇄
export const ICON_MCP_WEBSOCKET = '\u223F'; // ∿
export const ICON_MCP_HTTP = '\u2B7E'; // ⭾
export const ICON_MCP_UNKNOWN = '?';

/** LSP status: a tick when ready, and a dotted circle (pending) while the
 *  server is still starting, so "initializing" does not look like a failure. */
export const ICON_LSP_READY = '\u2713'; // check mark
export const ICON_LSP_NOT_READY = '\u25CC'; // dotted circle

/** Editor pill in the development-mode indicator (squared dot). */
export const ICON_EDITOR = '\u22A1'; // ⊡

/** Plan / decision-prompt marker. */
const ICON_PLAN = '?';

/** Goodbye / farewell (replaces waving-hand emoji). */
export const ICON_GOODBYE = '\u30C4'; // ツ

/** Convenience: format an MCP server line's transport marker. */
export function mcpTransportIcon(transportType: string): string {
	switch (transportType.toLowerCase()) {
		case 'stdio':
			return ICON_MCP_STDIO;
		case 'websocket':
			return ICON_MCP_WEBSOCKET;
		case 'http':
			return ICON_MCP_HTTP;
		default:
			return ICON_MCP_UNKNOWN;
	}
}

/** Centralised icon vocabulary, exported as a single object for callers that
 *  want to import the whole set under one namespace. */
export const Icons = {
	tool: ICON_TOOL,
	thought: ICON_THOUGHT,
	success: ICON_SUCCESS,
	error: ICON_ERROR,
	warning: ICON_WARNING,
	ellipsis: ICON_ELLIPSIS,
	bullet: ICON_BULLET,
	statusDot: ICON_STATUS_DOT,
	continuation: ICON_CONTINUATION,
	selection: ICON_SELECTION,
	treeCollapsed: ICON_TREE_COLLAPSED,
	treeExpanded: ICON_TREE_EXPANDED,
	taskPending: ICON_TASK_PENDING,
	taskInProgress: ICON_TASK_IN_PROGRESS,
	taskComplete: ICON_TASK_COMPLETE,
	image: ICON_IMAGE,
	dirty: ICON_DIRTY,
	gitBranch: ICON_GIT_BRANCH,
	modeNormal: ICON_MODE_NORMAL,
	modeAutoAccept: ICON_MODE_AUTO_ACCEPT,
	modeYolo: ICON_MODE_YOLO,
	modePlan: ICON_MODE_PLAN,
	modeHeadless: ICON_MODE_HEADLESS,
	mcpStdio: ICON_MCP_STDIO,
	mcpWebsocket: ICON_MCP_WEBSOCKET,
	mcpHttp: ICON_MCP_HTTP,
	mcpUnknown: ICON_MCP_UNKNOWN,
	lspReady: ICON_LSP_READY,
	lspNotReady: ICON_LSP_NOT_READY,
	editor: ICON_EDITOR,
	plan: ICON_PLAN,
	goodbye: ICON_GOODBYE,
} as const;
