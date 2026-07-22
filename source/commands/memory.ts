import {SemanticMemoryManager} from '@/memory/semantic-memory-manager';
import {SummarizerService} from '@/memory/summarizer-service';
import type {Command} from '@/types/commands';
import {formatError} from '@/utils/error-formatter';
import {errorMsg, infoMsg, successMsg} from '@/utils/message-factory';

interface MemoryCommandOptions {
	memoryManager?: Pick<
		SemanticMemoryManager,
		'listMemories' | 'deleteMemory' | 'clearMemories'
	>;
	summarizerService?: Pick<SummarizerService, 'proposeMemoriesFromMessages'>;
}

const USAGE =
	'Usage: /memory list | /memory delete <id> | /memory clear | /memory propose';

export function createMemoryCommand(
	options: MemoryCommandOptions = {},
): Command {
	const memoryManager = options.memoryManager ?? new SemanticMemoryManager();
	const summarizerService =
		options.summarizerService ?? new SummarizerService();

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
						return infoMsg(
							'No durable memory proposals found.',
							'memory-propose',
						);
					}

					return infoMsg(
						proposals
							.map(proposal => `[${proposal.category}] ${proposal.content}`)
							.join('\n'),
						'memory-propose',
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
