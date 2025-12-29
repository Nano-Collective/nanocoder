/**
 * Map of file extensions to human-readable language/format names.
 * Used for displaying file type information to users.
 */
const FILE_TYPE_MAP: Record<string, string> = {
	// TypeScript/JavaScript
	ts: 'TypeScript',
	tsx: 'TypeScript React',
	js: 'JavaScript',
	jsx: 'JavaScript React',
	mjs: 'JavaScript Module',
	cjs: 'CommonJS',

	// Other languages
	py: 'Python',
	go: 'Go',
	rs: 'Rust',
	java: 'Java',
	kt: 'Kotlin',
	cpp: 'C++',
	c: 'C',
	h: 'C Header',
	hpp: 'C++ Header',
	cs: 'C#',
	rb: 'Ruby',
	php: 'PHP',
	swift: 'Swift',

	// Markup/Data
	md: 'Markdown',
	json: 'JSON',
	yaml: 'YAML',
	yml: 'YAML',
	toml: 'TOML',
	xml: 'XML',
	html: 'HTML',
	htm: 'HTML',

	// Styles
	css: 'CSS',
	scss: 'SCSS',
	sass: 'Sass',
	less: 'Less',

	// Shell/Scripts
	sh: 'Shell',
	bash: 'Bash',
	zsh: 'Zsh',
	fish: 'Fish',
	ps1: 'PowerShell',

	// Other
	txt: 'Text',
	svg: 'SVG',
	sql: 'SQL',
	graphql: 'GraphQL',
	proto: 'Protocol Buffers',
	dockerfile: 'Dockerfile',
};

/**
 * Get the human-readable file type from a file path or extension.
 *
 * @param pathOrExtension - File path (e.g., "src/app.tsx") or extension (e.g., "tsx")
 * @returns Human-readable type name (e.g., "TypeScript React") or uppercase extension if unknown
 */
export function getFileType(pathOrExtension: string): string {
	// Extract extension from path if needed
	const ext = pathOrExtension.includes('.')
		? pathOrExtension.split('.').pop()?.toLowerCase() || ''
		: pathOrExtension.toLowerCase();

	return FILE_TYPE_MAP[ext] || (ext ? ext.toUpperCase() : 'Unknown');
}

/**
 * Export the raw map for cases where direct lookup is needed
 */
export {FILE_TYPE_MAP};
