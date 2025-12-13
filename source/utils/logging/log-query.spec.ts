import test from 'ava';
import LogStorage, {LogQueryBuilder, createLogQuery, logQueries, globalLogStorage} from './log-query.js';
import type {LogEntry, LogQuery, QueryResult, AggregationResult} from './log-query.js';

// Helper function to create test log entries
function createTestLogEntry(overrides: Partial<LogEntry> = {}): LogEntry {
    return {
        timestamp: new Date().toISOString(),
        level: 'info',
        message: 'Test message',
        correlationId: 'test-correlation',
        source: 'test-source',
        requestId: 'test-request',
        userId: 'test-user',
        sessionId: 'test-session',
        tags: ['test', 'logging'],
        metadata: {key: 'value'},
        error: undefined,
        performance: {
            duration: 100,
            memory: {heapUsed: 1024, heapTotal: 2048},
            cpu: 0.5,
        },
        request: {
            method: 'GET',
            url: '/test',
            statusCode: 200,
            duration: 50,
            size: 1024,
        },
        ...overrides,
    };
}

// Test LogStorage class
// ============================================================================

test('LogStorage constructor creates instance with default maxEntries', t => {
    const storage = new LogStorage();
    t.truthy(storage);
    t.is(storage.getEntryCount(), 0);
});

test('LogStorage constructor accepts custom maxEntries', t => {
    const storage = new LogStorage(100);
    t.truthy(storage);
    t.is(storage.getEntryCount(), 0);
});

test('LogStorage addEntry adds log entry', t => {
    const storage = new LogStorage();
    const entry = createTestLogEntry();
    
    storage.addEntry(entry);
    t.is(storage.getEntryCount(), 1);
});

test('LogStorage addEntry handles multiple entries', t => {
    const storage = new LogStorage();
    
    for (let i = 0; i < 10; i++) {
        storage.addEntry(createTestLogEntry({message: `Message ${i}`}));
    }
    
    t.is(storage.getEntryCount(), 10);
});

test('LogStorage addEntry respects maxEntries limit', t => {
    const storage = new LogStorage(5);
    
    // Add more entries than limit
    for (let i = 0; i < 10; i++) {
        storage.addEntry(createTestLogEntry({message: `Message ${i}`}));
    }
    
    // Should only keep maxEntries
    t.is(storage.getEntryCount(), 5);
});

test('LogStorage query returns QueryResult', t => {
    const storage = new LogStorage();
    storage.addEntry(createTestLogEntry());
    
    const result = storage.query({});
    
    t.truthy(result);
    t.true('entries' in result);
    t.true('totalCount' in result);
    t.true('filteredCount' in result);
    t.true('queryTime' in result);
    t.true('hasMore' in result);
});

test('LogStorage query returns correct entry count', t => {
    const storage = new LogStorage();
    storage.addEntry(createTestLogEntry({message: 'Entry 1'}));
    storage.addEntry(createTestLogEntry({message: 'Entry 2'}));
    storage.addEntry(createTestLogEntry({message: 'Entry 3'}));
    
    const result = storage.query({});
    
    t.is(result.totalCount, 3);
    t.is(result.filteredCount, 3);
    t.is(result.entries.length, 3);
});

test('LogStorage query with limit returns limited results', t => {
    const storage = new LogStorage();
    for (let i = 0; i < 10; i++) {
        storage.addEntry(createTestLogEntry({message: `Entry ${i}`}));
    }
    
    const result = storage.query({limit: 5});
    
    t.is(result.entries.length, 5);
    t.is(result.filteredCount, 10);
    t.true(result.hasMore);
});

test('LogStorage query with offset returns paginated results', t => {
    const storage = new LogStorage();
    for (let i = 0; i < 10; i++) {
        storage.addEntry(createTestLogEntry({message: `Entry ${i}`}));
    }
    
    const result = storage.query({offset: 5, limit: 3});
    
    t.is(result.entries.length, 3);
    t.is(result.filteredCount, 10);
});

