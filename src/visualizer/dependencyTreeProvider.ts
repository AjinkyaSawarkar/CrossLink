import * as vscode from 'vscode';
import { DependencyAnalyzer, ProjectInfo, Dependency } from '../core/dependencyAnalyzer';

export type TreeItem = ProjectItem | DependencyItem;

export class DependencyTreeProvider implements vscode.TreeDataProvider<TreeItem> {
    private _onDidChangeTreeData: vscode.EventEmitter<TreeItem | undefined | null | void> = new vscode.EventEmitter<TreeItem | undefined | null | void>();
    readonly onDidChangeTreeData: vscode.Event<TreeItem | undefined | null | void> = this._onDidChangeTreeData.event;

    constructor(private analyzer: DependencyAnalyzer) {}

    refresh(): void {
        this._onDidChangeTreeData.fire();
    }

    getTreeItem(element: TreeItem): vscode.TreeItem {
        return element;
    }

    getChildren(element?: TreeItem): Thenable<TreeItem[]> {
        if (!element) {
            // Root level - show projects
            const projects = this.analyzer.getProjects();
            return Promise.resolve(projects.map(project => new ProjectItem(project)));
        } else if (element instanceof ProjectItem) {
            // Show dependencies for project
            return Promise.resolve(
                element.project.dependencies.map(dep => new DependencyItem(dep))
            );
        }
        
        return Promise.resolve([]);
    }
}

export class DependencyItem extends vscode.TreeItem {
    constructor(public readonly dependency: Dependency) {
        super(dependency.name, vscode.TreeItemCollapsibleState.None);
        
        this.tooltip = this.createTooltip();
        this.description = this.createDescription();
        this.contextValue = 'dependency';
        
        // Enhanced icons with status-based styling
        this.iconPath = this.getStatusIcon();
        this.resourceUri = vscode.Uri.parse(`dependency:${dependency.name}`);
    }

    private createDescription(): string {
        const parts = [];
        
        // Add version with styling
        if (this.dependency.version) {
            parts.push(`v${this.dependency.version}`);
        }
        
        // Add status indicators
        if (this.dependency.missing) {
            parts.push('❌ MISSING');
        } else if (this.dependency.conflicts && this.dependency.conflicts.length > 0) {
            parts.push(`⚠️ ${this.dependency.conflicts.length} conflicts`);
        } else if (this.dependency.platformIssue) {
            parts.push('🔧 platform');
        } else {
            parts.push('✅ ok');
        }
        
        return parts.join(' • ');
    }

    private getStatusIcon(): vscode.ThemeIcon {
        if (this.dependency.missing) {
            return new vscode.ThemeIcon('error', new vscode.ThemeColor('errorForeground'));
        } else if (this.dependency.conflicts && this.dependency.conflicts.length > 0) {
            return new vscode.ThemeIcon('warning', new vscode.ThemeColor('warningForeground'));
        } else if (this.dependency.platformIssue) {
            return new vscode.ThemeIcon('gear', new vscode.ThemeColor('charts.blue'));
        } else {
            return new vscode.ThemeIcon('check', new vscode.ThemeColor('charts.green'));
        }
    }

    private createTooltip(): vscode.MarkdownString {
        const tooltip = new vscode.MarkdownString();
        tooltip.isTrusted = true;
        
        // Header with icon
        const statusIcon = this.dependency.missing ? '❌' : 
                          this.dependency.conflicts?.length ? '⚠️' : 
                          this.dependency.platformIssue ? '🔧' : '✅';
        
        tooltip.appendMarkdown(`## ${statusIcon} ${this.dependency.name}\n\n`);
        
        // Version information
        if (this.dependency.version) {
            tooltip.appendMarkdown(`**Version:** \`${this.dependency.version}\`\n\n`);
        }
        
        // Type information
        tooltip.appendMarkdown(`**Type:** \`${this.dependency.type}\`\n\n`);
        
        // Status details
        if (this.dependency.missing) {
            tooltip.appendMarkdown(`**Status:** $(error) Missing library\n\n`);
            tooltip.appendMarkdown(`> This library is declared but not found on the system.\n\n`);
        } else if (this.dependency.conflicts && this.dependency.conflicts.length > 0) {
            tooltip.appendMarkdown(`**Status:** $(warning) Version conflicts detected\n\n`);
            tooltip.appendMarkdown(`**Conflicting versions:** ${this.dependency.conflicts.map(v => `\`${v}\``).join(', ')}\n\n`);
            tooltip.appendMarkdown(`> Multiple versions of this library are being used.\n\n`);
        } else if (this.dependency.platformIssue) {
            tooltip.appendMarkdown(`**Status:** $(gear) Platform compatibility issue\n\n`);
            tooltip.appendMarkdown(`> This library may not be compatible with the current platform.\n\n`);
        } else {
            tooltip.appendMarkdown(`**Status:** $(check) Healthy\n\n`);
        }
        
        // Path information
        if (this.dependency.path) {
            tooltip.appendMarkdown(`**Path:** \`${this.dependency.path}\`\n\n`);
        }
        
        // Platform information
        if (this.dependency.platform) {
            tooltip.appendMarkdown(`**Platform:** \`${this.dependency.platform}\`\n\n`);
        }
        
        return tooltip;
    }
}

