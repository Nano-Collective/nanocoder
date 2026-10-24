/**
 * Syntax highlighting for the fenced code blocks the chat panel renders.
 *
 * marked already turns a still-open fence into `<pre><code class="language-x">`
 * while a reply streams, so highlighting is a single renderer hook rather than
 * a streaming special case: every `marked.parse()` in chat-panel.js (streaming
 * text, finished text, thought bubbles) picks it up.
 * Kept out of chat-panel.js (one big DOM-bound IIFE) so it can be unit tested
 * in Node. Loaded as a plain script after marked and highlight.min.js; see
 * markdown-highlight.spec.ts.
 */
(function (root) {
	'use strict';

	function escapeHtml(text) {
		return text
			.replace(/&/g, '&amp;')
			.replace(/</g, '&lt;')
			.replace(/>/g, '&gt;')
			.replace(/"/g, '&quot;')
			.replace(/'/g, '&#39;');
	}

	/**
	 * Highlight `code` as `lang`, or escape it as plain text when the language
	 * is not one the bundle knows. While a reply streams, the language is typed
	 * a letter at a time ("p", "py", "pyth"), so an unknown name is the normal
	 * case, not an error. Always returns HTML-safe markup.
	 *
	 * @param {{getLanguage: Function, highlight: Function}|undefined} hljs
	 * @param {string} code
	 * @param {string} lang
	 * @returns {string}
	 */
	function highlightCode(hljs, code, lang) {
		if (hljs && lang && hljs.getLanguage(lang)) {
			try {
				return hljs.highlight(code, {language: lang, ignoreIllegals: true}).value;
			} catch (e) {
				// Fall through to plain text; a highlighter bug must not blank the reply.
			}
		}
		return escapeHtml(code);
	}

	/**
	 * Make `marked` highlight fenced code. The markup matches marked's own
	 * (`<pre><code class="language-x">`), so existing styling and "copy code"
	 * keep working. Does nothing when either library failed to load.
	 *
	 * @param {{use: Function}|undefined} marked
	 * @param {{getLanguage: Function, highlight: Function}|undefined} hljs
	 */
	function configureMarkdown(marked, hljs) {
		if (!marked || !hljs) return;
		marked.use({
			renderer: {
				code: function (token) {
					var lang = (token.lang || '').match(/^\S*/)[0];
					var body = highlightCode(hljs, token.text.replace(/\n$/, ''), lang);
					var cls = lang ? ' class="language-' + escapeHtml(lang) + '"' : '';
					return '<pre><code' + cls + '>' + body + '\n</code></pre>\n';
				},
			},
		});
	}

	root.NanocoderMarkdownHighlight = {
		highlightCode: highlightCode,
		configureMarkdown: configureMarkdown,
	};
})(typeof globalThis !== 'undefined' ? globalThis : this);
