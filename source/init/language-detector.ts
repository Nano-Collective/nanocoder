import {basename, extname} from 'path';
import {MAX_SECONDARY_LANGUAGES, MIN_LANGUAGE_PERCENTAGE} from '../constants';

interface LanguageInfo {
	name: string;
	extensions: string[];
	percentage: number;
	files: string[];
}

export interface DetectedLanguages {
	primary: LanguageInfo | null;
	secondary: LanguageInfo[];
	all: LanguageInfo[];
}

export class LanguageDetector {
	private static readonly LANGUAGE_MAP: {[ext: string]: string} = {
		// JavaScript/TypeScript ecosystem
		'.js': 'JavaScript',
		'.jsx': 'JavaScript',
		'.ts': 'TypeScript',
		'.tsx': 'TypeScript',
		'.mjs': 'JavaScript',
		'.cjs': 'JavaScript',

		// Python
		'.py': 'Python',
		'.pyx': 'Python',
		'.pyi': 'Python',
		'.pyc': 'Python',

		// Rust
		'.rs': 'Rust',

		// Go
		'.go': 'Go',

		// Java/Kotlin
		'.java': 'Java',
		'.kt': 'Kotlin',
		'.kts': 'Kotlin',

		// C/C++
		'.c': 'C',
		'.h': 'C',
		'.cpp': 'C++',
		'.cxx': 'C++',
		'.cc': 'C++',
		'.hpp': 'C++',
		'.hxx': 'C++',

		// C#
		'.cs': 'C#',

		// PHP
		'.php': 'PHP',

		// Ruby
		'.rb': 'Ruby',

		// Swift
		'.swift': 'Swift',

		// Dart
		'.dart': 'Dart',

		// Shell
		'.sh': 'Shell',
		'.bash': 'Shell',
		'.zsh': 'Shell',
		'.fish': 'Shell',

		// Web technologies
		'.html': 'HTML',
		'.htm': 'HTML',
		'.css': 'CSS',
		'.scss': 'SCSS',
		'.sass': 'Sass',
		'.less': 'Less',
		'.vue': 'Vue',
		'.svelte': 'Svelte',

		// Config/Data
		'.json': 'JSON',
		'.yaml': 'YAML',
		'.yml': 'YAML',
		'.toml': 'TOML',
		'.xml': 'XML',
		'.ini': 'INI',

		// Documentation
		'.md': 'Markdown',
		'.mdx': 'Markdown',
		'.rst': 'reStructuredText',

		// SQL
		'.sql': 'SQL',

		// Docker
		'.dockerfile': 'Dockerfile',
	};

	/**
	 * Detect languages from file list
	 */
	public static detectLanguages(files: string[]): DetectedLanguages {
		const languageCounts: {[language: string]: string[]} = {};
		const totalFiles = files.length;

		// Count files by language
		for (const file of files) {
			const ext = extname(file).toLowerCase();
			const filename = basename(file).toLowerCase();

			let language: string | undefined;

			// Special case handling
			if (filename === 'dockerfile' || filename.startsWith('dockerfile.')) {
				language = 'Dockerfile';
			} else if (filename === 'makefile') {
				language = 'Makefile';
			} else {
				language = this.LANGUAGE_MAP[ext];
			}

			if (language) {
				if (!languageCounts[language]) {
					languageCounts[language] = [];
				}
				languageCounts[language].push(file);
			}
		}

		// Convert to LanguageInfo array
		const languageInfos: LanguageInfo[] = Object.entries(languageCounts)
			.map(([language, fileList]) => ({
				name: language,
				extensions: this.getExtensionsForLanguage(language),
				percentage: Math.round((fileList.length / totalFiles) * 100),
				files: fileList,
			}))
			.sort((a, b) => b.files.length - a.files.length);

		// Determine primary and secondary languages
		const primary = languageInfos.length > 0 ? languageInfos[0] : null;
		const secondary = languageInfos
			.slice(1)
			.filter(lang => lang.percentage >= MIN_LANGUAGE_PERCENTAGE) // At least MIN_LANGUAGE_PERCENTAGE% of files
			.slice(0, MAX_SECONDARY_LANGUAGES); // Top MAX_SECONDARY_LANGUAGES secondary languages

		return {
			primary,
			secondary,
			all: languageInfos,
		};
	}

	/**
	 * Get file extensions for a given language
	 */
	private static getExtensionsForLanguage(language: string): string[] {
		return Object.entries(this.LANGUAGE_MAP)
			.filter(([_, lang]) => lang === language)
			.map(([ext]) => ext);
	}

	/**
	 * Get language category (for grouping related languages)
	 */
	public static getLanguageCategory(language: string): string {
		const categories: {[category: string]: string[]} = {
			'Web Frontend': [
				'JavaScript',
				'TypeScript',
				'HTML',
				'CSS',
				'SCSS',
				'Sass',
				'Less',
				'Vue',
				'Svelte',
			],
			'Web Backend': ['Node.js', 'PHP', 'Python', 'Ruby', 'Java', 'C#', 'Go'],
			'Systems Programming': ['Rust', 'C', 'C++', 'Go'],
			Mobile: ['Swift', 'Kotlin', 'Dart', 'Java'],
			'Data & Config': ['JSON', 'YAML', 'TOML', 'XML', 'INI', 'SQL'],
			Documentation: ['Markdown', 'reStructuredText'],
			DevOps: ['Shell', 'Dockerfile', 'Makefile'],
		};

		for (const [category, languages] of Object.entries(categories)) {
			if (languages.includes(language)) {
				return category;
			}
		}

		return 'Other';
	}

	/**
	 * Suggest project type based on detected languages
	 */
	public static suggestProjectType(languages: DetectedLanguages): string {
		if (!languages.primary) {
			return 'Unknown';
		}

		const primary = languages.primary.name;
		const hasSecondary = (lang: string) =>
			languages.secondary.some(l => l.name === lang);

		// Web applications
		if (primary === 'JavaScript' || primary === 'TypeScript') {
			if (
				hasSecondary('HTML') ||
				hasSecondary('CSS') ||
				hasSecondary('Vue') ||
				hasSecondary('Svelte')
			) {
				return 'Web Application';
			}
			return 'Node.js Application';
		}

		// Python projects
		if (primary === 'Python') {
			return 'Python Application';
		}

		// Mobile apps
		if (primary === 'Swift') {
			return 'iOS Application';
		}
		if (primary === 'Kotlin' && hasSecondary('XML')) {
			return 'Android Application';
		}
		if (primary === 'Dart') {
			return 'Flutter Application';
		}

		// Systems programming
		if (primary === 'Rust') {
			return 'Rust Application';
		}
		if (primary === 'C' || primary === 'C++') {
			return 'C/C++ Application';
		}
		if (primary === 'Go') {
			return 'Go Application';
		}

		// Other languages
		if (primary === 'Java') {
			return 'Java Application';
		}
		if (primary === 'C#') {
			return 'C# Application';
		}
		if (primary === 'PHP') {
			return 'PHP Application';
		}
		if (primary === 'Ruby') {
			return 'Ruby Application';
		}

		return `${primary} Project`;
	}
}
