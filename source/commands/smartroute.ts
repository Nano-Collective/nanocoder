import {createStubCommand} from '@/commands/create-stub-command';

/**
 * The /smartroute command toggles smart auto-routing (Issue #891).
 *
 * Smart routing automatically sends trivial/simple turns to a fast, cheap
 * model while reserving the user's primary ("strong") model for complex
 * reasoning tasks.
 *
 * Subcommands:
 *   /smartroute           - Show current smart routing status
 *   /smartroute on        - Enable smart routing
 *   /smartroute off       - Disable smart routing
 *   /smartroute simple <model> - Set the model used for simple turns
 *   /smartroute threshold <low|medium|high> - Set classifier sensitivity
 *
 * Actual handling lives in app-util.ts (handleSmartRouteCommand) because
 * it needs access to app state (smartRouting, setSmartRouting, client).
 */
export const smartrouteCommand = createStubCommand(
	'smartroute',
	'Toggle smart auto-routing between simple and strong models',
);
