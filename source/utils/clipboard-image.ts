import {spawnSync} from 'node:child_process';
import {existsSync, readFileSync, statSync, unlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import type {ImageAttachment} from '@/types/core';
import {getLogger} from '@/utils/logging';

const logger = getLogger();

/** Hard cap on attachment size; providers reject very large images anyway. */
const MAX_IMAGE_BYTES = 10 * 1024 * 1024; // 10 MB

/**
 * Image extensions the supported providers accept. Anthropic, Google, and the
 * common OpenAI-compatible vision models all handle these media types.
 */
const EXTENSION_MEDIA_TYPES: Record<string, string> = {
	'.png': 'image/png',
	'.jpg': 'image/jpeg',
	'.jpeg': 'image/jpeg',
	'.gif': 'image/gif',
	'.webp': 'image/webp',
};

/**
 * Map a file path to an image media type by extension, or `undefined` if the
 * extension is not a supported image type.
 */
export function mediaTypeForPath(path: string): string | undefined {
	const lower = path.toLowerCase();
	const dot = lower.lastIndexOf('.');
	if (dot === -1) return undefined;
	return EXTENSION_MEDIA_TYPES[lower.slice(dot)];
}

/**
 * Normalise a single path-like token and return it only if it resolves to an
 * existing image file. Handles the forms terminals produce for dragged files:
 * `file://` prefixes, a single layer of surrounding quotes, and backslash-
 * escaped spaces.
 */
function resolveImagePath(raw: string): string | undefined {
	let candidate = raw.trim();
	if (!candidate) return undefined;

	// Remote URLs that happen to end in an image extension are not local files;
	// bail before touching the filesystem so message parsing never stats them.
	if (/^https?:\/\//i.test(candidate)) return undefined;

	// Strip a single layer of surrounding quotes.
	if (
		(candidate.startsWith('"') && candidate.endsWith('"')) ||
		(candidate.startsWith("'") && candidate.endsWith("'"))
	) {
		candidate = candidate.slice(1, -1);
	}

	// macOS terminals escape spaces in dragged paths as "\ ".
	candidate = candidate.replace(/\\ /g, ' ');

	if (candidate.startsWith('file://')) {
		try {
			candidate = decodeURIComponent(candidate.slice('file://'.length));
		} catch {
			// Leave the raw value if it is not valid percent-encoding.
			candidate = candidate.slice('file://'.length);
		}
	}

	if (!mediaTypeForPath(candidate)) return undefined;

	try {
		if (existsSync(candidate) && statSync(candidate).isFile()) {
			return candidate;
		}
	} catch {
		// Fall through to undefined on any stat error.
	}
	return undefined;
}

/**
 * Treat a chunk of pasted/typed text as a single image file reference. Returns
 * the resolved path only when the whole string points to an existing image.
 */
export function extractImagePathFromText(text: string): string | undefined {
	return resolveImagePath(text);
}

/**
 * Pull image file references out of a larger message. Terminals drop a dragged
 * file in as its path — quoted when it contains spaces — usually mixed in with
 * the user's own prose ("describe '<path>'"). This finds those path tokens,
 * resolves the ones that are real image files, and returns both the resolved
 * paths and the message text with those tokens replaced by `[Image #N]`
 * placeholders (mirroring the `[Paste #N]` convention). `startIndex` offsets
 * the numbering past attachments that have no textual token, e.g. clipboard
 * images pasted with Ctrl+V.
 */
export function extractImageReferences(
	text: string,
	startIndex = 0,
): {
	text: string;
	paths: string[];
} {
	const paths: string[] = [];
	const imageExt = '(?:png|jpe?g|gif|webp)';
	const placeholder = () => `[Image #${startIndex + paths.length}]`;

	// Quoted tokens first — the terminal wraps paths containing spaces in quotes.
	let result = text.replace(
		new RegExp(`(['"])(.*?\\.${imageExt})\\1`, 'gi'),
		(match, _quote, inner) => {
			const resolved = resolveImagePath(inner);
			if (resolved) {
				paths.push(resolved);
				return placeholder();
			}
			return match;
		},
	);

	// Unquoted tokens ending in an image extension. macOS terminals drop a
	// dragged file in unquoted with spaces backslash-escaped (`\ `), so the
	// token can legitimately contain `\ ` sequences as well as non-whitespace.
	result = result.replace(
		new RegExp(
			`(^|\\s)((?:file://)?(?:\\\\ |\\S)+\\.${imageExt})(?=\\s|$)`,
			'gi',
		),
		(match, lead, token) => {
			const resolved = resolveImagePath(token);
			if (resolved) {
				paths.push(resolved);
				return lead + placeholder();
			}
			return match;
		},
	);

	// Collapse whitespace left behind by removed tokens.
	const cleaned = result.replace(/[ \t]{2,}/g, ' ').trim();
	return {text: cleaned, paths};
}

/** Read an image file from disk into an attachment, or `null` on failure. */
export function readImageFile(path: string): ImageAttachment | null {
	const mediaType = mediaTypeForPath(path);
	if (!mediaType) return null;
	try {
		const size = statSync(path).size;
		if (size > MAX_IMAGE_BYTES) {
			logger.warn(`Image ${path} exceeds ${MAX_IMAGE_BYTES} bytes; skipping`);
			return null;
		}
		const data = readFileSync(path).toString('base64');
		return {data, mediaType, source: basename(path)};
	} catch (error) {
		logger.warn(`Could not read image ${path}: ${String(error)}`);
		return null;
	}
}

function basename(path: string): string {
	const parts = path.split(/[\\/]/);
	return parts[parts.length - 1] || path;
}

function toAttachment(
	buffer: Buffer,
	mediaType: string,
): ImageAttachment | null {
	if (buffer.length === 0) return null;
	if (buffer.length > MAX_IMAGE_BYTES) {
		logger.warn(`Clipboard image exceeds ${MAX_IMAGE_BYTES} bytes; skipping`);
		return null;
	}
	return {data: buffer.toString('base64'), mediaType, source: 'clipboard'};
}

/**
 * Read raw image bytes from the OS clipboard, if any. Returns `null` when the
 * clipboard holds no image, the platform tool is unavailable, or extraction
 * fails — callers treat that as "no image was pasted".
 *
 * Platform mechanisms:
 * - macOS: AppleScript dumps `«class PNGf»` clipboard data to a temp file.
 * - Linux: `wl-paste` (Wayland) or `xclip` (X11) stream `image/png` to stdout.
 * - Windows: PowerShell reads `Clipboard.GetImage()` and writes PNG to stdout.
 */
export function readClipboardImage(): ImageAttachment | null {
	try {
		switch (process.platform) {
			case 'darwin':
				return readClipboardImageMac();
			case 'linux':
				return readClipboardImageLinux();
			case 'win32':
				return readClipboardImageWindows();
			default:
				return null;
		}
	} catch (error) {
		logger.warn(`Clipboard image read failed: ${String(error)}`);
		return null;
	}
}

function readClipboardImageMac(): ImageAttachment | null {
	const outFile = join(
		tmpdir(),
		`nanocoder-clip-${process.pid}-${Date.now()}.png`,
	);
	// AppleScript: pull PNG clipboard data and write it to outFile. The path is
	// process-generated (no quotes), so embedding it directly is safe.
	const script = [
		'try',
		'	set imgData to (the clipboard as «class PNGf»)',
		'on error',
		'	return "NO_IMAGE"',
		'end try',
		`set outFile to (POSIX file "${outFile}")`,
		'set fh to open for access outFile with write permission',
		'set eof fh to 0',
		'write imgData to fh',
		'close access fh',
		'return "OK"',
	].join('\n');

	const result = spawnSync('osascript', ['-e', script], {
		timeout: 3000,
		encoding: 'utf8',
	});

	try {
		if (isCommandMissing(result.error)) {
			logger.debug(
				'Clipboard image paste unavailable: `osascript` not found on PATH',
			);
			return null;
		}
		if (result.status !== 0 || !result.stdout?.includes('OK')) {
			return null;
		}
		if (!existsSync(outFile)) return null;
		return toAttachment(readFileSync(outFile), 'image/png');
	} finally {
		safeUnlink(outFile);
	}
}

function readClipboardImageLinux(): ImageAttachment | null {
	// Wayland first, then X11. Both stream raw PNG bytes to stdout.
	const tools = [
		['wl-paste', ['--type', 'image/png']],
		['xclip', ['-selection', 'clipboard', '-t', 'image/png', '-o']],
	] as const;
	const missing: string[] = [];
	for (const [cmd, args] of tools) {
		const result = spawnSync(cmd, args, {
			timeout: 3000,
			maxBuffer: MAX_IMAGE_BYTES,
		});
		if (isCommandMissing(result.error)) {
			missing.push(cmd);
			continue;
		}
		if (result.error || result.status !== 0) continue;
		const stdout = result.stdout;
		if (Buffer.isBuffer(stdout) && stdout.length > 0) {
			return toAttachment(stdout, 'image/png');
		}
	}
	if (missing.length === tools.length) {
		logger.debug(
			`Clipboard image paste unavailable: install ${missing.join(' or ')} to enable it`,
		);
	}
	return null;
}

function readClipboardImageWindows(): ImageAttachment | null {
	const script =
		'Add-Type -AssemblyName System.Windows.Forms,System.Drawing; ' +
		'$img=[System.Windows.Forms.Clipboard]::GetImage(); ' +
		'if($img -ne $null){ $ms=New-Object System.IO.MemoryStream; ' +
		'$img.Save($ms,[System.Drawing.Imaging.ImageFormat]::Png); ' +
		'$bytes=$ms.ToArray(); $out=[Console]::OpenStandardOutput(); ' +
		'$out.Write($bytes,0,$bytes.Length); $out.Flush() }';
	const result = spawnSync(
		'powershell',
		['-NoProfile', '-NonInteractive', '-Command', script],
		{timeout: 3000, maxBuffer: MAX_IMAGE_BYTES},
	);
	if (isCommandMissing(result.error)) {
		logger.debug(
			'Clipboard image paste unavailable: `powershell` not found on PATH',
		);
		return null;
	}
	if (result.error || result.status !== 0) return null;
	const stdout = result.stdout;
	if (Buffer.isBuffer(stdout) && stdout.length > 0) {
		return toAttachment(stdout, 'image/png');
	}
	return null;
}

/** True when a spawnSync error means the executable is not installed/on PATH. */
function isCommandMissing(error: Error | undefined): boolean {
	return (error as NodeJS.ErrnoException | undefined)?.code === 'ENOENT';
}

function safeUnlink(path: string): void {
	try {
		if (existsSync(path)) unlinkSync(path);
	} catch {
		// Best-effort cleanup; a leftover temp file is harmless.
	}
}
