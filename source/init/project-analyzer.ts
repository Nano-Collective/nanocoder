import {existsSync, readFileSync} from 'fs';
import {basename, join} from 'path';
import {FileScanner} from './file-scanner';
import {FrameworkDetector, ProjectDependencies} from './framework-detector';
import {DetectedLanguages, LanguageDetector} from './language-detector';

export interface ProjectAnalysis {
	projectPath: string;
	projectName: string;
	languages: DetectedLanguages;
	dependencies: ProjectDependencies;
	projectType: string;
	keyFiles: {
		config: string[];
		documentation: string[];
		build: string[];
		test: string[];
		[key: string]: string[];
	};
	structure: {
		totalFiles: number;
		scannedFiles: number;
		directories: string[];
		importantDirectories: string[];
	};
	buildCommands: {[key: string]: string};
	description?: string;
	repository?: string;
}

export class ProjectAnalyzer {
	private fileScanner: FileScanner;
	private frameworkDetector: FrameworkDetector;

	constructor(private projectPath: string) {
		this.fileScanner = new FileScanner(projectPath);
		this.frameworkDetector = new FrameworkDetector(projectPath);
	}

	/**
	 * Perform comprehensive project analysis
	 */
	public analyze(): ProjectAnalysis {
		// Scan files
		const scanResult = this.fileScanner.scan();
		const keyFiles = this.fileScanner.getProjectFiles() as {
			config: string[];
			documentation: string[];
			build: string[];
			test: string[];
			[key: string]: string[];
		};

		// Detect languages
		const codeFiles = scanResult.files.filter(
			file => this.isCodeFile(file) && !this.isTestFile(file),
		);
		const languages = LanguageDetector.detectLanguages(codeFiles);

		// Detect frameworks and dependencies
		const dependencies = this.frameworkDetector.detectDependencies();

		// Analyze project structure
		const importantDirectories = this.getImportantDirectories(
			scanResult.directories,
		);

		// Get build commands
		const buildCommands = this.frameworkDetector.getBuildCommands();

		// Extract project metadata
		const {projectName, description, repository} =
			this.extractProjectMetadata();

		// Determine project type
		const projectType = this.determineProjectType(languages, dependencies);

		return {
			projectPath: this.projectPath,
			projectName,
			languages,
			dependencies,
			projectType,
			keyFiles,
			structure: {
				totalFiles: scanResult.totalFiles,
				scannedFiles: scanResult.scannedFiles,
				directories: scanResult.directories,
				importantDirectories,
			},
			buildCommands,
			description,
			repository,
		};
	}

	/**
	 * Check if a file is a code file
	 */
	private isCodeFile(file: string): boolean {
		const codeExtensions = [
			'.js',
			'.jsx',
			'.ts',
			'.tsx',
			'.py',
			'.rs',
			'.go',
			'.java',
			'.kt',
			'.c',
			'.cpp',
			'.h',
			'.hpp',
			'.cs',
			'.php',
			'.rb',
			'.swift',
			'.dart',
			'.vue',
			'.svelte',
		];

		const ext = file.substring(file.lastIndexOf('.'));
		return codeExtensions.includes(ext);
	}

	/**
	 * Check if a file is a test file
	 */
	private isTestFile(file: string): boolean {
		const fileName = basename(file).toLowerCase();
		return (
			fileName.includes('test') ||
			fileName.includes('spec') ||
			file.includes('__tests__') ||
			file.includes('/test/') ||
			file.includes('/tests/') ||
			file.includes('/spec/')
		);
	}

