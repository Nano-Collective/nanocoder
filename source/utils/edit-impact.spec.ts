import test from 'ava';
import {estimateEditImpact} from './edit-impact.js';
import type {ChangeStatistics} from './change-calculator.js';

test('should estimate low impact for tiny changes (<10% of file)', t => {
	const changeStats: ChangeStatistics = {
		linesAdded: 5,
		linesRemoved: 5,
		netLineChange: 0,
		tokensAdded: 25,
		tokensRemoved: 25,
		netTokenChange: 0,
		changeType: 'replace',
		sizeImpact: 'tiny',
	};
	const fileSize = {lines: 100, tokens: 1_000};

	const impact = estimateEditImpact(changeStats, fileSize);

	t.is(impact.severity, 'low');
	t.false(impact.shouldWarn);
	t.is(impact.recommendations.length, 0);
});

test('should estimate medium impact for small changes (10-25% of file)', t => {
	const changeStats: ChangeStatistics = {
		linesAdded: 15,
		linesRemoved: 15,
		netLineChange: 0,
		tokensAdded: 75,
		tokensRemoved: 75,
		netTokenChange: 0,
		changeType: 'replace',
		sizeImpact: 'small',
	};
	const fileSize = {lines: 100, tokens: 1_000};

	const impact = estimateEditImpact(changeStats, fileSize);

	t.is(impact.severity, 'medium');
	t.false(impact.shouldWarn);
});

test('should estimate high impact for medium changes (25-50% of file)', t => {
	const changeStats: ChangeStatistics = {
		linesAdded: 35,
		linesRemoved: 35,
		netLineChange: 0,
		tokensAdded: 350,
		tokensRemoved: 350,
		netTokenChange: 0,
		changeType: 'replace',
		sizeImpact: 'medium',
	};
	const fileSize = {lines: 100, tokens: 1_000};

	const impact = estimateEditImpact(changeStats, fileSize);

	t.is(impact.severity, 'high');
	t.true(impact.shouldWarn);
});

test('should estimate critical impact for massive changes (>50% of file)', t => {
	const changeStats: ChangeStatistics = {
		linesAdded: 60,
		linesRemoved: 60,
		netLineChange: 0,
		tokensAdded: 600,
		tokensRemoved: 600,
		netTokenChange: 0,
		changeType: 'replace',
		sizeImpact: 'large',
	};
	const fileSize = {lines: 100, tokens: 1_000};

	const impact = estimateEditImpact(changeStats, fileSize);

	// 60% replace: (60 + 60) / 100 = 1.2 (120%), which is > 50% threshold
	t.is(impact.severity, 'critical');
	t.true(impact.shouldWarn);
});

test('should generate description for insert changes', t => {
	const changeStats: ChangeStatistics = {
		linesAdded: 10,
		linesRemoved: 0,
		netLineChange: 10,
		tokensAdded: 50,
		tokensRemoved: 0,
		netTokenChange: 50,
		changeType: 'insert',
		sizeImpact: 'small',
	};
	const fileSize = {lines: 100, tokens: 1_000};

	const impact = estimateEditImpact(changeStats, fileSize);

	t.true(impact.description.includes('Adding'));
	t.true(impact.description.includes('10 lines'));
});

test('should generate description for delete changes', t => {
	const changeStats: ChangeStatistics = {
		linesAdded: 0,
		linesRemoved: 10,
		netLineChange: -10,
		tokensAdded: 0,
		tokensRemoved: 50,
		netTokenChange: -50,
		changeType: 'delete',
		sizeImpact: 'small',
	};
	const fileSize = {lines: 100, tokens: 1_000};

	const impact = estimateEditImpact(changeStats, fileSize);

	t.true(impact.description.includes('Removing'));
	t.true(impact.description.includes('10 lines'));
});

test('should generate description for replace changes with net zero', t => {
	const changeStats: ChangeStatistics = {
		linesAdded: 10,
		linesRemoved: 10,
		netLineChange: 0,
		tokensAdded: 50,
		tokensRemoved: 50,
		netTokenChange: 0,
		changeType: 'replace',
		sizeImpact: 'small',
	};
	const fileSize = {lines: 100, tokens: 1_000};

	const impact = estimateEditImpact(changeStats, fileSize);

	t.true(impact.description.includes('Replacing'));
});

test('should generate description for replace changes with net positive', t => {
	const changeStats: ChangeStatistics = {
		linesAdded: 15,
		linesRemoved: 10,
		netLineChange: 5,
		tokensAdded: 75,
		tokensRemoved: 50,
		netTokenChange: 25,
		changeType: 'replace',
		sizeImpact: 'small',
	};
	const fileSize = {lines: 100, tokens: 1_000};

	const impact = estimateEditImpact(changeStats, fileSize);

	t.true(impact.description.includes('net +5'));
});

test('should generate description for replace changes with net negative', t => {
	const changeStats: ChangeStatistics = {
		linesAdded: 10,
		linesRemoved: 15,
		netLineChange: -5,
		tokensAdded: 50,
		tokensRemoved: 75,
		netTokenChange: -25,
		changeType: 'replace',
		sizeImpact: 'small',
	};
	const fileSize = {lines: 100, tokens: 1_000};

	const impact = estimateEditImpact(changeStats, fileSize);

	t.true(impact.description.includes('net -5'));
});

