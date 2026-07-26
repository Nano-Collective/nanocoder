import type {
	AgentSideConnection,
	PermissionOption,
	RequestPermissionResponse,
} from '@agentclientprotocol/sdk';
import {getLogger} from '@/utils/logging';

const logger = getLogger();

const OPTION_PREFIX = 'answer-';

/**
 * Sentinel resolved by the abort race - `aborted` is not a protocol outcome, so
 * it cannot be modelled as a `RequestPermissionResponse`.
 */
const ABORTED = Symbol('aborted');

/**
 * Present an `ask_user` question to the ACP client and return the chosen answer.
 *
 * There is no interactive UI over ACP, so the question is surfaced through the
 * client's permission flow - a stable, widely-supported request that renders
 * each option as a selectable button in editors like Zed. We reuse the
 * `ask_user` tool call's own id (already announced via a `tool_call` update) as
 * the permission target; inventing a fresh id is rejected by clients as
 * "Invalid params" because it references an unknown tool call.
 *
 * Note: ACP permission options are selection-only, so a free-form typed answer
 * is not available over ACP - the model receives whichever option is picked.
 */
export async function requestUserChoice(
	conn: AgentSideConnection,
	sessionId: string,
	toolCallId: string,
	question: string,
	options: string[],
	abortSignal?: AbortSignal,
): Promise<string> {
	const permissionOptions: PermissionOption[] = options.map(
		(option, index) => ({
			optionId: `${OPTION_PREFIX}${index}`,
			name: option,
			kind: 'allow_once',
		}),
	);

	try {
		const requestPromise = conn.requestPermission({
			sessionId,
			options: permissionOptions,
			toolCall: {toolCallId, title: question, status: 'pending'},
		});

		let response: RequestPermissionResponse | typeof ABORTED;
		if (abortSignal) {
			response = await Promise.race([
				requestPromise,
				new Promise<typeof ABORTED>(resolve => {
					if (abortSignal.aborted) {
						resolve(ABORTED);
					} else {
						abortSignal.addEventListener('abort', () => {
							resolve(ABORTED);
						});
					}
				}),
			]);
		} else {
			response = await requestPromise;
		}

		if (response === ABORTED) {
			return 'Error: AbortError: The operation was aborted';
		}

		if (response.outcome.outcome === 'selected') {
			const optionId = response.outcome.optionId;
			if (optionId.startsWith(OPTION_PREFIX)) {
				const index = Number(optionId.slice(OPTION_PREFIX.length));
				if (Number.isInteger(index) && index >= 0 && index < options.length) {
					return options[index];
				}
			}
		}

		return 'Error: The user dismissed the question without selecting an answer.';
	} catch (error) {
		logger.error(`ACP ask_user failed: ${String(error)}`);
		return `Error: Could not ask the user a question: ${String(error)}`;
	}
}
