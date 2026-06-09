import test from 'ava';
import {AcpSession} from '@/acp/acp-session';

console.log('\nacp-session.spec.ts');

const createMockConn = () =>
	({
		sessionUpdate: async () => {},
		requestPermission: async () => ({
			outcome: {outcome: 'cancelled'},
		}),
	}) as any;

// ============================================================================
// Constructor
// ============================================================================

test('AcpSession - constructor sets sessionId', t => {
	const session = new AcpSession({
		sessionId: 'test-id',
		cwd: '/tmp',
		conn: createMockConn(),
	});
	t.is(session.sessionId, 'test-id');
});

test('AcpSession - constructor sets cwd', t => {
	const session = new AcpSession({
		sessionId: 'test-id',
		cwd: '/home/user/project',
		conn: createMockConn(),
	});
	t.is(session.cwd, '/home/user/project');
});

test('AcpSession - constructor sets conn', t => {
	const conn = createMockConn();
	const session = new AcpSession({
		sessionId: 'test-id',
		cwd: '/tmp',
		conn,
	});
	t.is(session.conn, conn);
});

test('AcpSession - default developmentMode is auto-accept', t => {
	const session = new AcpSession({
		sessionId: 'test-id',
		cwd: '/tmp',
		conn: createMockConn(),
	});
	t.is(session.developmentMode, 'auto-accept');
});

test('AcpSession - custom initialMode is respected', t => {
	const session = new AcpSession({
		sessionId: 'test-id',
		cwd: '/tmp',
		conn: createMockConn(),
		initialMode: 'yolo',
	});
	t.is(session.developmentMode, 'yolo');
});

test('AcpSession - messages starts empty', t => {
	const session = new AcpSession({
		sessionId: 'test-id',
		cwd: '/tmp',
		conn: createMockConn(),
	});
	t.deepEqual(session.messages, []);
});

test('AcpSession - systemMessage starts undefined', t => {
	const session = new AcpSession({
		sessionId: 'test-id',
		cwd: '/tmp',
		conn: createMockConn(),
	});
	t.is(session.systemMessage, undefined);
});

test('AcpSession - abortController starts non-aborted', t => {
	const session = new AcpSession({
		sessionId: 'test-id',
		cwd: '/tmp',
		conn: createMockConn(),
	});
	t.false(session.abortController.signal.aborted);
});

// ============================================================================
// cancel()
// ============================================================================

test('AcpSession - cancel aborts the old controller', t => {
	const session = new AcpSession({
		sessionId: 'test-id',
		cwd: '/tmp',
		conn: createMockConn(),
	});
	const oldController = session.abortController;
	session.cancel();
	t.true(oldController.signal.aborted);
});

test('AcpSession - cancel creates fresh abort controller', t => {
	const session = new AcpSession({
		sessionId: 'test-id',
		cwd: '/tmp',
		conn: createMockConn(),
	});
	const original = session.abortController;
	session.cancel();
	t.not(session.abortController, original);
	t.false(session.abortController.signal.aborted);
});

test('AcpSession - cancel can be called multiple times safely', t => {
	const session = new AcpSession({
		sessionId: 'test-id',
		cwd: '/tmp',
		conn: createMockConn(),
	});
	session.cancel();
	session.cancel();
	session.cancel();
	t.false(session.abortController.signal.aborted);
});

// ============================================================================
// State mutations
// ============================================================================

test('AcpSession - messages are mutable', t => {
	const session = new AcpSession({
		sessionId: 'test-id',
		cwd: '/tmp',
		conn: createMockConn(),
	});
	session.messages = [{role: 'user', content: 'hello'}];
	t.deepEqual(session.messages, [{role: 'user', content: 'hello'}]);
});

test('AcpSession - systemMessage is settable', t => {
	const session = new AcpSession({
		sessionId: 'test-id',
		cwd: '/tmp',
		conn: createMockConn(),
	});
	session.systemMessage = {role: 'system', content: 'You are helpful'};
	t.is(session.systemMessage?.role, 'system');
	t.is(session.systemMessage?.content, 'You are helpful');
});

test('AcpSession - developmentMode is settable', t => {
	const session = new AcpSession({
		sessionId: 'test-id',
		cwd: '/tmp',
		conn: createMockConn(),
	});
	session.developmentMode = 'yolo';
	t.is(session.developmentMode, 'yolo');
});
