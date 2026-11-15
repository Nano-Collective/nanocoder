/**
 * Deprecation notice for the legacy WebSocket companion (`--vscode`, or `/ide`
 * → VS Code). The VS Code extension now runs its own agent over ACP
 * (`nanocoder --acp`), so this companion duplicates that integration and is
 * slated for removal.
 */

export const LEGACY_VSCODE_DEPRECATION_NOTICE =
	'The VS Code companion started by --vscode (and /ide) is deprecated and will be removed in a future release. ' +
	'The Nanocoder VS Code extension now runs the agent itself: open the Nanocoder sidebar in VS Code instead. ' +
	'See docs/features/vscode-extension.md.';

let noticeTaken = false;

/**
 * The deprecation notice the first time it is asked for in this process, and
 * null after that, so a session that enables the companion more than once
 * (the flag, then `/ide`) warns once.
 */
export function takeLegacyVscodeDeprecationNotice(): string | null {
	if (noticeTaken) return null;
	noticeTaken = true;
	return LEGACY_VSCODE_DEPRECATION_NOTICE;
}

/** @internal */
export function resetLegacyVscodeDeprecationNoticeForTests(): void {
	noticeTaken = false;
}
