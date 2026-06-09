import type {NanocoderToolExport} from '@/types/core';
import {fileOpTool} from './file-op';

export function getFileOpTools(): NanocoderToolExport[] {
	return [fileOpTool];
}
