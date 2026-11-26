import React from 'react';
import {errorMsg, infoMsg, successMsg} from '@/components/message-factory';
import SecurityDisclaimer from '@/components/security-disclaimer';
import {loadPreferences, savePreferences} from '@/config/preferences';
import {
	ensureDirectoryTrust,
	grantDirectoryTrust,
} from '@/config/trust/directory-trust';
import {parseCustomCommandArgs} from '@/custom-commands/args';
import {
	addWorkingDirectory,
	prepareWorkingDirectory,
} from '@/services/working-directories';
import type {StatefulCommand} from '@/types/index';
import {formatError} from '@/utils/error-formatter';

export const addDirCommand: StatefulCommand = {
	name: 'add-dir',
	description:
		'Add a trusted working directory (/add-dir [--read-only] <path>)',
	run: async context => {
		const args = parseCustomCommandArgs(context.argText);
		const readOnly = args[0] === '--read-only';
		const paths = readOnly ? args.slice(1) : args;
		if (paths.length !== 1 || paths[0].startsWith('--')) {
			return {
				show: infoMsg('Usage: /add-dir [--read-only] <path>', 'add-dir-usage'),
			};
		}
		try {
			const directory = prepareWorkingDirectory({
				path: paths[0],
				mode: readOnly ? 'read-only' : 'read-write',
			});
			const add = () => {
				const added = addWorkingDirectory(directory);
				context.addToChatQueue(
					successMsg(
						`Added working directory: ${added.path} (${added.mode})`,
						'add-dir-success',
					),
				);
			};
			if (ensureDirectoryTrust(directory.path, false).trusted) {
				add();
				return 'done';
			}
			context.setLiveComponentCapturesInput(true);
			const until = new Promise<void>(resolve => {
				const close = () => {
					context.setLiveComponent(null);
					context.setLiveComponentCapturesInput(false);
					resolve();
				};
				context.setLiveComponent(
					React.createElement(SecurityDisclaimer, {
						directory: directory.path,
						onConfirm: fingerprint => {
							try {
								if (
									savePreferences(
										grantDirectoryTrust(
											loadPreferences(),
											directory.path,
											fingerprint,
										),
									) === false
								)
									throw new Error('Could not save directory trust');
								add();
							} catch (error) {
								context.addToChatQueue(
									errorMsg(formatError(error), 'add-dir-error'),
								);
							}
							close();
						},
						onExit: close,
						cancelLabel: 'No, cancel',
					}),
				);
			});
			return {until};
		} catch (error) {
			return {show: errorMsg(formatError(error), 'add-dir-error')};
		}
	},
};
