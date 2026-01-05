/**
 * LSP Response Fixtures for Testing
 *
 * Pre-defined LSP responses for testing different tools.
 */

import type {DocumentSymbol, Location} from '@/lsp/protocol';
import {SymbolKind} from '@/lsp/protocol';

/**
 * Fixtures for document symbols tool
 */
export const DOCUMENT_SYMBOLS_FIXTURES = {
	typescriptFile: {
		hierarchical: [
			{
				name: 'UserService',
				kind: SymbolKind.Class,
				detail: '',
				range: {
					start: {line: 10, character: 0},
					end: {line: 25, character: 1},
				},
				selectionRange: {
					start: {line: 10, character: 0},
					end: {line: 10, character: 11},
				},
				children: [
					{
						name: 'constructor',
						kind: SymbolKind.Constructor,
						detail: '',
						range: {
							start: {line: 12, character: 1},
							end: {line: 15, character: 2},
						},
						selectionRange: {
							start: {line: 12, character: 1},
							end: {line: 12, character: 13},
						},
						children: [],
					},
					{
						name: 'getUser',
						kind: SymbolKind.Method,
						detail: '(id: number): User | undefined',
						range: {
							start: {line: 17, character: 1},
							end: {line: 20, character: 2},
						},
						selectionRange: {
							start: {line: 17, character: 1},
							end: {line: 17, character: 8},
						},
						children: [],
					},
				],
			},
			{
				name: 'getUserById',
				kind: SymbolKind.Function,
				detail: '(id: number): User | undefined',
				range: {
					start: {line: 5, character: 0},
					end: {line: 8, character: 1},
				},
				selectionRange: {
					start: {line: 5, character: 0},
					end: {line: 5, character: 12},
				},
				children: [],
			},
		] as DocumentSymbol[],
	},

	emptyFile: {
		hierarchical: [] as DocumentSymbol[],
	},
};

/**
 * Fixtures for find references tool
 */
export const FIND_REFERENCES_FIXTURES = {
	multipleReferences: [
		{
			uri: 'file:///src/app.ts',
			range: {
				start: {line: 10, character: 5},
				end: {line: 10, character: 15},
			},
		},
		{
			uri: 'file:///src/utils.ts',
			range: {
				start: {line: 25, character: 10},
				end: {line: 25, character: 20},
			},
		},
		{
			uri: 'file:///src/app.ts',
			range: {
				start: {line: 42, character: 8},
				end: {line: 42, character: 18},
			},
		},
	] as Location[],

	singleReference: [
		{
			uri: 'file:///src/app.ts',
			range: {
				start: {line: 10, character: 5},
				end: {line: 10, character: 15},
			},
		},
	] as Location[],

	noReferences: [] as Location[],
};

/**
 * Fixtures for go to definition tool
 */
export const GO_TO_DEFINITION_FIXTURES = {
	singleDefinition: {
		uri: 'file:///src/app.ts',
		range: {
			start: {line: 5, character: 0},
			end: {line: 5, character: 20},
		},
	},

	multipleDefinitions: [
		{
			uri: 'file:///src/app.ts',
			range: {
				start: {line: 5, character: 0},
				end: {line: 5, character: 20},
			},
		},
		{
			uri: 'file:///src/types.ts',
			range: {
				start: {line: 10, character: 0},
				end: {line: 10, character: 20},
			},
		},
	],

	notFound: null,
};

/**
 * Fixtures for rename symbol tool
 */
export const RENAME_SYMBOL_FIXTURES = {
	singleFile: {
		changes: {
			'file:///src/app.ts': [
				{
					range: {
						start: {line: 10, character: 5},
						end: {line: 10, character: 15},
					},
					newText: 'newName',
				},
			],
		},
	},

	multipleFiles: {
		changes: {
			'file:///src/app.ts': [
				{
					range: {
						start: {line: 10, character: 5},
						end: {line: 10, character: 15},
					},
					newText: 'newName',
				},
				{
					range: {
						start: {line: 42, character: 8},
						end: {line: 42, character: 18},
					},
					newText: 'newName',
				},
			],
			'file:///src/utils.ts': [
				{
					range: {
						start: {line: 25, character: 10},
						end: {line: 25, character: 20},
					},
					newText: 'newName',
				},
			],
		},
	},

	noChanges: {
		changes: {},
	},
};

/**
 * Common test file paths
 */
export const TEST_FILE_PATHS = {
	typescript: 'src/app.ts',
	javascript: 'src/app.js',
	python: 'app.py',
	readme: 'README.md',
	config: 'package.json',
};

/**
 * Common test positions
 */
export const TEST_POSITIONS = {
	startOfFile: {line: 0, character: 0},
	middleOfFile: {line: 10, character: 5},
	endOfFile: {line: 100, character: 0},
};
