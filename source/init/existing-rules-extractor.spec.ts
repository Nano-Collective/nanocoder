import test from 'ava';
import {existsSync, mkdirSync, rmSync, writeFileSync} from 'fs';
import {join} from 'path';
import {tmpdir} from 'os';
import {
	type ExistingRules,
	ExistingRulesExtractor,
} from './existing-rules-extractor.js';

// Test fixture setup
function createTestProject(name: string): string {
	const testDir = join(tmpdir(), `nanocoder-test-${name}-${Date.now()}`);
	mkdirSync(testDir, {recursive: true});
	return testDir;
}

function cleanupTestProject(testDir: string): void {
	if (existsSync(testDir)) {
		rmSync(testDir, {recursive: true, force: true});
	}
}

// Sample content for testing
const sampleAgentsContent = `# AGENTS.md

## Project Architecture

This section describes the project architecture.

## Coding Conventions

- Always use TypeScript
- Must include tests for all features
- Should follow ESLint rules

## Testing Guidelines

Testing is critical and required for all features.
Never skip tests when adding new functionality.

## Random Section

This section should not be included as it's not relevant.
`;

const sampleCursorRules = `# Cursor Rules

You must always format code with Prettier.
Testing should be comprehensive.
Security is critical in all implementations.
`;

const sampleClaudeContent = `# Claude Instructions

## Style Guide

Code must be well-documented.
Performance optimization is important.
Always follow the project structure.

## Security Requirements

Security is critical.
Never expose sensitive data.
Must validate all inputs.
`;

const sampleInstructionsContent = `# Development Guidelines

Short line.

This is a relevant paragraph that contains important information about
how we must structure our code. It also mentions that testing should
always be comprehensive and never be skipped.

Another important paragraph discussing critical security requirements
that must be followed. This mentions that validation is essential and
should always be performed.

This is an example only paragraph that should be filtered out.

A short paragraph.
`;

const sampleRulesFile = `# Project Rules

All code must be tested.
Security should be priority one.
This is just an example only, not real.
`;

test('extractExistingRules - finds AGENTS.md file', t => {
	const testDir = createTestProject('agents-md');

	try {
		writeFileSync(join(testDir, 'AGENTS.md'), sampleAgentsContent);

		const extractor = new ExistingRulesExtractor(testDir);
		const rules = extractor.extractExistingRules();

		t.is(rules.length, 1);
		t.is(rules[0].source, 'AGENTS.md');
		t.is(rules[0].type, 'agents');
		t.truthy(rules[0].content.includes('Coding Conventions'));
		t.truthy(rules[0].content.includes('Testing Guidelines'));
		t.false(rules[0].content.includes('Random Section'));
	} finally {
		cleanupTestProject(testDir);
	}
});

test('extractExistingRules - finds CLAUDE.md file', t => {
	const testDir = createTestProject('claude-md');

	try {
		writeFileSync(join(testDir, 'CLAUDE.md'), sampleClaudeContent);

		const extractor = new ExistingRulesExtractor(testDir);
		const rules = extractor.extractExistingRules();

		t.is(rules.length, 1);
		t.is(rules[0].source, 'CLAUDE.md');
		t.is(rules[0].type, 'agents');
		t.truthy(rules[0].content.includes('Style Guide'));
		t.truthy(rules[0].content.includes('Security Requirements'));
	} finally {
		cleanupTestProject(testDir);
	}
});

test('extractExistingRules - finds .cursor/rules file', t => {
	const testDir = createTestProject('cursor-rules');

	try {
		const cursorDir = join(testDir, '.cursor');
		mkdirSync(cursorDir, {recursive: true});
		writeFileSync(join(cursorDir, 'rules'), sampleCursorRules);

		const extractor = new ExistingRulesExtractor(testDir);
		const rules = extractor.extractExistingRules();

		t.is(rules.length, 1);
		t.is(rules[0].source, '.cursor/rules');
		t.is(rules[0].type, 'rules');
		t.truthy(rules[0].content.length > 0);
	} finally {
		cleanupTestProject(testDir);
	}
});

