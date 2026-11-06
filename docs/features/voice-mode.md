---
title: "Voice Mode"
description: "Talk to Nanocoder with push-to-talk or hands-free speech, and hear its replies"
sidebar_order: 18
---

# Voice Mode

Voice mode lets you speak prompts instead of typing them and hear responses read back. Speech-to-text runs locally with Whisper and text-to-speech runs locally with Piper by default, so no audio leaves your machine unless you opt in to the OpenAI cloud backends.

## Turning It On

```bash
/voice          # toggle voice mode on or off
/voice on       # turn it on
/voice off      # turn it off
```

The first time voice mode needs its audio tools and they are missing, Nanocoder asks before installing them (see [Installing the Audio Tools](#installing-the-audio-tools)). Declining skips the install for the rest of the session.

## Commands

- `/voice` - toggle voice mode on or off.
- `/voice on` / `/voice off` - turn voice mode on or off explicitly.
- `/voice ptt` (or `/voice push-to-talk`) - switch to push-to-talk.
- `/voice hands-free` - switch to hands-free speech detection.
- `/voice mode <push-to-talk|hands-free>` - set the activation mode. With no argument it shows the current mode.
- `/voice stt <local|cloud>` - choose the speech-to-text backend. With no argument it shows the current one.
- `/voice tts <local|cloud>` - choose the text-to-speech backend. With no argument it shows the current one.
- `/voice status` - show whether voice mode is on, the activation mode and both backends.

Settings are saved to your preferences file and apply to later sessions.

## Push-to-Talk and Hands-Free

In **push-to-talk** mode (the default), press **Ctrl+G** to start recording and press it again to stop and send what you said. Ctrl+G works once voice mode is on and no prompt, confirmation or question is on screen.

In **hands-free** mode, Nanocoder listens continuously and starts recording when it detects speech. Speech has to last about 300 ms before it counts, so a cough or a door does not trigger it. Hands-free speech is ignored while a typed prompt is running, while a confirmation is on screen, and while a response is being spoken (so the speakers cannot interrupt themselves).

Pressing Ctrl+G while a response is running or being spoken interrupts it (barge-in).

Hands-free mode is paused in [yolo mode](development-modes.md#yolo-mode), so background speech cannot trigger tool calls that run without confirmation. Switch mode with Shift+Tab, or use `/voice ptt`.

## The Mode Line

While voice mode is on, its state shows on the mode line under the prompt:

- `voice (Ctrl+G to talk)` - idle in push-to-talk mode. In hands-free mode the hint reads `waiting for speech`, and when voice input is unavailable it gives the reason instead.
- `● listening` - recording.
- `transcribing…` - turning the recording into text.
- `speaking` - reading the response aloud.

Voice notices, such as an install result or a cloud fallback, print as plain lines in the chat.

## Local and Cloud Backends

Local is the default for both directions:

- **Speech-to-text:** `whisper-cli` from whisper.cpp with the `ggml-base.en.bin` model.
- **Text-to-speech:** Piper with the `en_US-lessac-medium` voice.
- **Recording and playback:** SoX (`rec` and `play`).

`/voice stt cloud` sends microphone audio to OpenAI's transcription endpoint (`whisper-1`), and `/voice tts cloud` sends the response text to OpenAI's speech endpoint. Both are opt-in. They only work when the current provider is OpenAI itself (named `openai`, with no `baseURL` or with `https://api.openai.com`); generic OpenAI-compatible providers such as Ollama, LM Studio or OpenRouter are refused. The provider's `apiKey` is used, falling back to `OPENAI_API_KEY`. If a cloud request fails, that request falls back to the local backend and a notice says so.

## Installing the Audio Tools

Nanocoder checks for SoX, `whisper-cli` with its model, and Piper, and offers to install whatever is missing. Everything it downloads goes into `voice-bin/` inside your Nanocoder config directory, over HTTPS with SHA-256 checksums verified. Installer output is captured rather than drawn over the UI, and a failure shows its last lines.

- **macOS** - Homebrew installs only the tools that are missing: `sox`, `whisper.cpp`, or both. Nothing is installed if they already work. On Apple silicon, native Homebrew in `/opt/homebrew` is preferred over an Intel Homebrew in `/usr/local`. If Homebrew fails, the error explains common causes in a few lines (for example Intel Homebrew running under Rosetta, or an outdated Xcode or Command Line Tools) and gives the command to rerun for the full output. The Whisper model and Piper are then downloaded.
- **Linux** - SoX is installed with `apt-get` (directly as root, otherwise with non-interactive `sudo`). whisper.cpp is built from a checksummed release source tarball with CMake, falling back to `make`. The Whisper model and Piper are downloaded.
- **Windows** - SoX is installed with `winget` (`Sox.Sox`). If winget is unavailable or fails, install SoX yourself and put `sox.exe` on your `PATH`. The whisper.cpp and Piper Windows binaries and the models are downloaded.

If an install step fails, install that tool yourself and run `/voice` again.

## Preferences

Voice settings live in the `voice` block of your [preferences file](../configuration/preferences.md). `/voice` writes it for you; the defaults are:

```json
{
  "voice": {
    "enabled": false,
    "activationMode": "push-to-talk",
    "sttBackend": "local",
    "ttsBackend": "local"
  }
}
```

An optional `voiceName` sets the cloud TTS voice (default `alloy`).

## Environment Overrides

These override the tools and models the local backends use:

- `WHISPER_MODEL` - path to the Whisper ggml model.
- `WHISPER_CMD` - the Whisper command (default `whisper-cli`).
- `PIPER_MODEL` - path to the Piper voice model.
- `PIPER_CMD` - the Piper command (default `piper`).
- `REC_CMD` - the recording command (default `rec`, or `sox` on Windows).
- `PLAY_CMD` - the playback command (default `play`).
