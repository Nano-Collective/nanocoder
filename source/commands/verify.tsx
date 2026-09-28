import {Box, Text} from 'ink';
import React from 'react';
import {TitledBoxWithPreferences} from '@/components/ui/titled-box';
import {getAppConfig} from '@/config/index';
import {useTerminalWidth} from '@/hooks/useTerminalWidth';
import {useTheme} from '@/hooks/useTheme';
import {getContainedSessionCwd} from '@/services/session-cwd';
import {
	runVerificationCommand,
	type VerificationRunResult,
} from '@/services/verification/runner';
import {generateKey} from '@/session/key-generator';
import type {Command} from '@/types/commands';

// Ink will happily try to render every byte it is handed, and a failing test
// suite is routinely thousands of lines. Past this the box is unreadable
// anyway, so the cap is about the terminal, not about the budget the model
// gets (which is `maxOutputBytes`, applied inside the runner).
const MAX_RENDERED_LINES = 40;

const EXAMPLE = `{
  "nanocoder": {
    "verification": {
      "command": ["npm", "run", "test:ci"]
    }
  }
}`;

interface VerifyProps {
	/** null when no command is configured, which is not an error. */
	commandDisplay: string | null;
	result: VerificationRunResult | null;
	/** Why nothing ran, when `result` is null. */
	notConfigured?: boolean;
	/** True when automatic post-edit verification is suppressed. */
	automaticDisabled: boolean;
	cwd: string;
}

type StatusColor = 'success' | 'error' | 'warning';

function statusLine(result: VerificationRunResult): {
	icon: string;
	label: string;
	color: StatusColor;
} {
	const seconds = (result.durationMs / 1000).toFixed(1);
	switch (result.status) {
		case 'passed':
			return {icon: '✓', label: `passed in ${seconds}s`, color: 'success'};
		case 'failed': {
			const code = result.exitCode === null ? '' : ` (exit ${result.exitCode})`;
			return {icon: '✗', label: `failed in ${seconds}s${code}`, color: 'error'};
		}
		case 'timeout':
			return {
				icon: '⏱',
				label: `timed out after ${seconds}s`,
				color: 'warning',
			};
		case 'aborted':
			return {icon: '■', label: 'cancelled', color: 'warning'};
		case 'unavailable':
			return {icon: '✗', label: 'command not found', color: 'error'};
	}
}

export function Verify({
	commandDisplay,
	result,
	notConfigured,
	automaticDisabled,
	cwd,
}: VerifyProps) {
	const boxWidth = useTerminalWidth();
	const {colors} = useTheme();

	return (
		<TitledBoxWithPreferences
			title="/verify"
			width={boxWidth}
			borderColor={colors.primary}
			paddingX={2}
			paddingY={1}
			flexDirection="column"
			marginBottom={1}
		>
			<Box marginBottom={1} flexDirection="column">
				<Text color={colors.secondary}>
					{notConfigured
						? 'No verification command configured.'
						: `$ ${commandDisplay ?? ''}`}
				</Text>
				{!notConfigured && <Text color={colors.secondary}>in {cwd}</Text>}
			</Box>

			{notConfigured ? (
				<Box flexDirection="column">
					<Text color={colors.text}>
						Add a check to your{' '}
						<Text color={colors.primary}>agents.config.json</Text>:
					</Text>
					<Text color={colors.secondary}>{EXAMPLE}</Text>
				</Box>
			) : (
				<>
					{automaticDisabled && (
						<Box marginBottom={1}>
							<Text color={colors.secondary}>
								Automatic post-edit verification is disabled
								(verification.enabled = false); this was a manual run.
							</Text>
						</Box>
					)}

					{result && <VerifyResult result={result} />}

					{result?.status === 'passed' && (
						<Box marginTop={1}>
							<Text color={colors.secondary}>Nothing to fix.</Text>
						</Box>
					)}
				</>
			)}
		</TitledBoxWithPreferences>
	);
}

function VerifyResult({result}: {result: VerificationRunResult}) {
	const {colors} = useTheme();
	const status = statusLine(result);

	const lines = result.output.split('\n');
	const elided = lines.length > MAX_RENDERED_LINES;
	const shown = elided ? lines.slice(-MAX_RENDERED_LINES) : lines;

	return (
		<Box flexDirection="column">
			<Box marginBottom={1}>
				<Text color={colors[status.color]} bold>
					{status.icon} {status.label}
				</Text>
			</Box>

			{result.spawnError && (
				<Box marginBottom={1}>
					<Text color={colors.error}>{result.spawnError}</Text>
				</Box>
			)}

			{result.status === 'timeout' && (
				<Box marginBottom={1}>
					<Text color={colors.secondary}>
						The check was killed. Raise verification.timeoutMs if the suite
						legitimately takes longer.
					</Text>
				</Box>
			)}

			{result.status === 'unavailable' && (
				<Box marginBottom={1}>
					<Text color={colors.secondary}>
						Make sure the program is on PATH. The array form avoids shell
						interpretation and is the safer spelling.
					</Text>
				</Box>
			)}

			{shown.length > 0 && (
				<Box flexDirection="column">
					{elided && (
						<Text color={colors.secondary}>
							… {lines.length - MAX_RENDERED_LINES} earlier lines omitted
						</Text>
					)}
					{shown.map((line, index) => (
						// Output lines have no stable identity, and the same text can
						// repeat; index is the only honest key here.
						<Text key={`${index}-${line}`} color={colors.secondary}>
							{line}
						</Text>
					))}
				</Box>
			)}

			{result.truncated && (
				<Box marginTop={1}>
					<Text color={colors.secondary}>
						Output was truncated at the configured byte cap.
					</Text>
				</Box>
			)}
		</Box>
	);
}

export const verifyCommand: Command = {
	name: 'verify',
	description: 'Run the configured verification check and report the result',
	progressLabel: 'Running verification',
	handler: async () => {
		const verification = getAppConfig().verification;

		// Nothing configured is the overwhelmingly common case, and it is not a
		// failure. Say what to add rather than throwing or rendering an empty box.
		if (!verification?.command) {
			return React.createElement(Verify, {
				key: generateKey('verify'),
				commandDisplay: null,
				result: null,
				notConfigured: true,
				automaticDisabled: false,
				cwd: getContainedSessionCwd(),
			});
		}

		const cwd = getContainedSessionCwd();
		const [command, ...args] = verification.command;

		const result = await runVerificationCommand({
			command: {command, args, display: verification.command.join(' ')},
			cwd,
			timeoutMs: verification.timeoutMs,
			maxOutputBytes: verification.maxOutputBytes,
		});

		return React.createElement(Verify, {
			key: generateKey('verify'),
			commandDisplay: verification.command.join(' '),
			result,
			// `enabled: false` suppresses the automatic post-edit loop, not the
			// command. Someone typing /verify is asking for it by name.
			automaticDisabled: !verification.enabled,
			cwd,
		});
	},
};
