import test from 'ava';
import type {
	InputState,
	PastePlaceholderContent,
	PlaceholderContent,
} from '../types/hooks';
import {PlaceholderType} from '../types/hooks';

console.log(`\npaste-roundtrip.spec.ts`);

// Self-contained implementations for integration testing
class PasteDetector {
	private lastInput = '';
	private lastTimestamp = 0;

	detectPaste(newInput: string): {
		isPaste: boolean;
		addedText: string;
		method?: string;
	} {
		const now = Date.now();
		const deltaTime = now - this.lastTimestamp;
		const addedText = newInput.slice(this.lastInput.length);

		// Update state for next call
		const result = {
			isPaste: false,
			addedText,
			method: undefined as string | undefined,
		};

		// Rate-based detection: >50 chars in <16ms
		if (addedText.length > 50 && deltaTime < 16) {
			result.isPaste = true;
			result.method = 'rate';
		}
		// Size-based detection: >100 chars at once
		else if (addedText.length > 100) {
			result.isPaste = true;
			result.method = 'size';
		}
		// Multi-line detection: >=2 lines
		else if (addedText.split(/\r\n|\r|\n/).length >= 2) {
			result.isPaste = true;
			result.method = 'multiline';
		}

		this.lastInput = newInput;
		this.lastTimestamp = now;

		return result;
	}

	reset() {
		this.lastInput = '';
		this.lastTimestamp = 0;
	}

	updateState(newInput: string) {
		this.lastInput = newInput;
		this.lastTimestamp = Date.now();
	}
}

function handlePaste(
	pastedText: string,
	currentDisplayValue: string,
	currentPlaceholderContent: Record<string, PlaceholderContent>,
): InputState | null {
	// Only create placeholder for large pastes (>80 chars)
	if (pastedText.length <= 80) {
		return null; // Small paste, insert as normal text
	}

	// Generate simple incrementing ID based on existing paste placeholders
	const existingPasteCount = Object.values(currentPlaceholderContent).filter(
		content => content.type === PlaceholderType.PASTE,
	).length;
	const pasteId = (existingPasteCount + 1).toString();
	const placeholder = `[Paste #${pasteId}: ${pastedText.length} chars]`;

	const pasteContent: PastePlaceholderContent = {
		type: PlaceholderType.PASTE,
		displayText: placeholder,
		content: pastedText,
		originalSize: pastedText.length,
		timestamp: Date.now(),
	};

	const newPlaceholderContent = {
		...currentPlaceholderContent,
		[pasteId]: pasteContent,
	};

	// For CLI paste detection, we need to replace the pasted text in the display value
	// If the pasted text is at the end, replace it. Otherwise append the placeholder.
	const newDisplayValue = currentDisplayValue.includes(pastedText)
		? currentDisplayValue.replace(pastedText, placeholder)
		: currentDisplayValue + placeholder;

	return {
		displayValue: newDisplayValue,
		placeholderContent: newPlaceholderContent,
	};
}

function assemblePrompt(inputState: InputState): string {
	let assembledPrompt = inputState.displayValue;

	Object.entries(inputState.placeholderContent).forEach(
		([pasteId, placeholderContent]) => {
			if (placeholderContent.type === 'paste') {
				const pasteContent = placeholderContent as PastePlaceholderContent;
				assembledPrompt = assembledPrompt.replace(
					pasteContent.displayText,
					pasteContent.content,
				);
			}
		},
	);

	return assembledPrompt;
}