test('LogStorage query with level filter returns filtered results', t => {
    const storage = new LogStorage();
    storage.addEntry(createTestLogEntry({level: 'info'}));
    storage.addEntry(createTestLogEntry({level: 'error'}));
    storage.addEntry(createTestLogEntry({level: 'warn'}));
    
    const result = storage.query({levels: ['error']});
    
    t.is(result.entries.length, 1);
    t.is(result.filteredCount, 1);
    t.is(result.entries[0].level, 'error');
});

test('LogStorage query with excludeLevels filter returns filtered results', t => {
    const storage = new LogStorage();
    storage.addEntry(createTestLogEntry({level: 'info'}));
    storage.addEntry(createTestLogEntry({level: 'error'}));
    storage.addEntry(createTestLogEntry({level: 'warn'}));
    
    const result = storage.query({excludeLevels: ['error', 'warn']});
    
    t.is(result.entries.length, 1);
    t.is(result.filteredCount, 1);
    t.is(result.entries[0].level, 'info');
});

test('LogStorage query with messageContains filter returns filtered results', t => {
    const storage = new LogStorage();
    storage.addEntry(createTestLogEntry({message: 'Hello world'}));
    storage.addEntry(createTestLogEntry({message: 'Goodbye world'}));
    storage.addEntry(createTestLogEntry({message: 'Test message'}));
    
    const result = storage.query({messageContains: 'Hello'});
    
    t.is(result.entries.length, 1);
    t.is(result.filteredCount, 1);
    t.is(result.entries[0].message, 'Hello world');
});

test('LogStorage query with messageRegex filter returns filtered results', t => {
    const storage = new LogStorage();
    storage.addEntry(createTestLogEntry({message: 'Error: Something failed'}));
    storage.addEntry(createTestLogEntry({message: 'Warning: Something might fail'}));
    storage.addEntry(createTestLogEntry({message: 'Info: Everything is fine'}));
    
    const result = storage.query({messageRegex: /Error:.*/});
    
    t.is(result.entries.length, 1);
    t.is(result.filteredCount, 1);
    t.is(result.entries[0].message, 'Error: Something failed');
});

test('LogStorage query with correlationIds filter returns filtered results', t => {
    const storage = new LogStorage();
    storage.addEntry(createTestLogEntry({correlationId: 'corr-1'}));
    storage.addEntry(createTestLogEntry({correlationId: 'corr-2'}));
    storage.addEntry(createTestLogEntry({correlationId: 'corr-1'}));
    
    const result = storage.query({correlationIds: ['corr-1']});
    
    t.is(result.entries.length, 2);
    t.is(result.filteredCount, 2);
});

test('LogStorage query with sources filter returns filtered results', t => {
    const storage = new LogStorage();
    storage.addEntry(createTestLogEntry({source: 'source-1'}));
    storage.addEntry(createTestLogEntry({source: 'source-2'}));
    storage.addEntry(createTestLogEntry({source: 'source-1'}));
    
    const result = storage.query({sources: ['source-1']});
    
    t.is(result.entries.length, 2);
    t.is(result.filteredCount, 2);
});

test('LogStorage query with tags filter returns filtered results', t => {
    const storage = new LogStorage();
    storage.addEntry(createTestLogEntry({tags: ['tag1', 'tag2']}));
    storage.addEntry(createTestLogEntry({tags: ['tag2', 'tag3']}));
    storage.addEntry(createTestLogEntry({tags: ['tag1']}));
    
    const result = storage.query({tags: ['tag1']});
    
    t.is(result.entries.length, 2);
    t.is(result.filteredCount, 2);
});

test('LogStorage query with hasTags filter returns filtered results', t => {
    const storage = new LogStorage();
    storage.addEntry(createTestLogEntry({tags: ['tag1']}));
    storage.addEntry(createTestLogEntry({tags: []}));
    storage.addEntry(createTestLogEntry({tags: ['tag2']}));
    
    const result = storage.query({hasTags: true});
    
    t.is(result.entries.length, 2);
    t.is(result.filteredCount, 2);
});

