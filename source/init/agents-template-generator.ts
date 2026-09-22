import {THRESHOLD_LARGE_CODEBASE_FILES} from '../constants';
import {
	type ExistingRules,
	ExistingRulesExtractor,
} from './existing-rules-extractor';
import type {ProjectAnalysis} from './project-analyzer';

export class AgentsTemplateGenerator {
	/**
	 * Generate AGENTS.md content based on project analysis
	 */
	public static generateAgentsMd(
		analysis: ProjectAnalysis,
		existingRules?: ExistingRules[],
	): string {
		const sections: string[] = [];

		// Header
		sections.push('# AGENTS.md');
		sections.push('');
		sections.push(
			`AI coding agent instructions for **${analysis.projectName}**`,
		);
		sections.push('');

		// Project Overview
		sections.push('## Project Overview');
		sections.push('');
		if (analysis.description) {
			sections.push(analysis.description);
			sections.push('');
		}
		sections.push(`**Project Type:** ${analysis.projectType}`);
		if (analysis.languages.primary) {
			sections.push(
				`**Primary Language:** ${analysis.languages.primary.name} (${analysis.languages.primary.percentage}% of codebase)`,
			);
		}
		if (analysis.languages.secondary.length > 0) {
			const secondaryLangs = analysis.languages.secondary
				.map(lang => `${lang.name} (${lang.percentage}%)`)
				.join(', ');
			sections.push(`**Secondary Languages:** ${secondaryLangs}`);
		}
		sections.push('');

		// Architecture Summary
		if (
			analysis.dependencies.frameworks.length > 0 ||
			analysis.structure.importantDirectories.length > 0
		) {
			sections.push('## Architecture');
			sections.push('');

			if (analysis.dependencies.frameworks.length > 0) {
				sections.push('**Key Frameworks & Libraries:**');
				for (const framework of analysis.dependencies.frameworks) {
					const version = framework.version ? ` (${framework.version})` : '';
					sections.push(
						`- ${framework.name}${version} - ${framework.category}`,
					);
				}
				sections.push('');
			}

			if (analysis.structure.importantDirectories.length > 0) {
				sections.push('**Project Structure:**');
				for (const dir of analysis.structure.importantDirectories.slice(
					0,
					20,
				)) {
					sections.push(`- \`${dir}/\` - ${this.getDirectoryDescription(dir)}`);
				}
				sections.push('');
			}
		}

		// Key Files
		if (Object.values(analysis.keyFiles).some(files => files.length > 0)) {
			sections.push('## Key Files');
			sections.push('');

			if (analysis.keyFiles.config.length > 0) {
				sections.push('**Configuration:**');
				analysis.keyFiles.config.slice(0, 5).forEach(file => {
					sections.push(`- \`${file}\` - ${this.getFileDescription(file)}`);
				});
				sections.push('');
			}

			if (analysis.keyFiles.documentation.length > 0) {
				sections.push('**Documentation:**');
				analysis.keyFiles.documentation.slice(0, 3).forEach(file => {
					sections.push(`- \`${file}\``);
				});
				sections.push('');
			}
		}

		// Build and Test Commands
		if (Object.keys(analysis.buildCommands).length > 0) {
			sections.push('## Development Commands');
			sections.push('');

			for (const [action, command] of Object.entries(analysis.buildCommands)) {
				sections.push(`**${action}:**`);
				sections.push('```bash');
				sections.push(command);
				sections.push('```');
				sections.push('');
			}
		}

		// Code Style Guidelines
		const conventions = this.getCodingConventions(analysis);
		if (conventions.length > 0) {
			sections.push('## Code Style Guidelines');
			sections.push('');

			for (const convention of conventions) {
				sections.push(`- ${convention}`);
			}
			sections.push('');
		}

		// Testing Instructions
		if (
			analysis.dependencies.testingFrameworks.length > 0 ||
			analysis.keyFiles.test.length > 0
		) {
			sections.push('## Testing');
			sections.push('');

			if (analysis.dependencies.testingFrameworks.length > 0) {
				sections.push(
					`**Testing Frameworks:** ${analysis.dependencies.testingFrameworks.join(
						', ',
					)}`,
				);
				sections.push('');
			}

			if (analysis.buildCommands.Test) {
				sections.push('**Run Tests:**');
				sections.push('```bash');
				sections.push(analysis.buildCommands.Test);
				sections.push('```');
				sections.push('');
			}

			if (analysis.keyFiles.test.length > 0) {
				sections.push('**Test Files:**');
				analysis.keyFiles.test.slice(0, 5).forEach(file => {
					sections.push(`- \`${file}\``);
				});
				sections.push('');
			}
		}

		// Existing AI rules and guidelines
		if (existingRules && existingRules.length > 0) {
			const mergedRules =
				ExistingRulesExtractor.mergeExistingRules(existingRules);
			if (mergedRules.trim()) {
				sections.push(mergedRules);
				sections.push('');
			}
		}

		// Special Considerations for AI
		sections.push('## AI Coding Assistance Notes');
		sections.push('');
		sections.push('**Important Considerations:**');

		// Language-specific notes
		if (analysis.languages.primary) {
			const langNotes = this.getLanguageSpecificNotes(
				analysis.languages.primary.name,
			);
			langNotes.forEach(note => sections.push(`- ${note}`));
		}

		// Framework-specific notes
		for (const framework of analysis.dependencies.frameworks.slice(0, 3)) {
			const frameworkNotes = this.getFrameworkSpecificNotes(framework.name);
			frameworkNotes.forEach(note => sections.push(`- ${note}`));
		}

		// General notes
		sections.push(
			`- Project has ${analysis.structure.scannedFiles} files across ${analysis.structure.directories.length} directories`,
		);
		if (analysis.structure.scannedFiles >= THRESHOLD_LARGE_CODEBASE_FILES) {
			sections.push(
				'- Large codebase: Focus on specific areas when making changes',
			);
		}
		if (analysis.keyFiles.build.length > 0) {
			sections.push(
				'- Check build configuration files before making structural changes',
			);
		}
		sections.push('');

		// Repository info
		if (analysis.repository) {
			sections.push('## Repository');
			sections.push('');
			sections.push(`**Source:** ${analysis.repository}`);
			sections.push('');
		}

		// Footer
		sections.push('---');
		sections.push('');
		sections.push(
			'*This AGENTS.md file was generated by Nanocoder. Update it as your project evolves.*',
		);

		return sections.join('\n');
	}

