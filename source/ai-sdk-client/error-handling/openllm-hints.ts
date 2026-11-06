import {commandExists} from '@/utils/command-exists';

export const OPENLLM_INSTALL_COMMAND =
	'curl -fsSL https://www.openllm.sh/install | bash';

/**
 * True for a local OpenLLM daemon: a loopback base URL on the default daemon
 * port, or on any port when the provider is named OpenLLM. Cloud base URLs
 * never match, so they keep the generic connection message.
 */
export function isOpenLLMProvider(
	providerName?: string,
	baseUrl?: string,
): boolean {
	if (!baseUrl) return false;
	try {
		const url = new URL(baseUrl);
		const isLoopback =
			url.hostname === '127.0.0.1' || url.hostname === 'localhost';
		return (
			isLoopback &&
			(url.port === '8787' || providerName?.trim().toLowerCase() === 'openllm')
		);
	} catch {
		return false;
	}
}

/**
 * The daemon refused the connection: it is either stopped or not installed.
 * Telling them apart needs a PATH lookup for the `openllm` CLI.
 */
export function openLLMUnreachableHint(
	isInstalled: (command: string) => boolean = commandExists,
): string {
	return isInstalled('openllm')
		? 'OpenLLM is not running. Run `openllm start`, then try again.'
		: `OpenLLM is not installed. Install it with \`${OPENLLM_INSTALL_COMMAND}\`, then run \`openllm login\`.`;
}
