// src/visualizer/enhancedFileConnectionListProvider.ts
import * as vscode from 'vscode';
import * as path from 'path';
import { DependencyAnalyzer, FileConnection } from '../core/dependencyAnalyzer';

export class EnhancedFileConnectionListProvider implements vscode.TreeDataProvider<FileConnectionItem> {
    private _onDidChangeTreeData: vscode.EventEmitter<FileConnectionItem | undefined | null | void> = new vscode.EventEmitter<FileConnectionItem | undefined | null | void>();
    readonly onDidChangeTreeData: vscode.Event<FileConnectionItem | undefined | null | void> = this._onDidChangeTreeData.event;

    private connections: FileConnection[] = [];
    private searchFilter: string = '';
    private statusFilter: 'all' | 'connected' | 'missing' = 'all';
    private groupBy: 'file' | 'package' | 'status' = 'file';

    constructor(private analyzer: DependencyAnalyzer) {}

    refresh(): void {
        this._onDidChangeTreeData.fire();
    }

    async updateConnections(): Promise<void> {
        this.connections = await this.analyzer.getFileConnections();
        console.log(`Enhanced file connections updated: ${this.connections.length} connections found`);
        this.refresh();
    }

    setSearchFilter(filter: string): void {
        this.searchFilter = filter.toLowerCase();
        this.refresh();
    }

    setStatusFilter(filter: 'all' | 'connected' | 'missing'): void {
        this.statusFilter = filter;
        this.refresh();
    }

    setGroupBy(groupBy: 'file' | 'package' | 'status'): void {
        this.groupBy = groupBy;
        this.refresh();
    }

    getTreeItem(element: FileConnectionItem): vscode.TreeItem {
        return element;
    }

    getChildren(element?: FileConnectionItem): Thenable<FileConnectionItem[]> {
        if (!element) {
            return Promise.resolve(this.getRootItems());
        } else if (element instanceof JavaFileItem || element instanceof PackageGroupItem || element instanceof StatusGroupItem) {
            return Promise.resolve(element.children);
        }
        
        return Promise.resolve([]);
    }

    private getRootItems(): FileConnectionItem[] {
        const filteredConnections = this.getFilteredConnections();
        
        if (filteredConnections.length === 0) {
            return [new NoConnectionsItem(this.searchFilter)];
        }

        switch (this.groupBy) {
            case 'package':
                return this.groupByPackage(filteredConnections);
            case 'status':
                return this.groupByStatus(filteredConnections);
            default:
                return this.groupByFile(filteredConnections);
        }
    }

    private getFilteredConnections(): FileConnection[] {
        return this.connections.filter(conn => {
            // Search filter
            if (this.searchFilter && !this.matchesSearch(conn)) {
                return false;
            }
            
            // Status filter
            if (this.statusFilter === 'connected' && !conn.isMatched) {
                return false;
            }
            if (this.statusFilter === 'missing' && conn.isMatched) {
                return false;
            }
            
            return true;
        });
    }

    private matchesSearch(conn: FileConnection): boolean {
        const searchLower = this.searchFilter;
        return path.basename(conn.javaFile).toLowerCase().includes(searchLower) ||
               path.basename(conn.cppFile).toLowerCase().includes(searchLower) ||
               conn.methodName.toLowerCase().includes(searchLower);
    }

    private groupByFile(connections: FileConnection[]): FileConnectionItem[] {
        const javaFileGroups = new Map<string, FileConnection[]>();
        
        connections.forEach(connection => {
            if (!javaFileGroups.has(connection.javaFile)) {
                javaFileGroups.set(connection.javaFile, []);
            }
            javaFileGroups.get(connection.javaFile)!.push(connection);
        });

        const items: JavaFileItem[] = [];
        javaFileGroups.forEach((connections, javaFile) => {
            items.push(new JavaFileItem(javaFile, connections));
        });

        return items.sort((a, b) => 
            path.basename(a.javaFilePath).localeCompare(path.basename(b.javaFilePath))
        );
    }

    private groupByPackage(connections: FileConnection[]): FileConnectionItem[] {
        const packageGroups = new Map<string, FileConnection[]>();
        
        connections.forEach(connection => {
            const packageName = this.extractPackageFromPath(connection.javaFile) || '(default package)';
            if (!packageGroups.has(packageName)) {
                packageGroups.set(packageName, []);
            }
            packageGroups.get(packageName)!.push(connection);
        });

        const items: PackageGroupItem[] = [];
        packageGroups.forEach((connections, packageName) => {
            items.push(new PackageGroupItem(packageName, connections));
        });

        return items.sort((a, b) => a.packageName.localeCompare(b.packageName));
    }

