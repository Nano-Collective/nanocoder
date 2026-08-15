import {useTerminalRows} from '@/hooks/useTerminalWidth';

/**
 * Rows the wizard chrome eats around a list: the outer box border + padding,
 * the wizard title, the step heading, the "Added: …" line, and the footer
 * hints. Steps with extra furniture (tabs, an inline prompt) pass a larger
 * value.
 */
const DEFAULT_CHROME_ROWS = 16;

/** Never shrink a list below this, however short the terminal is. */
const MIN_LIST_ROWS = 4;

/**
 * How many rows a wizard list may occupy before its box overflows the
 * terminal. An unbounded `SelectInput` pushes the whole wizard off screen on a
 * normal-height terminal, which reads as the wizard having vanished — and
 * hides trailing entries like "Done & Save", leaving no visible way to finish.
 */
export function useListLimit(chromeRows: number = DEFAULT_CHROME_ROWS): number {
	const terminalRows = useTerminalRows();
	return Math.max(MIN_LIST_ROWS, terminalRows - chromeRows);
}
