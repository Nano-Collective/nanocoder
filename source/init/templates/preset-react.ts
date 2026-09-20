import type {PresetDefinition} from '@/init/presets';

export const reactPreset = {
	name: 'react',
	description: 'React application defaults and quality checks',
	projectType: 'React Web Application',
	primaryLanguage: 'TypeScript',
	frameworks: [{name: 'React', category: 'web', confidence: 'high'}],
	buildCommands: {
		Development: 'npm run dev',
		Build: 'npm run build',
		Test: 'npm run test',
		Lint: 'npm run lint',
	},
	packageScripts: {
		Development: 'dev',
		Build: 'build',
		Test: 'test',
		Lint: 'lint',
	},
	files: [
		{
			path: '.nanocoderignore',
			content: `# Dependency lockfiles and generated TypeScript metadata
package-lock.json
pnpm-lock.yaml
yarn.lock
*.tsbuildinfo

# Generated test and build artifacts
coverage/
dist/
`,
		},
		{
			path: '.nanocoder/commands/check.md',
			content: `---
description: Run the available React project quality checks
category: quality
---

Inspect package.json and the lockfiles to determine the package manager. Run
the available type-check, lint, test, and build scripts in that order. Do not
invent missing scripts. Report each command and summarize any failures with
the relevant file and line information.
`,
		},
	],
} satisfies PresetDefinition;
