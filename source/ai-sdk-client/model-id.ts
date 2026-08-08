const ATLAS_CLOUD_HOST = 'api.atlascloud.ai';
const ATLAS_GPT_MODEL_PATTERN = /^gpt-5\.6-(sol|terra|luna)$/i;

function isAtlasCloudBaseUrl(baseURL: string | undefined): boolean {
	if (!baseURL) return false;

	try {
		return new URL(baseURL).hostname.toLowerCase() === ATLAS_CLOUD_HOST;
	} catch {
		return false;
	}
}

/**
 * Atlas Cloud uses provider-qualified IDs for its GPT-5.6 models. Keep the
 * shorthand convenient in user configuration, but send the ID Atlas expects
 * on the wire. Other providers and model families pass through unchanged.
 */
export function normalizeModelIdForRequest(
	baseURL: string | undefined,
	model: string,
): string {
	if (
		!isAtlasCloudBaseUrl(baseURL) ||
		model.includes('/') ||
		!ATLAS_GPT_MODEL_PATTERN.test(model)
	) {
		return model;
	}

	return `openai/${model.toLowerCase()}`;
}
