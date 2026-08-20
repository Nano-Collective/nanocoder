import {autoSelectSimpleModel} from '@/ai-sdk-client/smart-router';
import {DELAY_COMMAND_COMPLETE_MS} from '@/constants';
import type {SmartRoutingState} from '@/types/config';
import type {MessageSubmissionOptions} from '@/types/index';
import {errorMsg, infoMsg, successMsg} from '@/utils/message-factory';

const VALID_THRESHOLDS = new Set(['low', 'medium', 'high']);

/**
 * Handles /smartroute command. Returns true if handled.
 *
 * Subcommands:
 *   /smartroute                - Show current status
 *   /smartroute on             - Enable smart routing
 *   /smartroute off            - Disable smart routing
 *   /smartroute simple <model> - Set the simple model (or "auto")
 *   /smartroute threshold <v>  - Set classifier sensitivity
 */
import {SMART_ROUTING_DEFAULTS} from '@/types/config';

export async function handleSmartRouteCommand(
	commandParts: string[],
	options: MessageSubmissionOptions & {
		smartRouting?: SmartRoutingState;
		setSmartRouting?: (state: SmartRoutingState) => void;
	},
): Promise<boolean> {
	const {onAddToChatQueue, onCommandComplete} = options;
	const smartRouting = options.smartRouting ?? SMART_ROUTING_DEFAULTS;
	const setSmartRouting = options.setSmartRouting ?? (() => {});

	if (commandParts[0] !== 'smartroute') {
		return false;
	}

	const subcommand = commandParts[1]?.toLowerCase();

	// /smartroute (no args) — show status
	if (!subcommand) {
		const status = smartRouting.enabled ? 'ON' : 'OFF';
		const model = smartRouting.simpleModel ?? 'auto';
		const msg = [
			`Smart routing: ${status}`,
			`  Simple model: ${model}`,
			`  Threshold: ${smartRouting.threshold}`,
		].join('\n');
		onAddToChatQueue(infoMsg(msg, 'smartroute-status'));
		setTimeout(() => onCommandComplete?.(), DELAY_COMMAND_COMPLETE_MS);
		return true;
	}

	// /smartroute on
	if (subcommand === 'on') {
		const updated: SmartRoutingState = {...smartRouting, enabled: true};

		// Auto-select a simple model if none was explicitly set
		if (!updated.simpleModel && options.client) {
			const models = await options.client.getAvailableModels();
			const picked = autoSelectSimpleModel(models);
			if (picked && picked !== options.model) {
				updated.simpleModel = picked;
			}
		}

		setSmartRouting(updated);
		const modelInfo = updated.simpleModel
			? ` (simple model: ${updated.simpleModel})`
			: '';
		onAddToChatQueue(
			successMsg(
				`Smart routing enabled${modelInfo}. Trivial turns will use the simple model.`,
				'smartroute-on',
			),
		);
		setTimeout(() => onCommandComplete?.(), DELAY_COMMAND_COMPLETE_MS);
		return true;
	}

	// /smartroute off
	if (subcommand === 'off') {
		setSmartRouting({...smartRouting, enabled: false});
		onAddToChatQueue(
			successMsg(
				'Smart routing disabled. All turns will use the primary model.',
				'smartroute-off',
			),
		);
		setTimeout(() => onCommandComplete?.(), DELAY_COMMAND_COMPLETE_MS);
		return true;
	}

	// /smartroute simple <model-id | auto>
	if (subcommand === 'simple') {
		const modelArg = commandParts[2];
		if (!modelArg) {
			onAddToChatQueue(
				errorMsg(
					'Usage: /smartroute simple <model-id | auto>',
					'smartroute-error',
				),
			);
			setTimeout(() => onCommandComplete?.(), DELAY_COMMAND_COMPLETE_MS);
			return true;
		}

		if (modelArg.toLowerCase() === 'auto') {
			setSmartRouting({...smartRouting, simpleModel: undefined});
			onAddToChatQueue(
				successMsg(
					'Simple model set to auto — will be selected automatically from available models.',
					'smartroute-simple-auto',
				),
			);
		} else {
			setSmartRouting({...smartRouting, simpleModel: modelArg});
			onAddToChatQueue(
				successMsg(`Simple model set to: ${modelArg}`, 'smartroute-simple-set'),
			);
		}
		setTimeout(() => onCommandComplete?.(), DELAY_COMMAND_COMPLETE_MS);
		return true;
	}

	// /smartroute threshold <low|medium|high>
	if (subcommand === 'threshold') {
		const value = commandParts[2]?.toLowerCase();
		if (!value || !VALID_THRESHOLDS.has(value)) {
			onAddToChatQueue(
				errorMsg(
					'Usage: /smartroute threshold <low|medium|high>',
					'smartroute-error',
				),
			);
			setTimeout(() => onCommandComplete?.(), DELAY_COMMAND_COMPLETE_MS);
			return true;
		}

		setSmartRouting({
			...smartRouting,
			threshold: value as SmartRoutingState['threshold'],
		});
		onAddToChatQueue(
			successMsg(
				`Smart routing threshold set to: ${value}`,
				'smartroute-threshold',
			),
		);
		setTimeout(() => onCommandComplete?.(), DELAY_COMMAND_COMPLETE_MS);
		return true;
	}

	// Unknown subcommand
	onAddToChatQueue(
		errorMsg(
			'Unknown subcommand. Usage: /smartroute [on|off|simple <model>|threshold <low|medium|high>]',
			'smartroute-error',
		),
	);
	setTimeout(() => onCommandComplete?.(), DELAY_COMMAND_COMPLETE_MS);
	return true;
}
