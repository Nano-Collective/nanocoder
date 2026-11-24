import {getAppConfig} from '@/config/index';

/**
 * Whether the approval escalation for untrusted external content is on.
 *
 * Framing (the `<external_content>` body, the prompt section and the chat
 * notice) is unconditional; only the escalation is switchable. It ships on by
 * default: the users this protects are the ones who never edit configuration,
 * so opt-in would leave them unprotected. An explicit `false` is the opt-out.
 */
export function isUntrustedContentEscalationEnabled(): boolean {
	return getAppConfig().untrustedContent?.escalate !== false;
}
