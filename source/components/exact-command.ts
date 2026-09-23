/**
 * Whether Enter should submit instead of re-selecting a completion.
 *
 * An exact, sole match is already the typed command. Selecting it only
 * closes the menu and leaves the command unsent.
 *
 * @param input - Current composer text
 * @param completionNames - Names of the visible command matches, without the leading slash
 * @returns Whether the input is exactly the only available command
 */
export function isExactSingleCommand(
	input: string,
	completionNames: readonly string[],
): boolean {
	return (
		completionNames.length === 1 && input.trim() === `/${completionNames[0]}`
	);
}
