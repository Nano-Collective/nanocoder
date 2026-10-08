export type SyntaxIslandKind =
	| 'function'
	| 'method'
	| 'component'
	| 'arrow'
	| 'class'
	| 'block';

export interface SyntaxIsland {
	name: string;
	kind: SyntaxIslandKind;
	startOffset: number;
	endOffset: number;
	bodyStartOffset: number;
	bodyEndOffset: number;
	startLine: number;
	endLine: number;
	signature: string;
	originalBody: string;
	fullContent: string;
}

export interface IslandExtractionResult {
	found: boolean;
	island?: SyntaxIsland;
	error?: string;
}

export interface IslandSplicingResult {
	success: boolean;
	newContent?: string;
	error?: string;
	island?: SyntaxIsland;
}
