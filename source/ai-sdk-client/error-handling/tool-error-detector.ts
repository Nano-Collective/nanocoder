/**
 * Detects if an error indicates the model doesn't support tool calling
 *
 * This is used to automatically retry requests without tools when a model
 * rejects tool definitions (common with some local models like deepseek-r1 via Ollama)
 */
export function isToolSupportError(error: unknown): boolean {
	if (!(error instanceof Error)) {
		return false;
	}

	const message = error.message.toLowerCase();

	// Pattern 1: 400 Bad Request with tool-related messages
	if (message.includes('400') && message.includes('bad request')) {
		const toolPatterns = [
			/tool/i,
			/function/i,
			/invalid.*parameter/i,
			/unexpected.*field/i,
			/unrecognized/i,
		];

		for (const pattern of toolPatterns) {
			if (pattern.test(message)) {
				return true;
			}
		}
	}

	// Pattern 2: Direct mentions of tool/function not supported
	const directPatterns = [
		/tool.*not.*support/i,
		/function.*not.*support/i,
		/tool.*unsupported/i,
		/function.*unsupported/i,
		/invalid.*tool/i,
		/invalid.*function/i,
		/tool.*parameter.*invalid/i,
		/function.*parameter.*invalid/i,
	];

	for (const pattern of directPatterns) {
		if (pattern.test(message)) {
			return true;
		}
	}

	// Pattern 3: Ollama-specific error messages
	// Ollama may return errors like: "invalid character 't' looking for beginning of value"
	// when it encounters the 'tools' field in JSON
	if (
		message.includes('invalid character') &&
		message.includes('after top-level value')
	) {
		return true;
	}

	return false;
}