    private groupByStatus(connections: FileConnection[]): FileConnectionItem[] {
        const connected = connections.filter(c => c.isMatched);
        const missing = connections.filter(c => !c.isMatched);
        
        const items: StatusGroupItem[] = [];
        
        if (connected.length > 0) {
            items.push(new StatusGroupItem('connected', connected));
        }
        
        if (missing.length > 0) {
            items.push(new StatusGroupItem('missing', missing));
        }
        
        return items;
    }

    private extractPackageFromPath(javaFilePath: string): string {
        // Extract package from file path structure
        const srcIndex = javaFilePath.indexOf('src/main/java/');
        if (srcIndex !== -1) {
            const packagePath = path.dirname(javaFilePath.substring(srcIndex + 'src/main/java/'.length));
            return packagePath.replace(/[/\\]/g, '.');
        }
        return '';
    }

    getStats(): { total: number; connected: number; missing: number; packages: number } {
        const total = this.connections.length;
        const connected = this.connections.filter(c => c.isMatched).length;
        const missing = total - connected;
        const packages = new Set(this.connections.map(c => this.extractPackageFromPath(c.javaFile))).size;
        
        return { total, connected, missing, packages };
    }
}

// Enhanced Base Classes
export abstract class FileConnectionItem extends vscode.TreeItem {
    abstract children?: FileConnectionItem[];
}

export class NoConnectionsItem extends FileConnectionItem {
    children = undefined;

    constructor(searchFilter?: string) {
        const message = searchFilter 
            ? `No connections found matching "${searchFilter}"`
            : 'No file connections found';
        
        super(message, vscode.TreeItemCollapsibleState.None);
        
        this.description = searchFilter ? 'Try adjusting your search' : 'Add native methods to Java files';
        this.iconPath = new vscode.ThemeIcon(searchFilter ? 'search-stop' : 'info');
        this.contextValue = 'noConnections';
    }
}

export class PackageGroupItem extends FileConnectionItem {
    public children: JavaFileItem[] = [];

    constructor(
        public readonly packageName: string,
        connections: FileConnection[]
    ) {
        const displayName = packageName === '' ? '(default package)' : packageName;
        const stats = PackageGroupItem.calculateStats(connections);
        
        super(displayName, vscode.TreeItemCollapsibleState.Expanded);
        
        this.description = `${stats.connected}/${stats.total} connected`;
        this.tooltip = this.createTooltip(stats);
        this.contextValue = 'packageGroup';
        this.iconPath = new vscode.ThemeIcon('package', new vscode.ThemeColor('symbolIcon.packageForeground'));
        
        // Group connections by Java file within this package
        const javaFileGroups = new Map<string, FileConnection[]>();
        connections.forEach(conn => {
            if (!javaFileGroups.has(conn.javaFile)) {
                javaFileGroups.set(conn.javaFile, []);
            }
            javaFileGroups.get(conn.javaFile)!.push(conn);
        });
        
        this.children = Array.from(javaFileGroups.entries()).map(([javaFile, conns]) => 
            new JavaFileItem(javaFile, conns)
        ).sort((a, b) => path.basename(a.javaFilePath).localeCompare(path.basename(b.javaFilePath)));
    }

    private static calculateStats(connections: FileConnection[]): { total: number; connected: number; files: number } {
        const total = connections.length;
        const connected = connections.filter(c => c.isMatched).length;
        const files = new Set(connections.map(c => c.javaFile)).size;
        return { total, connected, files };
    }

    private createTooltip(stats: { total: number; connected: number; files: number }): vscode.MarkdownString {
        const tooltip = new vscode.MarkdownString();
        tooltip.isTrusted = true;
        
        tooltip.appendMarkdown(`## 📦 ${this.packageName}\n\n`);
        tooltip.appendMarkdown(`**Files:** ${stats.files}\n\n`);
        tooltip.appendMarkdown(`**Methods:** ${stats.total}\n\n`);
        tooltip.appendMarkdown(`**Connected:** ${stats.connected}\n\n`);
        tooltip.appendMarkdown(`**Missing:** ${stats.total - stats.connected}\n\n`);
        
        const percentage = stats.total > 0 ? Math.round((stats.connected / stats.total) * 100) : 0;
        tooltip.appendMarkdown(`**Connection Rate:** ${percentage}%\n\n`);
        
        return tooltip;
    }
}