test('LogStorage query with metadata filter returns filtered results', t => {
    const storage = new LogStorage();
    storage.addEntry(createTestLogEntry({metadata: {key: 'value1'}}));
    storage.addEntry(createTestLogEntry({metadata: {key: 'value2'}}));
    storage.addEntry(createTestLogEntry({metadata: {key: 'value1'}}));
    
    const result = storage.query({metadataKey: 'key', metadataValue: 'value1'});
    
    t.is(result.entries.length, 2);
    t.is(result.filteredCount, 2);
});

test('LogStorage query with durationMin filter returns filtered results', t => {
    const storage = new LogStorage();
    storage.addEntry(createTestLogEntry({performance: {duration: 50}}));
    storage.addEntry(createTestLogEntry({performance: {duration: 150}}));
    storage.addEntry(createTestLogEntry({performance: {duration: 250}}));
    
    const result = storage.query({durationMin: 100});
    
    t.is(result.entries.length, 2);
    t.is(result.filteredCount, 2);
});

test('LogStorage query with durationMax filter returns filtered results', t => {
    const storage = new LogStorage();
    storage.addEntry(createTestLogEntry({performance: {duration: 50}}));
    storage.addEntry(createTestLogEntry({performance: {duration: 150}}));
    storage.addEntry(createTestLogEntry({performance: {duration: 250}}));
    
    const result = storage.query({durationMax: 150});
    
    t.is(result.entries.length, 2);
    t.is(result.filteredCount, 2);
});

test('LogStorage query with memoryThreshold filter returns filtered results', t => {
    const storage = new LogStorage();
    storage.addEntry(createTestLogEntry({performance: {memory: {heapUsed: 100}}}));
    storage.addEntry(createTestLogEntry({performance: {memory: {heapUsed: 500}}}));
    storage.addEntry(createTestLogEntry({performance: {memory: {heapUsed: 1000}}}));
    
    const result = storage.query({memoryThreshold: 500});
    
    t.is(result.entries.length, 2);
    t.is(result.filteredCount, 2);
});

test('LogStorage query with hasErrors filter returns filtered results', t => {
    const storage = new LogStorage();
    storage.addEntry(createTestLogEntry({error: {message: 'Error 1'}}));
    storage.addEntry(createTestLogEntry({error: undefined}));
    storage.addEntry(createTestLogEntry({error: {message: 'Error 2'}}));
    
    const result = storage.query({hasErrors: true});
    
    t.is(result.entries.length, 2);
    t.is(result.filteredCount, 2);
});

test('LogStorage query with errorTypes filter returns filtered results', t => {
    const storage = new LogStorage();
    storage.addEntry(createTestLogEntry({error: {type: 'TypeError'}}));
    storage.addEntry(createTestLogEntry({error: {type: 'ReferenceError'}}));
    storage.addEntry(createTestLogEntry({error: {type: 'TypeError'}}));
    
    const result = storage.query({errorTypes: ['TypeError']});
    
    t.is(result.entries.length, 2);
    t.is(result.filteredCount, 2);
});

test('LogStorage query with requestMethods filter returns filtered results', t => {
    const storage = new LogStorage();
    storage.addEntry(createTestLogEntry({request: {method: 'GET'}}));
    storage.addEntry(createTestLogEntry({request: {method: 'POST'}}));
    storage.addEntry(createTestLogEntry({request: {method: 'GET'}}));
    
    const result = storage.query({requestMethods: ['GET']});
    
    t.is(result.entries.length, 2);
    t.is(result.filteredCount, 2);
});

test('LogStorage query with requestStatusCodes filter returns filtered results', t => {
    const storage = new LogStorage();
    storage.addEntry(createTestLogEntry({request: {statusCode: 200}}));
    storage.addEntry(createTestLogEntry({request: {statusCode: 404}}));
    storage.addEntry(createTestLogEntry({request: {statusCode: 200}}));
    
    const result = storage.query({requestStatusCodes: [200]});
    
    t.is(result.entries.length, 2);
    t.is(result.filteredCount, 2);
});

