/**
 * Task Decomposer
 *
 * Uses the LLM to break down complex queries into atomic,
 * executable subtasks with clear dependencies.
 */

import type {LLMClient} from '@/types/core';
import type {
	QueryAnalysis,
	TaskDefinition,
	TaskPlan,
	PlanningConfig,
} from './types';
import {DEFAULT_PLANNING_CONFIG} from './types';
import {TaskStore} from './task-store';

/**
 * Available tools that tasks can use
 */
const AVAILABLE_TOOLS = [
	'read_file',
	'create_file',
	'insert_lines',
	'replace_lines',
	'delete_lines',
	'search_files',
	'execute_bash',
	'fetch_url',
	'web_search',
];

/**
 * Generates a unique task ID
 */
function generateTaskId(index: number): string {
	return `task-${index + 1}-${Date.now().toString(36)}`;
}

/**
 * Build the decomposition prompt for the LLM
 */
function buildDecompositionPrompt(
	query: string,
	analysis: QueryAnalysis,
	config: PlanningConfig,
): string {
	return `You are a task planning assistant. Break down the user's request into small, atomic tasks.

## User Request
${query}

## Analysis
- Task Type: ${analysis.taskType}
${
	analysis.requiredContext.length > 0
		? `- Mentioned Context: ${analysis.requiredContext.join(', ')}`
		: ''
}

## Instructions

Break this request into discrete tasks (minimum 2, maximum ${
		config.maxTasksPerPlan
	}). Each task should:

1. Be completable in isolation with focused context
2. Have clear, verifiable acceptance criteria
3. List any dependencies on other tasks (by task number)
4. Specify which tools it will likely need

Available tools: ${AVAILABLE_TOOLS.join(', ')}

## Task Types Guidelines

- **Research/Read tasks**: Read files, search codebase, gather information (use: read_file, search_files)
- **Output/Respond tasks**: Summarize findings, answer questions, present results (no tools, just reasoning)
- **Implementation tasks**: Create or modify files (use: create_file, insert_lines, replace_lines, delete_lines)
- **Verification tasks**: Run tests, check output (use: execute_bash)

**Important**: Always separate information gathering (reading/searching) from presenting results.

## Output Format

Respond with a JSON array of tasks:

\`\`\`json
[
  {
    "title": "Short descriptive title",
    "description": "Detailed description of what to do",
    "acceptanceCriteria": ["Criterion 1", "Criterion 2"],
    "dependencies": [],
    "requiredTools": ["tool1", "tool2"]
  }
]
\`\`\`

## Rules

1. ALWAYS create at least 2 tasks - separate reading/gathering from outputting/responding
2. First task should usually be research/exploration unless the location is already known
3. Last task should present results or respond to the user
4. Tasks should be ordered so dependencies come before dependent tasks
5. Dependencies are specified as task indices (0-based): if task 2 depends on task 1, use [1]
6. Keep task descriptions focused - a task should do ONE thing
7. Maximum ${config.maxTasksPerPlan} tasks total

Now break down the user's request into tasks:`;
}

/**
 * Parse the LLM response into task definitions
 */