	/**
	 * Get important directories based on common patterns
	 */
	private getImportantDirectories(directories: string[]): string[] {
		const important = new Set<string>();

		const sourcePatterns = [
			'src',
			'source',
			'app',
			'lib',
			'libs',
			'components',
			'pages',
			'views',
			'routes',
			'api',
			'server',
			'backend',
			'frontend',
			'models',
			'controllers',
			'services',
			'utils',
			'config',
			'configs',
			'settings',
			'assets',
			'static',
			'public',
			'docs',
			'documentation',
		];

		const testPatterns = ['test', 'tests', '__tests__', 'spec'];

		// First pass: Add all source directories
		for (const dir of directories) {
			const dirName = basename(dir).toLowerCase();
			const dirParts = dir.split('/');

			// Check if this is a source directory (not inside test directories)
			const isInTestDir = dirParts.some(part =>
				testPatterns.includes(part.toLowerCase()),
			);

			if (!isInTestDir) {
				// Add if directory name matches source patterns
				if (sourcePatterns.includes(dirName)) {
					important.add(dir);
				}

				// Add if any part of the path matches source patterns (e.g., "src/components")
				if (
					dirParts.some(part => sourcePatterns.includes(part.toLowerCase()))
				) {
					important.add(dir);
				}
			}
		}

		// Second pass: Add test directories only if we don't have many source directories
		if (important.size < 5) {
			for (const dir of directories) {
				const dirName = basename(dir).toLowerCase();
				const dirParts = dir.split('/');

				// Check if this is a test directory
				const isTestDir =
					testPatterns.includes(dirName) ||
					dirParts.some(part => testPatterns.includes(part.toLowerCase()));

				if (isTestDir) {
					// Only add test directories that contain meaningful structure
					if (
						dirParts.length > 1 ||
						directories.filter(d => d.startsWith(dir)).length > 1
					) {
						important.add(dir);
					}
				}
			}
		}

		// Sort with source directories first, then by depth (fewer levels first), then alphabetically
		return Array.from(important).sort((a, b) => {
			const aIsTest = testPatterns.some(pattern => a.includes(pattern));
			const bIsTest = testPatterns.some(pattern => b.includes(pattern));

			// Source directories first
			if (aIsTest !== bIsTest) {
				return aIsTest ? 1 : -1;
			}

			// Then by depth (fewer levels first for better overview)
			const aDepth = a.split('/').length;
			const bDepth = b.split('/').length;
			if (aDepth !== bDepth) {
				return aDepth - bDepth;
			}

			// Finally alphabetically
			return a.localeCompare(b);
		});
	}