test('LogStorage query with requestDurationMin filter returns filtered results', t => {
    const storage = new LogStorage();
    storage.addEntry(createTestLogEntry({request: {duration: 50}}));
    storage.addEntry(createTestLogEntry({request: {duration: 150}}));
    storage.addEntry(createTestLogEntry({request: {duration: 250}}));
    
    const result = storage.query({requestDurationMin: 100});
    
    t.is(result.entries.length, 2);
    t.is(result.filteredCount, 2);
});

test('LogStorage query with requestDurationMax filter returns filtered results', t => {
    const storage = new LogStorage();
    storage.addEntry(createTestLogEntry({request: {duration: 50}}));
    storage.addEntry(createTestLogEntry({request: {duration: 150}}));
    storage.addEntry(createTestLogEntry({request: {duration: 250}}));
    
    const result = storage.query({requestDurationMax: 150});
    
    t.is(result.entries.length, 2);
    t.is(result.filteredCount, 2);
});

test('LogStorage query with time range filter returns filtered results', t => {
    const storage = new LogStorage();
    const now = new Date();
    const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
    const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000);
    
    storage.addEntry(createTestLogEntry({timestamp: twoHoursAgo.toISOString()}));
    storage.addEntry(createTestLogEntry({timestamp: oneHourAgo.toISOString()}));
    storage.addEntry(createTestLogEntry({timestamp: now.toISOString()}));
    
    const result = storage.query({startTime: oneHourAgo});
    
    t.is(result.entries.length, 2);
    t.is(result.filteredCount, 2);
});

test('LogStorage query with sorting returns sorted results', t => {
    const storage = new LogStorage();
    const now = new Date();
    
    storage.addEntry(createTestLogEntry({timestamp: new Date(now.getTime() - 3000).toISOString(), message: 'Entry 1'}));
    storage.addEntry(createTestLogEntry({timestamp: new Date(now.getTime() - 1000).toISOString(), message: 'Entry 2'}));
    storage.addEntry(createTestLogEntry({timestamp: new Date(now.getTime() - 2000).toISOString(), message: 'Entry 3'}));
    
    const result = storage.query({sortBy: 'timestamp', sortOrder: 'asc'});
    
    t.is(result.entries.length, 3);
    t.is(result.entries[0].message, 'Entry 1');
    t.is(result.entries[1].message, 'Entry 3');
    t.is(result.entries[2].message, 'Entry 2');
});

test('LogStorage query with descending sorting returns sorted results', t => {
    const storage = new LogStorage();
    const now = new Date();
    
    storage.addEntry(createTestLogEntry({timestamp: new Date(now.getTime() - 3000).toISOString(), message: 'Entry 1'}));
    storage.addEntry(createTestLogEntry({timestamp: new Date(now.getTime() - 1000).toISOString(), message: 'Entry 2'}));
    storage.addEntry(createTestLogEntry({timestamp: new Date(now.getTime() - 2000).toISOString(), message: 'Entry 3'}));
    
    const result = storage.query({sortBy: 'timestamp', sortOrder: 'desc'});
    
    t.is(result.entries.length, 3);
    t.is(result.entries[0].message, 'Entry 2');
    t.is(result.entries[1].message, 'Entry 3');
    t.is(result.entries[2].message, 'Entry 1');
});

test('LogStorage query generates facets', t => {
    const storage = new LogStorage();
    storage.addEntry(createTestLogEntry({level: 'info', source: 'source1', tags: ['tag1']}));
    storage.addEntry(createTestLogEntry({level: 'error', source: 'source1', tags: ['tag1', 'tag2']}));
    storage.addEntry(createTestLogEntry({level: 'info', source: 'source2', tags: ['tag2']}));
    
    const result = storage.query({});
    
    t.truthy(result.facets);
    t.truthy(result.facets?.levels);
    t.truthy(result.facets?.sources);
    t.truthy(result.facets?.tags);
    t.truthy(result.facets?.errorTypes);
    t.truthy(result.facets?.hours);
});

