// CLI Paste Detection Utilities
// Since CLI applications don't receive direct paste events, we use heuristics

export interface PasteDetectionOptions {
	// Time threshold for rapid input (milliseconds)
	timeThreshold: number;
	// Character count threshold for single input change
	charThreshold: number;
	// Line count threshold for multi-line detection
	lineThreshold: number;
}

export const DEFAULT_PASTE_OPTIONS: PasteDetectionOptions = {
	timeThreshold: 16, // ~1 frame at 60fps
	charThreshold: 50, // Characters added in single change
	lineThreshold: 2, // Multiple lines added instantly
};

export class PasteDetector {
	private lastInputTime = 0;
	private lastInputLength = 0;

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
		const timeElapsed = currentTime - this.lastInputTime;
		const charsAdded = newText.length - this.lastInputLength;
		const linesAdded = newText.split('\n').length - 1;

		// Get the added text (assuming it's at the end)
		const addedText = newText.slice(this.lastInputLength);

		// Update tracking
		this.lastInputTime = currentTime;
		this.lastInputLength = newText.length;

		const details = {
			timeElapsed,
			charsAdded,
			linesAdded,
		};

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
		this.lastInputLength = 0;
	}

	/**
	 * Update detector state without triggering detection
	 * Useful for manual input changes that shouldn't be considered pastes
	 */
	updateState(text: string): void {
		this.lastInputTime = Date.now();
		this.lastInputLength = text.length;
	}
}
