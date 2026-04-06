import {agentTool} from '@/tools/agent-tool';
import {askQuestionTool} from '@/tools/ask-question';
import {executeBashTool} from '@/tools/execute-bash';
import {fetchUrlTool} from '@/tools/fetch-url';
import {getFileOpTools} from '@/tools/file-ops';
import {stringReplaceTool} from '@/tools/file-ops/string-replace';
import {writeFileTool} from '@/tools/file-ops/write-file';
import {findFilesTool} from '@/tools/find-files';
import {getGitTools} from '@/tools/git';
import {listDirectoryTool} from '@/tools/list-directory';
import {getDiagnosticsTool} from '@/tools/lsp-get-diagnostics';
import {readFileTool} from '@/tools/read-file';
import {searchFileContentsTool} from '@/tools/search-file-contents';
import {
	createTaskTool,
	deleteTaskTool,
	listTasksTool,
	updateTaskTool,
} from '@/tools/tasks';
import {webSearchTool} from '@/tools/web-search';
import type {NanocoderToolExport} from '@/types/index';

// Static tools (always available)
const staticTools: NanocoderToolExport[] = [
	readFileTool,
	writeFileTool,
	stringReplaceTool,
	executeBashTool,
	webSearchTool,
	fetchUrlTool,
	findFilesTool,
	searchFileContentsTool,
	getDiagnosticsTool,
	listDirectoryTool,
	agentTool,
	// Interaction tools
	askQuestionTool,
	// File operation tools
	...getFileOpTools(),
	// Task management tools
	createTaskTool,
	listTasksTool,
	updateTaskTool,
	deleteTaskTool,
];

// Conditionally available tools (based on system capabilities)
// Git tools are only registered if git is installed
// PR tool additionally requires gh CLI
const conditionalTools: NanocoderToolExport[] = [...getGitTools()];

// All built-in tool exports — the single source of truth for static tools
export const allToolExports: NanocoderToolExport[] = [
	...staticTools,
	...conditionalTools,
];
