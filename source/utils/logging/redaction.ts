/**
 * PII and sensitive data redaction for security
 */

import type {PiiRedactionRules} from './types.js';

/**
 * Default redaction paths for common sensitive data
 */
export const DEFAULT_REDACT_PATHS = [
	'apiKey',
	'token',
	'password',
	'secret',
	'key',
	'auth',
	'authorization',
	'credential',
	'credentials',
	'privateKey',
	'private_key',
	'publicKey',
	'public_key',
	'accessToken',
	'access_token',
	'refreshToken',
	'refresh_token',
];

/**
 * Patterns for detecting sensitive data
 */
export const SENSITIVE_PATTERNS: RegExp[] = [
	// API keys (common patterns)
	/[a-zA-Z0-9]{32,}/gi,
	// Bearer tokens
	/Bearer\s+[a-zA-Z0-9\-._~+/]+=*/gi,
	// Email addresses
	/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/gi,
	// IPv4 addresses
	/\b(?:[0-9]{1,3}\.){3}[0-9]{1,3}\b/g,
	// UUIDs
	/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/gi,
];

/**
 * Redact a value if it matches sensitive patterns
 */
export function redactValue(value: unknown): unknown {
	if (typeof value === 'string') {
		return redactString(value);
	}

	if (typeof value === 'object' && value !== null) {
		if (Array.isArray(value)) {
			return value.map(redactValue);
		}

		return redactObject(value as Record<string, unknown>);
	}

	return value;
}

/**
 * Redact sensitive data in strings
 */
function redactString(str: string): string {
	let redacted = str;

	// Apply all sensitive patterns
	SENSITIVE_PATTERNS.forEach(pattern => {
		redacted = redacted.replace(pattern, '[REDACTED]');
	});

	// Additional redactions for specific patterns
	redacted = redacted
		// JSON web tokens
		.replace(
			/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g,
			'[JWT-REDACTED]',
		)
		// Basic auth strings
		.replace(/Basic\s+[A-Za-z0-9+/=]+/gi, '[BASIC-AUTH-REDACTED]')
		// Hex strings that might be keys
		.replace(/\b[0-9a-fA-F]{16,}\b/g, '[HEX-REDACTED]');

	return redacted;
}

/**
 * Redact sensitive data in objects
 */
function redactObject(obj: Record<string, unknown>): Record<string, unknown> {
	const redacted: Record<string, unknown> = {};

	for (const [key, value] of Object.entries(obj)) {
		if (shouldRedactKey(key)) {
			redacted[key] = '[REDACTED]';
		} else if (
			typeof value === 'string' &&
			shouldRedactKey(key.toLowerCase())
		) {
			redacted[key] = redactValue(value);
		} else {
			redacted[key] = redactValue(value);
		}
	}

	return redacted;
}

/**
 * Check if a key should be redacted
 */
function shouldRedactKey(key: string): boolean {
	const lowerKey = key.toLowerCase();

	// Check exact matches
	if (DEFAULT_REDACT_PATHS.some(path => lowerKey.includes(path))) {
		return true;
	}

	// Check for email fields
	if (lowerKey.includes('email')) {
		return true;
	}

	// Check for user ID fields
	if (lowerKey.includes('userid') || lowerKey.includes('user_id')) {
		return true;
	}

	// Check for credit card fields
	if (lowerKey.includes('card') || lowerKey.includes('credit')) {
		return true;
	}

	return false;
}

/**
 * Redact email addresses with partial masking
 */
export function redactEmail(email: string): string {
	const emailRegex = /^[^@]+@[^@]+\.[^@]+$/;
	if (!emailRegex.test(email)) {
		return '[INVALID-EMAIL]';
	}

	const parts = email.split('@');
	if (parts.length !== 2) {
		throw new Error('Invalid email');
	}
	const [localPart, domain] = parts;
	
	if (localPart.length <= 3) {
		return `${localPart[0]}***@${domain}`;
	}

	return `${localPart.substring(0, 3)}***@${domain}`;
}

/**
 * Redact user IDs with partial masking
 */
export function redactUserId(userId: string | number): string {
	const str = String(userId);
	if (str.length <= 4) {
		return 'USER_ID_REDACTED';
	}

	return `${str.substring(0, 2)}***${str.substring(str.length - 2)}`;
}

/**
 * Create redaction rules based on configuration
 */
export function createRedactionRules(
	customPaths: string[] = [],
	emailRedaction: boolean = true,
	userIdRedaction: boolean = true,
): PiiRedactionRules {
	return {
		patterns: [...SENSITIVE_PATTERNS],
		customPaths: [...DEFAULT_REDACT_PATHS, ...customPaths],
		emailRedaction,
		userIdRedaction,
	};
}

/**
 * Apply redaction to a log entry
 */
export function redactLogEntry(
	logEntry: Record<string, unknown>,
	rules: PiiRedactionRules,
): Record<string, unknown> {
	const redacted: Record<string, unknown> = {};

	for (const [key, value] of Object.entries(logEntry)) {
		// Skip system fields
		if (['level', 'time', 'pid', 'hostname', 'msg'].includes(key)) {
			redacted[key] = value;
			continue;
		}

		// Apply email redaction if enabled
		if (
			rules.emailRedaction &&
			key.toLowerCase().includes('email') &&
			typeof value === 'string'
		) {
			redacted[key] = redactEmail(value);
			continue;
		}

		// Apply user ID redaction if enabled
		if (
			rules.userIdRedaction &&
			(key.toLowerCase().includes('userid') ||
				key.toLowerCase().includes('user_id'))
		) {
			redacted[key] = redactUserId(String(value));
			continue;
		}

		// Check custom paths
		if (
			rules.customPaths.some(path =>
				key.toLowerCase().includes(path.toLowerCase()),
			)
		) {
			redacted[key] = '[REDACTED]';
			continue;
		}

		// Apply general redaction
		redacted[key] = redactValue(value);
	}

	return redacted;
}

/**
 * Validate redaction rules
 */
export function validateRedactionRules(rules: PiiRedactionRules): boolean {
	if (!Array.isArray(rules.customPaths)) {
		return false;
	}

	if (!Array.isArray(rules.patterns)) {
		return false;
	}

	if (typeof rules.emailRedaction !== 'boolean') {
		return false;
	}

	if (typeof rules.userIdRedaction !== 'boolean') {
		return false;
	}

	return true;
}