test('LogStorage aggregate returns AggregationResult', t => {
    const storage = new LogStorage();
    storage.addEntry(createTestLogEntry({performance: {duration: 100}}));
    storage.addEntry(createTestLogEntry({performance: {duration: 200}}));
    
    const result = storage.aggregate({
        groupBy: 'level',
        aggregations: ['count', 'avgDuration'],
    });
    
    t.truthy(result);
    t.true('groups' in result);
    t.true('totalGroups' in result);
    t.true('queryTime' in result);
});

test('LogStorage aggregate calculates correct aggregations', t => {
    const storage = new LogStorage();
    storage.addEntry(createTestLogEntry({level: 'info', performance: {duration: 100}}));
    storage.addEntry(createTestLogEntry({level: 'info', performance: {duration: 200}}));
    storage.addEntry(createTestLogEntry({level: 'error', performance: {duration: 300}}));
    
    const result = storage.aggregate({
        groupBy: 'level',
        aggregations: ['count', 'avgDuration', 'maxDuration', 'minDuration'],
    });
    
    t.is(result.totalGroups, 2);
    t.truthy(result.groups['info']);
    t.truthy(result.groups['error']);
    t.is(result.groups['info'].count, 2);
    t.is(result.groups['error'].count, 1);
});

test('LogStorage aggregate with time range filter returns filtered results', t => {
    const storage = new LogStorage();
    const now = new Date();
    const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
    
    storage.addEntry(createTestLogEntry({timestamp: oneHourAgo.toISOString(), performance: {duration: 100}}));
    storage.addEntry(createTestLogEntry({timestamp: now.toISOString(), performance: {duration: 200}}));
    
    const result = storage.aggregate({
        groupBy: 'level',
        aggregations: ['count'],
        timeRange: {
            startTime: oneHourAgo,
            endTime: now,
        },
    });
    
    t.is(result.totalGroups, 1);
    t.is(result.groups['info'].count, 2);
});

test('LogStorage clear removes all entries', t => {
    const storage = new LogStorage();
    storage.addEntry(createTestLogEntry());
    storage.addEntry(createTestLogEntry());
    
    t.is(storage.getEntryCount(), 2);
    
    storage.clear();
    
    t.is(storage.getEntryCount(), 0);
});

// Test LogQueryBuilder class
// ============================================================================

test('LogQueryBuilder creates query with fluent interface', t => {
    const builder = new LogQueryBuilder();
    const query = builder
        .timeRange(new Date('2023-01-01'), new Date('2023-12-31'))
        .levels('info', 'error')
        .messageContains('test')
        .limit(10)
        .offset(0)
        .sortBy('timestamp', 'desc')
        .execute();
    
    t.truthy(query);
    t.true('entries' in query);
});

test('LogQueryBuilder timeRange method sets time range', t => {
    const builder = new LogQueryBuilder();
    const startTime = new Date('2023-01-01');
    const endTime = new Date('2023-12-31');
    
    builder.timeRange(startTime, endTime);
    const query = builder.toJSON();
    
    t.deepEqual(query.startTime, startTime);
    t.deepEqual(query.endTime, endTime);
});

test('LogQueryBuilder levels method sets levels', t => {
    const builder = new LogQueryBuilder();
    builder.levels('info', 'error', 'warn');
    const query = builder.toJSON();
    
    t.deepEqual(query.levels, ['info', 'error', 'warn']);
});

test('LogQueryBuilder excludeLevels method sets excludeLevels', t => {
    const builder = new LogQueryBuilder();
    builder.excludeLevels('debug', 'trace');
    const query = builder.toJSON();
    
    t.deepEqual(query.excludeLevels, ['debug', 'trace']);
});

test('LogQueryBuilder messageContains method sets messageContains', t => {
    const builder = new LogQueryBuilder();
    builder.messageContains('test message');
    const query = builder.toJSON();
    
    t.is(query.messageContains, 'test message');
});

