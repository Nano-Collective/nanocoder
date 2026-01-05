/**
 * LSP Tool Testing Utilities
 *
 * Common helper functions and fixtures for testing LSP tools.
 */

import type {DocumentSymbol, Location, Position, Range} from '@/lsp/protocol';

/**
 * Creates a mock LSP Location for testing
 */
export function createMockLocation(
	uri: string,
	line: number,
	character: number,
): Location {
	return {
		uri: `file://${uri}`,
		range: {
			start: {line, character},
			end: {line, character: character + 5},
		},
	};
}

/**
 * Creates a mock LSP Position for testing
 */
export function createMockPosition(line: number, character: number): Position {
	return {line, character};
}

/**
 * Creates a mock LSP Range for testing
 */
export function createMockRange(
	startLine: number,
	startChar: number,
	endLine: number,
	endChar: number,
): Range {
	return {
		start: {line: startLine, character: startChar},
		end: {line: endLine, character: endChar},
	};
}

/**
 * Creates a mock DocumentSymbol for testing
 */
export function createMockDocumentSymbol(
	name: string,
	kind: number,
	line: number,
	detail?: string,
	children?: DocumentSymbol[],
): DocumentSymbol {
	return {
		name,
		kind,
		detail: detail ?? '',
		range: {
			start: {line, character: 0},
			end: {line: line + 10, character: 0},
		},
		selectionRange: {
			start: {line, character: 0},
			end: {line, character: name.length},
		},
		children: children ?? [],
	};
}

/**
 * Creates a mock workspace edit for testing rename operations
 */
export function createMockWorkspaceEdit(
	fileChanges: Record<
		string,
		Array<{
			startLine: number;
			startChar: number;
			endLine: number;
			endChar: number;
			newText: string;
		}>
	>,
) {
	const changes: Record<
		string,
		Array<{
			range: {start: Position; end: Position};
			newText: string;
		}>
	> = {};

	for (const [filePath, edits] of Object.entries(fileChanges)) {
		changes[`file://${filePath}`] = edits.map(edit => ({
			range: {
				start: {line: edit.startLine, character: edit.startChar},
				end: {line: edit.endLine, character: edit.endChar},
			},
			newText: edit.newText,
		}));
	}

	return {changes};
}

/**
 * Sample file content for testing
 */
export const SAMPLE_FILE_CONTENTS = {
	typescript: `interface User {
	id: number;
	name: string;
	email: string;
}

function getUserById(id: number): User | undefined {
	// Implementation
	return undefined;
}

class UserService {
	private users: User[] = [];

	getUser(id: number): User | undefined {
		return this.users.find(u => u.id === id);
	}
}
`,

	python: `class User:
    def __init__(self, user_id: int, name: str):
        self.id = user_id
        self.name = name

def get_user_by_id(user_id: int) -> User | None:
    # Implementation
    return None

class UserService:
    def __init__(self):
        self.users = []

    def get_user(self, user_id: int) -> User | None:
        return next((u for u in self.users if u.id == user_id), None)
`,

	javascript: `class User {
	constructor(id, name, email) {
		this.id = id;
		this.name = name;
		this.email = email;
	}
}

function getUserById(id) {
	// Implementation
	return undefined;
}

class UserService {
	constructor() {
		this.users = [];
	}

	getUser(id) {
		return this.users.find(u => u.id === id);
	}
}
`,
};

/**
 * Common file paths for testing
 */
export const TEST_FILE_PATHS = {
	typescriptFile: 'src/app.ts',
	javascriptFile: 'src/app.js',
	pythonFile: 'app.py',
	configFile: 'package.json',
	readmeFile: 'README.md',
};