export class StatusGroupItem extends FileConnectionItem {
    public children: JavaFileItem[] = [];

    constructor(
        public readonly status: 'connected' | 'missing',
        connections: FileConnection[]
    ) {
        const title = status === 'connected' ? 'Connected' : 'Missing Implementations';
        
        super(title, vscode.TreeItemCollapsibleState.Expanded);
        
        this.description = `${connections.length} method${connections.length !== 1 ? 's' : ''}`;
        this.tooltip = this.createTooltip(connections);
        this.contextValue = `statusGroup_${status}`;
        
        if (status === 'connected') {
            this.iconPath = new vscode.ThemeIcon('check-all', new vscode.ThemeColor('charts.green'));
        } else {
            this.iconPath = new vscode.ThemeIcon('warning', new vscode.ThemeColor('charts.red'));
        }
        
        // Group by Java file
        const javaFileGroups = new Map<string, FileConnection[]>();
        connections.forEach(conn => {
            if (!javaFileGroups.has(conn.javaFile)) {
                javaFileGroups.set(conn.javaFile, []);
            }
            javaFileGroups.get(conn.javaFile)!.push(conn);
        });
        
        this.children = Array.from(javaFileGroups.entries()).map(([javaFile, conns]) => 
            new JavaFileItem(javaFile, conns)
        ).sort((a, b) => path.basename(a.javaFilePath).localeCompare(path.basename(b.javaFilePath)));
    }

    private createTooltip(connections: FileConnection[]): vscode.MarkdownString {
        const tooltip = new vscode.MarkdownString();
        tooltip.isTrusted = true;
        
        const statusEmoji = this.status === 'connected' ? '✅' : '❌';
        tooltip.appendMarkdown(`## ${statusEmoji} ${this.status === 'connected' ? 'Connected Methods' : 'Missing Implementations'}\n\n`);
        
        tooltip.appendMarkdown(`**Count:** ${connections.length} method${connections.length !== 1 ? 's' : ''}\n\n`);
        
        const files = new Set(connections.map(c => c.javaFile)).size;
        tooltip.appendMarkdown(`**Files:** ${files}\n\n`);
        
        if (this.status === 'missing') {
            tooltip.appendMarkdown(`💡 **Quick Fix:** Right-click on missing methods to generate C++ stubs\n\n`);
        }
        
        return tooltip;
    }
}

export class JavaFileItem extends FileConnectionItem {
    public children: CppConnectionItem[] = [];

    constructor(
        public readonly javaFilePath: string,
        fileConnections: FileConnection[]
    ) {
        const fileName = path.basename(javaFilePath);
        const stats = JavaFileItem.calculateStats(fileConnections);
        
        super(fileName, vscode.TreeItemCollapsibleState.Expanded);
        
        this.description = this.createDescription(stats);
        this.tooltip = this.createTooltip(fileConnections, stats);
        this.contextValue = 'javaFile';
        this.iconPath = this.getIcon(stats);
        
        // Add connection health indicator
        this.resourceUri = vscode.Uri.file(javaFilePath);
        
        // Make it clickable to open the Java file
        this.command = {
            command: 'dependencyVisualizer.openFile',
            title: 'Open Java File',
            arguments: [javaFilePath]
        };

        // Create enhanced connection items
        this.children = fileConnections.map(conn => new CppConnectionItem(conn))
            .sort((a, b) => {
                if (a.connection.isMatched !== b.connection.isMatched) {
                    return a.connection.isMatched ? -1 : 1; // Connected first
                }
                return a.connection.methodName.localeCompare(b.connection.methodName);
            });
    }

    private static calculateStats(connections: FileConnection[]): { total: number; connected: number; percentage: number } {
        const total = connections.length;
        const connected = connections.filter(c => c.isMatched).length;
        const percentage = total > 0 ? Math.round((connected / total) * 100) : 0;
        return { total, connected, percentage };
    }

    private createDescription(stats: { total: number; connected: number; percentage: number }): string {
        if (stats.total === 0) return 'No native methods';
        if (stats.connected === stats.total) return `✅ ${stats.total} connected`;
        if (stats.connected === 0) return `❌ ${stats.total} missing`;
        return `⚡ ${stats.connected}/${stats.total} (${stats.percentage}%)`;
    }

