/**
 * Consistent terminal icon vocabulary for Nanocoder.
 *
 * Design principles
 * -----------------
 * 1. Single-column monochrome glyphs — every icon here renders as exactly one
 *    column in a standard Western monospace font. We never depend on emoji fonts,
 *    variation selectors, or Powerline/Nerd Fonts private-use codepoints.
 * 2. Ambiguous East-Asian-Width glyphs (e.g. `⚒`, `⚠`, `❯`) are tolerated
 *    here only when paired with `stringWidth(..., {ambiguousIsNarrow: true})`
 *    at truncation sites — the helper in `source/utils/width.ts` already does
 *    that. Whenever possible we prefer Narrow glyphs (Basic Latin, Arrows,
 *    General Punctuation).
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

/** Forward chevron — the universal "tool happened / action forward" glyph. */
export const ICON_TOOL = '\u00BB'; // »

/** Light-bulb-free "thinking" marker. A middle dot is calm and inconspicuous
 *  so it can accompany a streaming spinner without stealing attention. */
export const ICON_THOUGHT = '\u2234'; // ∴

/** Success — already the de-facto codebase standard. */
export const ICON_SUCCESS = '\u2713'; // ✓

/** Error / failure. */
export const ICON_ERROR = '\u2717'; // ✗

/** Warning. ASCII so it never inflates to 2 columns in CJK locales. */
export const ICON_WARNING = '\u2298'; // ⊘

/** Ellipsis indicating truncation / continuation. */
export const ICON_ELLIPSIS = '\u2026'; // …

/** Horizontal ellipsis for inline truncation (single-column, narrower than `…`). */
export const ICON_TRUNCATED = '\u2026'; // …

/** Bullet — used at the start of list rows and inline metadata items. */
export const ICON_BULLET = '\u25AA'; // ▪

/** Status dot — used for live agent progress indication. */
export const ICON_STATUS_DOT = '\u25CF'; // ●

/** Continuation / sub-hint row marker (lines beneath a parent item). */
export const ICON_CONTINUATION = '↳';

/** Row marker in command listings (`/commands`, `/skills`, `/agents`,
 *  `/tools`). Same glyph as ICON_TOOL on purpose — both read as
 *  "forward-pointing chevron" — but exported under its own name so the
 *  semantic intent at the call site is obvious. */
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
export const ICON_TASK_IN_PROGRESS = '\u25CE'; // ◎
export const ICON_TASK_COMPLETE = '\u2713'; // ✓

export const ICON_IMAGE = '\u29C9'; // ⧉

/** "Modified / unsaved" status (e.g. dirty JSON buffer). Solid black
 *  circle — read as a printed-tape dot. */
export const ICON_DIRTY = '\u00B1'; // ±

/** Git branch indicator (using the classic alternative branch symbol). */
export const ICON_GIT_BRANCH = '\u2387'; // ⎇

/** Forward-chevron dev-mode marker (single = neutral). */
export const ICON_MODE_NORMAL = '\u23F5'; // ⏵
/** Double chevron — auto-accept (running). */
export const ICON_MODE_AUTO_ACCEPT = '\u23F5\u23F5'; // ⏵⏵
/** Triple chevron — yolo (full auto). */
export const ICON_MODE_YOLO = '\u23F5\u23F5\u23F5'; // ⏵⏵⏵
/** Question mark — plan mode (waiting for plan approval). */
export const ICON_MODE_PLAN = '\u23F8'; // ⏸
/** Double chevron — headless (scripted; same look as auto-accept, different colour). */
export const ICON_MODE_HEADLESS = ICON_MODE_AUTO_ACCEPT;

/** MCP transport labels (ASCII brackets — single column). */
export const ICON_MCP_STDIO = '\u21C4'; // ⇄
export const ICON_MCP_WEBSOCKET = '\u223F'; // ∿
export const ICON_MCP_HTTP = '\u2B7E'; // ⭾
export const ICON_MCP_UNKNOWN = '?';

/** LSP status — reuse success/error glyphs (single column, themed by colour). */
export const ICON_LSP_READY = '\u2713'; // ✓
export const ICON_LSP_NOT_READY = '\u2298'; // ⊘

/** Editor pill in the development-mode indicator (replaces ambiguous `⊡`). */
export const ICON_EDITOR = '\u22A1'; // ⊡

/** Plan / decision-prompt marker. */
export const ICON_PLAN = '?';

/** Goodbye / farewell (replaces waving-hand emoji). */
export const ICON_GOODBYE = '\u30C4'; // ツ

/** Sentinel prefix for tool-validation errors. The codebase performs string
 *  `startsWith` checks against this prefix in a few places (`isErrorResult`,
 *  `displayToolResult`, `tool-executor`, `auto-diagnostics`); changing it
 *  requires updating those checks together. Using `!` keeps it ASCII and
 *  narrow. */
export const VALIDATION_ERROR_PREFIX = '!';

/** Compose a complete validation-error message in a way that matches the
 *  format the existing startsWith checks expect. */
export function validationError(message: string): string {
	return `${VALIDATION_ERROR_PREFIX} Validation failed: ${message}`;
}

/** Convenience: format a `<icon> <name>` tool header in one call. */
export function toolTitle(name: string): string {
	return `${ICON_TOOL} ${name}`;
}

/** Convenience: format an MCP server line's transport marker. */
export function mcpTransportIcon(transportType: string): string {
	switch (transportType.toLowerCase()) {
		case 'stdio':
			return ICON_MCP_STDIO;
		case 'websocket':
		case 'ws':
			return ICON_MCP_WEBSOCKET;
		case 'http':
		case 'https':
		case 'sse':
			return ICON_MCP_HTTP;
		default:
			return ICON_MCP_UNKNOWN;
	}
}

/** Map a task status to its icon. */
export const TASK_STATUS_ICONS = {
	pending: ICON_TASK_PENDING,
	in_progress: ICON_TASK_IN_PROGRESS,
	completed: ICON_TASK_COMPLETE,
} as const;

/** Map a development mode to its marker glyph (e.g. "›› auto-accept mode on"). */
export const MODE_GLYPHS: Record<string, string> = {
	normal: ICON_MODE_NORMAL,
	'auto-accept': ICON_MODE_AUTO_ACCEPT,
	yolo: ICON_MODE_YOLO,
	plan: ICON_MODE_PLAN,
	headless: ICON_MODE_HEADLESS,
};

/** Centralised icon vocabulary, exported as a single object for callers that
 *  want to import the whole set under one namespace. */
export const Icons = {
	tool: ICON_TOOL,
	thought: ICON_THOUGHT,
	success: ICON_SUCCESS,
	error: ICON_ERROR,
	warning: ICON_WARNING,
	ellipsis: ICON_ELLIPSIS,
	truncated: ICON_TRUNCATED,
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

export type IconName = keyof typeof Icons;

/** Default Nano Collective brand purple (#8373F7) — exposed so components
 *  can pin the brand colour regardless of active theme. */
export const NANO_COLLECTIVE_BRAND = '#8373F7';
