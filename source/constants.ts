/**
 * Centralized constants for the nanocoder codebase.
 * Naming convention: CATEGORY_DESCRIPTOR_UNIT (e.g., TIMEOUT_PROVIDER_MS)
 * MAX/MIN/DEFAULT always as prefix: MAX_CATEGORY_DESCRIPTOR
 */

// === TIMEOUTS (milliseconds) ===
export const TIMEOUT_PROVIDER_CONNECTION_MS = 5000;
export const TIMEOUT_LSP_VERIFICATION_MS = 5000;
export const TIMEOUT_LSP_SPAWN_VERIFICATION_MS = 2000;
export const TIMEOUT_OUTPUT_FLUSH_MS = 1000;
export const TIMEOUT_EXECUTION_MAX_MS = 300_000; // 5 minutes
export const TIMEOUT_WEB_SEARCH_MS = 10_000;
export const TIMEOUT_VSCODE_EXTENSION_SKIP_MS = 3000;
export const TIMEOUT_MESSAGE_PROCESSING_MS = 5 * 60 * 1000; // 5 minutes
export const TIMEOUT_HTTP_HEADERS_MS = 10_000;
export const TIMEOUT_HTTP_BODY_MS = 30_000;
export const TIMEOUT_UPDATE_CHECK_MS = 10_000;
export const TIMEOUT_SOCKET_DEFAULT_MS = 120_000;
export const TIMEOUT_SOCKET_LOCAL_DEFAULT_MS = 600_000; // 10 minutes for local models (Ollama, etc.)
export const TIMEOUT_LSP_DIAGNOSTICS_MS = 5000;
// Ceiling on the pricing lookup for the per-response usage footer: past
// this the message renders with token counts only rather than holding the
// streaming-to-static swap hostage to a cold models.dev fetch.
export const TIMEOUT_COST_LOOKUP_MS = 250;

// === PASTE DETECTION ===
export const PASTE_CHUNK_BASE_WINDOW_MS = 500;
export const PASTE_CHUNK_MAX_WINDOW_MS = 2000;
export const PASTE_RAPID_DETECTION_MS = 50;
export const PASTE_LARGE_CONTENT_THRESHOLD_CHARS = 150;

// === CACHE CONFIGURATION ===
export const CACHE_FILE_TTL_MS = 5000;
export const CACHE_MODELS_EXPIRATION_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
export const MAX_FILE_READ_RETRIES = 3;

// === SESSION NAMES ===
export const MAX_SESSION_NAME_LENGTH = 100;

// === LIMITS ===
export const MAX_CHECKPOINT_FILES = 50;
export const MAX_FIND_FILES_RESULTS = 100;
export const MAX_SEARCH_RESULTS = 100;
export const MAX_PROMPT_HISTORY_SIZE = 100;
export const MAX_USAGE_SESSIONS = 100;
export const MAX_DAILY_AGGREGATES = 30;
export const MAX_WEB_SEARCH_QUERY_LENGTH = 500;

// === DEFAULTS ===
export const DEFAULT_FIND_FILES_RESULTS = 50;
export const DEFAULT_SEARCH_RESULTS = 30;
export const DEFAULT_WEB_SEARCH_RESULTS = 10;
export const DEFAULT_TERMINAL_WIDTH = 200;
export const DEFAULT_TERMINAL_COLUMNS = 80;

// === FILE READING ===
// Files at or below this size are returned in full. Larger files get a bounded
// preview so the first read still gives the model useful context.
export const FILE_READ_PREVIEW_THRESHOLD_LINES = 1500;
export const FILE_READ_PREVIEW_LINES = 250;

// === @-FILE MENTION INLINING (prompt-processor) ===
// Files at or under this many lines are inlined in full when @-mentioned.
// Larger files inline only a head preview plus a read_file hint, so a single
// mention can't flood the conversation (the contents otherwise persist in
// context on every subsequent turn).
export const FILE_MENTION_INLINE_MAX_LINES = 250;
export const FILE_MENTION_PREVIEW_LINES = 40;

export const CHARS_PER_TOKEN_ESTIMATE = 4;
export const MAX_LINE_LENGTH_CHARS = 10_000; // Lines longer than this are likely minified/binary
export const EMPTY_CONTENT_MARKER = '[file is empty]';