    private getIcon(stats: { total: number; connected: number; percentage: number }): vscode.ThemeIcon {
        if (stats.percentage === 100) {
            return new vscode.ThemeIcon('file-code', new vscode.ThemeColor('charts.green'));
        } else if (stats.percentage === 0) {
            return new vscode.ThemeIcon('file-code', new vscode.ThemeColor('charts.red'));
        } else {
            return new vscode.ThemeIcon('file-code', new vscode.ThemeColor('charts.orange'));
        }
    }

    private createTooltip(connections: FileConnection[], stats: { total: number; connected: number; percentage: number }): vscode.MarkdownString {
        const tooltip = new vscode.MarkdownString();
        tooltip.isTrusted = true;
        
        tooltip.appendMarkdown(`## 📄 ${path.basename(this.javaFilePath)}\n\n`);
        tooltip.appendMarkdown(`**Path:** \`${this.javaFilePath}\`\n\n`);
        
        // Connection status with progress bar
        tooltip.appendMarkdown(`**Connection Status:**\n\n`);
        const progressBar = this.createProgressBar(stats.percentage);
        tooltip.appendMarkdown(`${progressBar} ${stats.connected}/${stats.total} (${stats.percentage}%)\n\n`);
        
        if (stats.connected > 0) {
            tooltip.appendMarkdown(`✅ **Connected Methods:** ${stats.connected}\n\n`);
        }
        
        if (stats.connected < stats.total) {
            const missing = stats.total - stats.connected;
            tooltip.appendMarkdown(`❌ **Missing Implementations:** ${missing}\n\n`);
            tooltip.appendMarkdown(`💡 Right-click to generate missing C++ stubs\n\n`);
        }
        
        return tooltip;
    }

    private createProgressBar(percentage: number): string {
        const barLength = 10;
        const filled = Math.round((percentage / 100) * barLength);
        const empty = barLength - filled;
        return '`' + '█'.repeat(filled) + '░'.repeat(empty) + '`';
    }
}

export class CppConnectionItem extends FileConnectionItem {
    children = undefined;

    constructor(public readonly connection: FileConnection) {
        super(connection.methodName, vscode.TreeItemCollapsibleState.None);
        
        this.description = this.createDescription();
        this.tooltip = this.createTooltip();
        this.contextValue = connection.isMatched ? 'cppConnection' : 'missingConnection';
        this.iconPath = this.getIcon();
        
        if (connection.isMatched) {
            // Make it clickable to open the C++ file
            this.command = {
                command: 'dependencyVisualizer.openFile',
                title: 'Open C++ File',
                arguments: [connection.cppFile]
            };
        }
    }

    private createDescription(): string {
        if (this.connection.isMatched) {
            return `→ ${path.basename(this.connection.cppFile)}`;
        } else {
            return '❌ Implementation missing';
        }
    }

    private getIcon(): vscode.ThemeIcon {
        if (this.connection.isMatched) {
            return new vscode.ThemeIcon('arrow-right', new vscode.ThemeColor('charts.green'));
        } else {
            return new vscode.ThemeIcon('close', new vscode.ThemeColor('charts.red'));
        }
    }

    private createTooltip(): vscode.MarkdownString {
        const tooltip = new vscode.MarkdownString();
        tooltip.isTrusted = true;
        
        const statusEmoji = this.connection.isMatched ? '✅' : '❌';
        const statusText = this.connection.isMatched ? 'Connected' : 'Missing Implementation';
        
        tooltip.appendMarkdown(`## ${statusEmoji} ${statusText}\n\n`);
        tooltip.appendMarkdown(`**Method:** \`${this.connection.methodName}\`\n\n`);
        
        if (this.connection.isMatched) {
            tooltip.appendMarkdown(`**C++ File:** \`${this.connection.cppFile}\`\n\n`);
            tooltip.appendMarkdown(`**Status:** ✅ JNI implementation found\n\n`);
            tooltip.appendMarkdown(`💡 Click to open C++ file\n\n`);
        } else {
            tooltip.appendMarkdown(`**Status:** ❌ No matching JNI implementation\n\n`);
            tooltip.appendMarkdown(`**Expected Function:** \`Java_[package]_[class]_${this.connection.methodName}\`\n\n`);
            tooltip.appendMarkdown(`💡 Right-click to generate C++ stub\n\n`);
        }
        
        return tooltip;
    }
}
