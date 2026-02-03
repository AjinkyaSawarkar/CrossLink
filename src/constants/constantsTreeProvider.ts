// src/constants/constantsTreeProvider.ts
import * as vscode from 'vscode';
import * as path from 'path';
import { ConstantsAnalyzer, ConstantInfo } from './constantsAnalyzer';

export class ConstantsTreeProvider implements vscode.TreeDataProvider<ConstantTreeItem> {
    private _onDidChangeTreeData: vscode.EventEmitter<ConstantTreeItem | undefined | null | void> = new vscode.EventEmitter<ConstantTreeItem | undefined | null | void>();
    readonly onDidChangeTreeData: vscode.Event<ConstantTreeItem | undefined | null | void> = this._onDidChangeTreeData.event;

    private constants: ConstantInfo[] = [];
    private groupBy: 'file' | 'type' | 'category' | 'suggestions' = 'file';
    private searchFilter: string = '';
    private showOnlyWithSuggestions: boolean = false;

    constructor(private analyzer: ConstantsAnalyzer) { }

    refresh(): void {
        this._onDidChangeTreeData.fire();
    }

    async updateConstants(): Promise<void> {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (workspaceFolder) {
            this.constants = await this.analyzer.analyzeWorkspace(workspaceFolder);
            this.refresh();
        }
    }

    setGroupBy(groupBy: 'file' | 'type' | 'category' | 'suggestions'): void {
        this.groupBy = groupBy;
        this.refresh();
    }

    setSearchFilter(filter: string): void {
        this.searchFilter = filter.toLowerCase();
        this.refresh();
    }

    setShowOnlyWithSuggestions(show: boolean): void {
        this.showOnlyWithSuggestions = show;
        this.refresh();
    }

    getTreeItem(element: ConstantTreeItem): vscode.TreeItem {
        return element;
    }

    getChildren(element?: ConstantTreeItem): Thenable<ConstantTreeItem[]> {
        if (!element) {
            return Promise.resolve(this.getRootItems());
        } else if (element instanceof GroupTreeItem) {
            return Promise.resolve(element.children);
        } else if (element instanceof ConstantItemTreeItem) {
            return Promise.resolve(element.suggestions);
        }

        return Promise.resolve([]);
    }

    private getRootItems(): ConstantTreeItem[] {
        const filteredConstants = this.getFilteredConstants();

        if (filteredConstants.length === 0) {
            return [new NoConstantsItem()];
        }

        switch (this.groupBy) {
            case 'file':
                return this.groupByFile(filteredConstants);
            case 'type':
                return this.groupByType(filteredConstants);
            case 'category':
                return this.groupByCategory(filteredConstants);
            case 'suggestions':
                return this.groupBySuggestions(filteredConstants);
            default:
                return this.groupByFile(filteredConstants);
        }
    }

    private getFilteredConstants(): ConstantInfo[] {
        return this.constants.filter(constant => {
            // Search filter
            if (this.searchFilter && !this.matchesSearch(constant)) {
                return false;
            }

            // Show only with suggestions filter
            if (this.showOnlyWithSuggestions && constant.suggestedNames.length === 0) {
                return false;
            }

            return true;
        });
    }

    private matchesSearch(constant: ConstantInfo): boolean {
        const searchLower = this.searchFilter;
        return constant.name.toLowerCase().includes(searchLower) ||
            constant.value.toLowerCase().includes(searchLower) ||
            path.basename(constant.file).toLowerCase().includes(searchLower) ||
            constant.suggestedNames.some(name => name.toLowerCase().includes(searchLower));
    }

    private groupByFile(constants: ConstantInfo[]): ConstantTreeItem[] {
        const fileGroups = new Map<string, ConstantInfo[]>();

        constants.forEach(constant => {
            const fileName = path.basename(constant.file);
            if (!fileGroups.has(fileName)) {
                fileGroups.set(fileName, []);
            }
            fileGroups.get(fileName)!.push(constant);
        });

        const items: GroupTreeItem[] = [];
        fileGroups.forEach((constants, fileName) => {
            const children = constants.map(constant => new ConstantItemTreeItem(constant));
            const suggestionsCount = constants.filter(c => c.suggestedNames.length > 0).length;
            const highConfidenceCount = constants.filter(c => c.confidence >= 80).length;

            const statusIcon = suggestionsCount > 0 ? '💡' : '✅';
            const statusText = suggestionsCount > 0 ?
                `${suggestionsCount} need suggestions` :
                'All well-named';

            items.push(new GroupTreeItem(fileName, children,
                `${statusIcon} 📄 ${fileName} (${constants.length} constants • ${statusText})`));
        });

        return items.sort((a, b) => {
            const labelA = typeof a.label === 'string' ? a.label : a.label?.label || '';
            const labelB = typeof b.label === 'string' ? b.label : b.label?.label || '';
            return labelA.localeCompare(labelB);
        });
    }

