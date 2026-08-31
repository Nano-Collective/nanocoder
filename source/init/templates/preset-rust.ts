import type {PresetDefinition} from '@/init/presets';

export const rustPreset = {
	name: 'rust',
	description: 'Rust project defaults and Cargo quality checks',
	projectType: 'Rust Application',
	primaryLanguage: 'Rust',
	frameworks: [],
	buildCommands: {
		Build: 'cargo build',
		Test: 'cargo test',
		Lint: 'cargo clippy --all-targets --all-features',
		Format: 'cargo fmt --check',
		Run: 'cargo run',
	},
	files: [
		{
			path: '.nanocoderignore',
			content: `# Generated Cargo build output
target/

# Generated coverage and profiling data
coverage/
*.profraw
*.profdata
`,
		},
		{
			path: '.nanocoder/commands/check.md',
			content: `---
description: Run the standard Rust project quality checks
aliases: [verify]
category: quality
---

Inspect Cargo.toml and repository instructions, then run cargo fmt --check,
cargo clippy --all-targets --all-features, and cargo test. Add --workspace when
the manifest defines a workspace. Report each command and summarize failures
with the relevant crate, file, and line information.
`,
		},
	],
} satisfies PresetDefinition;