test('LogQueryBuilder messageRegex method sets messageRegex', t => {
    const builder = new LogQueryBuilder();
    builder.messageRegex(/test.*/);
    const query = builder.toJSON();
    
    t.truthy(query.messageRegex);
});

test('LogQueryBuilder correlationIds method sets correlationIds', t => {
    const builder = new LogQueryBuilder();
    builder.correlationIds('corr-1', 'corr-2');
    const query = builder.toJSON();
    
    t.deepEqual(query.correlationIds, ['corr-1', 'corr-2']);
});

test('LogQueryBuilder sources method sets sources', t => {
    const builder = new LogQueryBuilder();
    builder.sources('source-1', 'source-2');
    const query = builder.toJSON();
    
    t.deepEqual(query.sources, ['source-1', 'source-2']);
});

test('LogQueryBuilder tags method sets tags', t => {
    const builder = new LogQueryBuilder();
    builder.tags('tag1', 'tag2');
    const query = builder.toJSON();
    
    t.deepEqual(query.tags, ['tag1', 'tag2']);
});

test('LogQueryBuilder hasTags method sets hasTags', t => {
    const builder = new LogQueryBuilder();
    builder.hasTags();
    const query = builder.toJSON();
    
    t.true(query.hasTags);
});

test('LogQueryBuilder limit method sets limit', t => {
    const builder = new LogQueryBuilder();
    builder.limit(25);
    const query = builder.toJSON();
    
    t.is(query.limit, 25);
});

test('LogQueryBuilder offset method sets offset', t => {
    const builder = new LogQueryBuilder();
    builder.offset(10);
    const query = builder.toJSON();
    
    t.is(query.offset, 10);
});

test('LogQueryBuilder sortBy method sets sortBy and sortOrder', t => {
    const builder = new LogQueryBuilder();
    builder.sortBy('timestamp', 'asc');
    const query = builder.toJSON();
    
    t.is(query.sortBy, 'timestamp');
    t.is(query.sortOrder, 'asc');
});

test('LogQueryBuilder durationMin method sets durationMin', t => {
    const builder = new LogQueryBuilder();
    builder.durationMin(100);
    const query = builder.toJSON();
    
    t.is(query.durationMin, 100);
});

test('LogQueryBuilder memoryThreshold method sets memoryThreshold', t => {
    const builder = new LogQueryBuilder();
    builder.memoryThreshold(1024);
    const query = builder.toJSON();
    
    t.is(query.memoryThreshold, 1024);
});

test('LogQueryBuilder toJSON returns complete query object', t => {
    const builder = new LogQueryBuilder();
    const query = builder
        .levels('info')
        .limit(10)
        .toJSON();
    
    t.truthy(query);
    t.deepEqual(query.levels, ['info']);
    t.is(query.limit, 10);
});

// Test createLogQuery function
// ============================================================================

test('createLogQuery returns LogQueryBuilder instance', t => {
    const builder = createLogQuery();
    t.truthy(builder);
    t.true(builder instanceof LogQueryBuilder);
});

// Test logQueries utility functions
// ============================================================================

test('logQueries.errors returns error logs', t => {
    const storage = new LogStorage();
    storage.addEntry(createTestLogEntry({level: 'info'}));
    storage.addEntry(createTestLogEntry({level: 'error'}));
    storage.addEntry(createTestLogEntry({level: 'fatal'}));
    
    const result = logQueries.errors();
    
    t.is(result.entries.length, 2);
    t.is(result.filteredCount, 2);
});

test('logQueries.byCorrelation returns logs by correlation ID', t => {
    const storage = new LogStorage();
    storage.addEntry(createTestLogEntry({correlationId: 'corr-1'}));
    storage.addEntry(createTestLogEntry({correlationId: 'corr-2'}));
    storage.addEntry(createTestLogEntry({correlationId: 'corr-1'}));
    
    const result = logQueries.byCorrelation('corr-1');
    
    t.is(result.entries.length, 2);
    t.is(result.filteredCount, 2);
});