	/**
	 * Extract project metadata from package.json, README, etc.
	 */
	private extractProjectMetadata(): {
		projectName: string;
		description?: string;
		repository?: string;
	} {
		const defaultName = basename(this.projectPath);
		let projectName = defaultName;
		let description: string | undefined;
		let repository: string | undefined;

		// Try package.json first
		const packageJsonPath = join(this.projectPath, 'package.json');
		if (existsSync(packageJsonPath)) {
			try {
				const content = readFileSync(packageJsonPath, 'utf-8');
				const pkg = JSON.parse(content) as {
					name?: string;
					description?: string;
					repository?: string | {url?: string};
				};

				if (pkg.name) projectName = pkg.name;
				if (pkg.description) description = pkg.description;
				if (pkg.repository) {
					if (typeof pkg.repository === 'string') {
						repository = pkg.repository;
					} else if (pkg.repository.url) {
						repository = pkg.repository.url;
					}
				}
			} catch {
				// Ignore parsing errors
			}
		}

		// Try Cargo.toml for Rust projects
		if (!description) {
			const cargoPath = join(this.projectPath, 'Cargo.toml');
			if (existsSync(cargoPath)) {
				try {
					const content = readFileSync(cargoPath, 'utf-8');
					const nameMatch = content.match(/^name\s*=\s*"([^"]+)"/m);
					const descMatch = content.match(/^description\s*=\s*"([^"]+)"/m);

					if (nameMatch) projectName = nameMatch[1];
					if (descMatch) description = descMatch[1];
				} catch {
					// Ignore parsing errors
				}
			}
		}

		// Try to extract description from README
		if (!description) {
			const readmeFiles = ['README.md', 'README.rst', 'README.txt', 'README'];
			for (const readmeFile of readmeFiles) {
				const readmePath = join(this.projectPath, readmeFile);
				if (existsSync(readmePath)) {
					try {
						const content = readFileSync(readmePath, 'utf-8');
						const lines = content.split('\n').filter(line => line.trim());

						// Look for the first non-title line as description
						for (const line of lines.slice(1)) {
							if (
								line.trim() &&
								!line.startsWith('#') &&
								!line.startsWith('!')
							) {
								description = line.trim();
								break;
							}
						}
						break;
					} catch {
						// Ignore parsing errors
					}
				}
			}
		}

		return {projectName, description, repository};
	}

	/**
	 * Determine the overall project type
	 */
	private determineProjectType(
		languages: DetectedLanguages,
		dependencies: ProjectDependencies,
	): string {
		interface Framework {
			category:
				| 'web'
				| 'mobile'
				| 'desktop'
				| 'backend'
				| 'testing'
				| 'build'
				| 'other';
			name: string;
			confidence: 'high' | 'medium' | 'low';
		}

		// Use framework-based detection first
		const webFrameworks = dependencies.frameworks.filter(
			(f): f is Framework => (f as Framework).category === 'web',
		);
		const backendFrameworks = dependencies.frameworks.filter(
			(f): f is Framework => (f as Framework).category === 'backend',
		);
		const mobileFrameworks = dependencies.frameworks.filter(
			(f): f is Framework => (f as Framework).category === 'mobile',
		);
		const desktopFrameworks = dependencies.frameworks.filter(
			(f): f is Framework => (f as Framework).category === 'desktop',
		);

		if (mobileFrameworks.length > 0) {
			return `${mobileFrameworks[0].name} Mobile Application`;
		}

		if (desktopFrameworks.length > 0) {
			return `${desktopFrameworks[0].name} Desktop Application`;
		}

		if (webFrameworks.length > 0 && backendFrameworks.length > 0) {
			return `Full Stack Web Application (${webFrameworks[0].name} + ${backendFrameworks[0].name})`;
		}

		if (webFrameworks.length > 0) {
			return `${webFrameworks[0].name} Web Application`;
		}

		if (backendFrameworks.length > 0) {
			return `${backendFrameworks[0].name} Backend Application`;
		}

		// Fall back to language-based detection
		return LanguageDetector.suggestProjectType(languages);
	}

	/**
	 * Get coding conventions based on detected languages and frameworks
	 */
	public getCodingConventions(): string[] {
		const analysis = this.analyze();
		const conventions: string[] = [];

		// Language-specific conventions
		if (analysis.languages.primary) {
			const lang = analysis.languages.primary.name;

			switch (lang) {
				case 'JavaScript':
				case 'TypeScript':
					conventions.push('Use camelCase for variables and functions');
					conventions.push('Use PascalCase for classes and components');
					conventions.push('Use const/let instead of var');
					if (
						analysis.dependencies.frameworks.some((f: unknown) =>
							(f as {name: string}).name.includes('React'),
						)
					) {
						conventions.push('Use functional components with hooks');
						conventions.push('Follow React naming conventions');
					}
					break;

				case 'Python':
					conventions.push('Follow PEP 8 style guide');
					conventions.push('Use snake_case for variables and functions');
					conventions.push('Use PascalCase for classes');
					conventions.push('Include type hints where appropriate');
					break;

				case 'Rust':
					conventions.push('Follow Rust naming conventions (snake_case)');
					conventions.push('Use cargo fmt for formatting');
					conventions.push('Handle errors explicitly with Result<T, E>');
					break;

				case 'Go':
					conventions.push('Follow Go naming conventions');
					conventions.push('Use gofmt for formatting');
					conventions.push('Handle errors explicitly');
					conventions.push('Use interfaces for abstraction');
					break;
			}
		}

		// Testing conventions
		if (analysis.dependencies.testingFrameworks.length > 0) {
			conventions.push(
				`Write tests using ${analysis.dependencies.testingFrameworks.join(
					', ',
				)}`,
			);
			conventions.push('Maintain good test coverage');
		}

		return conventions;
	}
}
