// CLI Paste Detection Utilities
// Since CLI applications don't receive direct paste events, we use heuristics

interface PasteDetectionOptions {
	// Time threshold for rapid input (milliseconds)
	timeThreshold: number;
	// Character count threshold for single input change
	charThreshold: number;
	// Line count threshold for multi-line detection
	lineThreshold: number;
}

const DEFAULT_PASTE_OPTIONS: PasteDetectionOptions = {
	timeThreshold: 50, // Increased to 50ms to be more forgiving of fast typing
	charThreshold: 5, // Lower threshold - detect pastes of 5+ chars (size method needs 10+ chars)
	lineThreshold: 2, // Multiple lines added instantly
};

/**
 * Extract the text inserted between two revisions of the input.
 *
 * The input buffer supports cursor movement, so an insertion is not always an
 * append. Trimming the shared prefix and suffix recovers the inserted run
 * wherever the cursor happened to be. For an edit that also removes text (a
 * replacement) this returns the whole replacing run, which is the content the
 * caller cares about.
 */
function extractInsertedText(previousText: string, newText: string): string {
	const maxPrefix = Math.min(previousText.length, newText.length);
	let prefix = 0;
	while (prefix < maxPrefix && previousText[prefix] === newText[prefix]) {
		prefix++;
	}

	const maxSuffix = Math.min(
		previousText.length - prefix,
		newText.length - prefix,
	);
	let suffix = 0;
	while (
		suffix < maxSuffix &&
		previousText[previousText.length - 1 - suffix] ===
			newText[newText.length - 1 - suffix]
	) {
		suffix++;
	}

	return newText.slice(prefix, newText.length - suffix);
}

export class PasteDetector {
	private lastInputTime = 0;
	private lastInput = '';

	/**
	 * Detect if a text change is likely a paste operation
	 * @param newText The new text content
	 * @param options Detection thresholds
	 * @returns Object with detection result and details
	 */
	detectPaste(
		newText: string,
		options: PasteDetectionOptions = DEFAULT_PASTE_OPTIONS,
	): {
		isPaste: boolean;
		method: 'rate' | 'size' | 'lines' | 'none';
		addedText: string;
		details: {
			timeElapsed: number;
			charsAdded: number;
			linesAdded: number;
		};
	} {
		const currentTime = Date.now();
		const previousText = this.lastInput;
		const timeElapsed = currentTime - this.lastInputTime;
		const charsAdded = newText.length - previousText.length;

		// Calculate lines added in THIS change, not total lines in text
		const linesAdded =
			newText.split('\n').length - previousText.split('\n').length;

		// Update tracking
		this.lastInputTime = currentTime;
		this.lastInput = newText;

		const details = {
			timeElapsed,
			charsAdded,
			linesAdded,
		};

		// Deletions and unchanged input do not contain added text to inspect.
		if (charsAdded <= 0) {
			return {
				isPaste: false,
				method: 'none',
				addedText: '',
				details,
			};
		}

		const addedText = extractInsertedText(previousText, newText);

		// Method 1: Rate-based detection (fast input)
		if (
			timeElapsed < options.timeThreshold &&
			charsAdded > options.charThreshold
		) {
			return {
				isPaste: true,
				method: 'rate',
				addedText,
				details,
			};
		}

		// Method 2: Size-based detection (large single input)
		if (charsAdded > options.charThreshold * 2) {
			return {
				isPaste: true,
				method: 'size',
				addedText,
				details,
			};
		}

		// Method 3: Multi-line detection
		if (linesAdded >= options.lineThreshold) {
			return {
				isPaste: true,
				method: 'lines',
				addedText,
				details,
			};
		}

		return {
			isPaste: false,
			method: 'none',
			addedText,
			details,
		};
	}

	/**
	 * Reset the detector state (call when input is cleared or submitted)
	 */
	reset(): void {
		this.lastInputTime = 0;
		this.lastInput = '';
	}

	/**
	 * Update detector state without triggering detection
	 * Useful for manual input changes that shouldn't be considered pastes
	 */
	updateState(text: string): void {
		this.lastInputTime = Date.now();
		this.lastInput = text;
	}
}