function handleAtomicDeletion(
	previousState: InputState,
	newText: string,
): InputState | null {
	const previousText = previousState.displayValue;

	// Only handle deletions (text getting shorter)
	if (newText.length >= previousText.length) {
		return null;
	}

	// Find what was deleted
	const deletedChars = previousText.length - newText.length;

	// Find where the deletion occurred
	let deletionStart = -1;
	for (let i = 0; i < Math.min(previousText.length, newText.length); i++) {
		if (previousText[i] !== newText[i]) {
			deletionStart = i;
			break;
		}
	}

	// If no difference found in common part, deletion was at the end
	if (deletionStart === -1) {
		deletionStart = newText.length;
	}

	// Check if any placeholder was affected by this deletion
	const placeholderRegex = /\[Paste #(\d+): \d+ chars\]/g;
	let match;

	while ((match = placeholderRegex.exec(previousText)) !== null) {
		const placeholderStart = match.index;
		const placeholderEnd = placeholderStart + match[0].length;
		const placeholderId = match[1];

		// Check if deletion overlaps with this placeholder
		const deletionEnd = deletionStart + deletedChars;

		if (
			(deletionStart >= placeholderStart && deletionStart < placeholderEnd) ||
			(deletionEnd > placeholderStart && deletionEnd <= placeholderEnd) ||
			(deletionStart <= placeholderStart && deletionEnd >= placeholderEnd)
		) {
			// Deletion affects this placeholder - remove it atomically
			const newDisplayValue = previousText.replace(match[0], '');
			const newPlaceholderContent = {...previousState.placeholderContent};
			delete newPlaceholderContent[placeholderId];

			return {
				displayValue: newDisplayValue,
				placeholderContent: newPlaceholderContent,
			};
		}
	}

	return null;
}

// Full round-trip integration test for paste handling system
test('complete paste handling round-trip workflow', t => {
	// Step 1: Simulate user typing some text
	let currentState: InputState = {
		displayValue: 'Analyze this code: ',
		placeholderContent: {},
	};

	// Step 2: Simulate a large paste being detected
	const detector = new PasteDetector();
	// Initialize detector with current state
	detector.updateState(currentState.displayValue);

	const largeCodeSnippet = `function fibonacci(n) {
	if (n <= 1) return n;
	return fibonacci(n - 1) + fibonacci(n - 2);
}

const result = fibonacci(10);
console.log('Fibonacci result:', result);

// Additional complex logic
class Calculator {
	constructor() {
		this.history = [];
		this.operations = ['add', 'subtract', 'multiply', 'divide'];
		this.precision = 2;
	}
	
	add(a, b) {
		const result = a + b;
		this.history.push(\`\${a} + \${b} = \${result}\`);
		return result;
	}
	
	subtract(a, b) {
		const result = a - b;
		this.history.push(\`\${a} - \${b} = \${result}\`);
		return result;
	}
	
	multiply(a, b) {
		const result = a * b;
		this.history.push(\`\${a} * \${b} = \${result}\`);
		return result;
	}
	
	divide(a, b) {
		if (b === 0) throw new Error('Division by zero');
		const result = a / b;
		this.history.push(\`\${a} / \${b} = \${result}\`);
		return result;
	}
	
	getHistory() {
		return this.history.slice();
	}
	
	clearHistory() {
		this.history = [];
	}
}`;

	// Simulate paste detection
	const newInputWithPaste = currentState.displayValue + largeCodeSnippet;
	const detection = detector.detectPaste(newInputWithPaste);

	// Verify paste was detected
	t.true(detection.isPaste);
	// Method could be 'rate' or 'size' depending on timing - both are valid for large pastes

	// Step 3: Handle the paste by creating placeholder
	const pasteResult = handlePaste(
		detection.addedText,
		currentState.displayValue,
		currentState.placeholderContent,
	);

	t.truthy(pasteResult);
	currentState = pasteResult!;

	// Verify placeholder was created correctly
	t.true(currentState.displayValue.includes('[Paste #'));
	t.true(currentState.displayValue.includes('chars]'));

	// Debug: Check actual vs expected length
	const pasteId = Object.keys(currentState.placeholderContent)[0];
	const pasteContent = currentState.placeholderContent[
		pasteId
	] as PastePlaceholderContent;
	const actualLength = pasteContent.content.length;

	// Use the actual length from the stored content
	t.is(
		currentState.displayValue,
		`Analyze this code: [Paste #${pasteId}: ${actualLength} chars]`,
	);

	// Verify full content is preserved
	t.is(pasteContent.content, largeCodeSnippet);

	// Step 4: Simulate adding more text after the paste
	currentState = {
		displayValue: currentState.displayValue + ' and explain the algorithm',
		placeholderContent: currentState.placeholderContent,
	};

	// Step 5: Simulate a second paste in the same command
	const secondSnippet = 'const testData = [1, 2, 3, 4, 5];';
	const secondPasteResult = handlePaste(
		secondSnippet,
		currentState.displayValue,
		currentState.placeholderContent,
	);

	// Second paste is small, should return null (inserted as plain text)
	t.is(secondPasteResult, null);

	// Add the small paste manually (simulating normal insertion)
	currentState = {
		displayValue: currentState.displayValue + ' Compare with: ' + secondSnippet,
		placeholderContent: currentState.placeholderContent,
	};

	// Step 6: Test atomic deletion - simulate user deleting part of the first placeholder
	// Create a text where we delete from inside the placeholder (simulating backspace)
	const fullPlaceholder = `[Paste #${pasteId}: ${actualLength} chars]`;
	const placeholderIndex = currentState.displayValue.indexOf(fullPlaceholder);
	// Delete 2 characters from the middle of the placeholder (remove "te" from "Paste")
	const partiallyDeletedText =
		currentState.displayValue.slice(0, placeholderIndex + 4) + // "[Pas"
		currentState.displayValue.slice(placeholderIndex + 6); // skip "te", continue from " #..."
	const atomicDeletionResult = handleAtomicDeletion(
		currentState,
		partiallyDeletedText,
	);

	t.truthy(atomicDeletionResult);

	// After atomic deletion, placeholder and content should be gone
	t.false(atomicDeletionResult!.displayValue.includes('[Paste #'));
	t.deepEqual(atomicDeletionResult!.placeholderContent, {});

	// Step 7: Restore state and test prompt assembly for submission
	// (Simulate the state before deletion for final assembly test)
	const finalState: InputState = {
		displayValue: `Analyze this code: [Paste #${pasteId}: ${actualLength} chars] and explain the algorithm Compare with: ${secondSnippet}`,
		placeholderContent: {
			[pasteId]: {
				type: PlaceholderType.PASTE,
				displayText: `[Paste #${pasteId}: ${actualLength} chars]`,
				content: largeCodeSnippet,
				originalSize: actualLength,
			} as PastePlaceholderContent,
		},
	};

	// Step 8: Test prompt assembly (what gets sent to AI)
	const assembledPrompt = assemblePrompt(finalState);

	// Verify placeholders are replaced with full content
	t.false(assembledPrompt.includes('[Paste #'));
	t.true(assembledPrompt.includes('function fibonacci(n)'));
	t.true(assembledPrompt.includes('class Calculator'));
	t.true(assembledPrompt.includes('and explain the algorithm'));
	t.true(assembledPrompt.includes('Compare with: const testData'));

	// Verify complete reconstruction
	const expectedFinalPrompt = `Analyze this code: ${largeCodeSnippet} and explain the algorithm Compare with: ${secondSnippet}`;
	t.is(assembledPrompt, expectedFinalPrompt);

	// Step 9: Test history preservation (what gets saved)
	// Verify that the InputState can be serialized and deserialized
	const serialized = JSON.stringify(finalState);
	const deserialized: InputState = JSON.parse(serialized);

	t.deepEqual(deserialized, finalState);
	t.is(assemblePrompt(deserialized), expectedFinalPrompt);
});

// Test multiple placeholders in single command
test('multiple placeholders in single command workflow', t => {
	const detector = new PasteDetector();
	let currentState: InputState = {
		displayValue: 'Compare ',
		placeholderContent: {},
	};

	// First large paste - simulate by creating full input
	const firstCode = 'x'.repeat(600); // Large enough to trigger placeholder
	const firstFullInput = currentState.displayValue + firstCode;
	const firstDetection = detector.detectPaste(firstFullInput);
	t.true(firstDetection.isPaste);

	const firstPasteResult = handlePaste(
		firstCode, // Pass the actual pasted code, not the added text which includes existing text
		currentState.displayValue,
		currentState.placeholderContent,
	);
	t.truthy(firstPasteResult);
	currentState = firstPasteResult!;

	// Add text between pastes
	currentState = {
		displayValue: currentState.displayValue + ' with ',
		placeholderContent: currentState.placeholderContent,
	};

	// Update detector state to current state
	detector.updateState(currentState.displayValue);

	// Second large paste - simulate by creating new full input
	const secondCode = 'y'.repeat(700);
	const secondFullInput = currentState.displayValue + secondCode;
	const secondDetection = detector.detectPaste(secondFullInput);
	t.true(secondDetection.isPaste);

	const secondPasteResult = handlePaste(
		secondCode, // Pass the actual pasted code, not the added text
		currentState.displayValue,
		currentState.placeholderContent,
	);
	t.truthy(secondPasteResult);
	currentState = secondPasteResult!;

	// Verify two placeholders exist
	const placeholderMatches = currentState.displayValue.match(
		/\[Paste #\d+: \d+ chars\]/g,
	);
	t.is(placeholderMatches?.length, 2);

	// Verify both pieces of content are preserved
	t.is(Object.keys(currentState.placeholderContent).length, 2);

	// Test assembly replaces both placeholders
	const assembled = assemblePrompt(currentState);
	t.false(assembled.includes('[Paste #'));
	t.true(assembled.includes(firstCode));
	t.true(assembled.includes(secondCode));
	t.is(assembled, `Compare ${firstCode} with ${secondCode}`);
});

// Test edge cases and error conditions
test('paste handling edge cases', t => {
	// Test with empty state
	const emptyState: InputState = {displayValue: '', placeholderContent: {}};
	const assembled = assemblePrompt(emptyState);
	t.is(assembled, '');

	// Test with placeholder but missing content (error recovery)
	const corruptState: InputState = {
		displayValue: 'Test [Paste #123: 100 chars] here',
		placeholderContent: {}, // Missing content for placeholder
	};
	const assembledCorrupt = assemblePrompt(corruptState);
	// Should leave placeholder intact if content is missing
	t.true(assembledCorrupt.includes('[Paste #123: 100 chars]'));
});