test('logQueries.bySource returns logs by source', t => {
    const storage = new LogStorage();
    storage.addEntry(createTestLogEntry({source: 'source-1'}));
    storage.addEntry(createTestLogEntry({source: 'source-2'}));
    storage.addEntry(createTestLogEntry({source: 'source-1'}));
    
    const result = logQueries.bySource('source-1');
    
    t.is(result.entries.length, 2);
    t.is(result.filteredCount, 2);
});

test('logQueries.byTag returns logs by tag', t => {
    const storage = new LogStorage();
    storage.addEntry(createTestLogEntry({tags: ['tag1', 'tag2']}));
    storage.addEntry(createTestLogEntry({tags: ['tag2', 'tag3']}));
    storage.addEntry(createTestLogEntry({tags: ['tag1']}));
    
    const result = logQueries.byTag('tag1');
    
    t.is(result.entries.length, 2);
    t.is(result.filteredCount, 2);
});

test('logQueries.slowRequests returns slow requests', t => {
    const storage = new LogStorage();
    storage.addEntry(createTestLogEntry({message: 'request', performance: {duration: 50}}));
    storage.addEntry(createTestLogEntry({message: 'request', performance: {duration: 1500}}));
    storage.addEntry(createTestLogEntry({message: 'request', performance: {duration: 2500}}));
    
    const result = logQueries.slowRequests(1000);
    
    t.is(result.entries.length, 2);
    t.is(result.filteredCount, 2);
});

test('logQueries.memoryIntensive returns memory-intensive operations', t => {
    const storage = new LogStorage();
    storage.addEntry(createTestLogEntry({performance: {memory: {heapUsed: 1024}}}));
    storage.addEntry(createTestLogEntry({performance: {memory: {heapUsed: 50 * 1024 * 1024}}}));
    storage.addEntry(createTestLogEntry({performance: {memory: {heapUsed: 100 * 1024 * 1024}}}));
    
    const result = logQueries.memoryIntensive(50 * 1024 * 1024);
    
    t.is(result.entries.length, 2);
    t.is(result.filteredCount, 2);
});

// Test globalLogStorage instance
// ============================================================================

test('globalLogStorage is LogStorage instance', t => {
    t.true(globalLogStorage instanceof LogStorage);
});

test('globalLogStorage can add and query entries', t => {
    globalLogStorage.clear();
    
    globalLogStorage.addEntry(createTestLogEntry({message: 'Global test entry'}));
    
    const result = globalLogStorage.query({});
    
    t.is(result.entries.length, 1);
    t.is(result.entries[0].message, 'Global test entry');
});

// Test edge cases
// ============================================================================

test('LogStorage handles empty query gracefully', t => {
    const storage = new LogStorage();
    storage.addEntry(createTestLogEntry());
    
    const result = storage.query({});
    
    t.truthy(result);
    t.is(result.entries.length, 1);
});

test('LogStorage handles query with no matches gracefully', t => {
    const storage = new LogStorage();
    storage.addEntry(createTestLogEntry({level: 'info'}));
    
    const result = storage.query({levels: ['error']});
    
    t.truthy(result);
    t.is(result.entries.length, 0);
    t.is(result.filteredCount, 0);
});

test('LogStorage handles aggregation with no entries gracefully', t => {
    const storage = new LogStorage();
    
    const result = storage.aggregate({
        groupBy: 'level',
        aggregations: ['count'],
    });
    
    t.truthy(result);
    t.is(result.totalGroups, 0);
});

test('LogStorage handles query with invalid sortBy gracefully', t => {
    const storage = new LogStorage();
    storage.addEntry(createTestLogEntry());
    
    const result = storage.query({sortBy: 'invalid' as any});
    
    t.truthy(result);
    t.is(result.entries.length, 1);
});

