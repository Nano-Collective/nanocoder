import {createStubCommand} from '@/commands/create-stub-command';

/**
 * The /compact command compresses message history to reduce context usage.
 *
 * Note: The actual command logic is handled in app-util.ts handleCompactCommand()
 * because it requires access to app state (messages, setMessages, provider, model)
 * that isn't available through the standard command handler interface.
 *
 * Available flags:
 * --aggressive    - Aggressive compression mode (removes more content)
 * --conservative  - Conservative compression mode (preserves more content)
 * --default       - Default balanced compression mode
 * --preview       - Show compression preview without applying
 * --restore       - Restore messages from pre-compression backup
 * --auto-on       - Enable auto-compact for this session
 * --auto-off      - Disable auto-compact for this session
 * --threshold <n> - Set auto-compact threshold (50-95%) for this session
 */
export const compactCommand = createStubCommand(
	'compact',
	'Compress message history to reduce context usage (use --aggressive, --conservative, --preview, --restore, --auto-on, --auto-off, --threshold <n>)',
);
