import {existsSync, mkdirSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import React from 'react';
import {ErrorMessage, SuccessMessage} from '@/components/message-box';
import type {MessageSubmissionOptions} from '@/types/index';

/**
 * Handles /schedule start — enters scheduler mode.
 * Returns true if handled.
 */
export async function handleScheduleStart(
	commandParts: string[],
	options: MessageSubmissionOptions,
): Promise<boolean> {
	if (commandParts[0] !== 'schedule' || commandParts[1] !== 'start') {
		return false;
	}

	const {onEnterSchedulerMode, onCommandComplete} = options;

	if (onEnterSchedulerMode) {
		onEnterSchedulerMode();
		onCommandComplete?.();
	} else {
		options.onAddToChatQueue(
			React.createElement(ErrorMessage, {
				key: `schedule-error-${options.getNextComponentKey()}`,
				message: 'Scheduler mode is not available.',
			}),
		);
		onCommandComplete?.();
	}

	return true;
}

/**
 * Creates a markdown file with frontmatter template and asks the AI to help write it.
 * Shared logic for /schedule create and /commands create.
 */
async function handleFileCreate(
	fileName: string | undefined,
	dirName: string,
	entityName: string,
	aiPrompt: (safeName: string, commandBaseName: string) => string,
	options: MessageSubmissionOptions,
): Promise<boolean> {
	const {
		onAddToChatQueue,
		onHandleChatMessage,
		onCommandComplete,
		getNextComponentKey,
	} = options;

	if (!fileName) {
		onAddToChatQueue(
			React.createElement(ErrorMessage, {
				key: `${entityName}-create-error-${getNextComponentKey()}`,
				message: `Usage: /${entityName} create <name>\nExample: /${entityName} create ${entityName === 'schedule' ? 'deps-update' : 'review-code'}`,
			}),
		);
		onCommandComplete?.();
		return true;
	}

	const safeName = fileName.endsWith('.md') ? fileName : `${fileName}.md`;
	const targetDir = join(process.cwd(), '.nanocoder', dirName);
	const filePath = join(targetDir, safeName);

	if (existsSync(filePath)) {
		onAddToChatQueue(
			React.createElement(ErrorMessage, {
				key: `${entityName}-create-exists-${getNextComponentKey()}`,
				message: `${entityName === 'schedule' ? 'Schedule' : 'Command'} file already exists: .nanocoder/${dirName}/${safeName}`,
			}),
		);
		onCommandComplete?.();
		return true;
	}

	mkdirSync(targetDir, {recursive: true});

	const template = `---
description: ${safeName.replace(/\.md$/, '')} ${entityName === 'schedule' ? 'scheduled command' : 'custom command'}
---

`;

	writeFileSync(filePath, template, 'utf-8');

	onAddToChatQueue(
		React.createElement(SuccessMessage, {
			key: `${entityName}-created-${getNextComponentKey()}`,
			message: `Created ${entityName} file: .nanocoder/${dirName}/${safeName}`,
			hideBox: true,
		}),
	);

	const commandBaseName = safeName.replace(/\.md$/, '');
	await onHandleChatMessage(aiPrompt(safeName, commandBaseName));

	return true;
}

/**
 * Handles /schedule create — creates the schedule file and prompts the AI to help write it.
 * Returns true if handled.
 */
export async function handleScheduleCreate(
	commandParts: string[],
	options: MessageSubmissionOptions,
): Promise<boolean> {
	if (commandParts[0] !== 'schedule' || commandParts[1] !== 'create') {
		return false;
	}

	return handleFileCreate(
		commandParts[2],
		'schedules',
		'schedule',
		safeName =>
			`I just created a new schedule command file at .nanocoder/schedules/${safeName}. Help me write the content for this scheduled task. Ask me what I want this scheduled job to do, then write the markdown prompt into the file using the write_file tool. The file should contain a clear prompt that instructs the AI agent what to do when this schedule runs. Keep the YAML frontmatter at the top with the description field.`,
		options,
	);
}

/**
 * Handles /commands create — creates the command file and prompts the AI to help write it.
 * Returns true if handled.
 */
export async function handleCommandCreate(
	commandParts: string[],
	options: MessageSubmissionOptions,
): Promise<boolean> {
	if (
		(commandParts[0] !== 'commands' && commandParts[0] !== 'custom-commands') ||
		commandParts[1] !== 'create'
	) {
		return false;
	}

	return handleFileCreate(
		commandParts[2],
		'commands',
		'commands',
		(safeName, commandBaseName) =>
			`I just created a new custom command file at .nanocoder/commands/${safeName}. Help me write the content for this command. Ask me what I want this command to do, then write the markdown prompt into the file using the write_file tool. The file should contain a clear prompt that instructs the AI what to do when this command is invoked via /${commandBaseName}. Keep the YAML frontmatter at the top.

Here is an example of the frontmatter format with all available fields:

---
description: Generate unit tests for a file
aliases: [test, unittest]
parameters: [filename]
tags: [testing, quality]
triggers: [write tests, unit test]
estimated-tokens: 2000
resources: true
category: testing
version: 1.0.0
author: user
examples:
  - /gen-tests src/utils.ts
  - /gen-tests lib/parser.ts
references: [docs/testing-guide.md]
dependencies: [lint]
---
Generate comprehensive unit tests for {{filename}}...

All fields are optional except description. Use whichever fields are appropriate for the user's needs. Parameters defined here can be used as {{param}} placeholders in the prompt body.`,
		options,
	);
}