    private groupByType(constants: ConstantInfo[]): ConstantTreeItem[] {
        const typeGroups = new Map<string, ConstantInfo[]>();

        constants.forEach(constant => {
            if (!typeGroups.has(constant.type)) {
                typeGroups.set(constant.type, []);
            }
            typeGroups.get(constant.type)!.push(constant);
        });

        const items: GroupTreeItem[] = [];
        typeGroups.forEach((constants, type) => {
            const children = constants.map(constant => new ConstantItemTreeItem(constant));
            const suggestionsCount = constants.filter(c => c.suggestedNames.length > 0).length;
            const icon = this.getTypeIcon(type);
            items.push(new GroupTreeItem(type, children, `${icon} ${type} (${constants.length} constants • ${suggestionsCount} need suggestions)`));
        });

        return items.sort((a, b) => {
            const labelA = typeof a.label === 'string' ? a.label : a.label?.label || '';
            const labelB = typeof b.label === 'string' ? b.label : b.label?.label || '';
            return labelA.localeCompare(labelB);
        });
    }

    private groupByCategory(constants: ConstantInfo[]): ConstantTreeItem[] {
        const categoryGroups = new Map<string, ConstantInfo[]>();

        constants.forEach(constant => {
            if (!categoryGroups.has(constant.category)) {
                categoryGroups.set(constant.category, []);
            }
            categoryGroups.get(constant.category)!.push(constant);
        });

        const items: GroupTreeItem[] = [];
        categoryGroups.forEach((constants, category) => {
            const icon = this.getCategoryIcon(category);
            const children = constants.map(constant => new ConstantItemTreeItem(constant));
            const suggestionsCount = constants.filter(c => c.suggestedNames.length > 0).length;
            items.push(new GroupTreeItem(category, children, `${icon} ${category} (${constants.length} constants • ${suggestionsCount} need suggestions)`));
        });

        return items.sort((a, b) => {
            const labelA = typeof a.label === 'string' ? a.label : a.label?.label || '';
            const labelB = typeof b.label === 'string' ? b.label : b.label?.label || '';
            return labelA.localeCompare(labelB);
        });
    }

    private groupBySuggestions(constants: ConstantInfo[]): ConstantTreeItem[] {
        const withSuggestions = constants.filter(c => c.suggestedNames.length > 0);
        const withoutSuggestions = constants.filter(c => c.suggestedNames.length === 0);

        const items: GroupTreeItem[] = [];

        if (withSuggestions.length > 0) {
            const children = withSuggestions.map(constant => new ConstantItemTreeItem(constant));
            const highConfidenceCount = withSuggestions.filter(c => c.confidence >= 80).length;
            items.push(new GroupTreeItem('with-suggestions', children,
                `💡 Constants Needing Suggestions (${withSuggestions.length} • ${highConfidenceCount} high confidence)`));
        }

        if (withoutSuggestions.length > 0) {
            const children = withoutSuggestions.map(constant => new ConstantItemTreeItem(constant));
            items.push(new GroupTreeItem('without-suggestions', children,
                `✅ Well Named Constants (${withoutSuggestions.length})`));
        }

        return items;
    }

    private getCategoryIcon(category: string): string {
        switch (category) {
            case 'string': return '📝';
            case 'numeric': return '🔢';
            case 'boolean': return '✅';
            case 'magic_number': return '🔮';
            default: return '🔹';
        }
    }

    private getTypeIcon(type: string): string {
        switch (type.toLowerCase()) {
            case 'int': return '🔢';
            case 'string': return '📝';
            case 'boolean': return '✅';
            case 'double': return '🔢';
            case 'float': return '🔢';
            case 'long': return '🔢';
            case 'macro': return '🔧';
            default: return '🔹';
        }
    }

