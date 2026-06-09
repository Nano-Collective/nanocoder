/**
 * Guidance returned to the model when a malformed fallback tool call (XML or
 * JSON) is detected — points it back at the native tool-calling interface.
 */
export const FORMAT_GUIDANCE_MESSAGE =
	'Please use the native tool calling format provided by the system. The tools are already available to you - call them directly using the function calling interface.';
