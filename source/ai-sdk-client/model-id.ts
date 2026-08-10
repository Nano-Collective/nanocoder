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
 * Older Atlas Cloud wizard versions stored unqualified GPT-5.6 model IDs.
 * Normalize those legacy aliases at request time so existing configurations
 * continue working after the wizard starts writing provider-qualified IDs.
 */
export function normalizeModelIdForRequest(
	baseURL: string | undefined,
	model: string,
): string {
	if (!isAtlasCloudBaseUrl(baseURL) || !ATLAS_GPT_MODEL_PATTERN.test(model)) {
		return model;
	}

	return `openai/${model.toLowerCase()}`;
}
