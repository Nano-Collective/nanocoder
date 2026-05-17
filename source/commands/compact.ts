import {createStubCommand} from '@/commands/create-stub-command';

/**
 * The /compact command compresses message history to reduce context usage.
 *
 * Note: The actual command logic is handled in app-util.ts handleCompactCommand()
 * because it requires access to app state (messages, setMessages, provider, model)
 * that isn't available through the standard command handler interface.
 *
 * Available flags:
 * --llm           - Force LLM-based summarisation for this invocation
 * --mechanical    - Force mechanical (regex) compression for this invocation
 * --strategy <s>  - Persist strategy for the session ("llm" or "mechanical")
 * --aggressive    - Aggressive mechanical compression mode
 * --conservative  - Conservative mechanical compression mode
 * --default       - Default balanced mechanical compression mode
 * --preview       - Show compression preview without applying
 * --restore       - Restore messages from pre-compression backup
 * --auto-on       - Enable auto-compact for this session
 * --auto-off      - Disable auto-compact for this session
 * --threshold <n> - Set auto-compact threshold (50-95%) for this session
 */
export const compactCommand = createStubCommand(
	'compact',
	'Compress message history (default LLM summary; use --mechanical, --preview, --restore, --auto-on/off, --threshold <n>, --strategy llm|mechanical)',
);
