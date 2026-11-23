/**
 * Remove a leading UTF-8 byte order mark.
 *
 * Windows editors (e.g. PowerShell 5.1 `Set-Content -Encoding UTF8`) and some
 * servers prefix files with a BOM, which `JSON.parse` rejects and `^`-anchored
 * patterns miss, so readers strip it before parsing.
 */
export function stripUtf8Bom(content: string): string {
	return content.replace(/^\uFEFF/, '');
}