    getStats(): { total: number; withSuggestions: number; highConfidence: number; files: number } {
        const total = this.constants.length;
        const withSuggestions = this.constants.filter(c => c.suggestedNames.length > 0).length;
        const highConfidence = this.constants.filter(c => c.confidence >= 70).length;
        const files = new Set(this.constants.map(c => c.file)).size;

        return { total, withSuggestions, highConfidence, files };
    }
}

export abstract class ConstantTreeItem extends vscode.TreeItem { }

export class NoConstantsItem extends ConstantTreeItem {
    constructor() {
        super('No constants found', vscode.TreeItemCollapsibleState.None);
        this.description = 'Add constants to your Java or C++ files to get started';
        this.iconPath = new vscode.ThemeIcon('info');
        this.contextValue = 'noConstants';
    }
}

export class GroupTreeItem extends ConstantTreeItem {
    constructor(
        public readonly groupName: string,
        public readonly children: ConstantTreeItem[],
        label: string
    ) {
        super(label, vscode.TreeItemCollapsibleState.Expanded);
        this.contextValue = 'constantGroup';
        this.iconPath = new vscode.ThemeIcon('folder');
    }
}

export class ConstantItemTreeItem extends ConstantTreeItem {
    public suggestions: SuggestionTreeItem[] = [];

    constructor(public readonly constant: ConstantInfo) {
        super(constant.name, constant.suggestedNames.length > 0 ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None);

        this.description = this.createDescription();
        this.tooltip = this.createTooltip();
        this.contextValue = constant.suggestedNames.length > 0 ? 'constantWithSuggestions' : 'constant';

        // Set command based on whether suggestions are available
        if (constant.suggestedNames.length > 0) {
            this.command = {
                command: 'dependencyVisualizer.copyConstantName',
                title: 'Copy Best Suggestion to Clipboard',
                arguments: [constant.suggestedNames[0]]
            };
        } else {
            this.command = {
                command: 'dependencyVisualizer.goToConstant',
                title: 'Go to Constant',
                arguments: [constant]
            };
        }

        this.iconPath = this.getIcon();

        // Create suggestion items with apply buttons
        this.suggestions = constant.suggestedNames.map((suggestion, index) =>
            new SuggestionTreeItem(suggestion, constant, index === 0) // First suggestion is primary
        );
    }

    private createDescription(): string {
        const parts = [];

        // Add value with type indicator
        const typeIcon = this.getTypeIcon(this.constant.type);
        parts.push(`${typeIcon} = ${this.constant.value}`);

        if (this.constant.suggestedNames.length > 0) {
            const confidenceIcon = this.constant.confidence >= 80 ? '🔥' :
                this.constant.confidence >= 60 ? '💡' : '💭';
            const confidenceText = this.constant.confidence >= 80 ? 'High' :
                this.constant.confidence >= 60 ? 'Medium' : 'Low';
            const actionText = '📋 Click to Copy';
            parts.push(`${confidenceIcon} ${this.constant.suggestedNames.length} suggestion${this.constant.suggestedNames.length !== 1 ? 's' : ''} (${confidenceText} confidence) • ${actionText}`);
        } else {
            parts.push('✅ Well named');
        }

        return parts.join(' ');
    }

    private getTypeIcon(type: string): string {
        switch (type.toLowerCase()) {
            case 'int': return '🔢';
            case 'string': return '📝';
            case 'boolean': return '✅';
            case 'double': return '🔢';
            case 'float': return '🔢';
            case 'long': return '🔢';
            case 'macro': return '🔧';
            default: return '🔹';
        }
    }

    private getIcon(): vscode.ThemeIcon {
        const baseIcon = this.constant.category === 'string' ? 'symbol-string' :
            this.constant.category === 'numeric' ? 'symbol-numeric' :
                this.constant.category === 'boolean' ? 'symbol-boolean' : 'symbol-constant';

        let color: vscode.ThemeColor;
        if (this.constant.suggestedNames.length > 0) {
            color = this.constant.confidence >= 80 ?
                new vscode.ThemeColor('charts.orange') :
                this.constant.confidence >= 60 ?
                    new vscode.ThemeColor('charts.yellow') :
                    new vscode.ThemeColor('charts.red');
        } else {
            color = new vscode.ThemeColor('charts.green');
        }

        return new vscode.ThemeIcon(baseIcon, color);
    }

