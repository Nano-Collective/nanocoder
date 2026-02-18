import {existsSync} from 'node:fs';
import {join} from 'node:path';
import {Box, Text} from 'ink';
import React from 'react';
import {useTheme} from '@/hooks/useTheme';
import {
	formatCronHuman,
	generateScheduleId,
	getNextRunTime,
	loadScheduleRuns,
	loadSchedules,
	saveSchedules,
	validateCron,
} from '@/schedule/index';
import type {Schedule} from '@/schedule/types';
import type {Command} from '@/types/index';

function ScheduleMessage({
	message,
	isError,
}: {
	message: string;
	isError?: boolean;
}) {
	const {colors} = useTheme();
	return (
		<Box marginY={1}>
			<Text color={isError ? colors.error : colors.success}>{message}</Text>
		</Box>
	);
}

function ScheduleListDisplay({schedules}: {schedules: Schedule[]}) {
	const {colors} = useTheme();

	if (schedules.length === 0) {
		return (
			<Box marginY={1}>
				<Text color={colors.secondary}>
					No schedules configured. Use /schedule create name && /schedule add
					"cron" name.md
				</Text>
			</Box>
		);
	}

	return (
		<Box flexDirection="column" marginY={1}>
			<Text bold color={colors.primary}>
				Schedules
			</Text>
			{schedules.map(schedule => {
				const nextRun = getNextRunTime(schedule.cron);
				const humanCron = formatCronHuman(schedule.cron);
				return (
					<Box key={schedule.id} flexDirection="column" marginTop={1}>
						<Text>
							<Text color={colors.info} bold>
								{schedule.id}
							</Text>
							<Text color={colors.secondary}> — </Text>
							<Text color={colors.primary}>{schedule.command}</Text>
						</Text>
						<Text color={colors.secondary}>
							{'  '}cron: {schedule.cron} ({humanCron})
						</Text>
						<Text color={colors.secondary}>
							{'  '}enabled: {schedule.enabled ? 'yes' : 'no'}
						</Text>
						{nextRun && (
							<Text color={colors.secondary}>
								{'  '}next run: {nextRun.toLocaleString()}
							</Text>
						)}
						{schedule.lastRunAt && (
							<Text color={colors.secondary}>
								{'  '}last run: {new Date(schedule.lastRunAt).toLocaleString()}
							</Text>
						)}
					</Box>
				);
			})}
		</Box>
	);
}

