import test from 'ava';
import {
	getToolsForProfile,
	isNanoProfile,
	isSingleToolProfile,
	TOOL_PROFILE_DESCRIPTIONS,
	TOOL_PROFILE_TOOLTIPS,
} from './tool-profiles.js';

console.log('\ntool-profiles.spec.ts');

// ============================================================================
// getToolsForProfile
// ============================================================================

test('getToolsForProfile - full profile returns empty array (no filtering)', t => {
	const result = getToolsForProfile('full');
	t.deepEqual(result, []);
});

test('getToolsForProfile - minimal profile returns 8 core tools', t => {
	const result = getToolsForProfile('minimal');
	t.deepEqual(result, ['read_file', 'write_file', 'string_replace', 'execute_bash', 'find_files', 'search_file_contents', 'list_directory', 'agent']);
});

test('getToolsForProfile - minimal profile includes read_file', t => {
	const result = getToolsForProfile('minimal');
	t.true(result.includes('read_file'));
});

test('getToolsForProfile - minimal profile includes string_replace', t => {
	const result = getToolsForProfile('minimal');
	t.true(result.includes('string_replace'));
});

test('getToolsForProfile - minimal profile includes execute_bash', t => {
	const result = getToolsForProfile('minimal');
	t.true(result.includes('execute_bash'));
});

test('getToolsForProfile - nano profile returns 5 core tools', t => {
	const result = getToolsForProfile('nano');
	t.deepEqual(result, [
		'read_file',
		'string_replace',
		'write_file',
		'execute_bash',
		'search_file_contents',
	]);
});

test('getToolsForProfile - nano omits agent, find_files, list_directory', t => {
	const result = getToolsForProfile('nano');
	t.false(result.includes('agent'));
	t.false(result.includes('find_files'));
	t.false(result.includes('list_directory'));
});

// ============================================================================
// isSingleToolProfile
// ============================================================================

test('isSingleToolProfile - returns true for minimal', t => {
	t.true(isSingleToolProfile('minimal'));
});

test('isSingleToolProfile - returns true for nano', t => {
	t.true(isSingleToolProfile('nano'));
});

test('isSingleToolProfile - returns false for full', t => {
	t.false(isSingleToolProfile('full'));
});

// ============================================================================
// isNanoProfile
// ============================================================================

test('isNanoProfile - returns true for nano', t => {
	t.true(isNanoProfile('nano'));
});

test('isNanoProfile - returns false for minimal and full', t => {
	t.false(isNanoProfile('minimal'));
	t.false(isNanoProfile('full'));
});

// ============================================================================
// Descriptions and tooltips
// ============================================================================

test('TOOL_PROFILE_DESCRIPTIONS - has entries for all profiles', t => {
	t.truthy(TOOL_PROFILE_DESCRIPTIONS.full);
	t.truthy(TOOL_PROFILE_DESCRIPTIONS.minimal);
	t.truthy(TOOL_PROFILE_DESCRIPTIONS.nano);
});

test('TOOL_PROFILE_TOOLTIPS - has entries for all profiles', t => {
	t.truthy(TOOL_PROFILE_TOOLTIPS.full);
	t.truthy(TOOL_PROFILE_TOOLTIPS.minimal);
	t.truthy(TOOL_PROFILE_TOOLTIPS.nano);
});
