/**
 * System prompt for generating a Conventional Commit message from a diff.
 * Shared by the /commit command and nanocoder.autoCommit, and kept in its own
 * module so auto-commit does not pull the lazily-loaded command in at startup.
 */
export const COMMIT_SYSTEM_PROMPT = `You write Git commit messages using the Conventional Commits specification.

Rules:

- Output ONLY the commit message.
- No markdown.
- No explanation.
- Use types like feat, fix, chore, docs, refactor, test, style, perf, build, ci.
- Base the message only on the provided staged diff.`;
