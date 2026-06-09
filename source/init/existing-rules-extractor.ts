import {existsSync, readFileSync} from 'fs';
import {join} from 'path';

export interface ExistingRules {
	source: string;
	content: string;
	type: 'agents' | 'rules' | 'instructions';
}

export class ExistingRulesExtractor {
	private static readonly AI_CONFIG_FILES = [
		// AI agent specific files
		'AGENTS.md',
		'AGENT.md',
		'CLAUDE.md',
		'GEMINI.md',
		'CURSOR.md',

		// Rules files in various directories
		'.cursor/rules',
		'.clinerules/rules',
		'.roorules/rules',

		// Alternative locations
		'.ai/rules',
		'.ai/instructions',
		'ai-instructions.md',
		'coding-guidelines.md',
		'dev-guidelines.md',
	];

	constructor(
		private projectPath: string,
		private skipAgentsMd = false,
		// Additional source filenames to skip (e.g. ['CLAUDE.md'] for "lean" mode).
		// Compared case-insensitively against the AI_CONFIG_FILES entries.
		private excludeSources: readonly string[] = [],
	) {}

	/**
	 * Find and extract content from existing AI configuration files
	 */
	public extractExistingRules(): ExistingRules[] {
		const found: ExistingRules[] = [];
		const excludeSet = new Set(this.excludeSources.map(s => s.toLowerCase()));

		for (const configFile of ExistingRulesExtractor.AI_CONFIG_FILES) {
			// Skip AGENTS.md when force regenerating
			if (this.skipAgentsMd && configFile === 'AGENTS.md') {
				continue;
			}

			// Skip explicitly excluded sources (e.g. CLAUDE.md in lean mode)
			if (excludeSet.has(configFile.toLowerCase())) {
				continue;
			}

			const filePath = join(this.projectPath, configFile);

			if (existsSync(filePath)) {
				try {
					const content = readFileSync(filePath, 'utf-8');
					const cleanContent = this.cleanAndExtractRelevantContent(
						content,
						configFile,
					);

					if (cleanContent.trim()) {
						found.push({
							source: configFile,
							content: cleanContent,
							type: this.determineFileType(configFile),
						});
					}
				} catch {
					// Skip files we can't read
					continue;
				}
			}
		}

		return found;
	}