// === TERMINAL AND UI ===
export const PATH_LENGTH_NARROW_TERMINAL = 30;
export const PATH_LENGTH_NORMAL_TERMINAL = 60;
export const TABLE_COLUMN_MIN_WIDTH = 10;
export const WIZARD_ROW_CHROME_CHARS = 10;
export const MIN_PATH_BUDGET_CHARS = 10;

// Short, discoverable hints shown on the welcome screen and by `/tip`.
// Keep these aligned with the documented command and keyboard behaviour.
export const TIPS = [
	'Press Ctrl+J to add a new line without sending your prompt.',
	'Press Shift+Tab to cycle between development modes.',
	'Press Ctrl+O to toggle compact tool output.',
	'Press Ctrl+R to toggle expanded reasoning traces.',
	'Use @ followed by a file path to add that file to context.',
	'Use /explorer to browse project files and add them to context.',
	'Run /checkpoint create before a risky refactor so you can restore it later.',
	'Run /compact --preview to inspect a context compression before applying it.',
	'Run /copy to copy the last assistant response to your clipboard.',
	'Run /usage to see how much of the current model context is in use.',
	'Run /model to switch providers or models without restarting your session.',
	'Paste an image with Ctrl+V when your selected model supports vision.',
] as const;

// === TOKEN THRESHOLDS (percentages - useChatHandler) ===
export const TOKEN_THRESHOLD_WARNING_PERCENT = 80;
export const TOKEN_THRESHOLD_CRITICAL_PERCENT = 95;

// === OUTPUT TRUNCATION ===
export const TRUNCATION_OUTPUT_LIMIT = 2000;
// Keep one unusually large tool response from dominating the model context.
// The cap is intentionally higher than the Bash preview limit so normal file
// reads and search results remain useful while unbounded tools stay bounded.
export const MAX_TOOL_RESULT_CHARS = 20_000;
export const TRUNCATION_DESCRIPTION_LENGTH = 100;

// === DELAYS ===
export const DELAY_COMMAND_COMPLETE_MS = 100;

// === BASH EXECUTION ===
export const INTERVAL_BASH_PROGRESS_MS = 500;
export const BASH_OUTPUT_PREVIEW_LENGTH = 150;
export const BASH_OUTPUT_DISPLAY_LINES = 20;
export const TIMEOUT_BASH_DEFAULT_MS = 120_000;
export const BASH_MAX_OUTPUT_BYTES = 5 * 1024 * 1024;

// === FILE SCANNER ===
export const MAX_FILES_TO_SCAN = 1000;
export const MAX_DIRECTORY_DEPTH = 10;

// === LANGUAGE DETECTOR ===
export const MIN_LANGUAGE_PERCENTAGE = 5;
export const MAX_SECONDARY_LANGUAGES = 3;

// === USAGE CALCULATOR ===
export const TOKENS_PER_TOOL_ESTIMATE = 150;
// Per-tool JSON envelope the provider wraps each definition in (the `name`,
// `description`, `input_schema`/`parameters` keys and surrounding braces) that
// isn't part of the serialized name/description/schema we tokenize directly.
export const TOKENS_PER_TOOL_FRAMING = 12;
export const USAGE_SUCCESS_THRESHOLD_PERCENT = 70;
export const USAGE_ERROR_THRESHOLD_PERCENT = 90;

// === FILE AUTOCOMPLETE ===
export const CACHE_FILE_LIST_TTL_MS = 5000;

// === FETCH URL ===
export const MAX_URL_CONTENT_BYTES = 100_000; // ~100 KB

// === AI SDK ===
export const MAX_TOOL_STEPS = 10;
// Cap how many consecutive empty assistant turns we'll auto-nudge through
// before surfacing an error. Some models (notably GPT-5 reasoning models)
// can produce reasoning-only turns; one or two retries usually clears it,
// but unbounded recursion would loop forever.
export const MAX_EMPTY_TURNS = 2;
// After hitting the empty-turn cap, mechanically compact the context and
// retry. This many compact-and-retry cycles are allowed before giving up.
export const MAX_COMPACT_RETRIES = 1;
// Cap how many consecutive malformed-XML self-correction recursions we'll
// attempt before surfacing an error. Without this, a model stuck producing
// bad XML loops async and appends two messages per iteration until Node's
// heap exhausts (~1.4GB).
export const MAX_MALFORMED_RETRIES = 2;
// Cap how many times the model may emit the exact same tool call(s) on
// consecutive turns. Small models can get stuck re-issuing an identical failing
// call forever; once the same signature repeats this many times in a row we
// stop and surface an actionable error instead of looping.
export const MAX_REPEATED_TOOL_CALLS = 3;

