import type {PresetDefinition} from '@/init/presets';

export const nextjsPreset = {
	name: 'nextjs',
	description: 'Next.js application defaults and quality checks',
	projectType: 'Next.js Web Application',
	primaryLanguage: 'TypeScript',
	frameworks: [
		{name: 'Next.js', category: 'web', confidence: 'high'},
		{name: 'React', category: 'web', confidence: 'high'},
	],
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
			content: `# Dependency lockfiles and generated framework metadata
package-lock.json
pnpm-lock.yaml
yarn.lock
next-env.d.ts
*.tsbuildinfo

# Next.js and test output
.next/
out/
coverage/
`,
		},
		{
			path: '.nanocoder/commands/check.md',
			content: `---
description: Run the available Next.js project quality checks
category: quality
---

Inspect package.json and the lockfiles to determine the package manager. Run
the available type-check, lint, test, and production build scripts in that
order. Do not invent missing scripts. Pay attention to server/client component
boundaries and report each failure with the relevant file and line information.
`,
		},
	],
} satisfies PresetDefinition;
