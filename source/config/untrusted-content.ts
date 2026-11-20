import {getAppConfig} from '@/config/index';

/**
 * Whether the approval escalation for untrusted external content is on.
 *
 * Framing (the `<external_content>` body, the prompt section and the chat
 * notice) is unconditional; only the escalation is switchable. It ships off by
 * default, the same way `firewall` and `sandbox` did: a behaviour that adds
 * confirmation prompts is opt-in first, and the default can be reconsidered once
 * it has run in the field.
 */
export function isUntrustedContentEscalationEnabled(): boolean {
	return getAppConfig().untrustedContent?.escalate === true;
}
