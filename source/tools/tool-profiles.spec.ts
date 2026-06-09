import test from 'ava';
import {ToolManager} from './tool-manager.js';
import {
	getToolsForProfile,
	inferToolProfile,
	isNanoProfile,
	isSingleToolProfile,
	resolveToolProfile,
	TOOL_PROFILE_DESCRIPTIONS,
	TOOL_PROFILE_TOOLTIPS,
} from './tool-profiles.js';

console.log('\ntool-profiles.spec.ts');

// ============================================================================
// Drift guard: profile entries must name real tools
// ============================================================================
// Profiles are hand-maintained string lists. This catches a renamed/removed
// tool leaving a dangling name behind (which would silently filter nothing).

test('every profile names only registered tools', t => {
	const registered = new Set(new ToolManager().getToolNames());
	for (const profile of ['minimal', 'nano'] as const) {
		for (const name of getToolsForProfile(profile)) {
			t.true(
				registered.has(name),
				`profile "${profile}" references unknown tool "${name}"`,
			);
		}
	}
});

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
// inferToolProfile — model-size heuristic
// ============================================================================

test('inferToolProfile - tiny models (<=4B) resolve to nano', t => {
	t.is(inferToolProfile('llama3.2:1b'), 'nano');
	t.is(inferToolProfile('deepseek-r1:1.5b'), 'nano');
	t.is(inferToolProfile('gemma2:2b'), 'nano');
	t.is(inferToolProfile('phi3:3.8b'), 'nano');
	t.is(inferToolProfile('smollm:135m'), 'nano');
});

test('inferToolProfile - small models (<=15B) resolve to minimal', t => {
	t.is(inferToolProfile('qwen2.5-coder:7b'), 'minimal');
	t.is(inferToolProfile('llama3.1:8b'), 'minimal');
	t.is(inferToolProfile('mistral-nemo:12b'), 'minimal');
});

test('inferToolProfile - large models resolve to full', t => {
	t.is(inferToolProfile('gpt-oss:20b'), 'full');
	t.is(inferToolProfile('qwen2.5-coder:32b'), 'full');
	t.is(inferToolProfile('llama3.3:70b'), 'full');
});

test('inferToolProfile - cloud/unknown models default to full', t => {
	t.is(inferToolProfile('claude-opus-4-8'), 'full');
	t.is(inferToolProfile('gpt-4o'), 'full');
	t.is(inferToolProfile(undefined), 'full');
	t.is(inferToolProfile(''), 'full');
});

test('resolveToolProfile - passes through concrete profiles unchanged', t => {
	t.is(resolveToolProfile('full', 'llama3.2:1b'), 'full');
	t.is(resolveToolProfile('nano', 'gpt-4o'), 'nano');
	t.is(resolveToolProfile('minimal', undefined), 'minimal');
});

test('resolveToolProfile - resolves auto from the model', t => {
	t.is(resolveToolProfile('auto', 'llama3.2:1b'), 'nano');
	t.is(resolveToolProfile('auto', 'qwen2.5-coder:7b'), 'minimal');
	t.is(resolveToolProfile('auto', 'gpt-4o'), 'full');
});

test('auto profile resolves via the profile helpers too', t => {
	t.true(isSingleToolProfile('auto', 'llama3.2:1b'));
	t.true(isNanoProfile('auto', 'llama3.2:1b'));
	t.false(isNanoProfile('auto', 'gpt-4o'));
	t.deepEqual(getToolsForProfile('auto', 'gpt-4o'), []);
	t.true(getToolsForProfile('auto', 'qwen2.5-coder:7b').includes('agent'));
});

// ============================================================================
// Descriptions and tooltips
// ============================================================================

test('TOOL_PROFILE_DESCRIPTIONS - has entries for all profiles', t => {
	t.truthy(TOOL_PROFILE_DESCRIPTIONS.auto);
	t.truthy(TOOL_PROFILE_DESCRIPTIONS.full);
	t.truthy(TOOL_PROFILE_DESCRIPTIONS.minimal);
	t.truthy(TOOL_PROFILE_DESCRIPTIONS.nano);
});

test('TOOL_PROFILE_TOOLTIPS - has entries for all profiles', t => {
	t.truthy(TOOL_PROFILE_TOOLTIPS.auto);
	t.truthy(TOOL_PROFILE_TOOLTIPS.full);
	t.truthy(TOOL_PROFILE_TOOLTIPS.minimal);
	t.truthy(TOOL_PROFILE_TOOLTIPS.nano);
});
