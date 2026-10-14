
import test from 'ava';
import * as os from 'os';
import * as vscode from 'vscode';
import {resolveExtensionCwd} from './workspace-utils';

test.beforeEach(() => {
    (vscode as any).__test.reset();
    (vscode.workspace as any).workspaceFolders = undefined;
});

test.afterEach.always(() => {
    (vscode as any).__test.reset();
    (vscode.workspace as any).workspaceFolders = undefined;
});

test('resolveExtensionCwd prefers configured cwd over workspace folder', t => {
    (vscode.workspace as any).workspaceFolders = [
        {uri: vscode.Uri.file('/workspace')},
    ];

    (vscode as any).__test.configuration = (section: string, key: string, fallback: unknown) =>
        section === 'nanocoder' && key === 'cwd'
            ? '/custom/project'
            : fallback;

    t.is(resolveExtensionCwd(), '/custom/project');
});

test('resolveExtensionCwd falls back to workspace for empty cwd setting', t => {
    (vscode.workspace as any).workspaceFolders = [
        {uri: vscode.Uri.file('/workspace')},
    ];

    (vscode as any).__test.configuration = (section: string, key: string, fallback: unknown) =>
        section === 'nanocoder' && key === 'cwd'
            ? ''
            : fallback;

    t.is(resolveExtensionCwd(), '/workspace');
});

test('resolveExtensionCwd falls back to home without cwd or workspace', t => {
    (vscode as any).__test.configuration = (
        _section: string,
        _key: string,
        fallback: unknown,
    ) => fallback;

    t.is(resolveExtensionCwd(), os.homedir());
});
