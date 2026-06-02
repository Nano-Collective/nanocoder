import {isNanocoderToolAlwaysAllowed} from '@/config/nanocoder-tools-config';
import type {DevelopmentMode} from '@/types/core';

/**
 * Creates an approval policy for file-mutation tools.
 * Returns false (no approval) if the tool is always-allowed or the current
 * mode is auto-accept/headless; otherwise requires approval. (Yolo is bypassed
 * centrally by resolveToolApproval.)
 *
 * Mode is supplied by the caller (the central approval resolver), never read
 * from a global.
 */
export function createFileToolApproval(
	toolName: string,
): (args: unknown, mode: DevelopmentMode) => boolean {
	return (_args, mode) => {
		if (isNanocoderToolAlwaysAllowed(toolName)) return false;
		return mode !== 'auto-accept' && mode !== 'headless';
	};
}
