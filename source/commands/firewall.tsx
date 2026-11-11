import {Box, Text} from 'ink';
import {
	getFirewallConfig,
	resetFirewallConfig,
	setFirewallConfig,
} from '@/firewall/mutation-firewall';
import {useTheme} from '@/hooks/useTheme';
import type {FirewallConfig, FirewallMode} from '@/types/firewall';
import type {Colors, Command} from '@/types/index';
import {errorMsg, successMsg} from '@/utils/message-factory';

const FIREWALL_SUBCOMMANDS =
	'status, enable, disable, mode, toggle, protect, unprotect, reset';

export const firewallCommand: Command = {
	name: 'firewall',
	description:
		'Guard file edits: block (strict) or warn about (lenient) edits that delete tests, change exported signatures, add `any` types or touch protected paths. Subcommands: status, enable, disable, mode, toggle, protect, unprotect, reset',
	handler: async (args: string[]) => {
		if (args.length === 0 || args[0] === 'status') {
			const config = getFirewallConfig();
			return <FirewallStatusView config={config} />;
		}

		const subCommand = args[0]?.toLowerCase();

		// `enable` / `disable` are shorthands for `mode strict` / `mode disabled`.
		if (subCommand === 'enable') {
			setFirewallConfig({mode: 'strict', enabled: true});
			return successMsg("Firewall enabled in 'strict' mode.", 'firewall');
		}

		if (subCommand === 'disable') {
			setFirewallConfig({mode: 'disabled', enabled: false});
			return successMsg('Firewall disabled.', 'firewall');
		}

		if (subCommand === 'mode') {
			const mode = args[1]?.toLowerCase() as FirewallMode;
			if (!mode || !['strict', 'lenient', 'disabled'].includes(mode)) {
				return errorMsg(
					'Usage: /firewall mode <strict|lenient|disabled>',
					'firewall',
				);
			}
			setFirewallConfig({mode, enabled: mode !== 'disabled'});
			return successMsg(`Firewall mode set to '${mode}'.`, 'firewall');
		}

		if (subCommand === 'toggle') {
			const target = args[1]?.toLowerCase();
			const config = getFirewallConfig();

			if (target === 'any') {
				const next = !config.blockAnyTypes;
				setFirewallConfig({blockAnyTypes: next});
				return successMsg(
					`Rule 'block_any_types' is now ${next ? 'enabled' : 'disabled'}.`,
					'firewall',
				);
			}
			if (target === 'tests' || target === 'test') {
				const next = !config.protectTestCases;
				setFirewallConfig({protectTestCases: next});
				return successMsg(
					`Rule 'protect_test_cases' is now ${next ? 'enabled' : 'disabled'}.`,
					'firewall',
				);
			}
			if (target === 'exports' || target === 'export') {
				const next = !config.preserveExportSignatures;
				setFirewallConfig({preserveExportSignatures: next});
				return successMsg(
					`Rule 'preserve_export_signatures' is now ${next ? 'enabled' : 'disabled'}.`,
					'firewall',
				);
			}

			return errorMsg(
				'Usage: /firewall toggle <any|tests|exports>',
				'firewall',
			);
		}

		if (subCommand === 'protect') {
			const pattern = args[1];
			if (!pattern) {
				return errorMsg('Usage: /firewall protect <glob-pattern>', 'firewall');
			}
			const config = getFirewallConfig();
			if (!config.protectedPatterns.includes(pattern)) {
				setFirewallConfig({
					protectedPatterns: [...config.protectedPatterns, pattern],
				});
			}
			return successMsg(
				`Added '${pattern}' to protected firewall patterns.`,
				'firewall',
			);
		}

		if (subCommand === 'unprotect') {
			const pattern = args[1];
			if (!pattern) {
				return errorMsg(
					'Usage: /firewall unprotect <glob-pattern>',
					'firewall',
				);
			}
			const config = getFirewallConfig();
			setFirewallConfig({
				protectedPatterns: config.protectedPatterns.filter(p => p !== pattern),
			});
			return successMsg(
				`Removed '${pattern}' from protected firewall patterns.`,
				'firewall',
			);
		}

		if (subCommand === 'reset') {
			resetFirewallConfig();
			return successMsg(
				'Firewall configuration reset to defaults.',
				'firewall',
			);
		}

		return errorMsg(
			`Unknown subcommand: '${subCommand}'. Available subcommands: ${FIREWALL_SUBCOMMANDS}`,
			'firewall',
		);
	},
};

/**
 * Theme colours for the status view, so it follows the active theme (and
 * stays readable on light ones) instead of hard-coding terminal colour names.
 */
export function getFirewallStatusColors(
	config: FirewallConfig,
	colors: Colors,
) {
	const onOff = (on: boolean) => (on ? colors.success : colors.error);
	return {
		status: onOff(config.enabled),
		mode:
			config.mode === 'strict'
				? colors.primary
				: config.mode === 'lenient'
					? colors.warning
					: colors.secondary,
		blockAnyTypes: onOff(config.blockAnyTypes),
		protectTestCases: onOff(config.protectTestCases),
		preserveExportSignatures: onOff(config.preserveExportSignatures),
		patternBullet: colors.warning,
	};
}

function FirewallStatusView({config}: {config: FirewallConfig}) {
	const {colors} = useTheme();
	const statusColors = getFirewallStatusColors(config, colors);

	return (
		<Box
			flexDirection="column"
			gap={1}
			padding={1}
			borderStyle="round"
			borderColor={colors.primary}
		>
			<Text color={colors.primary} bold>
				Mutation Firewall Configuration
			</Text>

			<Box flexDirection="column">
				<Text>
					Status:{' '}
					<Text color={statusColors.status} bold>
						{config.enabled ? 'ENABLED' : 'DISABLED'}
					</Text>
				</Text>
				<Text>
					Mode:{' '}
					<Text color={statusColors.mode} bold>
						{config.mode.toUpperCase()}
					</Text>
				</Text>
			</Box>

			<Box flexDirection="column">
				<Text color={colors.secondary} bold>
					Active Syntax & Safety Rules:
				</Text>
				<Text>
					• Block explicit 'any' types:{' '}
					<Text color={statusColors.blockAnyTypes}>
						{config.blockAnyTypes ? 'ON' : 'OFF'}
					</Text>
				</Text>
				<Text>
					• Protect existing test cases:{' '}
					<Text color={statusColors.protectTestCases}>
						{config.protectTestCases ? 'ON' : 'OFF'}
					</Text>
				</Text>
				<Text>
					• Preserve exported API signatures:{' '}
					<Text color={statusColors.preserveExportSignatures}>
						{config.preserveExportSignatures ? 'ON' : 'OFF'}
					</Text>
				</Text>
			</Box>

			<Box flexDirection="column">
				<Text color={colors.secondary} bold>
					Protected Path Patterns ({config.protectedPatterns.length}):
				</Text>
				{config.protectedPatterns.map((pattern, idx) => (
					<Text key={idx}>
						{' '}
						<Text color={statusColors.patternBullet}>•</Text> {pattern}
					</Text>
				))}
			</Box>
		</Box>
	);
}
