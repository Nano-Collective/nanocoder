
import * as os from 'os';
import * as vscode from 'vscode';

/**
 * The folder the user pointed Nanocoder at: `nanocoder.cwd`, else the first
 * workspace folder. Undefined when neither is set (an empty window).
 */
export function resolveProjectCwd(): string | undefined {
    const config = vscode.workspace.getConfiguration('nanocoder');

    return (
        config.get<string>('cwd') ||
        vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ||
        undefined
    );
}

export function resolveExtensionCwd(): string {
    return resolveProjectCwd() || os.homedir() || process.cwd();
}
