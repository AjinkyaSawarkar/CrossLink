// src/visualizer/fileConnectionListProvider.ts
import * as vscode from 'vscode';
import * as path from 'path';
import { DependencyAnalyzer, FileConnection } from '../core/dependencyAnalyzer';

export class FileConnectionListProvider implements vscode.TreeDataProvider<FileConnectionItem> {
    private _onDidChangeTreeData: vscode.EventEmitter<FileConnectionItem | undefined | null | void> = new vscode.EventEmitter<FileConnectionItem | undefined | null | void>();
    readonly onDidChangeTreeData: vscode.Event<FileConnectionItem | undefined | null | void> = this._onDidChangeTreeData.event;

    private connections: FileConnection[] = [];

    constructor(private analyzer: DependencyAnalyzer) {}

    refresh(): void {
        this._onDidChangeTreeData.fire();
    }

    async updateConnections(): Promise<void> {
        this.connections = await this.analyzer.getFileConnections();
        console.log(`File connections updated: ${this.connections.length} connections found`);
        this.refresh();
    }

    getTreeItem(element: FileConnectionItem): vscode.TreeItem {
        return element;
    }

    getChildren(element?: FileConnectionItem): Thenable<FileConnectionItem[]> {
        if (!element) {
            // Root level - group by Java files
            return Promise.resolve(this.getRootItems());
        } else if (element instanceof JavaFileItem) {
            // Show connected C++ files for this Java file
            return Promise.resolve(element.connections);
        }
        
        return Promise.resolve([]);
    }

    // src/visualizer/fileConnectionListProvider.ts

private getRootItems(): FileConnectionItem[] {
    if (this.connections.length === 0) {
        return [new NoConnectionsItem()];
    }

    // Group connections by Java file
    const javaFileGroups = new Map<string, FileConnection[]>();
    
    this.connections.forEach(connection => {
        if (!javaFileGroups.has(connection.javaFile)) {
            javaFileGroups.set(connection.javaFile, []);
        }
        javaFileGroups.get(connection.javaFile)!.push(connection);
    });

    const items: FileConnectionItem[] = [];
    javaFileGroups.forEach((connections, javaFile) => {
        items.push(new JavaFileItem(javaFile, connections));
    });

    // FIX: Handle the label property correctly
    return items.sort((a, b) => {
        const labelA = typeof a.label === 'string' ? a.label : (a.label?.label || '');
        const labelB = typeof b.label === 'string' ? b.label : (b.label?.label || '');
        return labelA.localeCompare(labelB);
    });
}

}

export abstract class FileConnectionItem extends vscode.TreeItem {}

export class NoConnectionsItem extends FileConnectionItem {
    constructor() {
        super('No file connections found', vscode.TreeItemCollapsibleState.None);
        this.description = 'Add native methods to Java files with matching C++ implementations';
        this.iconPath = new vscode.ThemeIcon('info');
        this.contextValue = 'noConnections';
    }
}

export class JavaFileItem extends FileConnectionItem {
    public connections: CppConnectionItem[] = [];

    constructor(
        public readonly javaFilePath: string,
        fileConnections: FileConnection[]
    ) {
        const fileName = path.basename(javaFilePath);
        const matchedCount = fileConnections.filter(c => c.isMatched).length;
        const totalCount = fileConnections.length;
        
        super(fileName, vscode.TreeItemCollapsibleState.Expanded);
        
        this.description = `${matchedCount}/${totalCount} connected`;
        this.tooltip = this.createTooltip(fileConnections);
        this.contextValue = 'javaFile';
        this.iconPath = new vscode.ThemeIcon('file-code', new vscode.ThemeColor('java.color'));
        
        // Make it clickable to open the Java file
        this.command = {
            command: 'dependencyVisualizer.openFile',
            title: 'Open Java File',
            arguments: [javaFilePath]
        };

        // Create connection items for C++ files
        this.connections = fileConnections.map(conn => new CppConnectionItem(conn));
    }

    private createTooltip(connections: FileConnection[]): vscode.MarkdownString {
        const tooltip = new vscode.MarkdownString();
        tooltip.isTrusted = true;
        
        tooltip.appendMarkdown(`## 📄 ${path.basename(this.javaFilePath)}\n\n`);
        tooltip.appendMarkdown(`**Path:** \`${this.javaFilePath}\`\n\n`);
        tooltip.appendMarkdown(`**Native Methods:** ${connections.length}\n\n`);
        
        const matched = connections.filter(c => c.isMatched).length;
        const unmatched = connections.length - matched;
        
        tooltip.appendMarkdown(`**Connected:** ${matched}\n\n`);
        if (unmatched > 0) {
            tooltip.appendMarkdown(`**Missing:** ${unmatched}\n\n`);
        }
        
        return tooltip;
    }
}

export class CppConnectionItem extends FileConnectionItem {
    constructor(public readonly connection: FileConnection) {
        const fileName = path.basename(connection.cppFile);
        
        super(connection.methodName, vscode.TreeItemCollapsibleState.None);
        
        this.description = connection.isMatched ? fileName : 'Not found';
        this.tooltip = this.createTooltip();
        this.contextValue = connection.isMatched ? 'cppConnection' : 'missingConnection';
        
        if (connection.isMatched) {
            this.iconPath = new vscode.ThemeIcon('file-code', new vscode.ThemeColor('cpp.color'));
            // Make it clickable to open the C++ file
            this.command = {
                command: 'dependencyVisualizer.openFile',
                title: 'Open C++ File',
                arguments: [connection.cppFile]
            };
        } else {
            this.iconPath = new vscode.ThemeIcon('error', new vscode.ThemeColor('errorForeground'));
        }
    }

    private createTooltip(): vscode.MarkdownString {
        const tooltip = new vscode.MarkdownString();
        tooltip.isTrusted = true;
        
        const status = this.connection.isMatched ? '✅ Connected' : '❌ Missing';
        
        tooltip.appendMarkdown(`## ${status}\n\n`);
        tooltip.appendMarkdown(`**Method:** \`${this.connection.methodName}\`\n\n`);
        
        if (this.connection.isMatched) {
            tooltip.appendMarkdown(`**C++ File:** \`${this.connection.cppFile}\`\n\n`);
            tooltip.appendMarkdown(`**Status:** Connected\n\n`);
        } else {
            tooltip.appendMarkdown(`**Status:** No matching C++ implementation found\n\n`);
            tooltip.appendMarkdown(`**Expected JNI function:** Look for function starting with \`Java_\`\n\n`);
        }
        
        return tooltip;
    }
}
