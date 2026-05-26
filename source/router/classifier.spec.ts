import test from 'ava';
import {
	classifyMessage,
	isActiveProviderLocal,
	resetRouterClient,
	shouldActivateRouter,
} from './classifier';
import {cleanCategoryResponse, buildRouterPrompt} from './prompt';
import {
	CATEGORY_TOOL_SETS,
	CATEGORY_DESCRIPTIONS,
	SPECIALIST_CATEGORIES,
	STICKY_CATEGORIES,
	type SpecialistCategory,
	type RouterConfig,
} from './types';
import {PRE_MODEL_OVERRIDES, KEYWORD_HINTS} from './keyword-hints';

// ─── cleanCategoryResponse ─────────────────────────────────────

test('cleanCategoryResponse - returns valid category', (t) => {
	t.is(cleanCategoryResponse('chat'), 'chat');
	t.is(cleanCategoryResponse('code_edit'), 'code_edit');
	t.is(cleanCategoryResponse('  CODE_EXPLORE  '), 'code_explore');
});

test('cleanCategoryResponse - strips non-alpha chars', (t) => {
	t.is(cleanCategoryResponse('chat.'), 'chat');
	t.is(cleanCategoryResponse('code_edit!'), 'code_edit');
	t.is(cleanCategoryResponse('"shell"'), 'shell');
});

test('cleanCategoryResponse - returns null for invalid', (t) => {
	t.is(cleanCategoryResponse('unknown'), null);
	t.is(cleanCategoryResponse(''), null);
	t.is(cleanCategoryResponse('  '), null);
	t.is(cleanCategoryResponse('not_a_real_category'), null);
});

// ─── buildRouterPrompt ─────────────────────────────────────────

test('buildRouterPrompt - includes all categories', (t) => {
	const config: RouterConfig = {
		model: 'test',
		timeout: 1000,
		defaultCategory: 'chat',
		categories: {},
	};
	const prompt = buildRouterPrompt('test message', config);

	for (const cat of SPECIALIST_CATEGORIES) {
		t.true(prompt.includes(cat), `prompt should include category: ${cat}`);
	}
});

test('buildRouterPrompt - includes the message', (t) => {
	const config: RouterConfig = {
		model: 'test',
		timeout: 1000,
		defaultCategory: 'chat',
		categories: {},
	};
	const prompt = buildRouterPrompt('Where is auth implemented?', config);
	t.true(prompt.includes('Where is auth implemented?'));
});

// ─── CATEGORY_TOOL_SETS ────────────────────────────────────────

test('CATEGORY_TOOL_SETS - chat has no tools', (t) => {
	t.deepEqual(CATEGORY_TOOL_SETS.chat, []);
});

test('CATEGORY_TOOL_SETS - code_edit has core editing tools', (t) => {
	const tools = CATEGORY_TOOL_SETS.code_edit;
	t.true(tools.includes('read_file'));
	t.true(tools.includes('write_file'));
	t.true(tools.includes('string_replace'));
});

test('CATEGORY_TOOL_SETS - all categories have tool sets', (t) => {
	for (const cat of SPECIALIST_CATEGORIES) {
		t.true(
			Array.isArray(CATEGORY_TOOL_SETS[cat]),
			`category ${cat} should have a tool set`,
		);
	}
});

test('CATEGORY_TOOL_SETS - multi has empty set (full tool access)', (t) => {
	t.deepEqual(CATEGORY_TOOL_SETS.multi, []);
});

// ─── classifyMessage (keyword/heuristic tier) ──────────────────

test('classifyMessage - pre-model override: shell via ! prefix', async (t) => {
	const result = await classifyMessage('!git status', undefined, {
		model: '',
		timeout: 1000,
		defaultCategory: 'chat',
		categories: {},
	});
	t.is(result.category, 'shell');
	t.is(result.confidence, 'pre_model_override');
});

test('classifyMessage - pre-model override: git explicit', async (t) => {
	const result = await classifyMessage(
		'git commit my changes',
		undefined,
		{model: '', timeout: 1000, defaultCategory: 'chat', categories: {}},
	);
	t.is(result.category, 'git');
	t.is(result.confidence, 'pre_model_override');
});

test('classifyMessage - pre-model override: @file mention', async (t) => {
	const result = await classifyMessage(
		'review @src/app.tsx',
		undefined,
		{model: '', timeout: 1000, defaultCategory: 'chat', categories: {}},
	);
	t.is(result.category, 'code_edit');
	t.is(result.confidence, 'pre_model_override');
});

test('classifyMessage - pre-model override: multi compound', async (t) => {
	const result = await classifyMessage(
		'find the auth module and fix the login bug',
		undefined,
		{model: '', timeout: 1000, defaultCategory: 'chat', categories: {}},
	);
	t.is(result.category, 'multi');
	t.is(result.confidence, 'pre_model_override');
});

test('classifyMessage - keyword: code_edit via fix bug', async (t) => {
	const result = await classifyMessage(
		'fix the bug in the auth module',
		undefined,
		{model: '', timeout: 1000, defaultCategory: 'chat', categories: {}},
	);
	t.is(result.category, 'code_edit');
	t.is(result.confidence, 'keyword');
});

