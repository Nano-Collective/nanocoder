/**
 * Best-effort secret redaction for text the harness posts publicly.
 *
 * The CI investigator and PR reviewer write their output from
 * attacker-controllable input (CI logs, PR diffs). A prompt injection, or an
 * honest quote of a leaked log line, could carry a credential into a PR
 * comment. This pass masks the common token shapes plus the literal values
 * of secret-looking variables in this process's environment. It is a safety
 * net, not a guarantee: anything it does not recognise passes through.
 */

const REDACTED = '[REDACTED]';

const SECRET_PATTERNS: readonly RegExp[] = [
	// PEM private key blocks (RSA, EC, OPENSSH, PGP, plain).
	/-----BEGIN [A-Z0-9 ]*PRIVATE KEY(?: BLOCK)?-----[\s\S]*?-----END [A-Z0-9 ]*PRIVATE KEY(?: BLOCK)?-----/g,
	// GitHub tokens: classic/OAuth/app/refresh, and fine-grained PATs.
	/\bgh[pousr]_[A-Za-z0-9]{20,}\b/g,
	/\bgithub_pat_[A-Za-z0-9_]{20,}\b/g,
	// OpenAI / Anthropic style keys (sk-..., sk-ant-..., sk-proj-...).
	/\bsk-[A-Za-z0-9_-]{16,}/g,
	// AWS access key ids.
	/\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g,
	// Slack bot/user/app tokens.
	/\bxox[abposr]-[A-Za-z0-9-]{10,}/g,
];

const SECRET_ENV_NAME = /TOKEN|KEY|SECRET|PASSWORD/i;
const MIN_ENV_SECRET_LENGTH = 8;

function escapeRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Values of env vars whose names look secret, longest first so a value that
 * contains another is masked whole.
 */
function secretEnvValues(env: NodeJS.ProcessEnv): string[] {
	const values = new Set<string>();
	for (const [name, value] of Object.entries(env)) {
		if (!value || value.length < MIN_ENV_SECRET_LENGTH) continue;
		if (!SECRET_ENV_NAME.test(name)) continue;
		values.add(value);
	}
	return [...values].sort((a, b) => b.length - a.length);
}

export function redactSecrets(
	text: string,
	env: NodeJS.ProcessEnv = process.env,
): string {
	let result = text;
	for (const value of secretEnvValues(env)) {
		result = result.replace(new RegExp(escapeRegExp(value), 'g'), REDACTED);
	}
	for (const pattern of SECRET_PATTERNS) {
		result = result.replace(pattern, REDACTED);
	}
	return result;
}
