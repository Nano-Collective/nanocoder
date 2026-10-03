---
title: "Chat Channels"
description: "Message your local agent from Telegram, Slack, or Discord through the per-project daemon"
sidebar_order: 7
---

# Chat Channels

Chat channels let you talk to Nanocoder from your phone or your team's chat: "summarize the latest logs", "fix the build error", "is CI green?". Each message becomes a run on the per-project [daemon](skills.md#the-daemon) on your machine, and the answer comes back in the same chat.

Everything stays local-first. The daemon never opens a port, and the bridge only makes outbound connections to the platform (Telegram long polling, Slack Socket Mode, the Discord gateway), so it works from behind NAT, on a laptop, with no public URL.

## How it works

```
phone / team chat ──▶ Telegram · Slack · Discord ──▶ nanocoder channels start ──▶ daemon (IPC) ──▶ agent run
```

- **`nanocoder daemon start`** hosts the agent. It must be running for the project before the bridge starts.
- **`nanocoder channels start`** is a thin client of that daemon. It connects to the platforms you configured, forwards each accepted message to the daemon's `prompt` IPC method, and relays the result back. It runs in the foreground; stop it with Ctrl+C.
- Every run is a **headless** subagent run: no confirmation prompts, no questions back to you. The daemon snapshots the working tree first, so a run that went wrong can be reverted with `/checkpoint` in the terminal.

## Configuration

Channels live under `nanocoder.channels` in `agents.config.json`. Tokens should come from the environment via [variable substitution](../configuration/index.md#environment-variable-substitution) rather than being written into the file.

```json
{
  "nanocoder": {
    "channels": {
      "telegram": {
        "token": "${TELEGRAM_BOT_TOKEN}",
        "allowedUsers": [123456789]
      },
      "slack": {
        "botToken": "${SLACK_BOT_TOKEN}",
        "appToken": "${SLACK_APP_TOKEN}",
        "allowedUsers": ["U0123ABCD"],
        "allowedChats": ["C0456EFGH"]
      },
      "discord": {
        "token": "${DISCORD_BOT_TOKEN}",
        "allowedUsers": ["987654321098765432"],
        "mode": "plan"
      },
      "historyTurns": 6,
      "timeoutMs": 600000
    }
  }
}
```

Each platform block takes:

| Key | Required | Meaning |
|-----|----------|---------|
| `token` (Telegram, Discord), `botToken` + `appToken` (Slack) | yes | Platform credentials. |
| `allowedUsers` | yes | Platform user ids allowed to talk to the agent. Everyone else is ignored. A platform with an empty list is **not started**. |
| `allowedChats` | no | Group chats or channels where every message from an allowed user is handled. Elsewhere the bot only answers direct messages and @-mentions. |
| `mode` | no | `headless` (default) executes tools unattended. `plan` only reports what the agent would do, without changing files. |

Top-level keys:

| Key | Default | Meaning |
|-----|---------|---------|
| `historyTurns` | `6` | Earlier exchanges from the same chat carried into the next prompt, so follow-ups like "now fix the second one" make sense. `0` disables it. Max 50. |
| `timeoutMs` | `600000` (10 min) | How long the bridge waits for the daemon to answer one message before reporting a timeout. The run itself keeps going. |

`nanocoder config show nanocoder.channels` prints the resolved block with tokens redacted. Misconfigured platforms are reported as warnings at startup and skipped rather than started half-configured.

## Platform setup

### Telegram

1. Message [@BotFather](https://t.me/BotFather), run `/newbot`, and copy the token into `TELEGRAM_BOT_TOKEN`.
2. Find your numeric user id (for example by messaging [@userinfobot](https://t.me/userinfobot)) and put it in `allowedUsers`.
3. Start the bridge and send your bot a direct message.

In groups, Telegram's privacy mode (on by default) only delivers commands, @-mentions, and replies to the bot, which is exactly what the bridge answers anyway. To have the bot see every message in a group, disable privacy mode in BotFather and add the group's id to `allowedChats`.

### Slack

1. Create an app at [api.slack.com/apps](https://api.slack.com/apps).
2. Under **Socket Mode**, enable it and create an app-level token with the `connections:write` scope. That is `SLACK_APP_TOKEN` (`xapp-...`).
3. Under **OAuth & Permissions**, add the bot scopes `chat:write`, `app_mentions:read`, `im:history`, and `channels:history` (plus `reactions:write` if you want the 👀 acknowledgement). Install the app and copy the bot token into `SLACK_BOT_TOKEN` (`xoxb-...`).
4. Under **Event Subscriptions**, subscribe to the bot events `message.im`, `app_mention`, and `message.channels`.
5. Put your Slack member id (profile → ⋯ → Copy member ID) in `allowedUsers`.

In channels the bot answers when @-mentioned and replies in a thread; direct messages are answered flat. Slack swallows unknown slash commands before they reach a bot, so type `help` or `reset` as plain words there.

### Discord

1. Create an application at the [developer portal](https://discord.com/developers/applications), add a bot, and copy its token into `DISCORD_BOT_TOKEN`.
2. Under **Bot → Privileged Gateway Intents**, enable **Message Content Intent**. Without it the gateway refuses the connection and the bridge reports `disallowed intents`.
3. Invite the bot to your server with the `bot` scope and the Send Messages, Read Message History, and View Channels permissions.
4. Enable Developer Mode in Discord's settings, right-click your name → Copy User ID, and put it in `allowedUsers`.

In servers the bot answers @-mentions (or every message in channels listed in `allowedChats`) and quotes the message it is replying to; direct messages are answered flat. Replies never ping anyone, even if the model echoes an `@`.

## Running

```bash
nanocoder daemon start      # once per project
nanocoder channels start    # foreground; Ctrl+C to stop
nanocoder channels status   # configured platforms and daemon state
```

Run both from the project directory. Log lines show each run starting and finishing; the daemon's own log (`nanocoder daemon logs`) has the run details, including the checkpoint id.

To keep the bridge up when you are not at the machine, run it under `tmux`, `screen`, or a user service, the same way you would any long-running CLI.

## In the chat

- Send a message: it runs, and the reply is the agent's summary. Long replies are split to the platform's message limit; code fences are kept intact across the split.
- `/help` (or `help`): what the bridge is connected to and which commands it understands.
- `/reset` (or `reset`): forget the earlier messages in this chat.
- One run per chat at a time. A message sent while the previous one is still running gets a "still working" reply; send it again afterwards. Runs from different chats queue up on the daemon and execute one after another.

## Security

A chat channel is a way to run tools on your machine from anywhere, so the gate is `allowedUsers`:

- It is required. A platform block without at least one id is not started, and the bridge says why.
- Messages from anyone else are logged and dropped without a reply, so a bot in a public server does not advertise itself.
- Keep tokens in the environment. If a `${VAR}` is unset, the bridge reports it and skips that platform instead of sending the literal string as a credential.
- The daemon already refuses to start in an untrusted directory; the bridge inherits that boundary. Use `"mode": "plan"` for a channel that should only ever report.

## For other clients

The bridge talks to the daemon over its existing IPC socket (see [the daemon](skills.md#the-daemon)) using one new method:

```
{"id": 1, "method": "prompt", "params": {"prompt": "...", "mode": "headless" | "plan", "source": "label"}}
→ {"id": 1, "result": {"success": true, "output": "...", "durationMs": 1234, "checkpointId": "..."}}
```

Anything that can open the socket can use it, so an editor plugin, a script, or a future HTTP front door can drive the daemon the same way the chat adapters do.