// === MCP ===
export const TIMEOUT_MCP_DEFAULT_MS = 30_000;

// === CODEBASE ANALYSIS ===
export const THRESHOLD_LARGE_CODEBASE_FILES = 500;

// === COST SCORING ===
export const COST_SCORE_FREE = 9;
export const COST_SCORE_CHEAP = 7;
export const COST_SCORE_MODERATE = 5;
export const COST_SCORE_EXPENSIVE = 3;

// === FILE TAGGING ===
export const MAX_FILE_TAG_SIZE_BYTES = 512_000; // 512 KB
export const BINARY_FILE_EXTENSIONS = new Set([
	// Images
	'.gif',
	'.png',
	'.jpg',
	'.jpeg',
	'.ico',
	'.bmp',
	'.webp',
	'.svg',
	'.tiff',
	// Media
	'.mp3',
	'.mp4',
	'.mov',
	'.avi',
	'.wav',
	'.flac',
	'.ogg',
	'.webm',
	// Archives
	'.zip',
	'.tar',
	'.gz',
	'.rar',
	'.7z',
	// Executables
	'.exe',
	'.dll',
	'.so',
	'.dylib',
	'.wasm',
	// Documents
	'.pdf',
	'.doc',
	'.docx',
	'.xls',
	'.xlsx',
	'.ppt',
	'.pptx',
	// Fonts
	'.woff',
	'.woff2',
	'.ttf',
	'.otf',
	'.eot',
	// Other
	'.bin',
	'.dat',
	'.o',
	'.class',
	'.pyc',
]);

// === FILE EXPLORER ===
export const FILE_EXPLORER_VISIBLE_ITEMS = 15;
export const FILE_EXPLORER_TOKEN_WARNING_THRESHOLD = 10000;

// Map file extensions to highlight.js language names
export const FILE_EXTENSION_TO_LANGUAGE: Record<string, string> = {
	'.js': 'javascript',
	'.mjs': 'javascript',
	'.cjs': 'javascript',
	'.jsx': 'javascript',
	'.ts': 'typescript',
	'.tsx': 'typescript',
	'.mts': 'typescript',
	'.cts': 'typescript',
	'.json': 'json',
	'.md': 'markdown',
	'.py': 'python',
	'.rb': 'ruby',
	'.go': 'go',
	'.rs': 'rust',
	'.java': 'java',
	'.c': 'c',
	'.h': 'c',
	'.cpp': 'cpp',
	'.cc': 'cpp',
	'.hpp': 'cpp',
	'.cs': 'csharp',
	'.php': 'php',
	'.swift': 'swift',
	'.kt': 'kotlin',
	'.scala': 'scala',
	'.sh': 'bash',
	'.bash': 'bash',
	'.zsh': 'bash',
	'.fish': 'fish',
	'.yml': 'yaml',
	'.yaml': 'yaml',
	'.toml': 'ini',
	'.ini': 'ini',
	'.xml': 'xml',
	'.html': 'html',
	'.htm': 'html',
	'.css': 'css',
	'.scss': 'scss',
	'.sass': 'scss',
	'.less': 'less',
	'.sql': 'sql',
	'.graphql': 'graphql',
	'.gql': 'graphql',
	'.dockerfile': 'dockerfile',
	'.makefile': 'makefile',
	'.mk': 'makefile',
	'.lua': 'lua',
	'.r': 'r',
	'.pl': 'perl',
	'.ex': 'elixir',
	'.exs': 'elixir',
	'.erl': 'erlang',
	'.clj': 'clojure',
	'.hs': 'haskell',
	'.vim': 'vim',
	'.diff': 'diff',
	'.patch': 'diff',
};
