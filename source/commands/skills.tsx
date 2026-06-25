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
import {InfoField} from '@/components/ui/info-field';
import {TitledBoxWithPreferences} from '@/components/ui/titled-box';
import {useTerminalWidth} from '@/hooks/useTerminalWidth';
import {useTheme} from '@/hooks/useTheme';
import {generateKey} from '@/session/key-generator';
import {checkSkillBundle, type SkillCheckReport} from '@/skills/check';
import {
	applyPromotion,
	type PromoteDirection,
	planPromotion,
} from '@/skills/promote';
import {findSkill, getLoadedSkills} from '@/skills/skill-registry';
import type {Command} from '@/types/index';
import type {Skill} from '@/types/skills';
import {
	errorMsg,
	infoMsg,
	successMsg,
	warningMsg,
} from '@/utils/message-factory';

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
			{sorted.map((skill, i) => (
				<Box
					key={skill.name}
					flexDirection="column"
					marginBottom={i < sorted.length - 1 ? 1 : 0}
				>
					<Box>
						<Text color={colors.text} bold>
							› {skill.name}
						</Text>
						<Text color={colors.secondary}>
							{' '}
							· {skill.source.shape} / {skill.source.priority}
						</Text>
					</Box>
					<Box marginLeft={4}>
						<Text color={colors.secondary}>{skill.description}</Text>
					</Box>
					<Box marginLeft={4}>
						<Text color={colors.secondary}>
							{memberCount(skill)}
							{skill.subscribe?.length
								? ` · ${skill.subscribe.length} subscription${skill.subscribe.length === 1 ? '' : 's'}`
								: ''}
						</Text>
					</Box>
				</Box>
			))}
		</TitledBoxWithPreferences>
	);
}

function SkillDetailView({skill}: {skill: Skill}) {
	const boxWidth = useTerminalWidth();
	const {colors} = useTheme();

	const fields: Array<{label: string; value: string}> = [
		{label: 'Source', value: skill.source.rootPath ?? '(unknown)'},
		{
			label: 'Shape',
			value: `${skill.source.shape} / ${skill.source.priority}`,
		},
		...(skill.version
			? [
					{
						label: 'Version',
						value: `${skill.version}${skill.author ? ` (${skill.author})` : ''}`,
					},
				]
			: []),
		{label: 'Tools visibility', value: skill.toolsVisibility},
	];

	const hasMembers =
		!!skill.commands?.length || !!skill.subagent || !!skill.tools?.length;

	return (
		<TitledBoxWithPreferences
			title={`Skill: ${skill.name}`}
			width={boxWidth}
			borderColor={colors.primary}
			paddingX={2}
			paddingY={1}
			flexDirection="column"
			marginBottom={1}
		>
			<Box marginBottom={1}>
				<Text>{skill.description}</Text>
			</Box>

			{fields.map(f => (
				<InfoField key={f.label} label={f.label} value={f.value} />
			))}

			<Box flexDirection="column" marginBottom={1}>
				<Text color={colors.primary} bold>
					Members
				</Text>
				{!hasMembers ? (
					<Text color={colors.secondary}>(no members)</Text>
				) : (
					<>
						{(skill.commands ?? []).map(c => (
							<Text key={c.command.fullName} color={colors.secondary}>
								› command: /{c.command.fullName} ({c.filePath})
							</Text>
						))}
						{skill.subagent ? (
							<Text color={colors.secondary}>
								› agent: {skill.subagent.subagent.name} (
								{skill.subagent.filePath})
							</Text>
						) : null}
						{(skill.tools ?? []).map(t => (
							<Text key={t.tool.name} color={colors.secondary}>
								› tool: {t.tool.name} ({t.filePath})
							</Text>
						))}
					</>
				)}
			</Box>

			{skill.subscribe?.length ? (
				<Box flexDirection="column" marginBottom={1}>
					<Text color={colors.primary} bold>
						Subscriptions
					</Text>
					{skill.subscribe.map((trig, i) => (
						<Text key={`${trig.kind}-${i}`} color={colors.secondary}>
							› {trig.kind} → {trig.target ?? '(self)'}
							{trig.confirm ? ' [confirm: plan mode]' : ''}
						</Text>
					))}
				</Box>
			) : null}
		</TitledBoxWithPreferences>
	);
}

