/**
 * /skills slash command. Lists every skill loaded by the bootstrap, with
 * its shape (single-file or bundle), priority, member counts, and any
 * active subscriptions.
 *
 * `/skills show <name>` drills into one skill: member paths, subscription
 * details, visibility setting, and any registration warnings.
 *
 * See `agents/2026-05-20-skills-unification-plan.md` step 22.
 */

import {Box, Text} from 'ink';
import React from 'react';
import {InfoMessage} from '@/components/message-box';
import {TitledBoxWithPreferences} from '@/components/ui/titled-box';
import {useTerminalWidth} from '@/hooks/useTerminalWidth';
import {useTheme} from '@/hooks/useTheme';
import {generateKey} from '@/session/key-generator';
import {findSkill, getLoadedSkills} from '@/skills/skill-registry';
import type {Command} from '@/types/index';
import type {Skill} from '@/types/skills';

function memberCount(skill: Skill): string {
	const parts: string[] = [];
	if (skill.commands?.length) {
		parts.push(
			`${skill.commands.length} command${skill.commands.length === 1 ? '' : 's'}`,
		);
	}
	if (skill.subagent) parts.push('1 agent');
	if (skill.tools?.length) {
		parts.push(
			`${skill.tools.length} tool${skill.tools.length === 1 ? '' : 's'}`,
		);
	}
	return parts.length === 0 ? 'no members' : parts.join(', ');
}

function SkillsListView({skills}: {skills: Skill[]}) {
	const boxWidth = useTerminalWidth();
	const {colors} = useTheme();

	if (skills.length === 0) {
		return (
			<TitledBoxWithPreferences
				title="Skills"
				width={boxWidth}
				borderColor={colors.primary}
				paddingX={2}
				paddingY={1}
				flexDirection="column"
			>
				<Text color={colors.secondary}>
					No skills loaded. Drop a directory with a `skill.yaml` under
					.nanocoder/skills/ and restart.
				</Text>
			</TitledBoxWithPreferences>
		);
	}

	const sorted = [...skills].sort((a, b) => a.name.localeCompare(b.name));

	return (
		<TitledBoxWithPreferences
			title={`Skills (${skills.length})`}
			width={boxWidth}
			borderColor={colors.primary}
			paddingX={2}
			paddingY={1}
			flexDirection="column"
		>
			{sorted.map(skill => (
				<Box key={skill.name} flexDirection="column" marginBottom={1}>
					<Text bold>{skill.name}</Text>
					<Text color={colors.secondary}>
						{skill.source.shape} / {skill.source.priority} -{' '}
						{memberCount(skill)}
						{skill.subscribe?.length
							? ` - ${skill.subscribe.length} subscription${skill.subscribe.length === 1 ? '' : 's'}`
							: ''}
					</Text>
					<Text>{skill.description}</Text>
				</Box>
			))}
		</TitledBoxWithPreferences>
	);
}

function SkillDetailView({skill}: {skill: Skill}) {
	const boxWidth = useTerminalWidth();
	const {colors} = useTheme();

	return (
		<TitledBoxWithPreferences
			title={`Skill: ${skill.name}`}
			width={boxWidth}
			borderColor={colors.primary}
			paddingX={2}
			paddingY={1}
			flexDirection="column"
		>
			<Text>{skill.description}</Text>
			<Text color={colors.secondary}>
				Shape: {skill.source.shape}, priority: {skill.source.priority}, root:{' '}
				{skill.source.rootPath}
			</Text>
			{skill.version ? (
				<Text color={colors.secondary}>
					Version: {skill.version}
					{skill.author ? ` (${skill.author})` : ''}
				</Text>
			) : null}
			<Text color={colors.secondary}>
				Tools visibility: {skill.toolsVisibility}
			</Text>

			<Box marginTop={1} flexDirection="column">
				<Text bold>Members</Text>
				{(skill.commands ?? []).map(c => (
					<Text key={c.command.fullName}>
						- command: /{c.command.fullName} ({c.filePath})
					</Text>
				))}
				{skill.subagent ? (
					<Text>
						- agent: {skill.subagent.subagent.name} ({skill.subagent.filePath})
					</Text>
				) : null}
				{(skill.tools ?? []).map(t => (
					<Text key={t.tool.name}>
						- tool: {t.tool.name} ({t.filePath})
					</Text>
				))}
				{!skill.commands?.length && !skill.subagent && !skill.tools?.length ? (
					<Text color={colors.secondary}>(no members)</Text>
				) : null}
			</Box>

			{skill.subscribe?.length ? (
				<Box marginTop={1} flexDirection="column">
					<Text bold>Subscriptions</Text>
					{skill.subscribe.map((trig, i) => (
						<Text key={`${trig.kind}-${i}`}>
							- {trig.kind} → {trig.target ?? '(self)'}
							{trig.confirm ? ' [confirm: plan mode]' : ''}
						</Text>
					))}
				</Box>
			) : null}
		</TitledBoxWithPreferences>
	);
}

export const skillsCommand: Command = {
	name: 'skills',
	description: 'List loaded skills. Subcommands: show <name>, create <name>.',
	handler: (args, _messages, _metadata) => {
		if (args[0] === 'create') {
			// `create` is intercepted in app-util.ts before dispatch. Show usage
			// if the user reached this branch (no name supplied, or non-app
			// context like /plain mode).
			return Promise.resolve(
				React.createElement(InfoMessage, {
					key: generateKey('skills'),
					message:
						'Usage: /skills create <name>\nExample: /skills create pr-reviewer\n\nScaffolds a bundle directory under .nanocoder/skills/<name>/. For single-piece skills, use /commands create, /agents create, or /tools create.',
					hideBox: true,
				}),
			);
		}

		if (args[0] === 'show') {
			const name = args[1];
			if (!name) {
				return Promise.resolve(
					React.createElement(InfoMessage, {
						key: generateKey('skills'),
						message: 'Usage: /skills show <name>',
						hideBox: true,
					}),
				);
			}
			const skill = findSkill(name);
			if (!skill) {
				return Promise.resolve(
					React.createElement(InfoMessage, {
						key: generateKey('skills'),
						message: `No skill named "${name}" is loaded.`,
						hideBox: true,
					}),
				);
			}
			return Promise.resolve(
				React.createElement(SkillDetailView, {
					skill,
					key: generateKey('skills'),
				}),
			);
		}

		return Promise.resolve(
			React.createElement(SkillsListView, {
				skills: getLoadedSkills(),
				key: generateKey('skills'),
			}),
		);
	},
};
