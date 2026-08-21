/**
 * Pure helpers for the composer's slash-command autocomplete.
 *
 * Kept out of chat-panel.js so the command definitions and trigger rules can
 * be tested directly without a VS Code webview.
 */
(function (root) {
	'use strict';

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
	 * Replace the slash command token with visible template text.
	 *
	 * The returned text is exactly what the webview sends to the backend.
	 *
	 * @param {string} text Full textarea value.
	 * @param {number} cursor Caret offset.
	 * @param {number} selectionEnd Selection end offset.
	 * @param {{template: string}} command Selected slash command.
	 * @returns {{text: string, cursor: number} | null}
	 */
	function applySlashCommandTemplate(text, cursor, selectionEnd, command) {
		var token = findSlashCommandToken(text, cursor, selectionEnd);
		if (!token || !command || typeof command.template !== 'string') {
			return null;
		}

		var existingText = (text.slice(0, token.start) + text.slice(token.end)).trim();
		return {
			text: command.template + existingText,
			cursor: command.template.length,
		};
	}

	function isSlashCommandName(value) {
		if (typeof value !== 'string') {
			return false;
		}
		var normalized = value.trim().toLowerCase();
		return SLASH_COMMANDS.some(function (command) {
			return command.name === normalized;
		});
	}

	root.NanocoderSlashCommandUtils = {
		SLASH_COMMANDS: SLASH_COMMANDS,
		findSlashCommandToken: findSlashCommandToken,
		applySlashCommandTemplate: applySlashCommandTemplate,
		isSlashCommandName: isSlashCommandName,
	};
})(typeof globalThis !== 'undefined' ? globalThis : this);
