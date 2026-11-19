import {notifyError} from '@/utils/message-queue-core';

// Expand environment variable references in a string
function expandEnvVar(str: string): string {
	if (typeof str !== 'string') {
		return str;
	}

	const regex =
		/\$\$|\$\{([A-Z_][A-Z0-9_]*)(?::-(.*?))?\}|\$([A-Z_][A-Z0-9_]*)/g;

	return str.replace(
		regex,
		(
			match: string,
			bracedVarName: string | undefined,
			defaultValue: string | undefined,
			unbracedVarName: string | undefined,
		) => {
			if (match === '$$') {
				return '$';
			}

			const varName = bracedVarName || unbracedVarName;
			if (!varName) return '';

			const envValue = process.env[varName];

			if (envValue !== undefined) {
				return envValue;
			}

			if (defaultValue !== undefined) {
				return defaultValue.replace(/\$\$/g, '$');
			}

			notifyError(
				`Environment variable ${varName} not found in config, using empty string`,
			);

			return '';
		},
	);
}

// Recursively substitute environment variables in objects, arrays, and strings
export function substituteEnvVars<T>(value: T): T {
	if (value === null || value === undefined) {
		return value;
	}

	if (typeof value === 'string') {
		return expandEnvVar(value) as T;
	}

	if (Array.isArray(value)) {
		return value.map((item: unknown) => substituteEnvVars(item)) as T;
	}

	if (typeof value === 'object') {
		const result: Record<string, unknown> = {};
		for (const [key, val] of Object.entries(value)) {
			// Skip __proto__ to prevent prototype pollution when parsing user JSON
			if (key === '__proto__') continue;
			result[key] = substituteEnvVars(val);
		}

		return result as T;
	}

	return value;
}