test('classifyMessage - keyword: code_explore via search', async (t) => {
	const result = await classifyMessage(
		'where is the User model defined?',
		undefined,
		{model: '', timeout: 1000, defaultCategory: 'chat', categories: {}},
	);
	t.is(result.category, 'code_explore');
	t.is(result.confidence, 'keyword');
});

test('classifyMessage - keyword: code_explore via file reference', async (t) => {
	const result = await classifyMessage(
		'tell me about package.json',
		undefined,
		{model: '', timeout: 1000, defaultCategory: 'chat', categories: {}},
	);
	t.is(result.category, 'code_explore');
	t.is(result.confidence, 'keyword');
});

test('classifyMessage - keyword: code_explore via explain file', async (t) => {
	const result = await classifyMessage(
		'explain the classifier.ts file',
		undefined,
		{model: '', timeout: 1000, defaultCategory: 'chat', categories: {}},
	);
	t.is(result.category, 'code_explore');
	t.is(result.confidence, 'keyword');
});

test('classifyMessage - keyword: shell via npm', async (t) => {
	const result = await classifyMessage(
		'npm test',
		undefined,
		{model: '', timeout: 1000, defaultCategory: 'chat', categories: {}},
	);
	t.is(result.category, 'shell');
	t.is(result.confidence, 'keyword');
});

test('classifyMessage - keyword: web search', async (t) => {
	const result = await classifyMessage(
		'search the web for latest AI news',
		undefined,
		{model: '', timeout: 1000, defaultCategory: 'chat', categories: {}},
	);
	t.is(result.category, 'web');
	t.is(result.confidence, 'keyword');
});

test('classifyMessage - keyword: task', async (t) => {
	const result = await classifyMessage(
		'add a task to fix the tests',
		undefined,
		{model: '', timeout: 1000, defaultCategory: 'chat', categories: {}},
	);
	t.is(result.category, 'task');
	t.is(result.confidence, 'keyword');
});

test('classifyMessage - default fallback', async (t) => {
	const result = await classifyMessage(
		'hello there',
		undefined,
		{model: '', timeout: 1000, defaultCategory: 'chat', categories: {}},
	);
	t.is(result.category, 'chat');
	t.is(result.confidence, 'fallback');
});

// ─── Sticky routing ────────────────────────────────────────────

test('classifyMessage - sticky: follow-up stays on chat', async (t) => {
	const result = await classifyMessage(
		'tell me more',
		'chat',
		{model: '', timeout: 1000, defaultCategory: 'chat', categories: {}},
	);
	t.is(result.category, 'chat');
	t.is(result.confidence, 'sticky');
});

test('classifyMessage - sticky: new topic breaks sticky', async (t) => {
	const result = await classifyMessage(
		'fix the bug in auth.ts',
		'chat',
		{model: '', timeout: 1000, defaultCategory: 'chat', categories: {}},
	);
	// "fix" is an imperative task command → breaks sticky
	t.not(result.confidence, 'sticky');
});

test('classifyMessage - sticky: greeting breaks sticky', async (t) => {
	const result = await classifyMessage(
		'hey what is up',
		'chat',
		{model: '', timeout: 1000, defaultCategory: 'chat', categories: {}},
	);
	t.not(result.confidence, 'sticky');
});

test('classifyMessage - sticky: only chat and code_explore are sticky', async (t) => {
	const result = await classifyMessage(
		'tell me more',
		'git' as SpecialistCategory,
		{model: '', timeout: 1000, defaultCategory: 'chat', categories: {}},
	);
	// git is not a sticky category → follow-up should not stick
	t.not(result.confidence, 'sticky');
});

// ─── shouldActivateRouter ──────────────────────────────────────

test('shouldActivateRouter - explicitly enabled', (t) => {
	t.true(shouldActivateRouter(true, undefined, 'any-provider'));
});

test('shouldActivateRouter - explicitly disabled', (t) => {
	t.false(shouldActivateRouter(false, undefined, 'any-provider'));
});

test('shouldActivateRouter - undefined uses local detection', (t) => {
	// Non-local provider → should not activate
	t.false(shouldActivateRouter(undefined, true, 'openrouter'));
});

test('shouldActivateRouter - activateForLocalProviders false disables auto', (t) => {
	t.false(shouldActivateRouter(undefined, false, 'ollama'));
});

// ─── STICKY_CATEGORIES ─────────────────────────────────────────

test('STICKY_CATEGORIES - only chat and code_explore', (t) => {
	t.true(STICKY_CATEGORIES.has('chat'));
	t.true(STICKY_CATEGORIES.has('code_explore'));
	t.false(STICKY_CATEGORIES.has('code_edit'));
	t.false(STICKY_CATEGORIES.has('shell'));
	t.false(STICKY_CATEGORIES.has('git'));
	t.false(STICKY_CATEGORIES.has('web'));
	t.false(STICKY_CATEGORIES.has('task'));
	t.false(STICKY_CATEGORIES.has('multi'));
});

// ─── CATEGORY_DESCRIPTIONS ─────────────────────────────────────

test('CATEGORY_DESCRIPTIONS - all categories have descriptions', (t) => {
	for (const cat of SPECIALIST_CATEGORIES) {
		t.truthy(
			CATEGORY_DESCRIPTIONS[cat],
			`category ${cat} should have a description`,
		);
	}
});
