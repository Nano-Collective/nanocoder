import {execGit, hasStagedChanges} from '@/tools/git/utils';
import type {Command} from '@/types/commands';
import type {Message} from '@/types/core';
import {formatError} from '@/utils/error-formatter';
import {errorMsg, successMsg, warningMsg} from '@/utils/message-factory';

const COMMIT_SYSTEM_PROMPT = `You write Git commit messages using the Conventional Commits specification.

Rules:
- Output ONLY the commit message.
- No markdown.
- No explanation.
- Use types like feat, fix, chore, docs, refactor, test, style, perf, build, ci.
- Base the message only on the provided staged diff.`;

export const commitCommand: Command = {
	name: 'commit',
	description: 'Generate a conventional commit message from staged changes',
	handler: async (_args, _messages, metadata) => {
		const hasChanges = await hasStagedChanges();

		if (!hasChanges) {
			return warningMsg('No staged changes to commit.', 'commit');
		}

		const diff = await execGit(['diff', '--cached']);

		const client = metadata.client;

		if (!client) {
			return errorMsg('No active LLM client available.', 'commit');
		}

		const commitMessages: Message[] = [
			{
				role: 'system',
				content: COMMIT_SYSTEM_PROMPT,
			},
			{
				role: 'user',
				content: diff,
			},
		];

		try {
			const response = await client.chat(commitMessages, {}, {});

			const commitMessage = response?.choices?.[0]?.message?.content?.trim();

			if (!commitMessage) {
				return warningMsg('Model returned an empty commit message.', 'commit');
			}

			return successMsg(commitMessage, 'commit');
		} catch (error) {
			return errorMsg(formatError(error), 'commit');
		}
	},
};
