import {execFile} from 'node:child_process';
import {existsSync, readFileSync, statSync, unlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import type {ImageAttachment} from '@/types/core';
import {getLogger} from '@/utils/logging';

const logger = getLogger();

/** Hard cap on attachment size; providers reject very large images anyway. */
const MAX_IMAGE_BYTES = 10 * 1024 * 1024; // 10 MB

/** How long a clipboard helper gets to answer before we report a timeout. */
const CLIPBOARD_TIMEOUT_MS = 3000;

const TIMEOUT_ERROR = `Clipboard image read timed out after ${
	CLIPBOARD_TIMEOUT_MS / 1000
}s`;

const TOO_LARGE_ERROR = `Clipboard image is larger than ${
	MAX_IMAGE_BYTES / (1024 * 1024)
} MB`;

const UNREADABLE_ERROR = 'Could not read the clipboard image';

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

/** One clipboard helper invocation, normalised across platforms. */
export interface ClipboardCommandResult {
	stdout: Buffer;
	/** The executable is not installed or not on PATH. */
	missing: boolean;
	/** The helper was killed after `CLIPBOARD_TIMEOUT_MS`. */
	timedOut: boolean;
	/** stdout hit the image size cap before the helper finished. */
	tooLarge: boolean;
	/** The helper exited non-zero for any other reason. */
	failed: boolean;
}

/**
 * Runs one clipboard helper. Injectable so the platform adapters can be
 * exercised without touching the real clipboard.
 */
export type ClipboardCommandRunner = (
	command: string,
	args: readonly string[],
) => Promise<ClipboardCommandResult>;

/** The result of a Ctrl+V image paste: an attachment, or why there isn't one. */
export interface ClipboardImageResult {
	image: ImageAttachment | null;
	/**
	 * A one-line, user-facing reason for the failure. Only set when the paste
	 * failed in a way the user can act on (missing helper, timeout, oversize);
	 * an empty clipboard is a silent `{image: null}`.
	 */
	error?: string;
}

export interface ReadClipboardImageOptions {
	/** Defaults to `process.platform`; tests use this to cover every adapter. */
	platform?: NodeJS.Platform;
	/** Defaults to the real helper runner; tests use this to fake output. */
	run?: ClipboardCommandRunner;
}

/**
 * Read raw image bytes from the OS clipboard, if any. Resolves instead of
 * blocking, so a cold helper (PowerShell in particular) can no longer freeze
 * the Ink event loop.
 *
 * Platform mechanisms:
 * - macOS: AppleScript dumps `«class PNGf»` clipboard data to a temp file.
 * - Linux: `wl-paste` (Wayland) or `xclip` (X11) stream `image/png` to stdout.
 * - Windows: PowerShell reads `Clipboard.GetImage()` and writes PNG to stdout.
 *
 * `{image: null}` with no `error` means the clipboard simply held no image;
 * an `error` means the read failed and the reason is worth showing the user.
 */
export async function readClipboardImage(
	options: ReadClipboardImageOptions = {},
): Promise<ClipboardImageResult> {
	const platform = options.platform ?? process.platform;
	const run = options.run ?? runClipboardCommand;
	try {
		switch (platform) {
			case 'darwin':
				return await readClipboardImageMac(run);
			case 'linux':
				return await readClipboardImageLinux(run);
			case 'win32':
				return await readClipboardImageWindows(run);
			default:
				return {image: null};
		}
	} catch (error) {
		logger.warn(`Clipboard image read failed: ${String(error)}`);
		return {image: null, error: UNREADABLE_ERROR};
	}
}

async function readClipboardImageMac(
	run: ClipboardCommandRunner,
): Promise<ClipboardImageResult> {
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

	const result = await run('osascript', ['-e', script]);

	try {
		if (result.missing) {
			logger.debug(
				'Clipboard image paste unavailable: `osascript` not found on PATH',
			);
			return {
				image: null,
				error: 'Clipboard image paste needs `osascript` on PATH',
			};
		}
		if (result.timedOut) return {image: null, error: TIMEOUT_ERROR};
		if (result.tooLarge) return {image: null, error: TOO_LARGE_ERROR};
		if (result.failed) return {image: null, error: UNREADABLE_ERROR};
		if (!result.stdout.toString('utf8').includes('OK')) {
			// The script returns "NO_IMAGE" when the clipboard holds no PNG.
			return {image: null};
		}
		if (!existsSync(outFile)) return {image: null, error: UNREADABLE_ERROR};
		return fromClipboardBuffer(readFileSync(outFile));
	} finally {
		safeUnlink(outFile);
	}
}

async function readClipboardImageLinux(
	run: ClipboardCommandRunner,
): Promise<ClipboardImageResult> {
	// Wayland first, then X11. Both stream raw PNG bytes to stdout.
	const tools = [
		['wl-paste', ['--type', 'image/png']],
		['xclip', ['-selection', 'clipboard', '-t', 'image/png', '-o']],
	] as const;
	const missing: string[] = [];
	let timedOut = false;
	let failed = false;
	for (const [cmd, args] of tools) {
		const result = await run(cmd, args);
		if (result.missing) {
			missing.push(cmd);
			continue;
		}
		if (result.tooLarge) return {image: null, error: TOO_LARGE_ERROR};
		if (result.timedOut) {
			timedOut = true;
			continue;
		}
		if (result.failed) {
			failed = true;
			continue;
		}
		if (result.stdout.length > 0) {
			return fromClipboardBuffer(result.stdout);
		}
	}
	if (missing.length === tools.length) {
		logger.debug(
			`Clipboard image paste unavailable: install ${missing.join(' or ')} to enable it`,
		);
		return {
			image: null,
			error: `Clipboard image paste needs ${missing.join(' or ')} installed`,
		};
	}
	if (timedOut) return {image: null, error: TIMEOUT_ERROR};
	if (failed) return {image: null, error: UNREADABLE_ERROR};
	return {image: null};
}

async function readClipboardImageWindows(
	run: ClipboardCommandRunner,
): Promise<ClipboardImageResult> {
	const script =
		'Add-Type -AssemblyName System.Windows.Forms,System.Drawing; ' +
		'$img=[System.Windows.Forms.Clipboard]::GetImage(); ' +
		'if($img -ne $null){ $ms=New-Object System.IO.MemoryStream; ' +
		'$img.Save($ms,[System.Drawing.Imaging.ImageFormat]::Png); ' +
		'$bytes=$ms.ToArray(); $out=[Console]::OpenStandardOutput(); ' +
		'$out.Write($bytes,0,$bytes.Length); $out.Flush() }';
	const result = await run('powershell', [
		'-NoProfile',
		'-NonInteractive',
		'-Command',
		script,
	]);
	if (result.missing) {
		logger.debug(
			'Clipboard image paste unavailable: `powershell` not found on PATH',
		);
		return {
			image: null,
			error: 'Clipboard image paste needs PowerShell on PATH',
		};
	}
	if (result.timedOut) return {image: null, error: TIMEOUT_ERROR};
	if (result.tooLarge) return {image: null, error: TOO_LARGE_ERROR};
	if (result.failed) return {image: null, error: UNREADABLE_ERROR};
	if (result.stdout.length === 0) return {image: null};
	return fromClipboardBuffer(result.stdout);
}

/** Turn raw clipboard bytes into a pending attachment, or explain why not. */
function fromClipboardBuffer(buffer: Buffer): ClipboardImageResult {
	if (buffer.length === 0) return {image: null};
	if (buffer.length > MAX_IMAGE_BYTES) {
		logger.warn(`Clipboard image exceeds ${MAX_IMAGE_BYTES} bytes; skipping`);
		return {image: null, error: TOO_LARGE_ERROR};
	}
	return {
		image: {
			data: buffer.toString('base64'),
			mediaType: 'image/png',
			source: 'clipboard',
		},
	};
}

/**
 * Spawn one helper asynchronously and normalise its outcome. `execFile` gives
 * us the same timeout/maxBuffer behaviour `spawnSync` had without blocking the
 * event loop. Exported so the timeout and size-cap mapping can be tested
 * without a real clipboard.
 */
export function runClipboardCommand(
	command: string,
	args: readonly string[],
	options: {timeoutMs?: number; maxBytes?: number} = {},
): Promise<ClipboardCommandResult> {
	const timeoutMs = options.timeoutMs ?? CLIPBOARD_TIMEOUT_MS;
	const maxBytes = options.maxBytes ?? MAX_IMAGE_BYTES;
	return new Promise(resolve => {
		let exceededTimeout = false;
		const timer = setTimeout(() => {
			exceededTimeout = true;
		}, timeoutMs);

		execFile(
			command,
			[...args],
			{
				encoding: 'buffer',
				maxBuffer: maxBytes,
				timeout: timeoutMs,
				windowsHide: true,
			},
			(error, stdout) => {
				clearTimeout(timer);
				const code = (error as NodeJS.ErrnoException | null)?.code;
				const missing = code === 'ENOENT';
				const tooLarge = code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER';
				const timedOut =
					Boolean(error) &&
					!missing &&
					!tooLarge &&
					(exceededTimeout || error?.killed === true);
				resolve({
					stdout: stdout ?? Buffer.alloc(0),
					missing,
					timedOut,
					tooLarge,
					failed: Boolean(error) && !missing && !tooLarge && !timedOut,
				});
			},
		);
	});
}

function safeUnlink(path: string): void {
	try {
		if (existsSync(path)) unlinkSync(path);
	} catch {
		// Best-effort cleanup; a leftover temp file is harmless.
	}
}
