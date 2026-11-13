import {pathToFileURL} from 'node:url';

const OSC_8 = '\u001B]8;;';
const OSC_TERMINATOR = '\u0007';

export function createTerminalFileLink(
	filePath: string,
	label: string,
): string {
	return `${OSC_8}${pathToFileURL(filePath).href}${OSC_TERMINATOR}${label}${OSC_8}${OSC_TERMINATOR}`;
}
