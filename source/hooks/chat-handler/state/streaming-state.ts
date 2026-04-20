/**
 * Creates a function to reset all streaming-related state.
 * Used to clean up after streaming responses complete or error.
 */
export const createResetStreamingState = (
	setIsCancelling: (cancelling: boolean) => void,
	setAbortController: (controller: AbortController | null) => void,
	setIsGenerating: (generating: boolean) => void,
	setStreamingContent: (content: string) => void,
	setStreamingReasoning: (content: string) => void,
	setTokenCount: (count: number) => void,
) => {
	return () => {
		setIsCancelling(false);
		setAbortController(null);
		setIsGenerating(false);
		setStreamingContent('');
		setStreamingReasoning('');
		setTokenCount(0);
	};
};
