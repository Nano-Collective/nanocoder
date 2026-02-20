import type {NanocoderToolExport} from '@/types/core';
import {copyFileTool} from './copy-file';
import {createDirectoryTool} from './create-directory';
import {deleteFileTool} from './delete-file';
import {moveFileTool} from './move-file';

export function getFileOpTools(): NanocoderToolExport[] {
	return [deleteFileTool, moveFileTool, createDirectoryTool, copyFileTool];
}
