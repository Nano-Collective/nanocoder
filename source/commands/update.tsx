import React from 'react';
import {
	ErrorMessage,
	InfoMessage,
	SuccessMessage,
} from '@/components/message-box';
import {getToolManager} from '@/message-handler';
import {Command} from '@/types/index';
import {logError, logInfo} from '@/utils/message-queue';
import {checkForUpdates} from '@/utils/update-checker';

/**
 * Determines if a command execution failed based on multiple signals.
 * Checks exit code first (most reliable), then looks for specific error patterns.
 * Exported for testing purposes.
 */
export function hasCommandFailed(output: string): boolean {
	const outputStr = String(output || '');

	// Strategy 1: Check exit code (most reliable)
	const exitCodeMatch = outputStr.match(/^EXIT_CODE:\s*(\d+)/m);
	if (exitCodeMatch) {
		const exitCode = parseInt(exitCodeMatch[1], 10);
		// Non-zero exit code indicates failure
		if (exitCode !== 0) {
			return true;
		}
	}

	// Strategy 2: Check for critical error patterns
	// Use word boundaries and case-sensitive matching to avoid false positives
	const normalized = outputStr.toLowerCase();

	// Critical errors that definitively indicate failure
	const criticalErrors = [
		/\bcommand not found\b/i,
		/\bno such file or directory\b/i,
		/\bpermission denied\b/i,
		/^error:/im, // Error at start of line
		/\berror:\s*(?!0\b)/i, // "error:" not followed by 0
		/\bfatal\b/i,
		/\bfailed\b/i,
		/\bcannot\b/i,
	];

	for (const pattern of criticalErrors) {
		if (pattern.test(normalized)) {
			// Additional check: avoid false positives for success messages
			// like "0 errors", "error-free", "no errors found"
			if (/0\s*errors?|error-?free|no\s*errors?\s*found/i.test(normalized)) {
				continue;
			}
			return true;
		}
	}

	// Strategy 3: Check if STDERR has content (warning: not always an error)
	// Some tools write progress to stderr, so this is a weak signal
	// Only use this if no other signals present
	const hasStderr = /^STDERR:\s*\S/m.test(outputStr);
	if (hasStderr) {
		// Check if stderr contains actual error indicators, not just warnings/info
		const stderrMatch = outputStr.match(/^STDERR:\s*([\s\S]*?)(?:^STDOUT:|$)/m);
		if (stderrMatch) {
			const stderrContent = stderrMatch[1].toLowerCase();
			// Only treat as error if stderr contains error-like content
			if (/\berror\b|\bfatal\b|\bfailed\b|\bcannot\b/i.test(stderrContent)) {
				return true;
			}
		}
	}

	return false;
}

export const updateCommand: Command = {
	name: 'update',
	description: 'Update Nanocoder to the latest version',
	handler: async (_args: string[]) => {
		// Show initial checking message
		logInfo('Checking for available updates...', true);

		try {
			const updateInfo = await checkForUpdates();

			if (updateInfo.hasUpdate) {
				// Show updating message
				logInfo(
					'Downloading and installing the latest Nanocoder update...',
					true,
				);

				// Run update command if provided; otherwise show informative message
				if (updateInfo.updateCommand) {
					try {
						const executeBash =
							getToolManager()?.getToolHandler('execute_bash');
						if (!executeBash) {
							throw new Error('execute_bash tool not available');
						}
						const result = await executeBash({
							command: updateInfo.updateCommand,
						});

						// Check for command failure using multiple strategies
						if (hasCommandFailed(result)) {
							logError('Update command executed but returned an error', true);
							return React.createElement(ErrorMessage, {
								message: `Update command failed. Output: ${String(result)}`,
								hideBox: true,
							});
						}

						// Show success message
						return React.createElement(SuccessMessage, {
							message:
								'Nanocoder has been updated to the latest version. Please restart your session to apply the update.',
							hideBox: true,
						});
					} catch (err) {
						const errorMessage =
							err instanceof Error ? err.message : String(err);
						logError(`Failed to execute update command: ${errorMessage}`, true);
						return React.createElement(ErrorMessage, {
							message: `Failed to execute update command: ${errorMessage}`,
							hideBox: true,
						});
					}
				}

				if (updateInfo.updateMessage) {
					// We cannot run an automated update; show instructions to user
					return React.createElement(InfoMessage, {
						message: updateInfo.updateMessage,
						hideBox: true,
					});
				}

				// Fallback for unknown installation method
				return React.createElement(InfoMessage, {
					message:
						'A new version is available. Please update using your package manager.',
					hideBox: true,
				});
			} else {
				// Already up to date
				return React.createElement(InfoMessage, {
					message: 'You are already on the latest version.',
					hideBox: true,
				});
			}
		} catch (error) {
			const errorMessage =
				error instanceof Error ? error.message : String(error);
			logError(`Failed to update Nanocoder: ${errorMessage}`, true);
			return React.createElement(ErrorMessage, {
				message: `Failed to check for updates: ${errorMessage}`,
				hideBox: true,
			});
		}
	},
};
