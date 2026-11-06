import {execFileSync} from 'child_process';
import {accessSync, constants as fsConstants} from 'fs';

/**
 * Checks if a command exists in the system PATH or as an executable path.
 * Uses execFileSync with separate arguments to prevent shell injection.
 * Handles both PATH lookups and direct path references (./bin/cmd, /usr/bin/cmd).
 */
export function commandExists(command: string): boolean {
	// Check if command is a path (contains path separators)
	if (command.includes('/') || command.includes('\\')) {
		try {
			// Check if file exists and is executable
			accessSync(command, fsConstants.X_OK);
			return true;
		} catch {
			return false;
		}
	}

	// PATH lookup using which/where
	try {
		const checkCmd = process.platform === 'win32' ? 'where' : 'which';
		execFileSync(checkCmd, [command], {stdio: 'ignore'});
		return true;
	} catch {
		return false;
	}
}
