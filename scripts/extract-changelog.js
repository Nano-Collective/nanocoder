#!/usr/bin/env node

/**
 * Extract changelog section for a specific version from CHANGELOG.md
 * Usage: node scripts/extract-changelog.js [version]
 * If no version is provided, reads from package.json
 */

import {readFileSync} from 'fs';
import {dirname, join} from 'path';
import {fileURLToPath} from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rootDir = join(__dirname, '..');

// Get version from command line arg or package.json
let version = process.argv[2];
if (!version) {
	const packageJson = JSON.parse(
		readFileSync(join(rootDir, 'package.json'), 'utf-8'),
	);
	version = packageJson.version;
}

// Read CHANGELOG.md
let changelogContent;
try {
	changelogContent = readFileSync(join(rootDir, 'CHANGELOG.md'), 'utf-8');
} catch (error) {
	console.error('Error reading CHANGELOG.md:', error.message);
	process.exit(1);
}

// Extract section for this version
// Support multiple formats:
// 1. ## [version] - date (Keep a Changelog format)
// 2. ## version (simple heading)
// 3. # version (simple heading with single #)
const versionPatterns = [
	// Pattern 1: ## [version] or ## version
	new RegExp(
		`##+ \\[?${version.replace(
			/\./g,
			'\\.',
		)}\\]?.*?\\n([\\s\\S]*?)(?=\\n##+ |$)`,
	),
	// Pattern 2: # version
	new RegExp(
		`#+ ${version.replace(/\./g, '\\.')}.*?\\n([\\s\\S]*?)(?=\\n#+ |$)`,
	),
];

let match = null;
for (const pattern of versionPatterns) {
	match = changelogContent.match(pattern);
	if (match) break;
}

if (!match) {
	console.error(`No changelog entry found for version ${version}`);
	console.error(
		'Please add a changelog entry in CHANGELOG.md with one of these formats:',
	);
	console.error(`## [${version}] - ${new Date().toISOString().split('T')[0]}`);
	console.error(`or`);
	console.error(`# ${version}`);
	process.exit(1);
}

// Output the changelog section (trim leading/trailing whitespace)
const changelogSection = match[1].trim();
console.log(changelogSection);
