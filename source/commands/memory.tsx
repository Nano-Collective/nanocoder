import {Box, Text} from 'ink';
import {TitledBoxWithPreferences} from '@/components/ui/titled-box';
import {useTerminalWidth} from '@/hooks/useTerminalWidth';
import {useTheme} from '@/hooks/useTheme';
import {ProposalStore, sharedProposalStore} from '@/memory/proposal-store';
import type {SemanticMemory} from '@/memory/semantic-memory-manager';
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
	proposalStore?: ProposalStore;
}

const USAGE =
	'Usage: /memory list | /memory delete <id> | /memory clear | /memory propose | /memory accept <n>';

/** Length of the display id. Long enough to stay unique in a realistic pool,
 * short enough to retype without copying out of wrapped terminal output. */
const SHORT_ID_LENGTH = 8;

export function shortMemoryId(id: string): string {
	return id.replaceAll('-', '').slice(0, SHORT_ID_LENGTH);
}

type IdLookup =
	| {kind: 'found'; memory: SemanticMemory}
	| {kind: 'missing'}
	| {kind: 'ambiguous'; matches: SemanticMemory[]};

/** Accepts a short id, a full UUID, or any unambiguous prefix of either. */
export function resolveMemoryId(
	memories: SemanticMemory[],
	input: string,
): IdLookup {
	const needle = input.trim().toLowerCase();
	if (!needle) return {kind: 'missing'};

	const exact = memories.find(memory => memory.id.toLowerCase() === needle);
	if (exact) return {kind: 'found', memory: exact};

	const matches = memories.filter(memory => {
		const compact = memory.id.replaceAll('-', '').toLowerCase();
		return (
			compact.startsWith(needle.replaceAll('-', '')) ||
			memory.id.toLowerCase().startsWith(needle)
		);
	});

	if (matches.length === 0) return {kind: 'missing'};
	if (matches.length > 1) return {kind: 'ambiguous', matches};
	return {kind: 'found', memory: matches[0] as SemanticMemory};
}

function MemoryList({memories}: {memories: SemanticMemory[]}) {
	const {colors} = useTheme();
	const width = useTerminalWidth();

	return (
		<TitledBoxWithPreferences
			title="Project Memories"
			width={width}
			borderColor={colors.primary}
			paddingX={2}
			paddingY={1}
			flexDirection="column"
			marginBottom={1}
		>
			{memories.map((memory, index) => (
				<Box
					key={memory.id}
					flexDirection="column"
					marginBottom={index === memories.length - 1 ? 0 : 1}
				>
					<Box>
						<Text color={colors.primary} bold>
							{shortMemoryId(memory.id)}
						</Text>
						<Text color={colors.secondary}> · {memory.category}</Text>
					</Box>
					<Box marginLeft={2}>
						<Text color={colors.text}>{memory.content}</Text>
					</Box>
				</Box>
			))}

			<Box marginTop={1}>
				<Text color={colors.secondary}>
					{memories.length} memor{memories.length === 1 ? 'y' : 'ies'} · delete
					one with /memory delete &lt;id&gt;
				</Text>
			</Box>
		</TitledBoxWithPreferences>
	);
}

function ProposalEvidence({proposal}: {proposal: MemoryProposal}) {
	const {colors} = useTheme();
	const rows = [
		...proposal.evidence.userMessages.map(text => ({label: 'User', text})),
		...proposal.evidence.assistantMessages.map(text => ({
			label: 'Assistant',
			text,
		})),
	];

	if (rows.length === 0) return null;

	return (
		<Box flexDirection="column" marginLeft={2}>
			{rows.map(row => (
				<Text key={`${row.label}-${row.text}`} color={colors.secondary}>
					{row.label}: "{row.text}"
				</Text>
			))}
		</Box>
	);
}

