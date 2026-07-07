/**
 * Clarification question trigger engine for Plan Mode (Issue #96).
 *
 * Pure, testable module: given a user message string, returns the set of
 * PlanQuestion objects that should be presented before the AI begins exploring.
 *
 * Phase 1 uses simple lowercased keyword matching. A future phase can swap
 * this for LLM-assisted analysis without changing the interface.
 */

import type {PlanQuestion, QuestionTemplate} from '@/types/plan';

// ============================================================================
// Template library
// ============================================================================

const TEMPLATES: QuestionTemplate[] = [
	// -------------------------------------------------------------------------
	// Ambiguity: Performance optimization
	// -------------------------------------------------------------------------
	{
		id: 'performance-focus',
		type: 'ambiguity',
		trigger: {
			patterns: ['optim', 'performance', 'speed', 'slow', 'fast', 'latency'],
			confidence: 0.75,
		},
		question: 'When you say "optimize performance", which metric matters most?',
		options: [
			'Response time / latency',
			'Memory usage',
			'CPU utilization',
			'Database query speed',
			'Throughput (requests/sec)',
		],
		allowFreeform: true,
	},

	// -------------------------------------------------------------------------
	// Decision: Authentication method
	// -------------------------------------------------------------------------
	{
		id: 'auth-method',
		type: 'decision',
		trigger: {
			patterns: [
				'auth',
				'login',
				'signin',
				'sign-in',
				'jwt',
				'session',
				'oauth',
			],
			confidence: 0.9,
		},
		question: 'What authentication approach should I plan for?',
		options: [
			'JWT tokens',
			'Session-based',
			'OAuth2 / social login',
			'API key',
		],
		optionMeta: [
			{
				label: 'JWT tokens',
				description: 'Stateless, signed tokens',
				pros: ['Scalable', 'Stateless', 'Industry standard'],
				cons: ['Cannot revoke without blocklist', 'Larger payload'],
			},
			{
				label: 'Session-based',
				description: 'Server-side session storage',
				pros: ['Easy to revoke', 'Simple implementation'],
				cons: [
					'Requires session store',
					'Not horizontally scalable by default',
				],
			},
			{
				label: 'OAuth2 / social login',
				description: 'Delegated auth (Google, GitHub…)',
				pros: ['No password management', 'Social login support'],
				cons: ['External dependency', 'Complex setup'],
			},
			{
				label: 'API key',
				description: 'Simple static keys for service-to-service calls',
				pros: ['Simple', 'Stateless'],
				cons: ['No user context', 'Key rotation complexity'],
			},
		],
		allowFreeform: false,
	},

	// -------------------------------------------------------------------------
	// Decision: Database type
	// -------------------------------------------------------------------------
	{
		id: 'database-type',
		type: 'decision',
		trigger: {
			patterns: [
				'database',
				'db',
				'storage',
				'persist',
				'postgres',
				'mongo',
				'sqlite',
				'mysql',
			],
			confidence: 0.85,
		},
		question: 'What type of database should I plan for?',
		options: ['PostgreSQL', 'MongoDB', 'SQLite', 'MySQL / MariaDB', 'Redis'],
		optionMeta: [
			{
				label: 'PostgreSQL',
				description: 'Relational, ACID-compliant',
				pros: ['Strong consistency', 'Complex queries', 'JSON support'],
				cons: ['Schema migrations needed', 'Vertical scaling default'],
			},
			{
				label: 'MongoDB',
				description: 'Document database, flexible schema',
				pros: ['Schema flexibility', 'Horizontal scaling', 'JSON native'],
				cons: ['Eventual consistency risk', 'No joins'],
			},
			{
				label: 'SQLite',
				description: 'File-based, zero config',
				pros: ['Zero configuration', 'Portable', 'Simple'],
				cons: ['Single writer lock', 'Not for high concurrency'],
			},
			{
				label: 'MySQL / MariaDB',
				description: 'Popular relational DB',
				pros: ['Widely supported', 'Good performance'],
				cons: ['Less feature-rich than Postgres'],
			},
			{
				label: 'Redis',
				description: 'In-memory key-value store',
				pros: ['Extremely fast', 'Good for caching/sessions'],
				cons: ['Not a primary data store', 'Data size limited by RAM'],
			},
		],
		allowFreeform: false,
	},

	// -------------------------------------------------------------------------
	// Decision: API style
	// -------------------------------------------------------------------------
	{
		id: 'api-style',
		type: 'decision',
		trigger: {
			patterns: ['api', 'endpoint', 'rest', 'graphql', 'grpc', 'rpc'],
			confidence: 0.8,
		},
		question: 'What API style should I plan for?',
		options: ['REST', 'GraphQL', 'gRPC', 'tRPC'],
		optionMeta: [
			{
				label: 'REST',
				description: 'Standard HTTP verbs and resources',
				pros: ['Universal support', 'Simple', 'Cacheable'],
				cons: ['Over/under-fetching', 'Multiple round trips'],
			},
			{
				label: 'GraphQL',
				description: 'Query language for flexible data fetching',
				pros: ['Precise data fetching', 'Strong typing', 'Single endpoint'],
				cons: ['Complex setup', 'Caching harder'],
			},
			{
				label: 'gRPC',
				description: 'Binary protocol, contract-first',
				pros: ['High performance', 'Streaming', 'Strongly typed'],
				cons: ['Browser support limited', 'Protobuf learning curve'],
			},
			{
				label: 'tRPC',
				description: 'End-to-end type-safe TypeScript APIs',
				pros: ['Zero schema boilerplate', 'Full TypeScript inference'],
				cons: ['TypeScript only', 'Less ecosystem tooling'],
			},
		],
		allowFreeform: false,
	},

	// -------------------------------------------------------------------------
	// Decision: Architecture style
	// -------------------------------------------------------------------------
	{
		id: 'architecture-style',
		type: 'decision',
		trigger: {
			patterns: [
				'architect',
				'structur',
				'microservice',
				'monolith',
				'service',
			],
			confidence: 0.7,
		},
		question: 'What application architecture should I plan for?',
		options: ['Monolith', 'Modular monolith', 'Microservices'],
		optionMeta: [
			{
				label: 'Monolith',
				description: 'Single deployable application',
				pros: ['Simple to develop and debug', 'Lower operational overhead'],
				cons: ['Harder to scale independently', 'Tight coupling risk'],
			},
			{
				label: 'Modular monolith',
				description: 'Single app with clear module boundaries',
				pros: ['Balanced approach', 'Easier to migrate later'],
				cons: ['Still a single deployment unit'],
			},
			{
				label: 'Microservices',
				description: 'Independent services per domain',
				pros: ['Independent scaling', 'Technology diversity'],
				cons: ['High operational complexity', 'Network latency'],
			},
		],
		allowFreeform: false,
	},

	// -------------------------------------------------------------------------
	// Ambiguity: Scope of refactoring
	// -------------------------------------------------------------------------
	{
		id: 'refactor-scope',
		type: 'ambiguity',
		trigger: {
			patterns: ['refactor', 'rewrite', 'clean up', 'cleanup', 'reorganize'],
			confidence: 0.75,
		},
		question: 'How broad should the refactoring be?',
		options: [
			'Target a specific file or module only',
			'Entire feature area (multiple files)',
			'Full codebase restructuring',
		],
		allowFreeform: true,
	},

	// -------------------------------------------------------------------------
	// Confirmation: Error handling strategy
	// -------------------------------------------------------------------------
	{
		id: 'error-handling',
		type: 'confirmation',
		trigger: {
			patterns: ['error handling', 'exception', 'resilient', 'robust', 'fault'],
			confidence: 0.65,
		},
		question: 'What error handling strategy should I plan for?',
		options: [
			'Graceful degradation with fallbacks',
			'Fail fast with detailed error messages',
			'Retry with exponential backoff',
			'Circuit breaker pattern',
		],
		allowFreeform: true,
	},

	// -------------------------------------------------------------------------
	// Ambiguity: Testing strategy
	// -------------------------------------------------------------------------
	{
		id: 'testing-scope',
		type: 'ambiguity',
		trigger: {
			patterns: [
				'test',
				'spec',
				'coverage',
				'unit test',
				'integration test',
				'e2e',
			],
			confidence: 0.7,
		},
		question: 'What level of testing should I include in the plan?',
		options: [
			'Unit tests only',
			'Unit + integration tests',
			'Unit + integration + E2E tests',
			'Just outline what to test (no spec files)',
		],
		allowFreeform: false,
	},
];

// ============================================================================
// Public API
// ============================================================================

export interface ClarificationContext {
	/** Whether the project already has files (affects scope questions). */
	hasFiles?: boolean;
}

/**
 * Given a user message and optional project context, returns an ordered list
 * of PlanQuestion objects that should be presented before plan generation.
 *
 * At most 3 questions are returned (per plan mode guidance) to avoid friction.
 * Questions are de-duped and sorted by descending confidence.
 */
export function buildClarificationQuestions(
	message: string,
	_context: ClarificationContext = {},
): PlanQuestion[] {
	const lower = message.toLowerCase();

	const matched: Array<{template: QuestionTemplate; confidence: number}> = [];

	for (const template of TEMPLATES) {
		const {patterns, confidence} = template.trigger;
		if (patterns.some(p => lower.includes(p))) {
			matched.push({template, confidence});
		}
	}

	// Sort by confidence descending, keep top 3
	matched.sort((a, b) => b.confidence - a.confidence);
	const top = matched.slice(0, 3);

	return top.map(({template}) => ({
		id: template.id,
		type: template.type,
		question: template.question,
		options: template.options,
		optionMeta: template.optionMeta,
		allowFreeform: template.allowFreeform ?? true,
	}));
}