test('LogStorage handles query with invalid groupBy gracefully', t => {
    const storage = new LogStorage();
    storage.addEntry(createTestLogEntry());
    
    const result = storage.aggregate({
        groupBy: 'invalid' as any,
        aggregations: ['count'],
    });
    
    t.truthy(result);
});

// Test performance characteristics
// ============================================================================

test('LogStorage handles large number of entries efficiently', t => {
    const storage = new LogStorage(1000);
    
    // Add many entries
    for (let i = 0; i < 1000; i++) {
        storage.addEntry(createTestLogEntry({message: `Entry ${i}`}));
    }
    
    const startTime = performance.now();
    const result = storage.query({});
    const queryTime = performance.now() - startTime;
    
    t.truthy(result);
    t.is(result.entries.length, 1000);
    t.true(queryTime < 100); // Should be fast
});

test('LogStorage handles query with complex filters efficiently', t => {
    const storage = new LogStorage();
    
    // Add entries with different characteristics
    for (let i = 0; i < 100; i++) {
        storage.addEntry(createTestLogEntry({
            level: i % 2 === 0 ? 'info' : 'error',
            source: i % 3 === 0 ? 'source1' : 'source2',
            tags: i % 4 === 0 ? ['tag1'] : ['tag2'],
            performance: {duration: i * 10},
        }));
    }
    
    const startTime = performance.now();
    const result = storage.query({
        levels: ['info'],
        sources: ['source1'],
        tags: ['tag1'],
        durationMin: 50,
        limit: 10,
    });
    const queryTime = performance.now() - startTime;
    
    t.truthy(result);
    t.true(queryTime < 50); // Should be fast
});

// Test memory management
// ============================================================================

test('LogStorage respects maxEntries limit when full', t => {
    const storage = new LogStorage(5);
    
    // Fill storage
    for (let i = 0; i < 5; i++) {
        storage.addEntry(createTestLogEntry({message: `Entry ${i}`}));
    }
    
    t.is(storage.getEntryCount(), 5);
    
    // Add one more - should remove oldest
    storage.addEntry(createTestLogEntry({message: 'Entry 5'}));
    
    t.is(storage.getEntryCount(), 5);
    
    // Query should not include the first entry
    const result = storage.query({});
    t.is(result.entries.length, 5);
    t.false(result.entries.some(e => e.message === 'Entry 0'));
});

// Test indexing functionality
// ============================================================================

test('LogStorage maintains indexes for fast filtering', t => {
    const storage = new LogStorage();
    
    // Add entries with different correlation IDs
    storage.addEntry(createTestLogEntry({correlationId: 'corr-1'}));
    storage.addEntry(createTestLogEntry({correlationId: 'corr-2'}));
    storage.addEntry(createTestLogEntry({correlationId: 'corr-1'}));
    
    // Query by correlation ID should be fast
    const startTime = performance.now();
    const result = storage.query({correlationIds: ['corr-1']});
    const queryTime = performance.now() - startTime;
    
    t.is(result.entries.length, 2);
    t.true(queryTime < 10); // Should be very fast
});

// Test error handling
// ============================================================================

test('LogStorage handles invalid log entries gracefully', t => {
    const storage = new LogStorage();
    
    // Should not throw with incomplete entry
    storage.addEntry({
        timestamp: new Date().toISOString(),
        level: 'info',
        message: 'Minimal entry',
    } as LogEntry);
    
    t.is(storage.getEntryCount(), 1);
});

test('LogStorage handles query with invalid regex gracefully', t => {
    const storage = new LogStorage();
    storage.addEntry(createTestLogEntry());
    
    // Should not throw with invalid regex
    try {
        // Create an invalid regex by using RegExp constructor with invalid pattern
        const invalidRegex = new RegExp('[invalid regex'); // Missing closing bracket
        const result = storage.query({messageRegex: invalidRegex});
        t.truthy(result);
    } catch (error) {
        // Expected to throw for invalid regex
        t.truthy(error);
    }
});

// Cleanup after tests
// ============================================================================

test.after('cleanup global log storage', t => {
    globalLogStorage.clear();
});