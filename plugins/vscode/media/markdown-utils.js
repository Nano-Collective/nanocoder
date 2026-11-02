/**
 * Markdown to sanitized HTML for the chat panel.
 *
 * Model replies, thoughts and replayed user messages are untrusted, and marked
 * passes raw HTML straight through. Every string that reaches innerHTML goes
 * through DOMPurify first. Kept out of chat-panel.js so the sanitizer policy
 * can be unit tested against the vendored DOMPurify build.
 * Loaded as a plain script after marked.min.js and purify.min.js, and before
 * chat-panel.js; see markdown-utils.spec.ts.
 */
(function (root) {
	'use strict';

	// marked tags fenced code as `language-<lang>`. Any other class is dropped,
	// so a reply cannot borrow the panel's own Tailwind utilities (for example
	// `fixed inset-0 z-50`) to cover or restyle the UI.
	var ALLOWED_CLASS = /^language-[\w#+.-]+$/;

	var SANITIZE_CONFIG = {
		// Plain HTML only: no SVG or MathML from model output.
		USE_PROFILES: {html: true},
		// <style> and style="" restyle the whole webview; a <form> has nothing to
		// submit to in a chat transcript.
		FORBID_TAGS: ['style', 'form'],
		FORBID_ATTR: ['style'],
		// Prefix id/name so injected markup cannot shadow the panel's element ids.
		SANITIZE_NAMED_PROPS: true,
	};

	var hooked = [];

	function filterClassAttribute(node, data) {
		if (data.attrName !== 'class') return;
		var kept = String(data.attrValue)
			.split(/\s+/)
			.filter(function (name) {
				return ALLOWED_CLASS.test(name);
			});
		if (kept.length > 0) {
			data.attrValue = kept.join(' ');
		} else {
			data.keepAttr = false;
		}
	}

	function ensureHooks(purify) {
		if (hooked.indexOf(purify) !== -1) return;
		purify.addHook('uponSanitizeAttribute', filterClassAttribute);
		hooked.push(purify);
	}

	/**
	 * Render markdown to HTML that is safe to assign to innerHTML.
	 *
	 * Returns null when marked or DOMPurify is missing, or DOMPurify reports
	 * the environment unsupported (it would then hand the input back as-is).
	 * The caller must fall back to textContent, never to raw marked output.
	 *
	 * @param {string} markdown
	 * @param {{parse: (src: string) => string} | undefined} markedLib
	 * @param {any} purify DOMPurify instance
	 * @returns {string|null}
	 */
	function renderMarkdown(markdown, markedLib, purify) {
		if (!markedLib || typeof markedLib.parse !== 'function') return null;
		if (
			!purify ||
			typeof purify.sanitize !== 'function' ||
			typeof purify.addHook !== 'function' ||
			purify.isSupported === false
		) {
			return null;
		}

		ensureHooks(purify);
		var html = markedLib.parse(markdown == null ? '' : String(markdown));
		return String(purify.sanitize(html, SANITIZE_CONFIG));
	}

	root.NanocoderMarkdownUtils = {
		renderMarkdown: renderMarkdown,
	};
})(typeof globalThis !== 'undefined' ? globalThis : this);