    private createTooltip(): vscode.MarkdownString {
        const tooltip = new vscode.MarkdownString();
        tooltip.isTrusted = true;

        // Header with constant name and status
        const statusIcon = this.constant.suggestedNames.length > 0 ? '💡' : '✅';
        const statusText = this.constant.suggestedNames.length > 0 ? 'Needs Suggestions' : 'Well Named';
        tooltip.appendMarkdown(`## ${statusIcon} ${this.constant.name}\n\n`);

        // Status badge
        const statusColor = this.constant.suggestedNames.length > 0 ? '#ff9800' : '#4caf50';
        tooltip.appendMarkdown(`<span style="background-color: ${statusColor}; color: white; padding: 2px 8px; border-radius: 12px; font-size: 0.8em; font-weight: bold;">${statusText}</span>\n\n`);

        // Constant details
        tooltip.appendMarkdown(`**🔢 Value:** \`${this.constant.value}\`\n\n`);
        tooltip.appendMarkdown(`**🔧 Type:** \`${this.constant.type}\`\n\n`);
        tooltip.appendMarkdown(`**🏷️ Language:** ${this.constant.language.toUpperCase()}\n\n`);
        tooltip.appendMarkdown(`**📁 Scope:** ${this.constant.scope}\n\n`);
        tooltip.appendMarkdown(`**📄 File:** \`${path.basename(this.constant.file)}\`\n\n`);
        tooltip.appendMarkdown(`**📍 Line:** ${this.constant.line + 1}\n\n`);

        if (this.constant.suggestedNames.length > 0) {
            const confidenceIcon = this.constant.confidence >= 80 ? '🔥' :
                this.constant.confidence >= 60 ? '💡' : '💭';
            const confidenceText = this.constant.confidence >= 80 ? 'High' :
                this.constant.confidence >= 60 ? 'Medium' : 'Low';
            tooltip.appendMarkdown(`**${confidenceIcon} Suggestions (${confidenceText} confidence - ${this.constant.confidence}%):**\n\n`);

            // Add "Copy Best Suggestion" button
            const bestSuggestion = this.constant.suggestedNames[0];
            const copyBestButton = `[📋 Copy Best: \`${bestSuggestion}\`](command:dependencyVisualizer.copyConstantName?${encodeURIComponent(JSON.stringify([bestSuggestion]))})`;
            tooltip.appendMarkdown(`${copyBestButton}\n\n`);

            // List all suggestions with copy buttons
            this.constant.suggestedNames.forEach((suggestion, index) => {
                const icon = index === 0 ? '⭐' : '💡';
                const label = index === 0 ? 'Recommended' : 'Alternative';
                const copyButton = `[Copy \`${suggestion}\`](command:dependencyVisualizer.copyConstantName?${encodeURIComponent(JSON.stringify([suggestion]))})`;
                tooltip.appendMarkdown(`${icon} \`${suggestion}\` (${label}) ${copyButton}\n\n`);
            });
        } else {
            tooltip.appendMarkdown(`✅ **Well named** - No suggestions needed\n\n`);
            tooltip.appendMarkdown(`This constant follows good naming conventions and doesn't require any changes.`);
        }

        return tooltip;
    }
}

export class SuggestionTreeItem extends ConstantTreeItem {
    constructor(
        public readonly suggestion: string,
        public readonly constant: ConstantInfo,
        public readonly isPrimary: boolean
    ) {
        super(suggestion, vscode.TreeItemCollapsibleState.None);

        this.description = this.createDescription();
        this.contextValue = 'constantSuggestion';
        this.iconPath = new vscode.ThemeIcon(
            isPrimary ? 'star-full' : 'lightbulb',
            new vscode.ThemeColor(isPrimary ? 'charts.orange' : 'charts.blue')
        );

        // Make it clickable to copy the suggestion to clipboard
        this.command = {
            command: 'dependencyVisualizer.copyConstantName',
            title: 'Copy to Clipboard',
            arguments: [suggestion]
        };
    }

    private createDescription(): string {
        const parts = [];

        if (this.isPrimary) {
            parts.push('⭐ Recommended');
        } else {
            parts.push('💡 Alternative');
        }

        // Add confidence indicator
        const confidence = this.constant.confidence;
        if (confidence >= 80) {
            parts.push('🔥 High');
        } else if (confidence >= 60) {
            parts.push('💡 Medium');
        } else {
            parts.push('💭 Low');
        }

        // Add copy button text
        parts.push('📋 Click to Copy');

        return parts.join(' • ');
    }
}
