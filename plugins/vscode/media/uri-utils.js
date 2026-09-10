/**
 * Pure helpers for turning a drop payload into filesystem paths.
 *
 * Kept out of chat-panel.js (which is one big DOM-bound IIFE) so the URI
 * decoding — which is easy to get subtly wrong per platform, and fails
 * silently when it does — can be unit tested in Node.
 * Loaded as a plain script before chat-panel.js; see uri-utils.spec.ts.
 */
(function (root) {
	'use strict';

	/**
	 * Convert a single `file://` URI to a filesystem path.
	 *
	 * The shapes that actually turn up in a VS Code drop:
	 *   file:///Users/me/x.ts   → /Users/me/x.ts       (posix)
	 *   file:///c%3A/dev/x.ts   → c:\dev\x.ts          (windows drive)
	 *   file://server/share     → \\server\share       (windows UNC)
	 *
	 * Returns null for anything that is not a usable path, so the caller can
	 * drop it rather than attaching a chip that points nowhere.
	 *
	 * @param {string} uri
	 * @param {boolean} isWindows
	 * @returns {string|null}
	 */
	function fileUriToPath(uri, isWindows) {
		if (typeof uri !== 'string') return null;

		var trimmed = uri.trim();
		if (!trimmed) return null;

		if (!/^file:\/\//i.test(trimmed)) {
			// Some drag sources only offer a bare path in text/plain. Accept it
			// when it is absolute; ignore dragged selections and http links.
			if (isAbsolutePath(trimmed)) return trimmed;
			return null;
		}

		// Everything after the scheme is `[authority]/path`. Splitting on the
		// first slash is what keeps the root slash attached to the path — the
		// bug this replaces stripped it with /^file:\/\/\/?/ and handed the
		// extension host a relative path that statSync could never resolve.
		var rest = trimmed.slice('file://'.length);
		var firstSlash = rest.indexOf('/');
		var authority = firstSlash === -1 ? rest : rest.slice(0, firstSlash);
		var pathPart = firstSlash === -1 ? '' : rest.slice(firstSlash);

		var decoded;
		try {
			decoded = decodeURIComponent(pathPart);
		} catch (err) {
			// Malformed percent-escape — a raw path beats discarding the drop.
			decoded = pathPart;
		}

		if (authority) {
			var unc = '//' + authority + decoded;
			return isWindows ? unc.replace(/\//g, '\\') : unc;
		}

		if (!decoded) return null;

		if (isWindows) {
			// file:///C:/dev → /C:/dev → C:/dev → C:\dev
			if (/^\/[a-zA-Z]:/.test(decoded)) decoded = decoded.slice(1);
			return decoded.replace(/\//g, '\\');
		}

		return decoded;
	}

	function isAbsolutePath(value) {
		return (
			value.charAt(0) === '/' ||
			value.slice(0, 2) === '\\\\' ||
			/^[a-zA-Z]:[\\/]/.test(value)
		);
	}

	/**
	 * Parse a `text/uri-list` (or text/plain) drop payload into paths,
	 * discarding comment lines and entries that are not usable paths.
	 *
	 * @param {string} data
	 * @param {boolean} isWindows
	 * @returns {string[]}
	 */
	function parseDropPayload(data, isWindows) {
		if (!data) return [];

		var paths = [];
		var lines = data.split(/\r?\n/);

		for (var i = 0; i < lines.length; i++) {
			var line = lines[i].trim();
			// Per RFC 2483 a leading '#' marks a comment in text/uri-list.
			if (!line || line.charAt(0) === '#') continue;

			var resolved = fileUriToPath(line, isWindows);
			if (resolved && paths.indexOf(resolved) === -1) {
				paths.push(resolved);
			}
		}

		return paths;
	}

	root.NanocoderUriUtils = {
		fileUriToPath: fileUriToPath,
		parseDropPayload: parseDropPayload,
	};
})(typeof globalThis !== 'undefined' ? globalThis : this);
