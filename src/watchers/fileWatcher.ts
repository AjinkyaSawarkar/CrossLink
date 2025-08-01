import * as vscode from 'vscode';
import * as path from 'path';
import { DependencyAnalyzer } from '../core/dependencyAnalyzer';
import { DependencyTreeProvider } from '../visualizer/dependencyTreeProvider';

export class FileWatcher implements vscode.Disposable {
    private watchers: vscode.FileSystemWatcher[] = [];
    private debounceTimer: NodeJS.Timeout | undefined;

    constructor(
        private analyzer: DependencyAnalyzer,
        private treeProvider: DependencyTreeProvider
    ) {}

    startWatching(): void {
        const config = vscode.workspace.getConfiguration('dependencyVisualizer');
        if (!config.get('autoRefresh', true)) {
            return;
        }

        // Watch for changes in build files
        const patterns = [
            '**/pom.xml',
            '**/build.gradle*',
            '**/CMakeLists.txt',
            '**/conanfile.*',
            '**/vcpkg.json'
        ];

        for (const pattern of patterns) {
            const watcher = vscode.workspace.createFileSystemWatcher(pattern);
            
            watcher.onDidChange(this.onFileChanged.bind(this));
            watcher.onDidCreate(this.onFileChanged.bind(this));
            watcher.onDidDelete(this.onFileChanged.bind(this));
            
            this.watchers.push(watcher);
        }
    }

    private onFileChanged(uri: vscode.Uri): void {
        // Debounce file changes to avoid excessive processing
        if (this.debounceTimer) {
            clearTimeout(this.debounceTimer);
        }

        this.debounceTimer = setTimeout(async () => {
            const workspaceFolder = vscode.workspace.getWorkspaceFolder(uri);
            if (workspaceFolder) {
                await this.analyzer.analyzeDependencies(workspaceFolder.uri.fsPath);
                this.treeProvider.refresh();
                
                vscode.window.showInformationMessage(
                    `Dependencies updated for ${path.basename(uri.fsPath)}`
                );
            }
        }, 1000); // 1 second debounce
    }

    dispose(): void {
        for (const watcher of this.watchers) {
            watcher.dispose();
        }
        this.watchers = [];
        
        if (this.debounceTimer) {
            clearTimeout(this.debounceTimer);
        }
    }
}
