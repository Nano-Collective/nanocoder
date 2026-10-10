import type {ToolExecutionRecord, WorkflowPattern} from '@/types/macros';

export interface SequenceTrackerOptions {
	maxHistory?: number;
	minSequenceLength?: number;
	maxSequenceLength?: number;
	minOccurrencesForCandidate?: number;
}

export class SequenceTracker {
	private readonly history: ToolExecutionRecord[] = [];
	private currentChain: ToolExecutionRecord[] = [];
	private readonly patterns: Map<string, WorkflowPattern> = new Map();
	private readonly patternLastEndIndex: Map<string, number> = new Map();
	private readonly patternLastStreakId: Map<string, number> = new Map();
	private currentStreakTool: string | null = null;
	private currentStreakId = 0;
	private executionCounter = 0;
	private readonly maxHistory: number;
	private readonly minSeqLen: number;
	private readonly maxSeqLen: number;
	private readonly minOccurrences: number;

	constructor(options?: SequenceTrackerOptions) {
		this.maxHistory = options?.maxHistory ?? 100;
		this.minSeqLen = options?.minSequenceLength ?? 2;
		this.maxSeqLen = options?.maxSequenceLength ?? 5;
		this.minOccurrences = options?.minOccurrencesForCandidate ?? 2;
	}

	recordExecution(record: ToolExecutionRecord): void {
		this.history.push(record);
		if (this.history.length > this.maxHistory) {
			this.history.shift();
		}

		// Only successful read-only actions form repeatable macro chains
		if (!record.success || !record.readOnly) {
			this.breakChain();
			return;
		}

		if (record.toolName === this.currentStreakTool) {
			// Continues current streak of the same tool
		} else {
			this.currentStreakTool = record.toolName;
			this.currentStreakId += 1;
		}

		const currentIndex = this.executionCounter;
		this.executionCounter += 1;

		this.currentChain.push(record);
		if (this.currentChain.length > this.maxSeqLen) {
			this.currentChain.shift();
		}

		this.extractPatternsFromCurrentChain(currentIndex);
	}

	/**
	 * Explicitly breaks the active contiguous chain of read-only tool calls.
	 * Interleaved mutating actions, failed calls, and agent subagent batches
	 * invoke this so they do not falsely link independent read-only calls.
	 */
	breakChain(): void {
		this.currentChain = [];
		this.currentStreakTool = null;
		this.currentStreakId += 1;
	}

	private extractPatternsFromCurrentChain(currentIndex: number): void {
		const chainLen = this.currentChain.length;
		for (
			let len = this.minSeqLen;
			len <= this.maxSeqLen && len <= chainLen;
			len++
		) {
			const slice = this.currentChain.slice(chainLen - len);
			const sequence = slice.map(r => r.toolName);
			const signature = sequence.join(' -> ');
			const exemplarRecords = slice.map(r => ({
				...r,
				inputArgs: {...r.inputArgs},
			}));

			const startIndex = currentIndex - len + 1;
			const lastEnd = this.patternLastEndIndex.get(signature) ?? -1;

			// Count non-overlapping repeats: slice must start after the end of the previous match
			if (startIndex <= lastEnd) {
				continue;
			}

			// If all tools in the sequence are identical (e.g. read_file -> read_file),
			// require that it comes from a separate streak/run so a single run of calling
			// the same tool repeatedly does not falsely report as a repeated macro.
			const isAllSameTool = sequence.every(name => name === sequence[0]);
			if (isAllSameTool) {
				const lastStreak = this.patternLastStreakId.get(signature);
				if (lastStreak !== undefined && lastStreak === this.currentStreakId) {
					continue;
				}
				this.patternLastStreakId.set(signature, this.currentStreakId);
			}

			this.patternLastEndIndex.set(signature, currentIndex);

			const existing = this.patterns.get(signature);
			if (existing) {
				existing.occurrences += 1;
				existing.lastExecutedAt = Date.now();
				existing.exemplarRecords = exemplarRecords;
			} else {
				this.patterns.set(signature, {
					id: `pattern_${Math.abs(hashString(signature))}`,
					signature,
					sequence,
					occurrences: 1,
					lastExecutedAt: Date.now(),
					exemplarRecords,
				});
			}
		}
	}

	getPatterns(minOccurrences?: number): WorkflowPattern[] {
		const threshold = minOccurrences ?? 1;
		return Array.from(this.patterns.values())
			.filter(p => p.occurrences >= threshold)
			.sort((a, b) => b.occurrences - a.occurrences);
	}

	getCandidates(): WorkflowPattern[] {
		return this.getPatterns(this.minOccurrences);
	}

	getHistory(): ReadonlyArray<ToolExecutionRecord> {
		return [...this.history];
	}

	getCurrentChain(): ReadonlyArray<ToolExecutionRecord> {
		return [...this.currentChain];
	}

	clear(): void {
		this.history.length = 0;
		this.currentChain = [];
		this.patterns.clear();
		this.patternLastEndIndex.clear();
		this.patternLastStreakId.clear();
		this.currentStreakTool = null;
		this.currentStreakId = 0;
		this.executionCounter = 0;
	}
}

function hashString(str: string): number {
	let hash = 0;
	for (let i = 0; i < str.length; i++) {
		hash = (hash << 5) - hash + str.charCodeAt(i);
		hash |= 0;
	}
	return hash;
}

let globalSequenceTracker: SequenceTracker | null = null;

export function getSequenceTracker(): SequenceTracker {
	if (!globalSequenceTracker) {
		globalSequenceTracker = new SequenceTracker();
	}
	return globalSequenceTracker;
}

export function resetSequenceTracker(): void {
	globalSequenceTracker = null;
}
