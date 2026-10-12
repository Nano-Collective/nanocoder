import test from 'ava';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';

import {findCliPath, isNanocoderWorkspaceFolder} from './cli-discovery';

const {__test} = vscode as unknown as {__test: any};

function makeTempDir(): string {
	return fs.mkdtempSync(path.join(os.tmpdir(), 'nanocoder-cli-discovery-'));
}

function writeWorkspacePackage(dir: string, name: string | null): void {
	if (name === null) {
		return;
	}
	fs.writeFileSync(
		path.join(dir, 'package.json'),
		JSON.stringify({name}, null, '\t'),
	);
}

test.beforeEach(() => {
	__test.reset();
});

test('findCliPath - skips a foreign project that ships dist/cli.js', async t => {
	const foreignDir = makeTempDir();
	t.teardown(() => fs.rmSync(foreignDir, {recursive: true, force: true}));
	writeWorkspacePackage(foreignDir, 'some-other-tool');
	fs.mkdirSync(path.join(foreignDir, 'dist'), {recursive: true});
	fs.writeFileSync(path.join(foreignDir, 'dist', 'cli.js'), '');

	const originalFolders = vscode.workspace.workspaceFolders;
	(vscode.workspace as any).workspaceFolders = [{uri: vscode.Uri.file(foreignDir)}];
	t.teardown(() => {
		(vscode.workspace as any).workspaceFolders = originalFolders;
	});

	const cliPath = await findCliPath();

	t.not(
		cliPath,
		`node ${path.join(foreignDir, 'dist', 'cli.js')}`,
		'a foreign dist/cli.js must never be executed',
	);
});

test('findCliPath - uses dist/cli.js of the nanocoder workspace itself', async t => {
	const nanoDir = makeTempDir();
	t.teardown(() => fs.rmSync(nanoDir, {recursive: true, force: true}));
	writeWorkspacePackage(nanoDir, '@nanocollective/nanocoder');
	fs.mkdirSync(path.join(nanoDir, 'dist'), {recursive: true});
	fs.writeFileSync(path.join(nanoDir, 'dist', 'cli.js'), '');

	const originalFolders = vscode.workspace.workspaceFolders;
	(vscode.workspace as any).workspaceFolders = [{uri: vscode.Uri.file(nanoDir)}];
	t.teardown(() => {
		(vscode.workspace as any).workspaceFolders = originalFolders;
	});

	const cliPath = await findCliPath();

	t.is(
		cliPath,
		`node ${path.join(nanoDir, 'dist', 'cli.js')}`,
		'the nanocoder repo keeps the local development fallback',
	);
});


test('isNanocoderWorkspaceFolder - matches the package name only', t => {
	const nanoDir = makeTempDir();
	const foreignDir = makeTempDir();
	const noPackageDir = makeTempDir();
	const brokenDir = makeTempDir();
	t.teardown(() => {
		for (const dir of [nanoDir, foreignDir, noPackageDir, brokenDir]) {
			fs.rmSync(dir, {recursive: true, force: true});
		}
	});
	writeWorkspacePackage(nanoDir, '@nanocollective/nanocoder');
	writeWorkspacePackage(foreignDir, 'some-other-tool');
	fs.writeFileSync(path.join(brokenDir, 'package.json'), '{ not json');

	t.true(isNanocoderWorkspaceFolder({uri: {fsPath: nanoDir}}));
	t.false(isNanocoderWorkspaceFolder({uri: {fsPath: foreignDir}}));
	t.false(isNanocoderWorkspaceFolder({uri: {fsPath: noPackageDir}}));
	t.false(isNanocoderWorkspaceFolder({uri: {fsPath: brokenDir}}));
});