export class ProjectItem extends vscode.TreeItem {
    constructor(public readonly project: ProjectInfo) {
        const displayName = `${project.type.toUpperCase()} (${project.buildSystem})`;
        super(displayName, vscode.TreeItemCollapsibleState.Expanded);
        
        this.tooltip = this.createTooltip();
        this.description = this.createDescription();
        this.contextValue = 'project';
        this.iconPath = this.getProjectIcon();
        this.resourceUri = vscode.Uri.parse(`project:${project.buildFile}`);
    }

    private createDescription(): string {
        const stats = this.getProjectStats();
        const parts = [];
        
        parts.push(`${this.project.dependencies.length} deps`);
        
        if (stats.conflicts > 0) {
            parts.push(`${stats.conflicts} conflicts`);
        }
        
        if (stats.missing > 0) {
            parts.push(`${stats.missing} missing`);
        }
        
        if (stats.platformIssues > 0) {
            parts.push(`${stats.platformIssues} platform`);
        }
        
        return parts.join(' • ');
    }

    private getProjectIcon(): vscode.ThemeIcon {
        const stats = this.getProjectStats();
        
        if (stats.missing > 0) {
            return new vscode.ThemeIcon('folder-library', new vscode.ThemeColor('errorForeground'));
        } else if (stats.conflicts > 0) {
            return new vscode.ThemeIcon('folder-library', new vscode.ThemeColor('warningForeground'));
        } else if (stats.platformIssues > 0) {
            return new vscode.ThemeIcon('folder-library', new vscode.ThemeColor('charts.blue'));
        } else {
            return new vscode.ThemeIcon('folder-library', new vscode.ThemeColor('charts.green'));
        }
    }

    private getProjectStats() {
        const stats = {
            total: this.project.dependencies.length,
            conflicts: 0,
            missing: 0,
            platformIssues: 0,
            healthy: 0
        };
        
        this.project.dependencies.forEach(dep => {
            if (dep.missing) {
                stats.missing++;
            } else if (dep.conflicts && dep.conflicts.length > 0) {
                stats.conflicts++;
            } else if (dep.platformIssue) {
                stats.platformIssues++;
            } else {
                stats.healthy++;
            }
        });
        
        return stats;
    }

    private createTooltip(): vscode.MarkdownString {
        const tooltip = new vscode.MarkdownString();
        tooltip.isTrusted = true;
        
        const stats = this.getProjectStats();
        const statusIcon = stats.missing > 0 ? '❌' : 
                          stats.conflicts > 0 ? '⚠️' : 
                          stats.platformIssues > 0 ? '🔧' : '✅';
        
        tooltip.appendMarkdown(`## ${statusIcon} ${this.project.type.toUpperCase()} Project\n\n`);
        
        // Build system info
        tooltip.appendMarkdown(`**Build System:** \`${this.project.buildSystem}\`\n\n`);
        
        // Build file path
        tooltip.appendMarkdown(`**Build File:** \`${this.project.buildFile}\`\n\n`);
        
        // Statistics
        tooltip.appendMarkdown(`### 📊 Statistics\n\n`);
        tooltip.appendMarkdown(`| Status | Count |\n`);
        tooltip.appendMarkdown(`|--------|-------|\n`);
        tooltip.appendMarkdown(`| $(check) Healthy | ${stats.healthy} |\n`);
        tooltip.appendMarkdown(`| $(warning) Conflicts | ${stats.conflicts} |\n`);
        tooltip.appendMarkdown(`| $(error) Missing | ${stats.missing} |\n`);
        tooltip.appendMarkdown(`| $(gear) Platform Issues | ${stats.platformIssues} |\n`);
        tooltip.appendMarkdown(`| **Total** | **${stats.total}** |\n\n`);
        
        // Health indicator
        if (stats.missing === 0 && stats.conflicts === 0 && stats.platformIssues === 0) {
            tooltip.appendMarkdown(`**Overall Health:** $(check) Excellent\n\n`);
        } else if (stats.missing === 0) {
            tooltip.appendMarkdown(`**Overall Health:** $(warning) Needs Attention\n\n`);
        } else {
            tooltip.appendMarkdown(`**Overall Health:** $(error) Critical Issues\n\n`);
        }
        
        return tooltip;
    }
}
