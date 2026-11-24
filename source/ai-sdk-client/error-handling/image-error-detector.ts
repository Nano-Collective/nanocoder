import {extractRootError} from './error-extractor.js';

const IMAGE_TERMS =
	/\b(image|images|image_url|vision|multimodal|multi-modal)\b/i;

const REJECTION_TERMS =
	/not support|unsupported|does not support|doesn'?t support|only supported|not a multimodal|not enabled|not allowed|missing data required|mmproj|cannot (?:process|accept|handle)/i;

function errorText(error: unknown): string {
	if (!(error instanceof Error)) {
		return typeof error === 'string' ? error : '';
	}
	// APICallError keeps the server's explanation in responseBody; the
	// message alone is often just the status text ("Internal Server Error").
	const body = (error as {responseBody?: unknown}).responseBody;
	return typeof body === 'string' ? `${error.message}\n${body}` : error.message;
}

/**
 * Detects a provider rejecting a request because it carries image input the
 * model cannot take, e.g. llama.cpp's "image input is not supported - hint:
 * ... mmproj", LM Studio's "Model does not support images", vLLM's "is not a
 * multimodal model" or OpenAI's "image_url is only supported by certain
 * models". Checks the thrown error, its root cause, and any errors the stream
 * reported via onError.
 */
export function isImageSupportError(
	error: unknown,
	streamingErrors: readonly Error[] = [],
): boolean {
	const candidates = [error, extractRootError(error), ...streamingErrors];
	return candidates.some(candidate => {
		const text = errorText(candidate);
		return IMAGE_TERMS.test(text) && REJECTION_TERMS.test(text);
	});
}
