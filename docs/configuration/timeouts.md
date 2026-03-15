---
title: "Timeouts"
description: "Configure request timeouts and connection pooling for AI providers"
sidebar_order: 6
---

# Timeout Configuration

Nanocoder allows you to configure timeouts for your AI providers to handle long-running requests.

## Timeout Options

- `requestTimeout`: (Optional) The application-level timeout in milliseconds. This is the total time the application will wait for a response from the provider. If not set, it defaults to 2 minutes (120,000 ms). Set to `-1` to disable this timeout.
- `socketTimeout`: (Optional) The socket-level timeout in milliseconds. This controls the timeout for the underlying network connection. If not set, it will use the value of `requestTimeout`. Set to `-1` to disable this timeout.

It is recommended to set both `requestTimeout` and `socketTimeout` to the same value for consistent behavior. For very long-running requests, you can disable timeouts by setting both to `-1`.

## Connection Pool Configuration

- `connectionPool`: (Optional) An object to configure the connection pooling behavior for the underlying socket connection.
  - `idleTimeout`: (Optional) The timeout in milliseconds for how long an idle connection should be kept alive in the pool. Defaults to 4 seconds (4,000 ms).
  - `cumulativeMaxIdleTimeout`: (Optional) The maximum time in milliseconds a connection can be idle. Defaults to 10 minutes (600,000 ms).

## Example Configuration

```json
{
	"nanocoder": {
		"providers": [
			{
				"name": "llama-cpp",
				"baseUrl": "http://localhost:8080/v1",
				"models": ["qwen3-coder:a3b", "deepseek-v3.1"],
				"requestTimeout": -1,
				"socketTimeout": -1,
				"connectionPool": {
					"idleTimeout": 30000,
					"cumulativeMaxIdleTimeout": 3600000
				}
			}
		]
	}
}
```

This example disables both request and socket timeouts (useful for local models that may take a long time to respond) and configures the connection pool with a 30-second idle timeout and 1-hour cumulative max idle timeout.