test('extractExistingRules - finds multiple files', t => {
	const testDir = createTestProject('multiple-files');

	try {
		writeFileSync(join(testDir, 'AGENTS.md'), sampleAgentsContent);
		writeFileSync(join(testDir, 'CLAUDE.md'), sampleClaudeContent);

		const cursorDir = join(testDir, '.cursor');
		mkdirSync(cursorDir, {recursive: true});
		writeFileSync(join(cursorDir, 'rules'), sampleCursorRules);

		const extractor = new ExistingRulesExtractor(testDir);
		const rules = extractor.extractExistingRules();

		t.is(rules.length, 3);
		t.truthy(rules.some(r => r.source === 'AGENTS.md'));
		t.truthy(rules.some(r => r.source === 'CLAUDE.md'));
		t.truthy(rules.some(r => r.source === '.cursor/rules'));
	} finally {
		cleanupTestProject(testDir);
	}
});

test('extractExistingRules - skips non-existent files', t => {
	const testDir = createTestProject('empty-project');

	try {
		const extractor = new ExistingRulesExtractor(testDir);
		const rules = extractor.extractExistingRules();

		t.is(rules.length, 0);
	} finally {
		cleanupTestProject(testDir);
	}
});

test('extractExistingRules - skips empty files', t => {
	const testDir = createTestProject('empty-file');

	try {
		writeFileSync(join(testDir, 'AGENTS.md'), '');

		const extractor = new ExistingRulesExtractor(testDir);
		const rules = extractor.extractExistingRules();

		t.is(rules.length, 0);
	} finally {
		cleanupTestProject(testDir);
	}
});

test('extractExistingRules - skips whitespace-only files', t => {
	const testDir = createTestProject('whitespace-file');

	try {
		writeFileSync(join(testDir, 'AGENTS.md'), '   \n\n\t\n   ');

		const extractor = new ExistingRulesExtractor(testDir);
		const rules = extractor.extractExistingRules();

		t.is(rules.length, 0);
	} finally {
		cleanupTestProject(testDir);
	}
});

test('extractExistingRules - handles read errors gracefully', t => {
	const testDir = createTestProject('read-error');

	try {
		// Create a directory instead of a file to cause a read error
		const invalidFile = join(testDir, 'AGENTS.md');
		mkdirSync(invalidFile, {recursive: true});

		const extractor = new ExistingRulesExtractor(testDir);
		const rules = extractor.extractExistingRules();

		// Should skip the file that can't be read
		t.is(rules.length, 0);
	} finally {
		cleanupTestProject(testDir);
	}
});

test('cleanAndExtractRelevantContent - removes excessive empty lines', t => {
	const testDir = createTestProject('empty-lines');

	try {
		const content = `## Important Section

Line 1


Line 2



Line 3

Testing must be done.
Security should be considered.`;
		writeFileSync(join(testDir, 'AGENTS.md'), content);

		const extractor = new ExistingRulesExtractor(testDir);
		const rules = extractor.extractExistingRules();

		t.is(rules.length, 1);
		// Should have reduced multiple empty lines to double newlines
		t.false(rules[0].content.includes('\n\n\n\n'));
	} finally {
		cleanupTestProject(testDir);
	}
});

test('cleanAndExtractRelevantContent - removes excessive header decoration', t => {
	const testDir = createTestProject('header-decoration');

	try {
		const content = `#### Coding Standards

Testing must be done.
Security should be important.

##### Another Section

Performance must be optimized.
Never skip tests.`;
		writeFileSync(join(testDir, 'AGENTS.md'), content);

		const extractor = new ExistingRulesExtractor(testDir);
		const rules = extractor.extractExistingRules();

		t.is(rules.length, 1);
		// Should reduce headers to max ### level
		t.false(rules[0].content.includes('####'));
	} finally {
		cleanupTestProject(testDir);
	}
});

test('extractAIAgentSections - extracts relevant sections with markdown headers', t => {
	const testDir = createTestProject('agent-sections');

	try {
		writeFileSync(join(testDir, 'AGENTS.md'), sampleAgentsContent);

		const extractor = new ExistingRulesExtractor(testDir);
		const rules = extractor.extractExistingRules();

		t.is(rules.length, 1);
		t.truthy(rules[0].content.includes('Coding Conventions'));
		t.truthy(rules[0].content.includes('Testing Guidelines'));
		t.false(rules[0].content.includes('Random Section'));
	} finally {
		cleanupTestProject(testDir);
	}
});

