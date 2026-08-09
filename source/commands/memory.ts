import {SemanticMemoryManager} from '@/memory/semantic-memory-manager';
import type {MemoryProposal} from '@/memory/summarizer-service';
import {SummarizerService} from '@/memory/summarizer-service';
import type {Command} from '@/types/commands';
import {formatError} from '@/utils/error-formatter';
import {errorMsg, infoMsg, successMsg} from '@/utils/message-factory';

interface MemoryCommandOptions {
	memoryManager?: Pick<
		SemanticMemoryManager,
		'listMemories' | 'deleteMemory' | 'clearMemories'
	>;
	summarizerService?: Pick<
		SummarizerService,
		'proposeMemoriesFromMessages' | 'acceptProposal'
	>;
}

const USAGE =
	'Usage: /memory list | /memory delete <id> | /memory clear | /memory propose | /memory accept <n>';

export function createMemoryCommand(
	options: MemoryCommandOptions = {},
): Command {
	const memoryManager = options.memoryManager ?? new SemanticMemoryManager();
	const summarizerService =
		options.summarizerService ?? new SummarizerService();
	let lastProposals: MemoryProposal[] = [];

	return {
		name: 'memory',
		description: 'Manage project memories',
		handler: async (args, messages) => {
			const subcommand = args[0]?.toLowerCase() ?? 'list';

			try {
				if (subcommand === 'list' || subcommand === 'ls') {
					const memories = await memoryManager.listMemories();
					if (memories.length === 0) {
						return infoMsg('No project memories saved.', 'memory-list');
					}

					return infoMsg(
						memories
							.map(
								memory => `${memory.id} [${memory.category}] ${memory.content}`,
							)
							.join('\n'),
						'memory-list',
					);
				}

				if (subcommand === 'delete' || subcommand === 'rm') {
					const id = args[1]?.trim();
					if (!id) return errorMsg(USAGE, 'memory-error');

					const deleted = await memoryManager.deleteMemory(id);
					if (!deleted) {
						return errorMsg(`Memory not found: ${id}`, 'memory-error');
					}

					return successMsg(`Deleted memory: ${id}`, 'memory-deleted');
				}

				if (subcommand === 'clear') {
					await memoryManager.clearMemories();
					return successMsg('Cleared project memories.', 'memory-cleared');
				}

				if (subcommand === 'propose') {
					const proposals =
						summarizerService.proposeMemoriesFromMessages(messages);
					if (proposals.length === 0) {
						lastProposals = [];
						return infoMsg(
							'No durable memory proposals found.',
							'memory-propose',
						);
					}

					proposals.sort((a, b) => {
						const aWarns = a.warnings.length;
						const bWarns = b.warnings.length;
						if (aWarns === 0 && bWarns > 0) return -1;
						if (aWarns > 0 && bWarns === 0) return 1;
						return 0;
					});
					lastProposals = proposals;

					const lines: string[] = [];
					for (let i = 0; i < proposals.length; i++) {
						const proposal = proposals[i]!;
						const hasWarnings = proposal.warnings.length > 0;
						const header = `─────────────────────────────────\nProposal ${i + 1} of ${proposals.length}${hasWarnings ? '  ⚠ Review carefully' : ''}\n─────────────────────────────────`;
						lines.push(header);
						lines.push(`[${proposal.category}] ${proposal.content}\n`);
						lines.push(`Source:   ${proposal.sourceType}`);

						const evidenceLines: string[] = [];
						for (const m of proposal.evidence.userMessages) {
							evidenceLines.push(`User: "${m}"`);
						}
						for (const m of proposal.evidence.assistantMessages) {
							evidenceLines.push(`Assistant: "${m}"`);
						}

						if (evidenceLines.length > 0) {
							lines.push(`Evidence: ${evidenceLines[0]}`);
							for (let j = 1; j < evidenceLines.length; j++) {
								lines.push(`          ${evidenceLines[j]}`);
							}
						}

						for (const w of proposal.warnings) {
							lines.push(`⚠ ${w}`);
						}
						lines.push('');
					}

					lines.push(
						`─────────────────────────────────\nRun /memory accept <1-${proposals.length}> to save one of the above.`,
					);

					return infoMsg(lines.join('\n'), 'memory-propose');
				}

				if (subcommand === 'accept') {
					if (lastProposals.length === 0) {
						return errorMsg(
							'No proposals to accept. Run /memory propose first.',
							'memory-error',
						);
					}

					const index = Number.parseInt(args[1] ?? '', 10);
					const proposal = Number.isInteger(index)
						? lastProposals[index - 1]
						: undefined;
					if (!proposal) {
						return errorMsg(
							`Usage: /memory accept <1-${lastProposals.length}>`,
							'memory-error',
						);
					}

					const memory = await summarizerService.acceptProposal(proposal);
					lastProposals = lastProposals.filter((_, i) => i !== index - 1);

					return successMsg(
						`Saved ${memory.category} memory: ${memory.content}`,
						'memory-accept',
					);
				}

				return errorMsg(USAGE, 'memory-error');
			} catch (error) {
				return errorMsg(
					`Failed to manage memory: ${formatError(error)}`,
					'memory-error',
				);
			}
		},
	};
}

export const memoryCommand: Command = createMemoryCommand();