export const scheduleCommand: Command = {
	name: 'schedule',
	description: 'Manage scheduled jobs',
	handler: async (args: string[]) => {
		const subcommand = args[0]?.toLowerCase();

		// No subcommand or "list" — show all schedules
		if (!subcommand || subcommand === 'list') {
			const schedules = await loadSchedules();
			return React.createElement(ScheduleListDisplay, {
				key: `schedule-list-${Date.now()}`,
				schedules,
			});
		}

		// Add a new schedule
		if (subcommand === 'add') {
			const rest = args.slice(1).join(' ');
			// Parse: "cron expression" command.md
			const cronMatch = rest.match(/^"([^"]+)"\s+(.+)$/);
			if (!cronMatch) {
				return React.createElement(ScheduleMessage, {
					key: `schedule-error-${Date.now()}`,
					message:
						'Usage: /schedule add "cron expression" command.md\nExample: /schedule add "0 9 * * MON" deps-update.md',
					isError: true,
				});
			}

			const cronExpr = cronMatch[1] ?? '';
			const commandFile = cronMatch[2]?.trim() ?? '';

			// Validate cron
			const cronError = validateCron(cronExpr);
			if (cronError) {
				return React.createElement(ScheduleMessage, {
					key: `schedule-error-${Date.now()}`,
					message: `Invalid cron expression: ${cronError}`,
					isError: true,
				});
			}

			// Check schedule file exists
			const commandPath = join(
				process.cwd(),
				'.nanocoder',
				'schedules',
				commandFile,
			);
			if (!existsSync(commandPath)) {
				return React.createElement(ScheduleMessage, {
					key: `schedule-error-${Date.now()}`,
					message: `Schedule file not found: .nanocoder/schedules/${commandFile}\nCreate one with: /schedule create ${commandFile.replace(/\.md$/, '')}`,
					isError: true,
				});
			}

			const schedule: Schedule = {
				id: generateScheduleId(),
				cron: cronExpr,
				command: commandFile,
				enabled: true,
				createdAt: new Date().toISOString(),
				lastRunAt: null,
			};

			const schedules = await loadSchedules();
			schedules.push(schedule);
			await saveSchedules(schedules);

			const humanCron = formatCronHuman(cronExpr);
			return React.createElement(ScheduleMessage, {
				key: `schedule-added-${Date.now()}`,
				message: `Schedule added: ${schedule.id} — ${commandFile} (${humanCron})`,
			});
		}

		// Create — intercepted in app-util.ts to trigger AI assistance
		if (subcommand === 'create') {
			return React.createElement(ScheduleMessage, {
				key: `schedule-error-${Date.now()}`,
				message:
					'Usage: /schedule create <name>\nExample: /schedule create deps-update',
				isError: true,
			});
		}

		// Remove a schedule
		if (subcommand === 'remove' || subcommand === 'rm') {
			const scheduleId = args[1];
			if (!scheduleId) {
				return React.createElement(ScheduleMessage, {
					key: `schedule-error-${Date.now()}`,
					message: 'Usage: /schedule remove <id>',
					isError: true,
				});
			}

			const schedules = await loadSchedules();
			const index = schedules.findIndex(s => s.id === scheduleId);
			if (index === -1) {
				return React.createElement(ScheduleMessage, {
					key: `schedule-error-${Date.now()}`,
					message: `Schedule not found: ${scheduleId}`,
					isError: true,
				});
			}

			const removed = schedules.splice(index, 1)[0];
			await saveSchedules(schedules);

			return React.createElement(ScheduleMessage, {
				key: `schedule-removed-${Date.now()}`,
				message: `Schedule removed: ${removed?.id} — ${removed?.command}`,
			});
		}

		// Start scheduler mode — this is handled specially in app-util.ts
		if (subcommand === 'start') {
			// This case is intercepted before reaching the command handler
			// If we get here, something went wrong
			return React.createElement(ScheduleMessage, {
				key: `schedule-error-${Date.now()}`,
				message: 'Scheduler mode could not be started.',
				isError: true,
			});
		}

		// Show logs
		if (subcommand === 'logs') {
			const scheduleId = args[1];
			const runs = await loadScheduleRuns();

			const filtered = scheduleId
				? runs.filter(r => r.scheduleId === scheduleId)
				: runs;

			if (filtered.length === 0) {
				return React.createElement(ScheduleMessage, {
					key: `schedule-logs-${Date.now()}`,
					message: scheduleId
						? `No runs found for schedule ${scheduleId}`
						: 'No schedule runs recorded yet.',
				});
			}

			const logLines = filtered
				.slice(-20)
				.reverse()
				.map(r => {
					const start = new Date(r.startedAt).toLocaleString();
					const statusIcon =
						r.status === 'success'
							? '[ok]'
							: r.status === 'error'
								? '[err]'
								: '[...]';
					const duration = r.completedAt
						? `${Math.round((new Date(r.completedAt).getTime() - new Date(r.startedAt).getTime()) / 1000)}s`
						: 'running';
					return `${statusIcon} ${r.command} — ${start} (${duration})${r.error ? ` — ${r.error}` : ''}`;
				})
				.join('\n');

			return React.createElement(ScheduleMessage, {
				key: `schedule-logs-${Date.now()}`,
				message: logLines,
			});
		}

		// Unknown subcommand
		return React.createElement(ScheduleMessage, {
			key: `schedule-error-${Date.now()}`,
			message:
				'Unknown subcommand. Available: create, add, list, remove, start, logs',
			isError: true,
		});
	},
};