test('extractAIAgentSections - handles underline-style headers', t => {
	const testDir = createTestProject('underline-headers');

	try {
		const content = `## Coding Style

Must use tabs.
Should be consistent.
Testing is important.

Random Content
---

Not relevant.

## Testing Guidelines

Testing is critical and essential.
Must test everything always.
Security should never be ignored.
`;
		writeFileSync(join(testDir, 'AGENTS.md'), content);

		const extractor = new ExistingRulesExtractor(testDir);
		const rules = extractor.extractExistingRules();

		t.is(rules.length, 1);
		t.truthy(rules[0].content.includes('Coding Style'));
		t.truthy(rules[0].content.includes('Testing Guidelines'));
	} finally {
		cleanupTestProject(testDir);
	}
});

test('extractAIAgentSections - falls back to key paragraphs when no sections found', t => {
	const testDir = createTestProject('no-sections');

	try {
		const content = `This is a document without headers.

But it contains important information that must be followed.
Security is critical and should always be considered.
Testing should never be skipped.

Another paragraph with essential guidelines that are required
for the project. Performance must be optimized and the structure
should follow best practices.
`;
		writeFileSync(join(testDir, 'AGENTS.md'), content);

		const extractor = new ExistingRulesExtractor(testDir);
		const rules = extractor.extractExistingRules();

		t.is(rules.length, 1);
		t.truthy(rules[0].content.includes('important'));
		t.truthy(rules[0].content.includes('Security'));
	} finally {
		cleanupTestProject(testDir);
	}
});

test('extractRulesSections - filters example-only content', t => {
	const testDir = createTestProject('rules-filtering');

	try {
		const cursorDir = join(testDir, '.cursor');
		mkdirSync(cursorDir, {recursive: true});
		writeFileSync(join(cursorDir, 'rules'), sampleRulesFile);

		const extractor = new ExistingRulesExtractor(testDir);
		const rules = extractor.extractExistingRules();

		t.is(rules.length, 1);
		t.false(rules[0].content.includes('example only'));
	} finally {
		cleanupTestProject(testDir);
	}
});

test('extractRulesSections - keeps short lines for structure', t => {
	const testDir = createTestProject('rules-structure');

	try {
		const content = `# Rules

Short

This is a longer line that should be kept for content.
`;
		const cursorDir = join(testDir, '.cursor');
		mkdirSync(cursorDir, {recursive: true});
		writeFileSync(join(cursorDir, 'rules'), content);

		const extractor = new ExistingRulesExtractor(testDir);
		const rules = extractor.extractExistingRules();

		t.is(rules.length, 1);
		t.truthy(rules[0].content.includes('Short'));
	} finally {
		cleanupTestProject(testDir);
	}
});

test('extractRulesSections - filters "this is just an example" lines', t => {
	const testDir = createTestProject('rules-this-is-just');

	try {
		const content = `# Project Rules

All code must be tested and reviewed.
This is just an example of what not to include.
Security should be the top priority.
`;
		const cursorDir = join(testDir, '.cursor');
		mkdirSync(cursorDir, {recursive: true});
		writeFileSync(join(cursorDir, 'rules'), content);

		const extractor = new ExistingRulesExtractor(testDir);
		const rules = extractor.extractExistingRules();

		t.is(rules.length, 1);
		t.truthy(rules[0].content.includes('All code must be tested'));
		t.false(rules[0].content.includes('this is just an example'));
	} finally {
		cleanupTestProject(testDir);
	}
});

test('extractGeneralInstructions - uses extractKeyParagraphs', t => {
	const testDir = createTestProject('general-instructions');

	try {
		writeFileSync(
			join(testDir, 'ai-instructions.md'),
			sampleInstructionsContent,
		);

		const extractor = new ExistingRulesExtractor(testDir);
		const rules = extractor.extractExistingRules();

		t.is(rules.length, 1);
		t.is(rules[0].type, 'instructions');
	} finally {
		cleanupTestProject(testDir);
	}
});

