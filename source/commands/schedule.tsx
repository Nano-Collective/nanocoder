/**
 * /schedule — read-only view of cron subscriptions declared across all
 * loaded skills.
 *
 * The legacy `.nanocoder/schedules.json`-backed scheduler was replaced by
 * skill subscriptions. Mutations now happen by editing a command's
 * frontmatter or a bundle's `skill.yaml`. The daemon owns execution.
 */

import {Box, Text} from 'ink';
import React from 'react';
import {InfoMessage} from '@/components/message-box';
import {TitledBoxWithPreferences} from '@/components/ui/titled-box';
import {useTerminalWidth} from '@/hooks/useTerminalWidth';
import {useTheme} from '@/hooks/useTheme';
import {formatCronHuman} from '@/schedule/cron';
import {generateKey} from '@/session/key-generator';
import {getLoadedSkills} from '@/skills/skill-registry';
import type {Command} from '@/types/index';

interface CronEntry {
	skill: string;
	target: string;
	cron: string;
	human: string;
	confirm?: boolean;
}

function collectCronSubscriptions(): CronEntry[] {
	const out: CronEntry[] = [];
	for (const skill of getLoadedSkills()) {
		for (const trig of skill.subscribe ?? []) {
			if (trig.kind !== 'schedule.cron') continue;
			out.push({
				skill: skill.name,
				target: trig.target ?? '(self)',
				cron: trig.cron,
				human: formatCronHuman(trig.cron),
				confirm: trig.confirm,
			});
		}
	}
	return out;
}

function ScheduleView({entries}: {entries: CronEntry[]}) {
	const boxWidth = useTerminalWidth();
	const {colors} = useTheme();

	if (entries.length === 0) {
		return (
			<TitledBoxWithPreferences
				title="Schedules"
				width={boxWidth}
				borderColor={colors.primary}
				paddingX={2}
				paddingY={1}
				flexDirection="column"
			>
				<Text color={colors.secondary}>
					No cron subscriptions declared. Add a `schedule.cron` entry to a
					command's frontmatter or a bundle's `skill.yaml` and run `nanocoder
					daemon start` to make it fire.
				</Text>
			</TitledBoxWithPreferences>
		);
	}

	return (
		<TitledBoxWithPreferences
			title={`Schedules (${entries.length})`}
			width={boxWidth}
			borderColor={colors.primary}
			paddingX={2}
			paddingY={1}
			flexDirection="column"
		>
			<Text color={colors.secondary}>
				Cron subscriptions only fire while the daemon is running (`nanocoder
				daemon start`).
			</Text>
			{entries.map((e, i) => (
				<Box key={`${e.skill}-${i}`} flexDirection="column" marginTop={1}>
					<Text bold>
						{e.cron} → {e.target}
						{e.confirm ? ' [confirm: plan mode]' : ''}
					</Text>
					<Text color={colors.secondary}>
						{e.human} — declared in skill "{e.skill}"
					</Text>
				</Box>
			))}
		</TitledBoxWithPreferences>
	);
}

export const scheduleCommand: Command = {
	name: 'schedule',
	description:
		'List cron-triggered skills (single-file frontmatter + bundle skill.yaml). Read-only - edit the source file to change.',
	handler: async args => {
		if (args[0] && args[0] !== 'list') {
			return React.createElement(InfoMessage, {
				key: generateKey('schedule'),
				message:
					"Usage: /schedule (or /schedule list)\n\nMutations now happen by editing a command's frontmatter `subscribe:` block, or a bundle's `skill.yaml`. See docs/features/skills.md for the new model.",
				hideBox: true,
			});
		}
		return React.createElement(ScheduleView, {
			key: generateKey('schedule'),
			entries: collectCronSubscriptions(),
		});
	},
};
