import type {MemoryProposal} from './summarizer-service';

/**
 * Holds the proposal list printed by the last `/memory propose`.
 *
 * The list is never mutated once printed. `/memory accept <n>` addresses it by
 * the same 1-based index the user is reading off screen, so accepted entries are
 * tracked in a separate set rather than removed - dropping an entry would shift
 * every later number against the printout and silently save the wrong memory.
 */
export class ProposalStore {
	private proposals: MemoryProposal[] = [];
	private readonly accepted = new Set<number>();

	set(proposals: MemoryProposal[]): void {
		this.proposals = proposals;
		this.accepted.clear();
	}

	list(): readonly MemoryProposal[] {
		return this.proposals;
	}

	get size(): number {
		return this.proposals.length;
	}

	/** `index` is 1-based, matching the printed list. */
	at(index: number): MemoryProposal | undefined {
		if (
			!Number.isInteger(index) ||
			index < 1 ||
			index > this.proposals.length
		) {
			return undefined;
		}
		return this.proposals[index - 1];
	}

	isAccepted(index: number): boolean {
		return this.accepted.has(index);
	}

	markAccepted(index: number): void {
		this.accepted.add(index);
	}

	clear(): void {
		this.proposals = [];
		this.accepted.clear();
	}
}

/**
 * Shared store backing the lazily-loaded `/memory` command. Cleared by `/clear`
 * so a proposal derived from a discarded conversation can't still be accepted.
 */
export const sharedProposalStore = new ProposalStore();