function SkillCheckView({report}: {report: SkillCheckReport}) {
	const boxWidth = useTerminalWidth();
	const {colors} = useTheme();

	const errorCount = report.issues.filter(i => i.severity === 'error').length;
	const warningCount = report.issues.filter(
		i => i.severity === 'warning',
	).length;

	const headline = report.ok
		? `PASS · ${report.memberSummary}`
		: !report.found
			? 'FAIL · not found'
			: `FAIL · ${errorCount} error${errorCount === 1 ? '' : 's'}${warningCount ? `, ${warningCount} warning${warningCount === 1 ? '' : 's'}` : ''}`;

	return (
		<Box width={boxWidth} marginBottom={1} flexDirection="column">
			<Box marginBottom={report.issues.length > 0 ? 1 : 0}>
				<Text color={report.ok ? colors.success : colors.error} bold>
					{headline}
				</Text>
				<Text color={colors.secondary}> · {report.bundlePath}</Text>
			</Box>

			{report.issues.map((issue, i) => (
				<Box key={`${issue.severity}-${i}`} flexDirection="column">
					<Box marginBottom={1}>
						<Text
							color={issue.severity === 'error' ? colors.error : colors.warning}
						>
							{issue.severity === 'error' ? '✗ ' : '! '}{' '}
						</Text>
						<Text color={colors.text}>{issue.message}</Text>
					</Box>
					{issue.filePath ? (
						<Box marginLeft={2}>
							<Text color={colors.secondary}>{issue.filePath}</Text>
						</Box>
					) : null}
				</Box>
			))}

			{report.ok && report.issues.length === 0 ? (
				<Text color={colors.secondary}>
					No problems found. Restart nanocoder to load it.
				</Text>
			) : null}
		</Box>
	);
}

async function handlePromotion(direction: PromoteDirection, args: string[]) {
	const verb = direction; // 'promote' | 'demote'
	const positional = args.filter(a => !a.startsWith('--'));
	const force = args.includes('--force');
	const name = positional[1];

	if (!name) {
		return infoMsg(
			`Usage: /skills ${verb} <name> [--force]\nExample: /skills ${verb} pr-reviewer`,
			'skills',
		);
	}

	const skill = findSkill(name);
	if (!skill) {
		return errorMsg(`No skill named "${name}" is loaded.`, 'skills');
	}

	const planned = planPromotion(skill, direction, process.cwd());
	if ('error' in planned) {
		return infoMsg(planned.error, 'skills');
	}
	const {plan} = planned;

	const result = await applyPromotion(plan, force);
	if (result.destExists) {
		return warningMsg(
			`A skill already exists at ${plan.dest}.\nRe-run with --force to overwrite it:\n  /skills ${verb} ${name} --force`,
			'skills',
		);
	}
	if (!result.ok) {
		return errorMsg(
			`Failed to ${verb} "${name}": ${result.error ?? 'unknown error'}`,
			'skills',
		);
	}

	return successMsg(
		`${verb === 'promote' ? 'Promoted' : 'Demoted'} "${name}" (${plan.fromLevel} → ${plan.toLevel}).\n  ${plan.source}\n  → ${plan.dest}\nRestart nanocoder to load it.`,
		'skills',
	);
}

export const skillsCommand: Command = {
	name: 'skills',
	description:
		'List loaded skills. Subcommands: show <name>, create <name>, check <name>, promote <name>, demote <name>.',
	handler: async (args, _messages, _metadata) => {
		if (args[0] === 'promote' || args[0] === 'demote') {
			return handlePromotion(args[0], args);
		}

		if (args[0] === 'check') {
			const name = args[1];
			if (!name) {
				return infoMsg(
					'Usage: /skills check <name>\nExample: /skills check pr-reviewer',
					'skills',
				);
			}
			const report = await checkSkillBundle(process.cwd(), name);
			return React.createElement(SkillCheckView, {
				report,
				key: generateKey('skills'),
			});
		}

		if (args[0] === 'create') {
			// `create` is intercepted in app-util.ts before dispatch. Show usage
			// if the user reached this branch (no name supplied, or non-app
			// context like /plain mode).
			return Promise.resolve(
				infoMsg(
					'Usage: /skills create <name>\nExample: /skills create pr-reviewer\n\nScaffolds a bundle directory under .nanocoder/skills/<name>/. For single-piece skills, use /commands create, /agents create, or /tools create.',
					'skills',
				),
			);
		}

		if (args[0] === 'show') {
			const name = args[1];
			if (!name) {
				return Promise.resolve(infoMsg('Usage: /skills show <name>', 'skills'));
			}
			const skill = findSkill(name);
			if (!skill) {
				return Promise.resolve(
					infoMsg(`No skill named "${name}" is loaded.`, 'skills'),
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