test('extractKeyParagraphs - extracts paragraphs with important keywords', t => {
	const testDir = createTestProject('key-paragraphs');

	try {
		writeFileSync(
			join(testDir, 'ai-instructions.md'),
			sampleInstructionsContent,
		);

		const extractor = new ExistingRulesExtractor(testDir);
		const rules = extractor.extractExistingRules();

		t.is(rules.length, 1);
		t.truthy(rules[0].content.includes('must structure our code'));
		t.truthy(rules[0].content.includes('critical security requirements'));
	} finally {
		cleanupTestProject(testDir);
	}
});

test('extractKeyParagraphs - requires at least 2 keywords', t => {
	const testDir = createTestProject('keyword-threshold');

	try {
		const content = `This is a long paragraph but only has one important keyword
which is not enough to be considered relevant.

This paragraph has must and should which are both important keywords
so it will be included in the extraction.

Another irrelevant paragraph.
`;
		writeFileSync(join(testDir, 'ai-instructions.md'), content);

		const extractor = new ExistingRulesExtractor(testDir);
		const rules = extractor.extractExistingRules();

		t.is(rules.length, 1);
		t.truthy(rules[0].content.includes('must and should'));
		t.false(rules[0].content.includes('only has one'));
	} finally {
		cleanupTestProject(testDir);
	}
});

test('extractKeyParagraphs - falls back to first 3 paragraphs if no keywords', t => {
	const testDir = createTestProject('no-keywords');

	try {
		const content = `First paragraph with enough characters to not be filtered out
by the minimum length requirement. This has no special keywords.

Second paragraph also with enough length to be considered a valid
paragraph but still lacking any of the important keywords.

Third paragraph continuing the trend of having sufficient length
to be a proper paragraph without the special keywords.

Fourth paragraph that should not be included because we only take
the first three paragraphs when there are no keyword matches.
`;
		writeFileSync(join(testDir, 'ai-instructions.md'), content);

		const extractor = new ExistingRulesExtractor(testDir);
		const rules = extractor.extractExistingRules();

		t.is(rules.length, 1);
		t.truthy(rules[0].content.includes('First paragraph'));
		t.truthy(rules[0].content.includes('Second paragraph'));
		t.truthy(rules[0].content.includes('Third paragraph'));
		t.false(rules[0].content.includes('Fourth paragraph'));
	} finally {
		cleanupTestProject(testDir);
	}
});

test('extractKeyParagraphs - limits to 5 paragraphs max', t => {
	const testDir = createTestProject('max-paragraphs');

	try {
		const content = `
Paragraph 1 with must and should keywords that make it important.

Paragraph 2 with critical and essential keywords for relevance.

Paragraph 3 with required and mandatory keywords to be selected.

Paragraph 4 with always and never keywords that are important.

Paragraph 5 with testing and security keywords for inclusion.

Paragraph 6 with must and should but should not be included because
we limit to a maximum of 5 paragraphs even if they are all relevant.
`;
		writeFileSync(join(testDir, 'ai-instructions.md'), content);

		const extractor = new ExistingRulesExtractor(testDir);
		const rules = extractor.extractExistingRules();

		t.is(rules.length, 1);
		t.truthy(rules[0].content.includes('Paragraph 1'));
		t.truthy(rules[0].content.includes('Paragraph 5'));
		t.false(rules[0].content.includes('Paragraph 6'));
	} finally {
		cleanupTestProject(testDir);
	}
});

test('extractKeyParagraphs - filters out short paragraphs', t => {
	const testDir = createTestProject('short-paragraphs');

	try {
		const content = `
Short.

This is a long paragraph with must and should keywords that has enough
characters to be considered for extraction based on the minimum length
requirement of more than 50 characters.

Too short with keywords.
`;
		writeFileSync(join(testDir, 'ai-instructions.md'), content);

		const extractor = new ExistingRulesExtractor(testDir);
		const rules = extractor.extractExistingRules();

		t.is(rules.length, 1);
		t.truthy(rules[0].content.includes('long paragraph'));
		t.false(rules[0].content.includes('Short.'));
	} finally {
		cleanupTestProject(testDir);
	}
});

