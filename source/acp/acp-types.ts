import type {CustomCommandLoader} from '@/custom-commands/loader';
import type {ToolManager} from '@/tools/tool-manager';
import type {DevelopmentMode, LLMClient} from '@/types/index';

export interface AcpInitContext {
	client: LLMClient;
	toolManager: ToolManager;
	customCommandLoader: CustomCommandLoader;
	provider: string;
	model: string;
	/**
	 * Starting mode of every session (`--mode`). When unset, sessions start in
	 * `defaultMode` from agents.config.json, then `auto-accept`.
	 */
	initialMode?: DevelopmentMode;
}
