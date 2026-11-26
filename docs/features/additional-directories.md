# Additional working directories

Add a sibling repository, shared library, or documentation checkout without changing the primary project:

```bash
nanocoder --add-dir ../shared-library --add-dir-ro ../docs
nanocoder --add-dir ../frontend --add-dir ../backend
nanocoder --add-dir ../shared-library run "Explain how this service uses the library"
```

Both flags are repeatable and accept `--add-dir=/absolute/path`. Quote paths containing spaces. Each directory must exist and pass the normal directory trust check before it becomes accessible. Interactive sessions show the existing trust prompt for each untrusted directory. Non-interactive sessions refuse untrusted additions; `--trust-directory` bypasses trust for this run, and `NANOCODER_TRUST_DIRECTORY=1` records trust, as for the primary directory.

You can also configure roots in `agents.config.json`:

```json
{
  "nanocoder": {
    "additionalDirectories": [
      "../shared-library",
      {"path": "../docs", "mode": "read-only"}
    ]
  }
}
```

Directory arguments and relative config entries resolve against the primary project. These directories grant file access only: they do not change the primary root, AGENTS.md loading, git context, or project configuration. Configuration is read from the primary project as usual.

Add a directory during an interactive session with:

```text
/add-dir ../shared-library
/add-dir --read-only "../reference docs"
/status
```

Declining the `/add-dir` trust prompt cancels the addition. `/status` lists active directories and their access modes. Re-adding a read-only directory does not upgrade it to writable; start a new session to change that restriction.

File reads, directory listings, file discovery, content search, and `@file` completion recognize all active roots. Each root uses its own `.gitignore` and `.nanocoderignore` rules. Discovery and completion use absolute paths for files in additional roots, so files with the same name remain distinguishable. Use those absolute paths in file tools and mentions. Relative file-tool paths retain the existing behavior of following the shell's current directory after `cd`; relative mentions resolve against the primary project.

Read-only roots reject built-in file edits, writes, deletes, moves, and export/share writes, including paths reached through symlinks or overlapping writable roots. Copying a file from a read-only root into a writable root is allowed.

Read-only is a restriction on Nanocoder's file operations, not an OS sandbox. Bash commands, MCP servers, plugins, and external programs still run with your account's permissions. Symlinks to directories outside all active roots remain inaccessible to file tools.
