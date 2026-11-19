import {
	Agent,
	type Dispatcher,
	EnvHttpProxyAgent,
	setGlobalDispatcher,
} from 'undici';

const PROXY_ENV_VARS = [
	'HTTP_PROXY',
	'http_proxy',
	'HTTPS_PROXY',
	'https_proxy',
] as const;

/**
 * True when an HTTP(S) proxy is configured in the environment. `NO_PROXY` on
 * its own does not count: it only carves exceptions out of a proxy.
 */
export function hasProxyEnv(env: NodeJS.ProcessEnv = process.env): boolean {
	return PROXY_ENV_VARS.some(name => Boolean(env[name]?.trim()));
}

/**
 * Build the undici dispatcher for outbound traffic.
 *
 * Without proxy variables this is the plain `Agent` nanocoder has always
 * used. With `HTTP_PROXY` / `HTTPS_PROXY` (either case) it is an
 * `EnvHttpProxyAgent`, which also applies `NO_PROXY`.
 *
 * `options` are the usual `Agent` options. A proxying agent ignores `connect`
 * for upstream sockets (it is used for the proxy hop), so the connect timeout
 * and TLS options are repeated as `connectTimeout`, `requestTls` (the target)
 * and `proxyTls` (an https:// proxy). Hosts matched by `NO_PROXY` are still
 * reached through a plain `Agent` built from the original `connect` options.
 */
export function createDispatcher(
	options: Agent.Options = {},
	env: NodeJS.ProcessEnv = process.env,
): Dispatcher {
	if (!hasProxyEnv(env)) {
		return new Agent(options);
	}

	const {connect} = options;
	const {timeout, ...tls} =
		connect && typeof connect === 'object' ? connect : {timeout: undefined};
	return new EnvHttpProxyAgent({
		...options,
		...(timeout !== undefined ? {connectTimeout: timeout} : {}),
		requestTls: tls,
		proxyTls: tls,
	});
}

let globalInstalled = false;

/**
 * Route Node's global `fetch` (used by libraries such as get-md that take no
 * dispatcher option) through the proxy too. A no-op without proxy variables,
 * and only installs once.
 */
export async function installProxyGlobalDispatcher(
	env: NodeJS.ProcessEnv = process.env,
): Promise<void> {
	if (globalInstalled || !hasProxyEnv(env)) {
		return;
	}
	setGlobalDispatcher(createDispatcher({}, env));
	globalInstalled = true;
}
