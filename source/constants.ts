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
export const TIMEOUT_LSP_DIAGNOSTICS_MS = 5000;

// === PASTE DETECTION ===
export const PASTE_CHUNK_BASE_WINDOW_MS = 500;
export const PASTE_CHUNK_MAX_WINDOW_MS = 2000;
export const PASTE_RAPID_DETECTION_MS = 50;
export const PASTE_LARGE_CONTENT_THRESHOLD_CHARS = 150;

// === CACHE CONFIGURATION ===
export const CACHE_FILE_TTL_MS = 5000;
export const CACHE_MODELS_EXPIRATION_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
export const MAX_FILE_READ_RETRIES = 3;

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
export const DEFAULT_TERMINAL_WIDTH = 120;
export const DEFAULT_TERMINAL_COLUMNS = 80;

// === BUFFER SIZES ===
export const BUFFER_FIND_FILES_BYTES = 1024 * 1024; // 1 MB
export const BUFFER_GREP_MULTIPLIER = 3;

// === FILE READING ===
export const FILE_READ_METADATA_THRESHOLD_LINES = 300;
export const FILE_READ_CHUNKING_HINT_THRESHOLD_LINES = 500;
export const FILE_READ_CHUNK_SIZE_LINES = 250;
export const CHARS_PER_TOKEN_ESTIMATE = 4;
export const MAX_LINE_LENGTH_CHARS = 10_000; // Lines longer than this are likely minified/binary

// === TERMINAL AND UI ===
export const PATH_LENGTH_NARROW_TERMINAL = 30;
export const PATH_LENGTH_NORMAL_TERMINAL = 60;
export const TABLE_COLUMN_MIN_WIDTH = 10;

// === TOKEN THRESHOLDS (percentages - useChatHandler) ===
export const TOKEN_THRESHOLD_WARNING_PERCENT = 80;
export const TOKEN_THRESHOLD_CRITICAL_PERCENT = 95;

// === HEAP USAGE THRESHOLDS (decimal - health-monitor) ===
export const HEAP_USAGE_WARNING_THRESHOLD = 0.8;
export const HEAP_USAGE_CRITICAL_THRESHOLD = 0.95;

// === OUTPUT TRUNCATION ===
export const TRUNCATION_OUTPUT_LIMIT = 2000;
export const TRUNCATION_DESCRIPTION_LENGTH = 100;

// === DELAYS ===
export const DELAY_COMMAND_COMPLETE_MS = 100;

// === BASH EXECUTION ===
export const INTERVAL_BASH_PROGRESS_MS = 500;
export const BASH_OUTPUT_PREVIEW_LENGTH = 150;

// === FILE SCANNER ===
export const MAX_FILES_TO_SCAN = 1000;
export const MAX_DIRECTORY_DEPTH = 10;

// === LANGUAGE DETECTOR ===
export const MIN_LANGUAGE_PERCENTAGE = 5;
export const MAX_SECONDARY_LANGUAGES = 3;

// === USAGE CALCULATOR ===
export const TOKENS_PER_TOOL_ESTIMATE = 150;
export const USAGE_SUCCESS_THRESHOLD_PERCENT = 70;
export const USAGE_ERROR_THRESHOLD_PERCENT = 90;

// === FILE AUTOCOMPLETE ===
export const CACHE_FILE_LIST_TTL_MS = 5000;
export const BUFFER_FILE_LIST_BYTES = 10 * 1024 * 1024; // 10 MB

// === FETCH URL ===
export const MAX_URL_CONTENT_BYTES = 100_000; // ~100 KB

// === HEALTH MONITOR ===
export const INTERVAL_HEALTH_CHECK_MS = 30_000;
export const TIMEOUT_HEALTH_CHECK_MS = 5000;
export const DURATION_AVERAGE_WARNING_MS = 1000;
export const DURATION_AVERAGE_CRITICAL_MS = 5000;
export const DURATION_REQUEST_WARNING_MS = 2000;
export const DURATION_REQUEST_CRITICAL_MS = 10_000;
export const COOLDOWN_ALERT_MS = 300_000; // 5 minutes

// === LOGGING ===
export const BUFFER_LOG_BYTES = 65_536; // 64 KB
export const INTERVAL_LOG_FLUSH_MS = 1000;
export const MAX_LOG_ENTRIES = 10_000;
export const MAX_COMPLETED_REQUESTS = 1000;

// === AI SDK ===
export const MAX_TOOL_STEPS = 10;

// === MCP ===
export const TIMEOUT_MCP_DEFAULT_MS = 30_000;

// === CODEBASE ANALYSIS ===
export const THRESHOLD_LARGE_CODEBASE_FILES = 500;

// === COST SCORING ===
export const COST_SCORE_FREE = 9;
export const COST_SCORE_CHEAP = 7;
export const COST_SCORE_MODERATE = 5;
export const COST_SCORE_EXPENSIVE = 3;

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