test('should provide recommendations for large changes (>50%)', t => {
	const changeStats: ChangeStatistics = {
		linesAdded: 60,
		linesRemoved: 60,
		netLineChange: 0,
		tokensAdded: 600,
		tokensRemoved: 600,
		netTokenChange: 0,
		changeType: 'replace',
		sizeImpact: 'large',
	};
	const fileSize = {lines: 100, tokens: 1_000};

	const impact = estimateEditImpact(changeStats, fileSize);

	t.true(
		impact.recommendations.some(r =>
			r.includes('breaking this into smaller'),
		),
	);
});

test('should provide recommendations for large replacement (>30%)', t => {
	const changeStats: ChangeStatistics = {
		linesAdded: 35,
		linesRemoved: 35,
		netLineChange: 0,
		tokensAdded: 350,
		tokensRemoved: 350,
		netTokenChange: 0,
		changeType: 'replace',
		sizeImpact: 'medium',
	};
	const fileSize = {lines: 100, tokens: 1_000};

	const impact = estimateEditImpact(changeStats, fileSize);

	t.true(impact.recommendations.some(r => r.includes('Large replacement')));
});

test('should provide recommendations for large deletion (>25%)', t => {
	const changeStats: ChangeStatistics = {
		linesAdded: 0,
		linesRemoved: 30,
		netLineChange: -30,
		tokensAdded: 0,
		tokensRemoved: 300,
		netTokenChange: -300,
		changeType: 'delete',
		sizeImpact: 'medium',
	};
	const fileSize = {lines: 100, tokens: 1_000};

	const impact = estimateEditImpact(changeStats, fileSize);

	t.true(
		impact.recommendations.some(r => r.includes('Significant deletion')),
	);
});

test('should provide recommendations for large net additions (>50 lines)', t => {
	const changeStats: ChangeStatistics = {
		linesAdded: 60,
		linesRemoved: 0,
		netLineChange: 60,
		tokensAdded: 600,
		tokensRemoved: 0,
		netTokenChange: 600,
		changeType: 'insert',
		sizeImpact: 'large',
	};
	const fileSize = {lines: 100, tokens: 1_000};

	const impact = estimateEditImpact(changeStats, fileSize);

	t.true(
		impact.recommendations.some(r => r.includes('file organization')),
	);
});

test('should provide recommendations for large token changes (>500 tokens)', t => {
	const changeStats: ChangeStatistics = {
		linesAdded: 50,
		linesRemoved: 50,
		netLineChange: 0,
		tokensAdded: 600,
		tokensRemoved: 600,
		netTokenChange: 0,
		changeType: 'replace',
		sizeImpact: 'medium',
	};
	const fileSize = {lines: 100, tokens: 1_000};

	const impact = estimateEditImpact(changeStats, fileSize);

	t.true(
		impact.recommendations.some(r => r.includes('Large token change')),
	);
});

test('should handle empty file', t => {
	const changeStats: ChangeStatistics = {
		linesAdded: 5,
		linesRemoved: 0,
		netLineChange: 5,
		tokensAdded: 25,
		tokensRemoved: 0,
		netTokenChange: 25,
		changeType: 'insert',
		sizeImpact: 'tiny',
	};
	const fileSize = {lines: 0, tokens: 0};

	const impact = estimateEditImpact(changeStats, fileSize);

	// Should handle gracefully without division by zero
	t.is(impact.severity, 'critical'); // Any change to empty file is critical
});

test('should handle zero change', t => {
	const changeStats: ChangeStatistics = {
		linesAdded: 1,
		linesRemoved: 1,
		netLineChange: 0,
		tokensAdded: 5,
		tokensRemoved: 5,
		netTokenChange: 0,
		changeType: 'no-change',
		sizeImpact: 'tiny',
	};
	const fileSize = {lines: 100, tokens: 1_000};

	const impact = estimateEditImpact(changeStats, fileSize);

	t.is(impact.severity, 'low');
});

test('should include token impact in result', t => {
	const changeStats: ChangeStatistics = {
		linesAdded: 10,
		linesRemoved: 5,
		netLineChange: 5,
		tokensAdded: 100,
		tokensRemoved: 50,
		netTokenChange: 50,
		changeType: 'replace',
		sizeImpact: 'small',
	};
	const fileSize = {lines: 100, tokens: 1_000};

	const impact = estimateEditImpact(changeStats, fileSize);

	t.is(impact.tokenImpact, 50);
});

test('should classify as low impact when change is no-change', t => {
	const changeStats: ChangeStatistics = {
		linesAdded: 1,
		linesRemoved: 1,
		netLineChange: 0,
		tokensAdded: 5,
		tokensRemoved: 5,
		netTokenChange: 0,
		changeType: 'no-change',
		sizeImpact: 'tiny',
	};
	const fileSize = {lines: 100, tokens: 1_000};

	const impact = estimateEditImpact(changeStats, fileSize);

	t.is(impact.severity, 'low');
	t.false(impact.shouldWarn);
});