export interface ToolExecutionRecord {
	toolName: string;
	inputArgs: Record<string, unknown>;
	success: boolean;
	readOnly: boolean;
	parallelBatch?: boolean;
	durationMs?: number;
	timestamp: number;
}

export interface WorkflowPattern {
	id: string;
	signature: string;
	sequence: string[];
	occurrences: number;
	lastExecutedAt: number;
	exemplarRecords?: ToolExecutionRecord[];
}
