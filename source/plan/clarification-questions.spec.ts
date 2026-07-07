import test from 'ava';
import {buildClarificationQuestions} from './clarification-questions';

console.log('\nclarification-questions.spec.ts');

// ============================================================================
// Trigger matching
// ============================================================================

test('returns empty array for unambiguous requests', t => {
	const result = buildClarificationQuestions('read this file and summarize it');
	t.deepEqual(result, []);
});

test('triggers auth question for login-related requests', t => {
	const result = buildClarificationQuestions('add user authentication to the app');
	t.true(result.some(q => q.id === 'auth-method'));
});

test('triggers performance question for optimize requests', t => {
	const result = buildClarificationQuestions('optimize the API performance');
	t.true(result.some(q => q.id === 'performance-focus'));
});

test('triggers database question for database-related requests', t => {
	const result = buildClarificationQuestions('add persistent storage with a database');
	t.true(result.some(q => q.id === 'database-type'));
});

test('triggers api-style question for API build requests', t => {
	const result = buildClarificationQuestions('build a REST api for user management');
	t.true(result.some(q => q.id === 'api-style'));
});

test('triggers architecture question for microservice requests', t => {
	const result = buildClarificationQuestions('design a microservices architecture');
	t.true(result.some(q => q.id === 'architecture-style'));
});

test('triggers refactor-scope question for refactoring requests', t => {
	const result = buildClarificationQuestions('refactor the user module');
	t.true(result.some(q => q.id === 'refactor-scope'));
});

test('triggers testing question for testing requests', t => {
	const result = buildClarificationQuestions('add unit tests for the auth module');
	t.true(result.some(q => q.id === 'testing-scope'));
});

// ============================================================================
// Result count + ordering
// ============================================================================

test('returns at most 3 questions even for very ambiguous requests', t => {
	const result = buildClarificationQuestions(
		'optimize database performance for the authentication api and add unit tests',
	);
	t.true(result.length <= 3);
});

test('sorts by confidence descending', t => {
	// auth (0.9) > db (0.85) > api (0.8)
	const result = buildClarificationQuestions(
		'build a database-backed authentication api',
	);
	t.true(result.length > 0);
	// First question should be the highest-confidence one
	const firstConf =
		result[0]?.id === 'auth-method'
			? 0.9
			: result[0]?.id === 'database-type'
				? 0.85
				: 0.8;
	const secondConf =
		result[1]?.id === 'auth-method'
			? 0.9
			: result[1]?.id === 'database-type'
				? 0.85
				: 0.8;
	t.true(firstConf >= secondConf);
});

// ============================================================================
// Output shape
// ============================================================================

test('returned questions have required fields', t => {
	const result = buildClarificationQuestions('add user login');
	t.true(result.length > 0);
	for (const q of result) {
		t.truthy(q.id);
		t.truthy(q.type);
		t.truthy(q.question);
		t.true(Array.isArray(q.options));
		t.true(q.options.length >= 2);
	}
});

test('decision questions include optionMeta', t => {
	const result = buildClarificationQuestions('add authentication');
	const authQ = result.find(q => q.id === 'auth-method');
	t.truthy(authQ);
	t.truthy(authQ?.optionMeta);
	t.is(authQ?.optionMeta?.length, authQ?.options.length);
});

test('question type is one of the valid types', t => {
	const result = buildClarificationQuestions(
		'add authentication and optimize database performance',
	);
	const validTypes = new Set(['ambiguity', 'decision', 'confirmation']);
	for (const q of result) {
		t.true(validTypes.has(q.type));
	}
});

// ============================================================================
// Case insensitivity
// ============================================================================

test('matching is case-insensitive', t => {
	const lower = buildClarificationQuestions('add Authentication');
	const upper = buildClarificationQuestions('ADD AUTHENTICATION');
	t.is(lower.length, upper.length);
	t.is(lower[0]?.id, upper[0]?.id);
});
