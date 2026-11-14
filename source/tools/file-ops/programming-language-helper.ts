export function getLanguageFromExtension(ext?: string): string {
	const languageMap: Record<string, string> = {
		js: 'javascript',
		jsx: 'javascript',
		ts: 'typescript',
		tsx: 'typescript',
		py: 'python',
		rb: 'ruby',
		go: 'go',
		rs: 'rust',
		java: 'java',
		cpp: 'cpp',
		c: 'c',
		cs: 'csharp',
		php: 'php',
		html: 'html',
		css: 'css',
		scss: 'scss',
		json: 'json',
		yaml: 'yaml',
		yml: 'yaml',
		xml: 'xml',
		md: 'markdown',
		sh: 'bash',
		bash: 'bash',
		zsh: 'bash',
		fish: 'bash',
		sql: 'sql',
	};

	return languageMap[ext || ''] || 'javascript';
}
