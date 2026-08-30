/**
 * Pure helpers for the composer's slash-command autocomplete.
 *
 * Kept out of chat-panel.js so the command definitions and trigger rules can
 * be tested directly without a VS Code webview.
 */
(function (root) {
	'use strict';

	/**
	 * Commands come in two shapes.
	 *
	 * A `template` command is a prompt shortcut: selecting it drops visible,
	 * editable text into the composer so the user sees exactly what will be
	 * sent. Nothing hidden is attached to the message.
	 *
	 * A command with no `template` is one the app itself interprets (`/clear`
	 * server-side, `/copy` in the webview). For those the menu only completes
	 * the name; pressing Enter afterwards runs it through the existing path.
	 */
	var SLASH_COMMANDS = [
		{
			name: '/test',
			description: 'Write focused tests',
			template: 'Write tests for the following:\n\n',
		},
		{
			name: '/explain',
			description: 'Explain code or errors',
			template: 'Explain the following clearly:\n\n',
		},
		{
			name: '/doc',
			description: 'Draft documentation',
			template: 'Write documentation for the following:\n\n',
		},
		{
			name: '/clear',
			description: 'Clear the conversation',
		},
		{
			name: '/copy',
			description: 'Copy the last response',
		},
	];

	/**
	 * Find a slash-command token at the caret.
	 *
	 * Commands only count when they are the first non-whitespace text on their
	 * line. That keeps prose, URLs, and paths from opening the command menu just
	 * because they contain or end with a slash.
	 *
	 * @param {string} text Full textarea value.
	 * @param {number} cursor Caret offset (selectionStart).
	 * @param {number} selectionEnd Selection end offset.
	 * @returns {{start: number, end: number, query: string} | null}
	 */
	function findSlashCommandToken(text, cursor, selectionEnd) {
		if (typeof text !== 'string' || typeof cursor !== 'number') {
			return null;
		}
		if (selectionEnd !== undefined && cursor !== selectionEnd) {
			return null;
		}
		if (cursor < 0 || cursor > text.length) {
			return null;
		}

		var lineStart = text.lastIndexOf('\n', cursor - 1) + 1;
		var beforeCursorOnLine = text.slice(lineStart, cursor);
		var afterCursorOnLine = text.slice(cursor).split('\n', 1)[0];
		var match = beforeCursorOnLine.match(/^(\s*)\/([a-z-]*)$/i);
		if (!match || /\S/.test(afterCursorOnLine)) {
			return null;
		}

		return {
			start: lineStart + match[1].length,
			end: cursor,
			query: match[2].toLowerCase(),
		};
	}

	/**
	 * Swap the slash-command token for the text it stands in for.
	 *
	 * The token is replaced in place, so anything the user already typed above
	 * or below the command line keeps its position and its line breaks. The
	 * returned text is exactly what the webview sends to the backend.
	 *
	 * @param {string} text Full textarea value.
	 * @param {number} cursor Caret offset.
	 * @param {number} selectionEnd Selection end offset.
	 * @param {{name: string, template?: string}} command Selected slash command.
	 * @returns {{text: string, cursor: number} | null}
	 */
	function applySlashCommand(text, cursor, selectionEnd, command) {
		var token = findSlashCommandToken(text, cursor, selectionEnd);
		if (!token || !command) {
			return null;
		}

		var insert =
			typeof command.template === 'string' ? command.template : command.name;
		if (typeof insert !== 'string') {
			return null;
		}

		return {
			text: text.slice(0, token.start) + insert + text.slice(token.end),
			cursor: token.start + insert.length,
		};
	}

	root.NanocoderSlashCommandUtils = {
		SLASH_COMMANDS: SLASH_COMMANDS,
		findSlashCommandToken: findSlashCommandToken,
		applySlashCommand: applySlashCommand,
	};
})(typeof globalThis !== 'undefined' ? globalThis : this);