function parseDecompositionResponse(response: string): TaskDefinition[] | null {
	// Try to extract JSON from the response
	const jsonMatch = response.match(/```(?:json)?\s*([\s\S]*?)```/);
	const jsonStr = jsonMatch ? jsonMatch[1].trim() : response.trim();

	try {
		const parsed = JSON.parse(jsonStr);

		if (!Array.isArray(parsed)) {
			console.error('Decomposition response is not an array');
			return null;
		}

		// Validate and transform each task
		const tasks: TaskDefinition[] = [];

		for (let i = 0; i < parsed.length; i++) {
			const item = parsed[i];

			// Validate required fields
			if (!item.title || typeof item.title !== 'string') {
				console.error(`Task ${i} missing title`);
				continue;
			}
			if (!item.description || typeof item.description !== 'string') {
				console.error(`Task ${i} missing description`);
				continue;
			}

			// Build task definition with defaults
			const task: TaskDefinition = {
				id: generateTaskId(i),
				title: item.title,
				description: item.description,
				acceptanceCriteria: Array.isArray(item.acceptanceCriteria)
					? item.acceptanceCriteria
					: [],
				dependencies: [], // Will be resolved after all tasks are created
				requiredTools: Array.isArray(item.requiredTools)
					? item.requiredTools.filter((t: string) =>
							AVAILABLE_TOOLS.includes(t),
					  )
					: [],
			};

			tasks.push(task);
		}

		// Resolve dependencies (convert indices to task IDs)
		for (let i = 0; i < parsed.length; i++) {
			const item = parsed[i];
			if (Array.isArray(item.dependencies)) {
				const resolvedDeps: string[] = [];
				for (const dep of item.dependencies) {
					const depIndex = typeof dep === 'number' ? dep : parseInt(dep, 10);
					if (
						!isNaN(depIndex) &&
						depIndex >= 0 &&
						depIndex < tasks.length &&
						depIndex !== i
					) {
						resolvedDeps.push(tasks[depIndex].id);
					}
				}
				if (tasks[i]) {
					tasks[i].dependencies = resolvedDeps;
				}
			}
		}

		return tasks.length > 0 ? tasks : null;
	} catch (error) {
		console.error('Failed to parse decomposition response:', error);
		return null;
	}
}

/**
 * Create a fallback plan when LLM decomposition fails
 */
function createFallbackPlan(query: string): TaskDefinition[] {
	// Single task that encompasses the whole request
	return [
		{
			id: generateTaskId(0),
			title: `Complete: ${query.slice(0, 50)}${query.length > 50 ? '...' : ''}`,
			description: query,
			acceptanceCriteria: ['Task completed successfully'],
			dependencies: [],
			requiredTools: AVAILABLE_TOOLS.slice(0, 5), // Give access to common tools
		},
	];
}

/**
 * Decompose a query into tasks using the LLM
 */
async function decomposeQuery(
	client: LLMClient,
	query: string,
	analysis: QueryAnalysis,
	config: PlanningConfig = DEFAULT_PLANNING_CONFIG,
	signal?: AbortSignal,
): Promise<{tasks: TaskDefinition[]; usedFallback: boolean}> {
	const prompt = buildDecompositionPrompt(query, analysis, config);

	try {
		// Call the LLM to decompose the query
		const response = await client.chat(
			[
				{
					role: 'system',
					content: 'You are a task planning assistant that outputs JSON.',
				},
				{role: 'user', content: prompt},
			],
			{}, // No tools needed for planning
			signal,
		);

		if (!response?.choices?.[0]?.message?.content) {
			console.error('Empty response from LLM during decomposition');
			return {tasks: createFallbackPlan(query), usedFallback: true};
		}

		const content = response.choices[0].message.content;
		const tasks = parseDecompositionResponse(content);

		if (!tasks) {
			console.error('Failed to parse decomposition response');
			return {tasks: createFallbackPlan(query), usedFallback: true};
		}

		return {tasks, usedFallback: false};
	} catch (error) {
		if (error instanceof Error && error.message === 'Operation was cancelled') {
			throw error; // Re-throw cancellation
		}
		console.error('Error during query decomposition:', error);
		return {tasks: createFallbackPlan(query), usedFallback: true};
	}
}

/**
 * Create a complete task plan from a query
 */
export async function createTaskPlan(
	client: LLMClient,
	taskStore: TaskStore,
	query: string,
	analysis: QueryAnalysis,
	config: PlanningConfig = DEFAULT_PLANNING_CONFIG,
	signal?: AbortSignal,
): Promise<TaskPlan> {
	const {tasks} = await decomposeQuery(client, query, analysis, config, signal);
	return taskStore.createPlan(query, tasks);
}
