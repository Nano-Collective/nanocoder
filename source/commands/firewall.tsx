import {Box, Text} from 'ink';
import {
	getFirewallConfig,
	resetFirewallConfig,
	setFirewallConfig,
} from '@/firewall/mutation-firewall';
import {useTheme} from '@/hooks/useTheme';
import type {FirewallConfig, FirewallMode} from '@/types/firewall';
import type {Command} from '@/types/index';
import {errorMsg, successMsg} from '@/utils/message-factory';

export const firewallCommand: Command = {
	name: 'firewall',
	description:
		'Configure negative-space mutation firewall. Subcommands: status, mode <strict|lenient|disabled>, toggle <any|tests|exports>, protect <pattern>, unprotect <pattern>, reset',
	handler: async (args: string[]) => {
		if (args.length === 0 || args[0] === 'status') {
			const config = getFirewallConfig();
			return <FirewallStatusView config={config} />;
		}

		const subCommand = args[0]?.toLowerCase();

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
			`Unknown subcommand: '${subCommand}'. Available subcommands: status, mode, toggle, protect, unprotect, reset`,
			'firewall',
		);
	},
};

function FirewallStatusView({config}: {config: FirewallConfig}) {
	const {colors} = useTheme();

	const modeColor =
		config.mode === 'strict'
			? colors.primary
			: config.mode === 'lenient'
				? 'yellow'
				: 'gray';

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
					<Text color={config.enabled ? 'green' : 'red'} bold>
						{config.enabled ? 'ENABLED' : 'DISABLED'}
					</Text>
				</Text>
				<Text>
					Mode:{' '}
					<Text color={modeColor} bold>
						{config.mode.toUpperCase()}
					</Text>
				</Text>
			</Box>

			<Box flexDirection="column">
				<Text color={colors.secondary} bold>
					Active AST & Safety Rules:
				</Text>
				<Text>
					• Block explicit 'any' types:{' '}
					<Text color={config.blockAnyTypes ? 'green' : 'red'}>
						{config.blockAnyTypes ? 'ON' : 'OFF'}
					</Text>
				</Text>
				<Text>
					• Protect existing test cases:{' '}
					<Text color={config.protectTestCases ? 'green' : 'red'}>
						{config.protectTestCases ? 'ON' : 'OFF'}
					</Text>
				</Text>
				<Text>
					• Preserve exported API signatures:{' '}
					<Text color={config.preserveExportSignatures ? 'green' : 'red'}>
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
						<Text color="yellow">•</Text> {pattern}
					</Text>
				))}
			</Box>
		</Box>
	);
}