test('determineFileType - identifies agents files', t => {
	const testDir = createTestProject('file-types-agents');

	try {
		writeFileSync(join(testDir, 'AGENTS.md'), sampleAgentsContent);
		writeFileSync(join(testDir, 'CLAUDE.md'), sampleClaudeContent);
		writeFileSync(
			join(testDir, 'GEMINI.md'),
			`# Gemini

## Testing Requirements

Must test all features.
Security should be considered always.
`,
		);

		const extractor = new ExistingRulesExtractor(testDir);
		const rules = extractor.extractExistingRules();

		const agentsRules = rules.filter(r => r.type === 'agents');
		t.is(agentsRules.length, 3);
	} finally {
		cleanupTestProject(testDir);
	}
});

test('determineFileType - identifies rules files', t => {
	const testDir = createTestProject('file-types-rules');

	try {
		const cursorDir = join(testDir, '.cursor');
		mkdirSync(cursorDir, {recursive: true});
		writeFileSync(join(cursorDir, 'rules'), sampleCursorRules);

		const clinerules = join(testDir, '.clinerules');
		mkdirSync(clinerules, {recursive: true});
		writeFileSync(join(clinerules, 'rules'), 'Must test.');

		const extractor = new ExistingRulesExtractor(testDir);
		const rules = extractor.extractExistingRules();

		const rulesFiles = rules.filter(r => r.type === 'rules');
		t.is(rulesFiles.length, 2);
	} finally {
		cleanupTestProject(testDir);
	}
});

test('determineFileType - identifies instructions files', t => {
	const testDir = createTestProject('file-types-instructions');

	try {
		writeFileSync(
			join(testDir, 'ai-instructions.md'),
			sampleInstructionsContent,
		);
		writeFileSync(
			join(testDir, 'coding-guidelines.md'),
			`# Coding Guidelines

You must follow all conventions in this project.
Code quality should always be maintained and never compromised.
`,
		);

		const extractor = new ExistingRulesExtractor(testDir);
		const rules = extractor.extractExistingRules();

		const instructions = rules.filter(r => r.type === 'instructions');
		t.is(instructions.length, 2);
	} finally {
		cleanupTestProject(testDir);
	}
});

test('mergeExistingRules - returns empty string for no rules', t => {
	const result = ExistingRulesExtractor.mergeExistingRules([]);
	t.is(result, '');
});

test('mergeExistingRules - creates proper structure with headers', t => {
	const rules: ExistingRules[] = [
		{
			source: 'AGENTS.md',
			content: 'Agent content',
			type: 'agents',
		},
	];

	const result = ExistingRulesExtractor.mergeExistingRules(rules);

	t.truthy(result.includes('## Existing Project Guidelines'));
	t.truthy(
		result.includes('*The following guidelines were found in existing'),
	);
});

test('mergeExistingRules - groups by type correctly', t => {
	const rules: ExistingRules[] = [
		{
			source: 'AGENTS.md',
			content: 'Agent content',
			type: 'agents',
		},
		{
			source: '.cursor/rules',
			content: 'Rules content',
			type: 'rules',
		},
		{
			source: 'ai-instructions.md',
			content: 'Instructions content',
			type: 'instructions',
		},
	];

	const result = ExistingRulesExtractor.mergeExistingRules(rules);

	t.truthy(result.includes('### AI Agent Guidelines'));
	t.truthy(result.includes('**From AGENTS.md:**'));
	t.truthy(result.includes('Agent content'));

	t.truthy(result.includes('### Project Rules'));
	t.truthy(result.includes('**From .cursor/rules:**'));
	t.truthy(result.includes('Rules content'));

	t.truthy(result.includes('### Additional Instructions'));
	t.truthy(result.includes('**From ai-instructions.md:**'));
	t.truthy(result.includes('Instructions content'));
});

test('mergeExistingRules - handles multiple rules of same type', t => {
	const rules: ExistingRules[] = [
		{
			source: 'AGENTS.md',
			content: 'First agent content',
			type: 'agents',
		},
		{
			source: 'CLAUDE.md',
			content: 'Second agent content',
			type: 'agents',
		},
	];

	const result = ExistingRulesExtractor.mergeExistingRules(rules);

	t.truthy(result.includes('**From AGENTS.md:**'));
	t.truthy(result.includes('First agent content'));
	t.truthy(result.includes('**From CLAUDE.md:**'));
	t.truthy(result.includes('Second agent content'));
});