	/**
	 * Clean content and extract only AI-relevant information
	 */
	private cleanAndExtractRelevantContent(
		content: string,
		filename: string,
	): string {
		// Remove excessive markdown formatting but keep structure
		let cleaned = content;

		// Remove multiple consecutive empty lines
		cleaned = cleaned.replace(/\n\s*\n\s*\n/g, '\n\n');

		// Remove excessive header decoration
		cleaned = cleaned.replace(/#{4,}/g, '###');

		// For specific file types, extract relevant sections
		if (
			filename.toLowerCase().includes('claude') ||
			filename.toLowerCase().includes('agents')
		) {
			return this.extractAIAgentSections(cleaned);
		}

		if (filename.includes('rules')) {
			return this.extractRulesSections(cleaned);
		}

		// For generic files, extract key sections
		return this.extractGeneralInstructions(cleaned);
	}

	/**
	 * Extract AI agent specific sections
	 */
	private extractAIAgentSections(content: string): string {
		const relevantSections: string[] = [];
		const lines = content.split('\n');
		let currentSection = '';
		let inRelevantSection = false;
		let sectionHeader = '';

		const relevantHeaders = [
			'coding',
			'style',
			'convention',
			'pattern',
			'architecture',
			'testing',
			'security',
			'performance',
			'build',
			'deployment',
			'project',
			'structure',
			'guidelines',
			'rules',
			'instructions',
			'important',
			'note',
			'requirement',
			'constraint',
		];

		for (const line of lines) {
			const trimmed = line.trim().toLowerCase();

			// Check if this is a header
			if (line.match(/^#+\s/) || line.match(/^[=-]{3,}$/)) {
				// Save previous section if it was relevant
				if (inRelevantSection && currentSection.trim()) {
					relevantSections.push(sectionHeader + '\n' + currentSection.trim());
				}

				// Check if new section is relevant
				inRelevantSection = relevantHeaders.some(keyword =>
					trimmed.includes(keyword),
				);
				sectionHeader = line;
				currentSection = '';
			} else if (inRelevantSection) {
				currentSection += line + '\n';
			}
		}

		// Don't forget the last section
		if (inRelevantSection && currentSection.trim()) {
			relevantSections.push(sectionHeader + '\n' + currentSection.trim());
		}

		// If no specific sections found, extract key paragraphs
		if (relevantSections.length === 0) {
			return this.extractKeyParagraphs(content);
		}

		return relevantSections.join('\n\n');
	}

	/**
	 * Extract rules file content
	 */
	private extractRulesSections(content: string): string {
		// Rules files are typically more concise, keep most content
		const lines = content.split('\n');
		const filtered = lines.filter(line => {
			const trimmed = line.trim();
			// Skip very generic lines
			if (trimmed.length < 10) return true; // Keep short lines for structure
			if (trimmed.includes('example') && trimmed.includes('only')) return false;
			if (trimmed.includes('this is just') && trimmed.includes('example'))
				return false;
			return true;
		});

		return filtered.join('\n');
	}

	/**
	 * Extract general instructions from any file
	 */
	private extractGeneralInstructions(content: string): string {
		return this.extractKeyParagraphs(content);
	}

	/**
	 * Extract key paragraphs based on content analysis
	 */
	private extractKeyParagraphs(content: string): string {
		const paragraphs = content.split('\n\n').filter(p => p.trim().length > 50);
		const keyParagraphs: string[] = [];

		const importantKeywords = [
			'must',
			'should',
			'always',
			'never',
			'important',
			'critical',
			'required',
			'mandatory',
			'essential',
			'convention',
			'pattern',
			'style',
			'format',
			'structure',
			'architecture',
			'test',
			'security',
		];

		for (const paragraph of paragraphs) {
			const lowerParagraph = paragraph.toLowerCase();
			const relevanceScore = importantKeywords.reduce((score, keyword) => {
				return score + (lowerParagraph.includes(keyword) ? 1 : 0);
			}, 0);

			// Include paragraphs with at least 2 important keywords
			if (relevanceScore >= 2) {
				keyParagraphs.push(paragraph.trim());
			}
		}

		// If we didn't find enough relevant content, take first few paragraphs
		if (keyParagraphs.length === 0 && paragraphs.length > 0) {
			return paragraphs.slice(0, 3).join('\n\n');
		}

		return keyParagraphs.slice(0, 5).join('\n\n'); // Limit to 5 paragraphs max
	}

	/**
	 * Determine the type of configuration file
	 */
	private determineFileType(
		filename: string,
	): 'agents' | 'rules' | 'instructions' {
		const lower = filename.toLowerCase();

		if (
			lower.includes('agent') ||
			lower.includes('claude') ||
			lower.includes('gemini')
		) {
			return 'agents';
		}

		if (
			lower.includes('rule') ||
			lower.includes('.cursor/') ||
			lower.includes('.clinerules/')
		) {
			return 'rules';
		}

		return 'instructions';
	}

	/**
	 * Merge existing rules into a single consolidated section
	 */
	public static mergeExistingRules(existingRules: ExistingRules[]): string {
		if (existingRules.length === 0) {
			return '';
		}

		const sections: string[] = [];
		sections.push('## Existing Project Guidelines');
		sections.push('');
		sections.push(
			'*The following guidelines were found in existing AI configuration files:*',
		);
		sections.push('');

		// Group by type
		const agentRules = existingRules.filter(r => r.type === 'agents');
		const ruleFiles = existingRules.filter(r => r.type === 'rules');
		const instructions = existingRules.filter(r => r.type === 'instructions');

		// Add agent-specific rules
		if (agentRules.length > 0) {
			sections.push('### AI Agent Guidelines');
			for (const rule of agentRules) {
				sections.push(`**From ${rule.source}:**`);
				sections.push(rule.content);
				sections.push('');
			}
		}

		// Add rule files
		if (ruleFiles.length > 0) {
			sections.push('### Project Rules');
			for (const rule of ruleFiles) {
				sections.push(`**From ${rule.source}:**`);
				sections.push(rule.content);
				sections.push('');
			}
		}

		// Add general instructions
		if (instructions.length > 0) {
			sections.push('### Additional Instructions');
			for (const rule of instructions) {
				sections.push(`**From ${rule.source}:**`);
				sections.push(rule.content);
				sections.push('');
			}
		}

		return sections.join('\n');
	}
}