	/**
	 * Get description for a directory based on its name
	 */
	private static getDirectoryDescription(dir: string): string {
		const dirName = dir.split('/').pop()?.toLowerCase() || '';

		const descriptions: {[key: string]: string} = {
			src: 'Source code',
			source: 'Source code',
			app: 'Application code',
			lib: 'Library code',
			libs: 'Libraries',
			components: 'React/UI components',
			pages: 'Page components',
			views: 'View components',
			routes: 'Routing logic',
			api: 'API endpoints',
			server: 'Server code',
			backend: 'Backend code',
			frontend: 'Frontend code',
			models: 'Data models',
			controllers: 'Controllers',
			services: 'Service layer',
			utils: 'Utility functions',
			config: 'Configuration files',
			configs: 'Configuration files',
			settings: 'Settings',
			assets: 'Static assets',
			static: 'Static files',
			public: 'Public assets',
			docs: 'Documentation',
			documentation: 'Documentation',
			test: 'Test files',
			tests: 'Test files',
			__tests__: 'Test files',
			spec: 'Test specifications',
		};

		return descriptions[dirName] || 'Project files';
	}

	/**
	 * Get description for a file based on its name
	 */
	private static getFileDescription(file: string): string {
		const fileName = file.toLowerCase();

		if (fileName.includes('package.json'))
			return 'Node.js dependencies and scripts';
		if (fileName.includes('cargo.toml')) return 'Rust package configuration';
		if (fileName.includes('go.mod')) return 'Go module dependencies';
		if (fileName.includes('requirements.txt')) return 'Python dependencies';
		if (fileName.includes('tsconfig.json')) return 'TypeScript configuration';
		if (fileName.includes('webpack')) return 'Webpack build configuration';
		if (fileName.includes('vite')) return 'Vite build configuration';
		if (fileName.includes('rollup')) return 'Rollup build configuration';
		if (fileName.includes('docker')) return 'Docker configuration';
		if (fileName.includes('makefile')) return 'Build automation';

		return 'Configuration file';
	}