test('mergeExistingRules - omits sections for missing types', t => {
	const rules: ExistingRules[] = [
		{
			source: 'AGENTS.md',
			content: 'Agent content',
			type: 'agents',
		},
	];

	const result = ExistingRulesExtractor.mergeExistingRules(rules);

	t.truthy(result.includes('### AI Agent Guidelines'));
	t.false(result.includes('### Project Rules'));
	t.false(result.includes('### Additional Instructions'));
});

test('all AI config files are checked', t => {
	const testDir = createTestProject('all-config-files');

	try {
		// Create files for all config file patterns
		const configFiles = [
			'AGENTS.md',
			'AGENT.md',
			'CLAUDE.md',
			'GEMINI.md',
			'CURSOR.md',
			'.cursor/rules',
			'.clinerules/rules',
			'.roorules/rules',
			'.ai/rules',
			'.ai/instructions',
			'ai-instructions.md',
			'coding-guidelines.md',
			'dev-guidelines.md',
		];

		for (const file of configFiles) {
			const filePath = join(testDir, file);
			const dir = filePath.substring(0, filePath.lastIndexOf('/'));
			if (dir && dir !== testDir) {
				mkdirSync(dir, {recursive: true});
			}
			writeFileSync(
				filePath,
				`# ${file}\n\nThis must be tested. Security should be considered.`,
			);
		}

		const extractor = new ExistingRulesExtractor(testDir);
		const rules = extractor.extractExistingRules();

		// All files should be found and have content
		t.is(rules.length, configFiles.length);

		// Verify each file type is correctly categorized
		const agentFiles = ['AGENTS.md', 'AGENT.md', 'CLAUDE.md', 'GEMINI.md'];
		const ruleFiles = [
			'.cursor/rules',
			'.clinerules/rules',
			'.roorules/rules',
			'.ai/rules',
		];
		const instructionFiles = [
			'CURSOR.md',
			'.ai/instructions',
			'ai-instructions.md',
			'coding-guidelines.md',
			'dev-guidelines.md',
		];

		for (const rule of rules) {
			if (agentFiles.includes(rule.source)) {
				t.is(rule.type, 'agents');
			} else if (ruleFiles.includes(rule.source)) {
				t.is(rule.type, 'rules');
			} else if (instructionFiles.includes(rule.source)) {
				t.is(rule.type, 'instructions');
			} else {
				t.fail(`Unexpected file: ${rule.source}`);
			}
		}
	} finally {
		cleanupTestProject(testDir);
	}
});

test('integration - full workflow with realistic project', t => {
	const testDir = createTestProject('realistic-project');

	try {
		// Create a realistic project structure
		writeFileSync(
			join(testDir, 'AGENTS.md'),
			`# Project Guidelines

## Architecture

This project uses a modular architecture.

## Coding Standards

- Code must be TypeScript
- Testing should be comprehensive
- Security is critical
- Performance must be optimized

## Deployment

Use CI/CD pipeline.
`,
		);

		const cursorDir = join(testDir, '.cursor');
		mkdirSync(cursorDir, {recursive: true});
		writeFileSync(
			join(cursorDir, 'rules'),
			`Always format with Biome.
Testing is required for all features.
This is just an example only.
`,
		);

		writeFileSync(
			join(testDir, 'dev-guidelines.md'),
			`# Development Guidelines

When contributing to this project, you must follow these important rules.
Code quality should always be maintained and never compromised.
Testing is essential and required for every pull request.

Short text.

The security of our application is critical and must be prioritized.
All inputs should be validated and sanitized. Performance testing is
mandatory for all new features. The project structure should follow
the established patterns and conventions.
`,
		);

		const extractor = new ExistingRulesExtractor(testDir);
		const rules = extractor.extractExistingRules();

		// Should find all 3 files
		t.is(rules.length, 3);

		// Verify types
		t.is(rules.find(r => r.source === 'AGENTS.md')?.type, 'agents');
		t.is(rules.find(r => r.source === '.cursor/rules')?.type, 'rules');
		t.is(
			rules.find(r => r.source === 'dev-guidelines.md')?.type,
			'instructions',
		);

		// Merge and verify
		const merged = ExistingRulesExtractor.mergeExistingRules(rules);

		t.truthy(merged.includes('## Existing Project Guidelines'));
		t.truthy(merged.includes('### AI Agent Guidelines'));
		t.truthy(merged.includes('### Project Rules'));
		t.truthy(merged.includes('### Additional Instructions'));

		// Verify content is included
		t.truthy(merged.includes('Coding Standards'));
		t.truthy(merged.includes('TypeScript'));

		// Verify example-only content is filtered
		t.false(merged.includes('example only'));

		// Verify key paragraphs from guidelines are extracted
		t.truthy(merged.includes('important rules'));
		t.truthy(merged.includes('security'));
	} finally {
		cleanupTestProject(testDir);
	}
});

