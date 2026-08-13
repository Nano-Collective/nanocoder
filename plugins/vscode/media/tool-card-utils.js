/**
 * Pure presentation helpers for the tool cards in the chat panel. Kept out of
 * `chat-panel.js` so they can be exercised directly by
 * `src/tool-card-utils.spec.ts` without a DOM.
 */
(function (root) {
	'use strict';

	/**
	 * Verb per tool for the aggregated tool list. An entry only ever fires when
	 * the tool's ACP title is `"<name>: <target>"`, which `humanizeToolTitle`
	 * splits on. Two families are deliberately absent:
	 *  - `fetch_url` / `web_search` take a `url`/`query`, not a path, so their
	 *    title is the bare tool name and never contains the separator.
	 *  - `string_replace` / `write_file` report ACP kind `edit`, so they render
	 *    as edit cards and never reach this list.
	 */
	var TOOL_VERBS = {
		read_file: 'Reading',
		list_directory: 'Listing',
		find_files: 'Finding files in',
		search_file_contents: 'Searching',
		execute_bash: 'Running',
		lsp_get_diagnostics: 'Checking diagnostics in',
	};

	/** Action label per resolved status, rendered as `"<action> <filename>"`. */
	var EDIT_ACTIONS = {
		pending: 'Edit',
		in_progress: 'Editing',
		completed: 'Edited',
		failed: 'Failed to edit',
		cancelled: 'Cancelled edit to',
		denied: 'Denied edit to',
	};

	/** Icon bucket per resolved status. */
	var EDIT_TONES = {
		pending: 'circle',
		in_progress: 'pending',
		completed: 'success',
		failed: 'error',
		cancelled: 'cancelled',
		denied: 'cancelled',
	};

	/**
	 * Rewrite an ACP tool title into a human phrase: `"read_file: a.ts"` becomes
	 * `"Reading a.ts"`. Titles without a known tool prefix pass through.
	 * @param {string} title
	 * @returns {string}
	 */
	function humanizeToolTitle(title) {
		if (!title) return 'Tool Call';
		var sep = title.indexOf(': ');
		if (sep === -1) return title;
		var name = title.slice(0, sep);
		if (!Object.prototype.hasOwnProperty.call(TOOL_VERBS, name)) return title;
		return TOOL_VERBS[name] + ' ' + title.slice(sep + 2);
	}

	/**
	 * Pull the bare filename out of an ACP tool title, tolerating both path
	 * separators and a trailing quote from a stringified argument.
	 * @param {string} title
	 * @returns {string}
	 */
	function extractFileName(title) {
		if (!title) return 'File';
		var sep = title.indexOf(': ');
		var parts = (sep === -1 ? title : title.slice(sep + 2)).split('/');
		var last = parts[parts.length - 1];
		last = last.split('\\').pop();
		return last.replace(/['"]+$/g, '').trim();
	}

	/**
	 * True when this update carries a diff the extension host would have handed
	 * to DiffManager. Mirrors `handleDiffs` in `chat-webview-provider.ts` so the
	 * panel only offers "Open Diff" once the change is actually registered.
	 * @param {{content?: unknown}} update
	 * @returns {boolean}
	 */
	function hasDiffContent(update) {
		if (!update || !Array.isArray(update.content)) return false;
		return update.content.some(function (block) {
			return !!block && block.type === 'diff' && !!block.path;
		});
	}

	/**
	 * Resolve an edit card's label and icon from an update. The agent reports a
	 * user cancel or deny as `failed` with an explanatory `rawOutput`, so those
	 * are separated back out here rather than all reading as an error.
	 * @param {{status?: string, rawOutput?: unknown}} update
	 * @returns {{status: string, action: string, tone: string}}
	 */
	function resolveEditCardState(update) {
		var status = (update && update.status) || 'pending';
		if (status === 'success') status = 'completed';
		if (status === 'error') status = 'failed';

		if (status === 'failed') {
			var raw =
				update && typeof update.rawOutput === 'string' ? update.rawOutput : '';
			if (/denied/i.test(raw)) status = 'denied';
			else if (/cancel|AbortError/i.test(raw)) status = 'cancelled';
		}

		if (!Object.prototype.hasOwnProperty.call(EDIT_ACTIONS, status)) {
			status = 'pending';
		}
		return {
			status: status,
			action: EDIT_ACTIONS[status],
			tone: EDIT_TONES[status],
		};
	}

	/**
	 * True once a card has reached a terminal state and its approval buttons
	 * should come down.
	 * @param {string} status Resolved status from `resolveEditCardState`.
	 * @returns {boolean}
	 */
	function isSettled(status) {
		return status !== 'pending' && status !== 'in_progress';
	}

	root.NanocoderToolCardUtils = {
		TOOL_VERBS: TOOL_VERBS,
		humanizeToolTitle: humanizeToolTitle,
		extractFileName: extractFileName,
		hasDiffContent: hasDiffContent,
		resolveEditCardState: resolveEditCardState,
		isSettled: isSettled,
	};
})(typeof globalThis !== 'undefined' ? globalThis : this);