	/**
	 * Get coding conventions based on project analysis
	 */
	private static getCodingConventions(analysis: ProjectAnalysis): string[] {
		const conventions: string[] = [];

		if (analysis.languages.primary) {
			const lang = analysis.languages.primary.name;

			switch (lang) {
				case 'JavaScript':
				case 'TypeScript':
					conventions.push('Use camelCase for variables and functions');
					conventions.push('Use PascalCase for classes and components');
					conventions.push('Prefer const/let over var');
					conventions.push('Use async/await over callbacks when possible');
					if (
						analysis.dependencies.frameworks.some((f: {name: string}) =>
							f.name.includes('React'),
						)
					) {
						conventions.push('Use functional components with hooks');
						conventions.push('Follow React naming conventions for components');
					}
					break;

				case 'Python':
					conventions.push('Follow PEP 8 style guide');
					conventions.push('Use snake_case for variables and functions');
					conventions.push('Use PascalCase for classes');
					conventions.push('Include docstrings for functions and classes');
					conventions.push('Use type hints where appropriate');
					break;

				case 'Rust':
					conventions.push('Follow Rust naming conventions (snake_case)');
					conventions.push('Use cargo fmt for code formatting');
					conventions.push('Handle errors explicitly with Result<T, E>');
					conventions.push('Prefer owned types over references when possible');
					break;

				case 'Go':
					conventions.push('Follow Go naming conventions');
					conventions.push('Use gofmt for formatting');
					conventions.push('Handle errors explicitly');
					conventions.push('Use interfaces for abstraction');
					conventions.push('Keep functions and methods concise');
					break;

				case 'Java':
					conventions.push('Follow Java naming conventions');
					conventions.push('Use camelCase for methods and variables');
					conventions.push('Use PascalCase for classes');
					conventions.push('Include JavaDoc for public methods');
					break;
			}
		}

		return conventions;
	}

	/**
	 * Get language-specific notes for AI assistance
	 */
	private static getLanguageSpecificNotes(language: string): string[] {
		switch (language) {
			case 'JavaScript':
			case 'TypeScript':
				return [
					'Check package.json for available scripts before running commands',
					'Be aware of Node.js version requirements',
					'Consider impact on bundle size when adding dependencies',
				];

			case 'Python':
				return [
					'Check virtual environment setup before running commands',
					'Be mindful of Python version compatibility',
					'Follow import organization (stdlib, third-party, local)',
				];

			case 'Rust':
				return [
					'Run cargo check before cargo build for faster feedback',
					'Consider memory safety and ownership when suggesting changes',
					'Use cargo clippy for additional linting',
				];

			case 'Go':
				return [
					'Run go mod tidy after adding dependencies',
					'Consider goroutine usage for concurrent operations',
					'Follow Go idioms for error handling',
				];

			default:
				return [
					'Check project documentation for specific conventions',
					'Test changes thoroughly before committing',
				];
		}
	}

	/**
	 * Get framework-specific notes for AI assistance
	 */
	private static getFrameworkSpecificNotes(framework: string): string[] {
		switch (framework) {
			case 'React':
				return [
					'Follow React hooks best practices',
					'Consider component reusability when creating new components',
				];

			case 'Next.js':
				return [
					'Be aware of SSR/SSG implications when making changes',
					'Check routing structure before adding new pages',
				];

			case 'Django':
				return [
					'Run migrations after model changes',
					'Follow Django project structure conventions',
				];

			case 'Express.js':
				return [
					'Consider middleware order when adding new routes',
					'Use proper error handling middleware',
				];

			default:
				return [];
		}
	}
}