function MemoryProposals({proposals}: {proposals: readonly MemoryProposal[]}) {
	const {colors} = useTheme();
	const width = useTerminalWidth();

	return (
		<TitledBoxWithPreferences
			title="Memory Proposals"
			width={width}
			borderColor={colors.primary}
			paddingX={2}
			paddingY={1}
			flexDirection="column"
			marginBottom={1}
		>
			{proposals.map((proposal, index) => {
				const hasWarnings = proposal.warnings.length > 0;
				return (
					<Box
						key={`${index + 1}-${proposal.content}`}
						flexDirection="column"
						marginBottom={index === proposals.length - 1 ? 0 : 1}
					>
						<Box>
							<Text color={colors.text} bold>
								{index + 1}.
							</Text>
							<Text color={colors.secondary}> [{proposal.category}] </Text>
							<Text color={colors.secondary}>{proposal.sourceType}</Text>
							{hasWarnings && (
								<Text color={colors.warning}> · review carefully</Text>
							)}
						</Box>
						<Box marginLeft={2}>
							<Text color={colors.text}>{proposal.content}</Text>
						</Box>
						<ProposalEvidence proposal={proposal} />
						{proposal.warnings.map(warning => (
							<Box key={warning} marginLeft={2}>
								<Text color={colors.warning}>⚠ {warning}</Text>
							</Box>
						))}
					</Box>
				);
			})}

			<Box marginTop={1}>
				<Text color={colors.secondary}>
					Save one with /memory accept &lt;1-{proposals.length}&gt;
				</Text>
			</Box>
		</TitledBoxWithPreferences>
	);
}

export function createMemoryCommand(
	options: MemoryCommandOptions = {},
): Command {
	let memoryManager = options.memoryManager;
	let summarizerService = options.summarizerService;
	if (!memoryManager) {
		const manager = new SemanticMemoryManager();
		memoryManager = manager;
		summarizerService ??= new SummarizerService(manager);
	} else {
		summarizerService ??= new SummarizerService();
	}
	// Defaults to a private store; only the exported singleton binds the shared
	// one, so tests and any ad-hoc instance can't clobber each other's state.
	const proposalStore = options.proposalStore ?? new ProposalStore();

	return {
		name: 'memory',
		description: 'Manage project memories',
		handler: async (args, messages, metadata) => {
			const subcommand = args[0]?.toLowerCase() ?? 'list';

			try {
				if (subcommand === 'list' || subcommand === 'ls') {
					const memories = await memoryManager.listMemories();
					if (memories.length === 0) {
						return infoMsg('No project memories saved.', 'memory-list');
					}

					return <MemoryList memories={memories} />;
				}

				if (subcommand === 'delete' || subcommand === 'rm') {
					const id = args[1]?.trim();
					if (!id) return errorMsg(USAGE, 'memory-error');

					const lookup = resolveMemoryId(
						await memoryManager.listMemories(),
						id,
					);
					if (lookup.kind === 'missing') {
						return errorMsg(`Memory not found: ${id}`, 'memory-error');
					}
					if (lookup.kind === 'ambiguous') {
						const ids = lookup.matches
							.map(memory => shortMemoryId(memory.id))
							.join(', ');
						return errorMsg(
							`Ambiguous memory id "${id}" matches: ${ids}`,
							'memory-error',
						);
					}

					const deleted = await memoryManager.deleteMemory(lookup.memory.id);
					if (!deleted) {
						return errorMsg(`Memory not found: ${id}`, 'memory-error');
					}

					return successMsg(
						`Deleted memory: ${shortMemoryId(lookup.memory.id)}`,
						'memory-deleted',
					);
				}

				if (subcommand === 'clear') {
					await memoryManager.clearMemories();
					proposalStore.clear();
					return successMsg('Cleared project memories.', 'memory-cleared');
				}

				if (subcommand === 'propose') {
					const proposals =
						summarizerService.proposeMemoriesFromMessages(messages);
					if (proposals.length === 0) {
						proposalStore.clear();
						return infoMsg(
							'No durable memory proposals found.',
							'memory-propose',
						);
					}

					// Warning-free proposals first, so the safest choices carry the
					// lowest numbers. Order is fixed here and never changes again -
					// `/memory accept` indexes into exactly this list.
					proposals.sort(
						(a, b) =>
							(a.warnings.length === 0 ? 0 : 1) -
							(b.warnings.length === 0 ? 0 : 1),
					);
					proposalStore.set(proposals);

					return <MemoryProposals proposals={proposalStore.list()} />;
				}

				if (subcommand === 'accept') {
					if (proposalStore.size === 0) {
						return errorMsg(
							'No proposals to accept. Run /memory propose first.',
							'memory-error',
						);
					}

					const index = Number.parseInt(args[1] ?? '', 10);
					const proposal = proposalStore.at(index);
					if (!proposal) {
						return errorMsg(
							`Usage: /memory accept <1-${proposalStore.size}>`,
							'memory-error',
						);
					}
					if (proposalStore.isAccepted(index)) {
						return errorMsg(
							`Proposal ${index} was already saved.`,
							'memory-error',
						);
					}

					const memory = await summarizerService.acceptProposal(
						proposal,
						metadata.sessionId,
					);
					proposalStore.markAccepted(index);

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

export const memoryCommand: Command = createMemoryCommand({
	proposalStore: sharedProposalStore,
});
