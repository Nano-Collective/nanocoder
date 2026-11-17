import {readFileSync} from 'node:fs';

export const defaultConfig = {theme: 'dark', retries: 2};

/**
 * Read config.json. Invalid JSON currently propagates the SyntaxError to the
 * caller, which is the behaviour the task has to change.
 */
export function loadConfig(file) {
	return JSON.parse(readFileSync(file, 'utf8'));
}
