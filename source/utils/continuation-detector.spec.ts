import test from 'ava';
import {
	detectContinuationIntent,
	shouldAutoContinue,
	DEFAULT_CONTINUATION_PATTERNS,
	type AutoContinuationMode,
} from './continuation-detector.js';

// Test cases for continuation detection
test('detectContinuationIntent: detects "Let me check" as continuation', t => {
	const result = detectContinuationIntent(
		'Let me check the file contents to understand the structure.',
		false,
	);
	t.true(result.shouldContinue);
	t.true(result.confidence >= 0.4);
	t.true(result.detectedPatterns.some(p => p.includes('starting')));
});

test('detectContinuationIntent: detects "I will examine" as continuation', t => {
	const result = detectContinuationIntent(
		'I will examine the codebase to find the relevant files.',
		false,
	);
	t.true(result.shouldContinue);
	t.true(result.confidence >= 0.4);
});

test('detectContinuationIntent: detects "Now I\'ll search" as continuation', t => {
	const result = detectContinuationIntent(
		"Now I'll search for the configuration files.",
		false,
	);
	t.true(result.shouldContinue);
	t.true(result.confidence >= 0.4);
});

test('detectContinuationIntent: detects action verbs as continuation signals', t => {
	const result = detectContinuationIntent(
		'I need to search for and read the configuration file.',
		false,
	);
	t.true(result.shouldContinue);
	t.true(result.detectedPatterns.some(p => p.includes('search')));
	t.true(result.detectedPatterns.some(p => p.includes('read')));
});

test('detectContinuationIntent: detects text ending with colon as continuation', t => {
	const result = detectContinuationIntent(
		'Let me examine the following files:',
		false,
	);
	t.true(result.shouldContinue);
	t.true(result.detectedPatterns.some(p => p.includes('colon')));
});

test('detectContinuationIntent: detects text ending with ellipsis as continuation', t => {
	const result = detectContinuationIntent('Let me check the files...', false);
	t.true(result.shouldContinue);
	t.true(result.detectedPatterns.some(p => p.includes('ellipsis')));
});

test('detectContinuationIntent: boosts confidence with recent tool results', t => {
	const withoutToolResults = detectContinuationIntent(
		'I need to examine this.',
		false,
	);
	const withToolResults = detectContinuationIntent(
		'I need to examine this.',
		true,
	);

	t.true(withToolResults.confidence > withoutToolResults.confidence);
	t.true(
		withToolResults.detectedPatterns.some(p => p.includes('recent tool results')),
	);
});

test('detectContinuationIntent: does NOT continue with conclusive language', t => {
	const result = detectContinuationIntent(
		'Based on my analysis, the configuration is correctly set up. The issue is resolved.',
		false,
	);
	t.false(result.shouldContinue);
	t.true(result.detectedPatterns.some(p => p.includes('conclusive')));
});

test('detectContinuationIntent: does NOT continue with "In summary"', t => {
	const result = detectContinuationIntent(
		'In summary, I have completed the requested changes and all tests are passing.',
		false,
	);
	t.false(result.shouldContinue);
});

test('detectContinuationIntent: does NOT continue with "To answer your question"', t => {
	const result = detectContinuationIntent(
		'To answer your question, the tool uses native AI SDK tool calls from version 6.0.',
		false,
	);
	t.false(result.shouldContinue);
});

test('detectContinuationIntent: does NOT continue with questions', t => {
	const result = detectContinuationIntent(
		'Would you like me to proceed with the implementation?',
		false,
	);
	t.false(result.shouldContinue);
	t.true(result.detectedPatterns.some(p => p.includes('question')));
});

test('detectContinuationIntent: does NOT continue with very short text', t => {
	const result = detectContinuationIntent('Done', false);
	t.false(result.shouldContinue);
	t.is(result.reason, 'Response too short');
});

test('detectContinuationIntent: does NOT continue with very long text', t => {
	const longText = 'A'.repeat(1500); // Exceeds maxLength of 1000
	const result = detectContinuationIntent(longText, false);
	t.false(result.shouldContinue);
	t.is(result.reason, 'Response too long (likely complete)');
});

test('detectContinuationIntent: handles empty text gracefully', t => {
	const result = detectContinuationIntent('', false);
	t.false(result.shouldContinue);
	t.is(result.confidence, 0);
});

