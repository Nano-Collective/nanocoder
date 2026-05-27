import type {AgentSideConnection} from '@agentclientprotocol/sdk';
import type {CustomCommandLoader} from '@/custom-commands/loader';
import type {ToolManager} from '@/tools/tool-manager';
import type {LLMClient} from '@/types/index';

export interface AcpInitContext {
	client: LLMClient;
	toolManager: ToolManager;
	customCommandLoader: CustomCommandLoader;
	provider: string;
	model: string;
}

export interface AcpAgentContext {
	initContext: AcpInitContext;
	conn: AgentSideConnection;
}
