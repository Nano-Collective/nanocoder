/**
 * With the VS Code extension connected, a submitted prompt carries the
 * editor selection after it (`\n\n[@file]<!--vscode-context-->…<!--/vscode-context-->`,
 * see `useVSCodePromptHandling`). A slash command's arguments must not
 * include it.
 */
const TRAILING_VSCODE_CONTEXT =
	/\n\n\[@[^\]]+\]<!--vscode-context-->[\s\S]*?<!--\/vscode-context-->\s*$/;

/** `text` without the trailing VS Code editor context, if it has one. */
export function stripVSCodeContext(text: string): string {
	return text.replace(TRAILING_VSCODE_CONTEXT, '');
}