test('detectContinuationIntent: handles complex continuation case', t => {
	const result = detectContinuationIntent(
		'Let me examine the tool registry to understand how tools are registered:',
		true, // Had recent tool results
	);
	t.true(result.shouldContinue);
	t.true(result.confidence >= 0.7); // Should have high confidence
	t.true(result.detectedPatterns.length >= 3); // Multiple signals
});

test('detectContinuationIntent: handles mixed signals correctly', t => {
	// Has starting phrase BUT also conclusive language
	const result = detectContinuationIntent(
		'Let me check. In summary, the answer is correct.',
		false,
	);
	// Conclusive language should win
	t.false(result.shouldContinue);
});

// Test cases for auto-continuation mode
test('shouldAutoContinue: "always" mode returns true regardless of detection', t => {
	const neverContinue = {
		shouldContinue: false,
		confidence: 0,
		detectedPatterns: [],
		reason: 'Test',
	};
	t.true(shouldAutoContinue('always', neverContinue));
});

test('shouldAutoContinue: "never" mode returns false regardless of detection', t => {
	const shouldContinue = {
		shouldContinue: true,
		confidence: 1,
		detectedPatterns: ['starting: "let me"'],
		reason: 'Test',
	};
	t.false(shouldAutoContinue('never', shouldContinue));
});

test('shouldAutoContinue: "smart" mode respects detection result', t => {
	const shouldContinue = {
		shouldContinue: true,
		confidence: 0.8,
		detectedPatterns: ['starting: "let me"'],
		reason: 'Test',
	};
	const shouldNotContinue = {
		shouldContinue: false,
		confidence: 0.2,
		detectedPatterns: [],
		reason: 'Test',
	};

	t.true(shouldAutoContinue('smart', shouldContinue));
	t.false(shouldAutoContinue('smart', shouldNotContinue));
});

test('shouldAutoContinue: handles invalid mode gracefully', t => {
	const result = {
		shouldContinue: true,
		confidence: 0.8,
		detectedPatterns: [],
		reason: 'Test',
	};
	// @ts-expect-error Testing invalid mode
	t.false(shouldAutoContinue('invalid', result));
});

// Test custom patterns
test('detectContinuationIntent: works with custom patterns', t => {
	const customPatterns = {
		...DEFAULT_CONTINUATION_PATTERNS,
		startingPhrases: ['custom phrase'],
		actionVerbs: ['custom action'],
	};

	const result = detectContinuationIntent(
		'custom phrase to custom action something',
		false,
		customPatterns,
	);

	t.true(result.shouldContinue);
	t.true(result.detectedPatterns.some(p => p.includes('custom phrase')));
	t.true(result.detectedPatterns.some(p => p.includes('custom action')));
});

// Real-world test cases from the issue
test('detectContinuationIntent: real case - "Let me search more broadly"', t => {
	const result = detectContinuationIntent(
		'Let me search more broadly for tool call related functionality in the codebase.',
		true, // Had tool results
	);
	t.true(result.shouldContinue);
	t.true(result.confidence >= 0.7);
});

test('detectContinuationIntent: real case - "Now let me check"', t => {
	const result = detectContinuationIntent(
		'Now let me check the tool registry to understand how tools are registered:',
		true, // Had tool results
	);
	t.true(result.shouldContinue);
	t.true(result.confidence >= 0.7);
});

test('detectContinuationIntent: real case - "Based on my analysis..."', t => {
	const result = detectContinuationIntent(
		'Based on my analysis, I can confirm that this TypeScript CLI tool does NOT use native tool calls from the AI SDK.',
		false,
	);
	t.false(result.shouldContinue);
	t.true(result.detectedPatterns.some(p => p.includes('conclusive')));
});

test('detectContinuationIntent: real case - "I need to examine"', t => {
	const result = detectContinuationIntent(
		"I need to examine the file that contains the `tool()` method usage to understand where it's imported from.",
		true, // Had tool results
	);
	t.true(result.shouldContinue);
});

test('detectContinuationIntent: edge case - only action verb', t => {
	const result = detectContinuationIntent(
		'Searching through the codebase.',
		false,
	);
	// Should NOT continue - too weak signal without starting phrase
	t.false(result.shouldContinue);
});

test('detectContinuationIntent: edge case - action verb after tool results', t => {
	const result = detectContinuationIntent(
		'Searching through the codebase.',
		true, // Had tool results
	);
	// Should continue - combination of action verb + recent tool results
	t.true(result.shouldContinue);
});
