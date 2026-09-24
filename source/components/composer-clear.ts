/**
 * Whether Escape should offer to clear the composer.
 *
 * @param input - Current composer text
 * @param attachmentCount - Number of attached images
 * @returns Whether there is something to clear
 */
export function shouldOfferInputClear(
	input: string,
	attachmentCount: number,
): boolean {
	return input.length > 0 || attachmentCount > 0;
}
