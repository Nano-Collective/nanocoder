
import * as os from 'os';
import * as vscode from 'vscode';

export function resolveExtensionCwd(): string {
    const config = vscode.workspace.getConfiguration('nanocoder');

    return (
        config.get<string>('cwd') ||
        vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ||
        os.homedir() ||
        process.cwd()
    );
}