test('extractExistingRules - skips AGENTS.md when skipAgentsMd is true', t => {
	const testDir = createTestProject('skip-agents-md');

	try {
		// Create AGENTS.md and other config files
		writeFileSync(
			join(testDir, 'AGENTS.md'),
			`# AGENTS.md

## Coding Standards

Always use TypeScript.

Testing is required.`,
		);

		writeFileSync(
			join(testDir, 'CLAUDE.md'),
			`# CLAUDE.md

## Important Rules

Follow project conventions strictly.`,
		);

		// Extract with skipAgentsMd = true
		const extractor = new ExistingRulesExtractor(testDir, true);
		const rules = extractor.extractExistingRules();

		// Should NOT find AGENTS.md, but should find CLAUDE.md
		t.is(rules.length, 1);
		t.false(rules.some(r => r.source === 'AGENTS.md'));
		t.truthy(rules.some(r => r.source === 'CLAUDE.md'));

		// Extract with skipAgentsMd = false (default)
		const extractor2 = new ExistingRulesExtractor(testDir, false);
		const rules2 = extractor2.extractExistingRules();

		// Should find both files
		t.is(rules2.length, 2);
		t.truthy(rules2.some(r => r.source === 'AGENTS.md'));
		t.truthy(rules2.some(r => r.source === 'CLAUDE.md'));

		// Extract with skipAgentsMd not specified (default)
		const extractor3 = new ExistingRulesExtractor(testDir);
		const rules3 = extractor3.extractExistingRules();

		// Should find both files (default is false)
		t.is(rules3.length, 2);
		t.truthy(rules3.some(r => r.source === 'AGENTS.md'));
		t.truthy(rules3.some(r => r.source === 'CLAUDE.md'));
	} finally {
		cleanupTestProject(testDir);
	}
});

test('extractExistingRules - excludeSources skips named files (lean mode)', t => {
	const testDir = createTestProject('exclude-claude');

	try {
		writeFileSync(
			join(testDir, 'AGENTS.md'),
			`# AGENTS.md

## Coding Standards

Always use TypeScript. Testing is required for all features.`,
		);

		writeFileSync(
			join(testDir, 'CLAUDE.md'),
			`# CLAUDE.md

## Important Rules

Follow project conventions strictly. Always test changes.`,
		);

		// Lean mode: exclude CLAUDE.md
		const extractor = new ExistingRulesExtractor(testDir, false, ['CLAUDE.md']);
		const rules = extractor.extractExistingRules();

		t.false(rules.some(r => r.source === 'CLAUDE.md'));
		t.truthy(rules.some(r => r.source === 'AGENTS.md'));

		// Without exclusion, both should be found
		const baseline = new ExistingRulesExtractor(testDir).extractExistingRules();
		t.truthy(baseline.some(r => r.source === 'CLAUDE.md'));
		t.truthy(baseline.some(r => r.source === 'AGENTS.md'));
	} finally {
		cleanupTestProject(testDir);
	}
});

test('extractExistingRules - excludeSources is case-insensitive', t => {
	const testDir = createTestProject('exclude-claude-lowercase');

	try {
		writeFileSync(
			join(testDir, 'CLAUDE.md'),
			`# CLAUDE.md

## Rules

Always use TypeScript. Always run tests.`,
		);

		// Lower-case in excludeSources should still match CLAUDE.md
		const extractor = new ExistingRulesExtractor(testDir, false, ['claude.md']);
		const rules = extractor.extractExistingRules();

		t.is(rules.length, 0);
	} finally {
		cleanupTestProject(testDir);
	}
});
