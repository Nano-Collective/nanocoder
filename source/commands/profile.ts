import {errorMsg, infoMsg, successMsg} from '@/components/message-factory';
import {reloadAppConfig} from '@/config/index';
import {
	getActiveProfileName,
	loadAvailableProfiles,
	setActiveProfile,
} from '@/config/profile';
import type {CommandContext, StatefulCommand} from '@/types/index';

/**
 * /profile lists available profiles or switches to a named profile.
 *
 * /profile          - List all configured profiles, highlighting the active one
 * /profile <name>   - Switch to the named profile and reload configuration
 * /profile --clear  - Clear active profile and run with base configuration
 */
export const profileCommand: StatefulCommand = {
	name: 'profile',
	description:
		'List or switch configuration profiles (/profile [name|--clear])',
	run: async (context: CommandContext) => {
		const targetName = context.args[0]?.trim();
		const profiles = loadAvailableProfiles();
		const profileNames = Object.keys(profiles);

		if (!targetName) {
			if (profileNames.length === 0) {
				context.addToChatQueue(
					infoMsg(
						'No configuration profiles found in agents.config.json.\nDefine profiles under nanocoder.profiles.',
						'profile-list-empty',
					),
				);
				return 'done';
			}

			const activeName = getActiveProfileName();
			const lines: string[] = ['Configuration profiles:'];

			for (const name of profileNames) {
				const isActive = name === activeName;
				const marker = isActive ? '* ' : '  ';
				const suffix = isActive ? ' (active)' : '';
				lines.push(`\n${marker}${name}${suffix}`);

				const profile = profiles[name];
				const details: string[] = [];
				if (profile.provider) details.push(`provider: ${profile.provider}`);
				if (profile.model) details.push(`model: ${profile.model}`);
				if (profile.mode) details.push(`mode: ${profile.mode}`);

				const extraKeys = Object.keys(profile).filter(
					k => !['provider', 'model', 'mode'].includes(k),
				);
				if (extraKeys.length > 0) {
					details.push(`overrides: ${extraKeys.join(', ')}`);
				}

				for (const detail of details) {
					lines.push(`    ${detail}`);
				}
			}

			context.addToChatQueue(infoMsg(lines.join('\n'), 'profile-list'));
			return 'done';
		}

		if (
			targetName === '--clear' ||
			targetName === 'clear' ||
			targetName === '--reset'
		) {
			setActiveProfile(undefined);
			reloadAppConfig();
			context.addToChatQueue(
				successMsg(
					'Profile cleared. Running without a configuration profile.',
					'profile-cleared',
				),
			);
			return 'done';
		}

		if (!Object.hasOwn(profiles, targetName)) {
			const listText =
				profileNames.length > 0
					? `Available profiles: ${profileNames.join(', ')}`
					: 'No profiles are configured in agents.config.json.';
			context.addToChatQueue(
				errorMsg(
					`Unknown profile "${targetName}". ${listText}`,
					'profile-unknown',
				),
			);
			return 'done';
		}

		setActiveProfile(targetName);
		reloadAppConfig();

		const profile = profiles[targetName];
		let modelSwitchFailed = false;
		if (context.switchModel && (profile.provider || profile.model)) {
			const targetProvider = profile.provider || context.provider;
			const targetModel = profile.model || context.model;
			try {
				const switched = await context.switchModel(targetProvider, targetModel);
				if (!switched) {
					modelSwitchFailed = true;
				}
			} catch {
				modelSwitchFailed = true;
			}
		}

		if (profile.mode && context.switchMode) {
			context.switchMode(profile.mode);
		}

		if (modelSwitchFailed) {
			const targetModel = profile.model || context.model;
			context.addToChatQueue(
				errorMsg(
					`Failed to switch model to "${targetModel}". Profile configuration was not fully applied.`,
					'profile-model-switch-failed',
				),
			);
			return 'done';
		}

		context.addToChatQueue(
			successMsg(
				`Switched to profile "${targetName}". Configuration reloaded.`,
				'profile-switched',
			),
		);
		return 'done';
	},
};
