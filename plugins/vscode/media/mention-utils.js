/**
 * Pure helpers for the composer's `@` autocomplete.
 *
 * Kept out of chat-panel.js (which is one big DOM-bound IIFE) so the trigger
 * rules — the fiddliest part of the feature — can be unit tested in Node.
 * Loaded as a plain script before chat-panel.js; see mention-utils.spec.ts.
 */
(function (root) {
	'use strict';

	/**
	 * Longest `@token` we will treat as a mention. Past this the user is
	 * pasting, not typing a filename, and the backward scan should give up.
	 */
	var MAX_MENTION_TOKEN = 120;

	var WHITESPACE = /\s/;

	/**
	 * Find the `@` mention token that the caret currently sits inside.
	 *
	 * Returns `{start, query}` where `start` is the index of the `@`, or null
	 * when the caret is not in a mention. The `@` only counts at the start of
	 * the input or directly after whitespace — that single rule is what keeps
	 * `user@example.com`, `@decorator` mid-word, and npm scopes from popping
	 * the dropdown while the user types prose.
	 *
	 * @param {string} text Full textarea value.
	 * @param {number} cursor Caret offset (selectionStart).
	 * @returns {{start: number, query: string} | null}
	 */
	function findMentionQuery(text, cursor) {
		if (typeof text !== 'string' || typeof cursor !== 'number') {
			return null;
		}
		if (cursor < 0 || cursor > text.length) {
			return null;
		}

		var lowerBound = Math.max(0, cursor - MAX_MENTION_TOKEN);

		for (var i = cursor - 1; i >= lowerBound; i--) {
			var ch = text.charAt(i);

			if (ch === '@') {
				var prev = i > 0 ? text.charAt(i - 1) : '';
				if (i === 0 || WHITESPACE.test(prev)) {
					return { start: i, query: text.slice(i + 1, cursor) };
				}
				// An `@` glued to a preceding word is an email or a decorator.
				return null;
			}

			// Mentions never span whitespace, so a space ends the search.
			if (WHITESPACE.test(ch)) {
				return null;
			}
		}

		return null;
	}

	/**
	 * Index one past the end of the mention token that starts at `start`.
	 *
	 * The caret is not the end of the token: accepting a completion with the
	 * caret in the middle of `@src/foo` (just after `src`) has to take `/foo`
	 * with it, otherwise the leftover suffix is stranded in the textarea next
	 * to the chip that replaced it.
	 *
	 * @param {string} text Full textarea value.
	 * @param {number} start Index of the `@`.
	 * @returns {number}
	 */
	function mentionTokenEnd(text, start) {
		var limit = Math.min(text.length, start + MAX_MENTION_TOKEN);
		for (var i = Math.max(0, start); i < limit; i++) {
			if (WHITESPACE.test(text.charAt(i))) {
				return i;
			}
		}
		return limit;
	}

	/**
	 * Remove the whole `@query` token once its completion has been accepted.
	 * The chosen path becomes a chip instead of inline text, so nothing is
	 * substituted back into the textarea.
	 *
	 * @param {string} text Full textarea value.
	 * @param {number} start Index of the `@`.
	 * @returns {{text: string, cursor: number}}
	 */
	function removeMentionToken(text, start) {
		if (typeof text !== 'string') {
			return { text: '', cursor: 0 };
		}
		var from = Math.max(0, Math.min(start, text.length));
		var to = mentionTokenEnd(text, from);
		return { text: text.slice(0, from) + text.slice(to), cursor: from };
	}

	root.NanocoderMentionUtils = {
		findMentionQuery: findMentionQuery,
		removeMentionToken: removeMentionToken,
		mentionTokenEnd: mentionTokenEnd,
		MAX_MENTION_TOKEN: MAX_MENTION_TOKEN,
	};
})(typeof globalThis !== 'undefined' ? globalThis : this);
