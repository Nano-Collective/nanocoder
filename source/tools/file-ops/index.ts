import type {NanocoderToolExport} from '@/types/core';
import {fileOpTool} from './file-op';
import {syntaxIslandEditTool} from './syntax-island-edit';

export function getFileOpTools(): NanocoderToolExport[] {
	return [fileOpTool, syntaxIslandEditTool];
}
