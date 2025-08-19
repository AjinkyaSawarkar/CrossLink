// src/dashboard/dashboardProvider.ts (Complete Corrected File)
import * as vscode from 'vscode';
import { DependencyAnalyzer } from '../core/dependencyAnalyzer';
import { ConstantsAnalyzer } from '../constants/constantsAnalyzer';
import { RefactoringProvider } from '../refactoring/refactoringProvider';

export class DashboardProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'dependencyVisualizerDashboard';

    private _view?: vscode.WebviewView;
    private _isRefactoringAvailable: boolean = false;

    constructor(
        private readonly _extensionUri: vscode.Uri,
        private analyzer: DependencyAnalyzer,
        private constantsAnalyzer: ConstantsAnalyzer,
        private refactoringProvider: RefactoringProvider
    ) {
        // Listen for editor changes to update refactoring availability
        vscode.window.onDidChangeActiveTextEditor(() => {
            this.updateRefactoringAvailability();
        });
        
        vscode.window.onDidChangeTextEditorSelection(() => {
            this.updateRefactoringAvailability();
        });
    }

    public resolveWebviewView(
        webviewView: vscode.WebviewView,
        context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken,
    ) {
        this._view = webviewView;

        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [this._extensionUri]
        };

        webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);

        webviewView.webview.onDidReceiveMessage(async data => {
            switch (data.type) {
                case 'showDependencies':
                    await this.showDependencies();
                    break;
                case 'showFileConnections':
                    await this.showFileConnections();
                    break;
                case 'showConstants':
                    await this.showConstants();
                    break;
                case 'executeRefactoring':
                    await this.executeRefactoring();
                    break;
                case 'refreshAll':
                    await this.refreshAll();
                    break;

            }
        });

        // Initial update
        this.updateRefactoringAvailability();
    }

    private async updateRefactoringAvailability() {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            this._isRefactoringAvailable = false;
        } else {
            const workspaceFolder = vscode.workspace.getWorkspaceFolder(editor.document.uri);
            if (!workspaceFolder) {
                this._isRefactoringAvailable = false;
            } else {
                const context = {
                    workspaceFolder,
                    document: editor.document,
                    selection: editor.selection,
                    language: editor.document.languageId === 'java' ? 'java' as const : 'cpp' as const
                };
                
                const availableRefactorings = await this.refactoringProvider.getAvailableRefactorings(context);
                this._isRefactoringAvailable = availableRefactorings.length > 0;
            }
        }

        // Update the webview
        if (this._view) {
            this._view.webview.postMessage({ 
                type: 'updateRefactoringStatus', 
                available: this._isRefactoringAvailable 
            });
        }
    }

    private async showDependencies() {
        this.showStatus('🔄 Analyzing dependencies...');
        
        // First run the analysis
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) {
            vscode.window.showErrorMessage('No workspace folder found');
            return;
        }

        try {
            // Run analysis first
            await this.analyzer.analyzeDependencies(workspaceFolder.uri.fsPath);
            
            // Then show the graph
            await vscode.commands.executeCommand('dependencyVisualizer.showDependencyGraph');
            this.showStatus('📊 Dependency graph opened with analysis data');
        } catch (error) {
            this.showStatus('❌ Analysis failed');
            vscode.window.showErrorMessage(`Analysis failed: ${error}`);
        }
    }

    private async showFileConnections() {
        this.showStatus('🔄 Analyzing file connections...');
        
        try {
            // Ensure connections are analyzed
            const connections = await this.analyzer.getFileConnections();
            
            // Create webview panel instead of HTML document
            this.createFileConnectionsWebviewPanel(connections);
            this.showStatus(`🔗 Found ${connections.length} file connections`);
        } catch (error) {
            this.showStatus('❌ File connections analysis failed');
            vscode.window.showErrorMessage(`File connections analysis failed: ${error}`);
        }
    }

    private async showConstants() {
        this.showStatus('🔄 Analyzing constants...');
        
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) {
            vscode.window.showErrorMessage('No workspace folder found');
            return;
        }

        try {
            // Analyze constants
            const constants = await this.constantsAnalyzer.analyzeWorkspace(workspaceFolder);
            
            // Create webview panel instead of HTML document
            this.createConstantsWebviewPanel(constants);
            this.showStatus(`📝 Found ${constants.length} constants`);
        } catch (error) {
            this.showStatus('❌ Constants analysis failed');
            vscode.window.showErrorMessage(`Constants analysis failed: ${error}`);
        }
    }

    private async executeRefactoring() {
        if (!this._isRefactoringAvailable) {
            vscode.window.showWarningMessage('No refactoring options available at current position');
            return;
        }

        // Trigger the existing refactoring command
        await vscode.commands.executeCommand('dependencyVisualizer.refactor');
    }

    private async refreshAll() {
        this.showStatus('🔄 Refreshing all data...');
        
        try {
            // Refresh dependencies
            await this.showDependencies();
            
            // Refresh constants
            await this.showConstants();
            
            // Refresh file connections
            await this.showFileConnections();
            
            this.showStatus('✅ All data refreshed successfully!');
        } catch (error) {
            this.showStatus('❌ Error refreshing data');
            console.error('Error refreshing all data:', error);
        }
    }



    private showStatus(message: string) {
        if (this._view) {
            this._view.webview.postMessage({ type: 'showStatus', message });
        }
    }

    // FIX: Create webview panel for file connections with proper message handling
    private createFileConnectionsWebviewPanel(connections: any[]) {
        const panel = vscode.window.createWebviewPanel(
            'fileConnectionsView',
            '🔗 Java-C++ File Connections',
            vscode.ViewColumn.Beside,
            {
                enableScripts: true,
                retainContextWhenHidden: true
            }
        );

        panel.webview.html = this.createFileConnectionsTreeView(connections);
        
        // FIX: Handle messages from the webview properly
        panel.webview.onDidReceiveMessage(async message => {
            console.log('Received message in file connections panel:', message);
            switch (message.command) {
                case 'openFile':
                    try {
                        const uri = vscode.Uri.file(message.filePath);
                        await vscode.window.showTextDocument(uri);
                    } catch (error) {
                        vscode.window.showErrorMessage(`Failed to open file: ${message.filePath}`);
                    }
                    break;
                case 'generateStub':
                    await vscode.commands.executeCommand('dependencyVisualizer.generateCppStub', message.connection);
                    break;
                case 'renameConstant':
                    try {
                        const { filePath, line, oldName, newName } = message;
                        await this.renameConstantInFile(filePath, line, oldName, newName);
                        vscode.window.showInformationMessage(`Renamed "${oldName}" to "${newName}"`);
                        } catch (error) {
                            vscode.window.showErrorMessage('Could not rename constant: ' + ((error as any)?.message || error));
                        }
                        break;
                }
            
        });
    }

    private async renameConstantSymbol(file: string, line: number, oldName: string, newName: string) {
    const uri = vscode.Uri.file(file);
    const doc = await vscode.workspace.openTextDocument(uri);
    const pos = new vscode.Position(line, 0);
    const editor = await vscode.window.showTextDocument(doc, { preview: false });
    editor.selection = new vscode.Selection(pos, pos);

    // Find the word at the position
    const wordRange = doc.getWordRangeAtPosition(pos, new RegExp(`\\b${oldName}\\b`));
    if (!wordRange) throw new Error('Could not locate constant name at given line');
    // Use built-in rename provider if available
    await vscode.commands.executeCommand('editor.action.rename', [
        uri, wordRange.start, newName
    ]);
}

    // FIX: Create webview panel for constants with proper message handling
    private createConstantsWebviewPanel(constants: any[]) {
        const panel = vscode.window.createWebviewPanel(
            'constantsView',
            '📝 Project Constants',
            vscode.ViewColumn.Beside,
            {
                enableScripts: true,
                retainContextWhenHidden: true
            }
        );

        panel.webview.html = this.createConstantsTreeView(constants);
        
        // FIX: Handle messages from the webview properly
        panel.webview.onDidReceiveMessage(async message => {
            console.log('Received message in constants panel:', message);
            switch (message.command) {
                case 'openFile':
                    try {
                        const uri = vscode.Uri.file(message.filePath);
                        const document = await vscode.workspace.openTextDocument(uri);
                        const editor = await vscode.window.showTextDocument(document);
                        
                        // If line number is provided, navigate to it
                        if (message.line !== undefined) {
                            const position = new vscode.Position(message.line, message.column || 0);
                            editor.selection = new vscode.Selection(position, position);
                            editor.revealRange(new vscode.Range(position, position));
                        }
                    } catch (error) {
                        vscode.window.showErrorMessage(`Failed to open file: ${message.filePath}`);
                    }
                    break;
                case 'applySuggestion':
                    await vscode.commands.executeCommand('dependencyVisualizer.applySuggestion', message.constant, message.suggestion);
                    break;
                case 'copyToClipboard':
                    await vscode.env.clipboard.writeText(message.text);
                    vscode.window.showInformationMessage(`Copied "${message.text}" to clipboard`);
                    break;
                case 'renameConstant':
                    try {
                        const { filePath, line, oldName, newName } = message;
                        await this.renameConstantInFile(filePath, line, oldName, newName);
                        vscode.window.showInformationMessage(`Renamed "${oldName}" to "${newName}"`);
                        } catch (error) {
                            vscode.window.showErrorMessage('Could not rename constant: ' + ((error as any)?.message || error));
                        }
                        break;
                }
        });
    }

    // Create interactive HTML for file connections
    private createFileConnectionsTreeView(connections: any[]): string {
        const connectedCount = connections.filter((c: any) => c.isMatched).length;
        const missingCount = connections.length - connectedCount;
        
        return `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Java-C++ File Connections</title>
    <style>
        body { 
            font-family: var(--vscode-font-family);
            padding: 20px; 
            background: var(--vscode-editor-background); 
            color: var(--vscode-foreground); 
            margin: 0;
        }
        .header {
            border-bottom: 2px solid var(--vscode-textLink-foreground);
            padding-bottom: 15px;
            margin-bottom: 20px;
        }
        .title { 
            font-size: 24px; 
            color: var(--vscode-textLink-foreground); 
            margin: 0;
        }
        .stats {
            display: flex;
            gap: 20px;
            margin-bottom: 20px;
            flex-wrap: wrap;
        }
        .stat-card {
            background: var(--vscode-editor-widget-background);
            border: 1px solid var(--vscode-widget-border);
            border-radius: 6px;
            padding: 15px;
            min-width: 120px;
            text-align: center;
        }
        .stat-number {
            font-size: 28px;
            font-weight: bold;
            margin-bottom: 5px;
        }
        .stat-number.connected { color: #4ec9b0; }
        .stat-number.missing { color: #f48771; }
        .stat-number.total { color: var(--vscode-textLink-foreground); }
        .file-group {
            background: var(--vscode-editor-widget-background);
            border: 1px solid var(--vscode-widget-border);
            border-radius: 6px;
            margin-bottom: 15px;
            overflow: hidden;
        }
        .file-header {
            background: var(--vscode-editor-widget-background);
            padding: 12px 15px;
            border-bottom: 1px solid var(--vscode-widget-border);
            cursor: pointer;
            display: flex;
            align-items: center;
            justify-content: space-between;
        }
        .file-header:hover {
            background: var(--vscode-list-hoverBackground);
        }
        .file-name {
            font-weight: bold;
            color: #569cd6;
        }
        .file-path {
            font-size: 11px;
            color: var(--vscode-descriptionForeground);
            margin-top: 2px;
        }
        .connection-count {
            background: var(--vscode-textLink-foreground);
            color: var(--vscode-editor-background);
            padding: 2px 8px;
            border-radius: 12px;
            font-size: 11px;
        }
        .connections-list {
            padding: 10px 0;
        }
        .connection-item {
            display: flex;
            align-items: center;
            padding: 8px 15px;
            border-left: 3px solid transparent;
            cursor: pointer;
        }
        .connection-item:hover {
            background: var(--vscode-list-hoverBackground);
        }
        .connection-item.connected {
            border-left-color: #4ec9b0;
            background-color: rgba(67, 160, 71, 0.10);
        }
        .connection-item.missing {
            border-left-color: #f48771;
            background-color: rgba(229, 57, 53, 0.10);
        }
          .arrow {
  margin: 0 8px;
  color: #888;
}
.cpp-file.not-found {
  color: #e53935;
  font-weight: 500;
}  
        .connection-status {
            font-size: 16px;
            margin-right: 10px;
        }
        .method-name {
            font-weight: 500;
            color: #dcdcaa;
            margin-right: 10px;
        }
        .cpp-file {
            color: #4ec9b0;
            font-size: 12px;
        }
        .search-box {
            width: 100%;
            padding: 10px;
            background: var(--vscode-input-background);
            border: 1px solid var(--vscode-input-border);
            border-radius: 4px;
            color: var(--vscode-input-foreground);
            margin-bottom: 20px;
        }
    </style>
</head>
<body>
    <div class="header">
        <h1 class="title">🔗 Java-C++ File Connections</h1>
        <div style="color: var(--vscode-descriptionForeground); margin-top: 5px;">
            Generated: ${new Date().toLocaleString()}
        </div>
    </div>

    <div class="stats">
        <div class="stat-card">
            <div class="stat-number total">${connections.length}</div>
            <div style="font-size: 12px; color: var(--vscode-descriptionForeground);">Total Methods</div>
        </div>
        <div class="stat-card">
            <div class="stat-number connected">${connectedCount}</div>
            <div style="font-size: 12px; color: var(--vscode-descriptionForeground);">Connected</div>
        </div>
        <div class="stat-card">
            <div class="stat-number missing">${missingCount}</div>
            <div style="font-size: 12px; color: var(--vscode-descriptionForeground);">Missing</div>
        </div>
        <div class="stat-card">
            <div class="stat-number total">${connections.length > 0 ? Math.round((connectedCount / connections.length) * 100) : 0}%</div>
            <div style="font-size: 12px; color: var(--vscode-descriptionForeground);">Success Rate</div>
        </div>
    </div>

    <input type="text" class="search-box" placeholder="🔍 Search connections..." onkeyup="filterConnections(this.value)">

    <div id="connections-container">
        ${this.generateConnectionsHtml(connections)}
    </div>

    <script>
        const vscode = acquireVsCodeApi();

        function openFile(filePath) {
    console.log('Opening file:', filePath);
    vscode.postMessage({
        command: 'openFile',
        filePath: filePath
    });
}

        function filterConnections(searchTerm) {
            const term = searchTerm.toLowerCase();
            const fileGroups = document.querySelectorAll('.file-group');
            
            fileGroups.forEach(group => {
                const fileName = group.dataset.file || '';
                const methods = group.querySelectorAll('.connection-item');
                let hasVisibleMethods = false;
                
                methods.forEach(method => {
                    const methodName = method.dataset.method || '';
                    const isVisible = fileName.includes(term) || methodName.includes(term);
                    method.style.display = isVisible ? 'flex' : 'none';
                    if (isVisible) hasVisibleMethods = true;
                });
                
                group.style.display = hasVisibleMethods ? 'block' : 'none';
            });
        }

        function openFile(filePath) {
            vscode.postMessage({
                command: 'openFile',
                filePath: filePath
            });
        }
    </script>
</body>
</html>`;
    }

    // Create interactive HTML for constants with file grouping and collapsible suggestions
    // Create compact list view for constants
   // Create compact list view for constants
private createConstantsTreeView(constants: any[]): string {
    const regularConstants = constants.filter((c: any) => !c.isMagicNumber);
    const magicNumbers = constants.filter((c: any) => c.category === 'magic_number' || c.isMagicNumber);
    const withSuggestions = regularConstants.filter((c: any) => c.suggestedNames && c.suggestedNames.length > 0);
    const wellNamed = regularConstants.filter((c: any) => !c.suggestedNames || c.suggestedNames.length === 0);
    
    return `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Project Constants</title>
    <style>
        :root {
            --primary-bg: #1a1a1a;
            --secondary-bg: #252526;
            --tertiary-bg: #2d2d30;
            --hover-bg: #2a2d2e;
            
            --primary-border: #3e3e42;
            --secondary-border: #454545;
            --accent-border: #0e639c;
            
            --primary-text: #cccccc;
            --secondary-text: #9d9d9d;
            --accent-text: #4fc3f7;
            --success-text: #81c784;
            --warning-text: #ffb74d;
            --error-text: #e57373;
            --magic-text: #ff9800;
        }

        body { 
            font-family: var(--vscode-font-family);
            padding: 20px; 
            background: var(--primary-bg); 
            color: var(--primary-text); 
            margin: 0;
            line-height: 1.4;
        }
        
        .header {
            background: var(--secondary-bg);
            border: 1px solid var(--primary-border);
            border-radius: 6px;
            padding: 16px;
            margin-bottom: 20px;
        }
        
        .title { 
            font-size: 22px; 
            color: var(--accent-text); 
            margin: 0;
            font-weight: 600;
        }
        
        .subtitle {
            color: var(--secondary-text);
            margin-top: 4px;
            font-size: 12px;
        }
        
        .stats {
            display: flex;
            gap: 12px;
            margin-bottom: 20px;
            flex-wrap: wrap;
        }
        
        .stat-item {
            background: var(--tertiary-bg);
            border: 1px solid var(--primary-border);
            border-radius: 4px;
            padding: 8px 12px;
            font-size: 12px;
            display: flex;
            align-items: center;
            gap: 6px;
        }
        
        .stat-number {
            font-weight: 600;
            font-size: 14px;
        }
        
        .stat-number.good { color: var(--success-text); }
        .stat-number.needs-work { color: var(--error-text); }
        .stat-number.magic { color: var(--magic-text); }
        .stat-number.total { color: var(--accent-text); }
        
        .search-box {
            width: 100%;
            padding: 8px 12px;
            background: var(--tertiary-bg);
            border: 1px solid var(--primary-border);
            border-radius: 4px;
            color: var(--primary-text);
            margin-bottom: 16px;
            font-size: 13px;
        }
        
        .search-box:focus {
            outline: none;
            border-color: var(--accent-border);
        }
        
        .tabs {
            display: flex;
            margin-bottom: 16px;
            border-bottom: 1px solid var(--primary-border);
            background: var(--secondary-bg);
            border-radius: 4px 4px 0 0;
        }
        
        .tab {
            padding: 8px 16px;
            cursor: pointer;
            border-bottom: 2px solid transparent;
            color: var(--secondary-text);
            transition: all 0.2s ease;
            font-size: 13px;
            font-weight: 500;
        }
        
        .tab:hover {
            background: var(--hover-bg);
            color: var(--primary-text);
        }
        
        .tab.active {
            color: var(--accent-text);
            border-bottom-color: var(--accent-text);
            background: var(--tertiary-bg);
        }
        
        .tab-content {
            display: none;
        }
        
        .tab-content.active {
            display: block;
        }
        
        /* COMPACT LIST STYLES */
        .constants-list {
            background: var(--secondary-bg);
            border: 1px solid var(--primary-border);
            border-radius: 4px;
            overflow: hidden;
        }
        
        .list-header {
            background: var(--tertiary-bg);
            padding: 8px 16px;
            border-bottom: 1px solid var(--primary-border);
            font-size: 12px;
            color: var(--secondary-text);
            font-weight: 600;
            text-transform: uppercase;
            letter-spacing: 0.5px;
        }
        
        .constant-row {
            display: flex;
            align-items: center;
            padding: 6px 16px;
            border-bottom: 1px solid var(--primary-border);
            cursor: pointer;
            transition: background-color 0.2s ease;
            font-size: 13px;
        }
        
        .constant-row:last-child {
            border-bottom: none;
        }
        
        .constant-row:hover {
            background: var(--hover-bg);
        }
        
        .constant-row.needs-suggestions {
            border-left: 3px solid var(--error-text);
            background: rgba(229, 115, 115, 0.05);
        }
        
        .constant-row.well-named {
            border-left: 3px solid var(--success-text);
            background: rgba(129, 199, 132, 0.05);
        }
        
        .constant-row.magic-number {
            border-left: 3px solid var(--magic-text);
            background: rgba(255, 152, 0, 0.05);
        }
        
        .status-icon {
            width: 20px;
            text-align: center;
            margin-right: 8px;
            font-size: 14px;
        }
        
        .constant-name {
            font-family: 'Consolas', 'Monaco', monospace;
            font-weight: 600;
            color: var(--accent-text);
            min-width: 180px;
            margin-right: 12px;
        }
        
        .constant-value {
            font-family: 'Consolas', 'Monaco', monospace;
            color: var(--warning-text);
            min-width: 120px;
            margin-right: 12px;
        }
        
        .constant-meta {
            display: flex;
            gap: 12px;
            margin-right: 12px;
            flex: 1;
        }
        
        .meta-item {
            color: var(--secondary-text);
            font-size: 11px;
            white-space: nowrap;
        }
        
        .suggestions-indicator {
            color: var(--error-text);
            font-size: 11px;
            margin-left: auto;
            cursor: pointer;
        }
        
        .suggestions-indicator:hover {
            color: var(--warning-text);
        }
        
        .suggestions-dropdown {
            background: var(--tertiary-bg);
            border: 1px solid var(--primary-border);
            margin: 0 16px 0 44px;
            padding: 8px;
            border-radius: 4px;
            display: none;
        }
        
        .suggestions-dropdown.show {
            display: block;
        }
        
        .suggestion-item {
            display: flex;
            align-items: center;
            padding: 4px 8px;
            cursor: pointer;
            border-radius: 3px;
            font-size: 12px;
        }
        
        .suggestion-item:hover {
            background: var(--hover-bg);
        }
        
        .suggestion-icon {
            margin-right: 8px;
            font-size: 12px;
        }
        
        .suggestion-name {
            font-family: 'Consolas', 'Monaco', monospace;
            color: var(--warning-text);
            margin-right: auto;
        }
        
        .suggestion-label {
            color: var(--secondary-text);
            font-size: 10px;
        }
        
        .file-group-header {
            background: var(--tertiary-bg);
            padding: 8px 16px;
            border-bottom: 1px solid var(--primary-border);
            font-weight: 600;
            color: var(--accent-text);
            font-size: 13px;
            cursor: pointer;
            display: flex;
            align-items: center;
            justify-content: space-between;
        }
        
        .file-group-header:hover {
            background: var(--hover-bg);
        }
        
        .file-count {
            background: var(--accent-text);
            color: var(--primary-bg);
            padding: 2px 6px;
            border-radius: 8px;
            font-size: 10px;
            font-weight: 600;
        }
    </style>
</head>
<body>
    <div class="header">
        <h1 class="title">📝 Project Constants & Magic Numbers</h1>
        <div class="subtitle">Generated: ${new Date().toLocaleString()}</div>
    </div>

    <div class="stats">
        <div class="stat-item">
            <span class="stat-number total">${constants.length}</span>
            <span>Total Items</span>
        </div>
        <div class="stat-item">
            <span class="stat-number good">${wellNamed.length}</span>
            <span>Well Named</span>
        </div>
        <div class="stat-item">
            <span class="stat-number needs-work">${withSuggestions.length}</span>
            <span>Need Suggestions</span>
        </div>
        <div class="stat-item">
            <span class="stat-number magic">${magicNumbers.length}</span>
            <span>Magic Numbers</span>
        </div>
    </div>

    <input type="text" class="search-box" placeholder="🔍 Search constants and magic numbers..." onkeyup="filterConstants(this.value)">

    <div class="tabs">
        <div class="tab active" onclick="showTab('byfile')">📁 By File (${constants.length})</div>
        <div class="tab" onclick="showTab('suggestions')">💡 Need Suggestions (${withSuggestions.length})</div>
        <div class="tab" onclick="showTab('magic')">🔢 Magic Numbers (${magicNumbers.length})</div>
        <div class="tab" onclick="showTab('wellnamed')">✅ Well Named (${wellNamed.length})</div>
    </div>

    <div id="byfile-tab" class="tab-content active">
        ${this.generateConstantsByFileList(constants)}
    </div>

    <div id="suggestions-tab" class="tab-content">
        ${this.generateConstantsList(withSuggestions, true)}
    </div>

    <div id="magic-tab" class="tab-content">
        ${this.generateMagicNumbersList(magicNumbers)}
    </div>

    <div id="wellnamed-tab" class="tab-content">
        ${this.generateConstantsList(wellNamed, false)}
    </div>

    <script>
        const vscode = acquireVsCodeApi();

        function showTab(tabName) {
            document.querySelectorAll('.tab-content').forEach(tab => {
                tab.classList.remove('active');
            });
            document.querySelectorAll('.tab').forEach(tab => {
                tab.classList.remove('active');
            });
            
            document.getElementById(tabName + '-tab').classList.add('active');
            event.target.classList.add('active');
        }

        function toggleSuggestions(constantId) {
            const suggestions = document.getElementById('suggestions-' + constantId);
            const indicator = document.getElementById('indicator-' + constantId);
            
            if (suggestions.classList.contains('show')) {
                suggestions.classList.remove('show');
                indicator.textContent = '💡 Show';
            } else {
                // Hide all other suggestions first
                document.querySelectorAll('.suggestions-dropdown.show').forEach(el => {
                    el.classList.remove('show');
                });
                document.querySelectorAll('.suggestions-indicator').forEach(el => {
                    if (el.id.startsWith('indicator-')) {
                        el.textContent = '💡 Show';
                    }
                });
                
                suggestions.classList.add('show');
                indicator.textContent = '🔼 Hide';
            }
        }

        function filterConstants(searchTerm) {
            const term = searchTerm.toLowerCase();
            const rows = document.querySelectorAll('.constant-row');
            
            rows.forEach(row => {
                const text = row.textContent.toLowerCase();
                const isVisible = text.includes(term);
                row.style.display = isVisible ? 'flex' : 'none';
            });
        }

        function copySuggestion(suggestion) {
            vscode.postMessage({
                command: 'copyToClipboard',
                text: suggestion
            });
        }

        function openConstantFile(filePath, line, column) {
        
            vscode.postMessage({
                command: 'openFile',
                filePath: filePath,
                line: line,
                column: column
            });
        }
    </script>
</body>
</html>`;
}

// NEW: Generate compact list for constants by file
private generateConstantsByFileList(constants: any[]): string {
    // Group by files
    const fileGroups = new Map<string, any[]>();
    constants.forEach((constant: any) => {
        if (!fileGroups.has(constant.file)) {
            fileGroups.set(constant.file, []);
        }
        fileGroups.get(constant.file)!.push(constant);
    });

    let html = '<div class="constants-list">';
    
    fileGroups.forEach((fileConstants, filePath) => {
        const fileName = filePath.split(/[/\\]/).pop() || filePath;
        const suggestionsCount = fileConstants.filter(c => c.suggestedNames && c.suggestedNames.length > 0).length;
        const magicCount = fileConstants.filter(c => c.isMagicNumber).length;
        
        html += `
        <div class="file-group-header">
            <span>📄 ${fileName}</span>
            <span class="file-count">${fileConstants.length}${magicCount > 0 ? ` (${magicCount} magic)` : ''}</span>
        </div>`;
        
        fileConstants.forEach((constant: any, index: number) => {
            const constantId = `${fileName}_${index}`;
            const hasSuggestions = constant.suggestedNames && constant.suggestedNames.length > 0;
            const isMagic = constant.isMagicNumber;
            const cssClass = isMagic ? 'magic-number' : (hasSuggestions ? 'needs-suggestions' : 'well-named');
            const statusIcon = isMagic ? '🔢' : (hasSuggestions ? '💡' : '✅');
            
            html += `
                <div class="constant-row ${cssClass}" onclick="openConstantFile('${constant.file}', ${constant.line}, ${constant.column})">
                    <div class="status-icon">${statusIcon}</div>
                    <div class="constant-name">${constant.name}</div>
                    <div class="constant-value">= ${constant.value}</div>
                    <div class="constant-meta">
                        <span class="meta-item">🔧 ${constant.type}</span>
                        <span class="meta-item">🏷️ ${constant.language.toUpperCase()}</span>
                        <span class="meta-item">📍 Line ${constant.line + 1}</span>
                        ${isMagic ? `<span class="meta-item">📍 ${constant.usageContext}</span>` : ''}
                    </div>
                    ${hasSuggestions ? `<div class="suggestions-indicator" id="indicator-${constantId}" onclick="event.stopPropagation(); toggleSuggestions('${constantId}')">💡 Show</div>` : ''}
                </div>`;
            
            if (hasSuggestions) {
                html += `<div class="suggestions-dropdown" id="suggestions-${constantId}">`;
                constant.suggestedNames.forEach((suggestion: string, idx: number) => {
                    const icon = idx === 0 ? '⭐' : '💡';
                    const label = idx === 0 ? 'Recommended' : 'Alternative';
                    html += `
                        <div class="suggestion-item" onclick="copySuggestion('${suggestion}')">
                            <span class="suggestion-icon">${icon}</span>
                            <span class="suggestion-name">${suggestion}</span>
                            <span class="suggestion-label">${label}</span>
                        </div>`;
                });
                html += `</div>`;
            }
        });
    });
    
    html += '</div>';
    return html;
}

// NEW: Generate compact list for constants
private generateConstantsList(constants: any[], hasSuggestions: boolean): string {
    if (constants.length === 0) {
        return '<div style="text-align: center; padding: 40px; color: var(--secondary-text);">No constants in this category</div>';
    }

    let html = '<div class="constants-list">';
    html += `<div class="list-header">${hasSuggestions ? 'Constants Needing Suggestions' : 'Well Named Constants'}</div>`;
    
    constants.forEach((constant: any, index: number) => {
        const fileName = constant.file.split(/[/\\]/).pop() || constant.file;
        const constantId = `const_${index}`;
        const cssClass = hasSuggestions ? 'needs-suggestions' : 'well-named';
        const statusIcon = hasSuggestions ? '💡' : '✅';
        
        html += `
            <div class="constant-row ${cssClass}" onclick="openConstantFile('${constant.file}', ${constant.line}, ${constant.column})">
                <div class="status-icon">${statusIcon}</div>
                <div class="constant-name">${constant.name}</div>
                <div class="constant-value">= ${constant.value}</div>
                <div class="constant-meta">
                    <span class="meta-item">📄 ${fileName}</span>
                    <span class="meta-item">🔧 ${constant.type}</span>
                    <span class="meta-item">🏷️ ${constant.language.toUpperCase()}</span>
                    <span class="meta-item">📍 Line ${constant.line + 1}</span>
                </div>
                ${hasSuggestions && constant.suggestedNames ? `<div class="suggestions-indicator" id="indicator-${constantId}" onclick="event.stopPropagation(); toggleSuggestions('${constantId}')">💡 Show</div>` : ''}
            </div>`;
        
        if (hasSuggestions && constant.suggestedNames) {
            html += `<div class="suggestions-dropdown" id="suggestions-${constantId}">`;
            constant.suggestedNames.forEach((suggestion: string, idx: number) => {
                const icon = idx === 0 ? '⭐' : '💡';
                const label = idx === 0 ? 'Recommended' : 'Alternative';
                html += `
                    <div class="suggestion-item" onclick="copySuggestion('${suggestion}')">
                        <span class="suggestion-icon">${icon}</span>
                        <span class="suggestion-name">${suggestion}</span>
                        <span class="suggestion-label">${label}</span>
                    </div>`;
            });
            html += `</div>`;
        }
    });
    
    html += '</div>';
    return html;
}

// NEW: Generate compact list for magic numbers
private generateMagicNumbersList(magicNumbers: any[]): string {
    if (magicNumbers.length === 0) {
        return '<div style="text-align: center; padding: 40px; color: var(--secondary-text);">🎉 No magic numbers found! Your code is clean.</div>';
    }

    let html = '<div class="constants-list">';
    html += '<div class="list-header">Magic Numbers Detected</div>';
    
    magicNumbers.forEach((constant: any, index: number) => {
        const fileName = constant.file.split(/[/\\]/).pop() || constant.file;
        const constantId = `magic_${index}`;
        
        html += `
            <div class="constant-row magic-number" onclick="openConstantFile('${constant.file}', ${constant.line}, ${constant.column})">
                <div class="status-icon">🔢</div>
                <div class="constant-name">${constant.value}</div>
                <div class="constant-value">in ${fileName}</div>
                <div class="constant-meta">
                    <span class="meta-item">🔧 ${constant.type}</span>
                    <span class="meta-item">🏷️ ${constant.language.toUpperCase()}</span>
                    <span class="meta-item">📍 Line ${constant.line + 1}</span>
                    <span class="meta-item">📍 ${constant.usageContext}</span>
                </div>
                ${constant.suggestedNames && constant.suggestedNames.length > 0 ? `<div class="suggestions-indicator" id="indicator-${constantId}" onclick="event.stopPropagation(); toggleSuggestions('${constantId}')">💡 Show</div>` : ''}
            </div>`;
        
        if (constant.suggestedNames && constant.suggestedNames.length > 0) {
            html += `<div class="suggestions-dropdown" id="suggestions-${constantId}">`;
            constant.suggestedNames.forEach((suggestion: string, idx: number) => {
                const icon = idx === 0 ? '⭐' : '💡';
                const label = idx === 0 ? 'Recommended' : 'Alternative';
                html += `
                    <div class="suggestion-item" onclick="copySuggestion('${suggestion}')">
                        <span class="suggestion-icon">${icon}</span>
                        <span class="suggestion-name">${suggestion}</span>
                        <span class="suggestion-label">${label}</span>
                    </div>`;
            });
            html += `</div>`;
        }
    });
    
    html += '</div>';
    return html;
}

// Helper for compact list, indented under filename/group.


private generateConstantsByFileIndentedList(fileGroups: Map<string, any[]>): string {
    let html = '';
    let i = 0;
    for (const [file, constants] of fileGroups.entries()) {
        const fileName = file.split(/[/\\]/).pop();
        html += `<div class="file-group">
          <div class="file-header">📄 ${fileName}</div>
          ${constants.map((c, idx) =>{
            const isMagic = c.category === "magic_number";
            return ` <div class="constant-row${isMagic ? " magic" : ""}"
                data-type="${c.category || ''}"
                data-file="${(fileName || 'unknown').toLowerCase()}"
                data-name="${c.name.toLowerCase()}"
                data-meta="${(c.type + ' ' + (c.language || '') + ' ' + c.value).toLowerCase()}"
                onclick="openConstant('${c.file}',${c.line},${c.column})">
              <span class="c-name">${c.name}</span>
              <span class="c-value">= ${c.value}</span>
              <span class="c-meta">🔧${c.type} 🏷️${c.language?.toUpperCase() || ''} 📍${c.line+1}</span>
              ${c.suggestedNames && c.suggestedNames.length ? `
                <button class="c-sugg" onclick="event.stopPropagation();toggleSuggestions('${i}_${idx}')">💡</button>
                <div class="suggestion-list" id="sugg-${i}_${idx}" style="display:none;">
                  ${c.suggestedNames.map((s: string) =>
                    `<div class="suggestion-item" onclick="event.stopPropagation();renameConstant('${c.file}',${c.line},'${c.name.replace(/'/g,"\\'")}','${s.replace(/'/g,"\\'")}')">${s}</div>`
                  ).join('')}
                </div>
              ` : ''}
            </div>
          `;
      }).join('')}
    </div>`;
    i++;
}
    return html;
}

private async renameConstantInFile(filePath: string, line: number, oldName: string, newName: string) {
    const uri = vscode.Uri.file(filePath);
    const doc = await vscode.workspace.openTextDocument(uri);
    const editor = await vscode.window.showTextDocument(doc, { preview: false });
    // Get the actual word position (in case column isn't provided, or name is not at beginning)
    const lineText = doc.lineAt(line).text;
    const regex = new RegExp(`\\b${oldName}\\b`, 'g');
    let match: RegExpExecArray | null;
    let found = false;
    while ((match = regex.exec(lineText)) !== null) {
        // Construct range for just the word
        const start = new vscode.Position(line, match.index);
        const end = new vscode.Position(line, match.index + oldName.length);
        const range = new vscode.Range(start, end);
        // Optionally, check it's an identifier (not a comment/string)
        await editor.edit(editBuilder => {
            editBuilder.replace(range, newName);
        });
        found = true;
        break; // For safety, only first match per line.
    }
    if (!found) throw new Error(`Could not locate "${oldName}" for renaming.`);
    await doc.save();
}



    // Helper method to generate connections HTML
    
private generateConnectionsHtml(connections: any[]): string {
    const javaFileGroups = new Map<string, any[]>();
    connections.forEach((conn: any) => {
        if (!javaFileGroups.has(conn.javaFile)) {
            javaFileGroups.set(conn.javaFile, []);
        }
        javaFileGroups.get(conn.javaFile)!.push(conn);
    });

    let html = '';
    javaFileGroups.forEach((fileConnections, javaFile) => {
        const fileName = javaFile.split(/[/\\]/).pop() || javaFile;
        const fileConnectedCount = fileConnections.filter(c => c.isMatched).length;
        
        // FIX: Properly escape file paths for HTML attributes
        const escapedJavaFile = javaFile.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
        
        html += `
        <div class="file-group" data-file="${fileName.toLowerCase()}">
            <div class="file-header" onclick="openFile('${escapedJavaFile}')">
                <div>
                    <div class="file-name">📄 ${fileName}</div>
                    <div class="file-path">${javaFile}</div>
                </div>
                <div class="connection-count">${fileConnectedCount}/${fileConnections.length}</div>
            </div>
            <div class="connections-list">`;
        
        fileConnections.forEach((conn: any) => {
            const status = conn.isMatched ? '✅' : '❌';
            const statusClass = conn.isMatched ? 'connected' : 'missing';
            const cppFile = conn.isMatched ? conn.cppFile.split(/[/\\]/).pop() : '';
            
            // FIX: Properly escape C++ file paths
            const escapedCppFile = conn.isMatched ? conn.cppFile.replace(/\\/g, '\\\\').replace(/'/g, "\\'") : '';
            
            html += `
                <div class="connection-item ${statusClass}" data-method="${conn.methodName.toLowerCase()}" ${conn.isMatched ? `onclick="openFile('${escapedCppFile}')"` : ''}>
                    <span class="connection-status">${status}</span>
                    <span class="method-name">${conn.methodName}</span>
                    <span class="arrow">→</span>
                    ${conn.isMatched ? 
                        `<span class="cpp-file"> ${cppFile}</span>` : 
                        '<span class="cpp-file not-found" style="color: #f48771;">Not Found</span>'
                    }
                </div>`;
        });
        
        html += `</div></div>`;
    });

    return html;
}

    // NEW: Generate constants grouped by files
    // Fix in generateConstantsByFileHtml method
private generateConstantsByFileHtml(constants: any[]): string {
    // Group by files
    const fileGroups = new Map<string, any[]>();
    constants.forEach((constant: any) => {
        if (!fileGroups.has(constant.file)) {
            fileGroups.set(constant.file, []);
        }
        fileGroups.get(constant.file)!.push(constant);
    });

    let html = '';
    fileGroups.forEach((fileConstants, filePath) => {
        const fileName = filePath.split(/[/\\]/).pop() || filePath;
        const suggestionsCount = fileConstants.filter(c => c.suggestedNames && c.suggestedNames.length > 0).length;
        const magicCount = fileConstants.filter(c => c.isMagicNumber).length;
        
        html += `
        <div class="file-group">
            <div class="file-header" onclick="toggleFileGroup(this)">
                <div>
                    <div class="file-name">📄 ${fileName}</div>
                    <div class="file-path">${filePath}</div>
                </div>
                <div class="constants-count">${fileConstants.length} items${magicCount > 0 ? ` (${magicCount} magic)` : ''}</div>
            </div>
            <div class="constants-list">`;
        
        fileConstants.forEach((constant: any, index: number) => {
            const constantId = `${fileName}_${index}`;
            const hasSuggestions = constant.suggestedNames && constant.suggestedNames.length > 0;
            const isMagic = constant.isMagicNumber;
            const cssClass = isMagic ? 'magic-number' : (hasSuggestions ? 'needs-suggestions' : 'well-named');
            
            // FIX: Use data attributes instead of onclick with file paths
            html += `
                <div class="constant-item ${cssClass}" data-file-path="${constant.file}" data-line="${constant.line}" data-column="${constant.column}" onclick="openConstantFileFromData(this)">
                    <div class="constant-header">
                        <div>
                            <span class="constant-name">${constant.name}</span>
                            <span class="constant-value">= ${constant.value}</span>
                        </div>
                        <div style="font-size: 14px;">
                            ${isMagic ? '🔢' : (hasSuggestions ? '💡' : '✅')}
                        </div>
                    </div>
                    <div class="constant-meta">
                        <span>🔧 ${constant.type}</span>
                        <span>🏷️ ${constant.language.toUpperCase()}</span>
                        <span>📍 Line ${constant.line + 1}</span>
                        ${isMagic ? `<span class="usage-context">📍 ${constant.usageContext}</span>` : ''}
                    </div>`;
            
            if (isMagic && constant.usageContext) {
                html += `
                    <div class="magic-number-info">
                        <strong>Magic Number Detected:</strong> Used in <span class="usage-context">${constant.usageContext}</span> context
                    </div>`;
            }
            
            if (hasSuggestions) {
                html += `
                    <button class="suggestions-toggle" id="toggle-${constantId}" onclick="event.stopPropagation(); toggleSuggestions('${constantId}')">
                        💡 Show Suggestions
                    </button>
                    <div class="suggestions" id="suggestions-${constantId}">`;
                
                constant.suggestedNames.forEach((suggestion: string, idx: number) => {
                    const icon = idx === 0 ? '⭐' : '💡';
                    const label = idx === 0 ? 'Recommended' : 'Alternative';
                    html += `
                        <div class="suggestion-item" onclick="event.stopPropagation(); copySuggestion('${suggestion}')">
                            <span class="suggestion-icon">${icon}</span>
                            <span class="suggestion-name">${suggestion}</span>
                            <span class="suggestion-label">${label}</span>
                        </div>`;
                });
                
                html += `</div>`;
            }
            
            html += `</div>`;
        });
        
        html += `</div></div>`;
    });

    return html;
}

    // NEW: Generate magic numbers HTML
    private generateMagicNumbersHtml(magicNumbers: any[]): string {
        let html = '';
        
        if (magicNumbers.length === 0) {
            html = '<div style="text-align: center; padding: 40px; color: var(--vscode-descriptionForeground);">🎉 No magic numbers found! Your code is clean.</div>';
            return html;
        }
        
        magicNumbers.forEach((constant: any, index: number) => {
            const fileName = constant.file.split(/[/\\]/).pop() || constant.file;
            const constantId = `magic_${index}`;
            
            html += `
            <div class="constant-item magic-number" onclick="openConstantFile('${constant.file}', ${constant.line}, ${constant.column})">
                <div class="constant-header">
                    <div>
                        <span class="constant-name">${constant.value}</span>
                        <span style="color: var(--vscode-descriptionForeground); margin-left: 10px;">in ${fileName}</span>
                    </div>
                    <div style="font-size: 14px; color: #ff9500;">🔢</div>
                </div>
                <div class="constant-meta">
                    <span>📄 ${fileName}</span>
                    <span>🔧 ${constant.type}</span>
                    <span>🏷️ ${constant.language.toUpperCase()}</span>
                    <span>📍 Line ${constant.line + 1}</span>
                </div>
                <div class="magic-number-info">
                    <strong>Context:</strong> <span class="usage-context">${constant.usageContext}</span><br>
                    <strong>Usage:</strong> ${constant.usageContext || 'General usage'}
                </div>`;
            
            if (constant.suggestedNames && constant.suggestedNames.length > 0) {
                html += `
                    <button class="suggestions-toggle" id="toggle-${constantId}" onclick="event.stopPropagation(); toggleSuggestions('${constantId}')">
                        💡 Show Suggestions (${constant.confidence}% confidence)
                    </button>
                    <div class="suggestions" id="suggestions-${constantId}">`;
                
                constant.suggestedNames.forEach((suggestion: string, idx: number) => {
                    const icon = idx === 0 ? '⭐' : '💡';
                    const label = idx === 0 ? 'Recommended' : 'Alternative';
                    html += `
                        <div class="suggestion-item" onclick="event.stopPropagation(); copySuggestion('${suggestion}')">
                            <span class="suggestion-icon">${icon}</span>
                            <span class="suggestion-name">${suggestion}</span>
                            <span class="suggestion-label">${label}</span>
                        </div>`;
                });
                
                html += `</div>`;
            }
            
            html += `</div>`;
        });

        return html;
    }

    // Update existing generateConstantsHtml method
    private generateConstantsHtml(constants: any[], hasSuggestions: boolean): string {
        let html = '';
        
        constants.forEach((constant: any, index: number) => {
            const fileName = constant.file.split(/[/\\]/).pop() || constant.file;
            const constantId = `const_${index}`;
            
            html += `
            <div class="constant-item ${hasSuggestions ? 'needs-suggestions' : 'well-named'}" onclick="openConstantFile('${constant.file}', ${constant.line}, ${constant.column})">
                <div class="constant-header">
                    <div>
                        <span class="constant-name">${constant.name}</span>
                        <span class="constant-value">= ${constant.value}</span>
                    </div>
                    <div style="font-size: 14px; color: ${hasSuggestions ? '#f48771' : '#4ec9b0'};">
                        ${hasSuggestions ? '💡' : '✅'}
                    </div>
                </div>
                <div class="constant-meta">
                    <span>📄 ${fileName}</span>
                    <span>🔧 ${constant.type}</span>
                    <span>🏷️ ${constant.language.toUpperCase()}</span>
                    <span>📍 Line ${constant.line + 1}</span>
                </div>`;
            
            if (hasSuggestions && constant.suggestedNames) {
                html += `
                    <button class="suggestions-toggle" id="toggle-${constantId}" onclick="event.stopPropagation(); toggleSuggestions('${constantId}')">
                        💡 Show Suggestions (${constant.confidence}% confidence)
                    </button>
                    <div class="suggestions" id="suggestions-${constantId}">`;
                
                constant.suggestedNames.forEach((suggestion: string, idx: number) => {
                    const icon = idx === 0 ? '⭐' : '💡';
                    const label = idx === 0 ? 'Recommended' : 'Alternative';
                    html += `
                        <div class="suggestion-item" onclick="event.stopPropagation(); copySuggestion('${suggestion}')">
                            <span class="suggestion-icon">${icon}</span>
                            <span class="suggestion-name">${suggestion}</span>
                            <span class="suggestion-label">${label}</span>
                        </div>`;
                });
                
                html += `</div>`;
            }
            
            html += `</div>`;
        });

        return html;
    }

    private _getHtmlForWebview(webview: vscode.Webview) {
        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Dependency Visualizer Dashboard</title>
    <style>
        body {
            font-family: var(--vscode-font-family);
            padding: 15px;
            color: var(--vscode-foreground);
            background-color: var(--vscode-editor-background);
        }
        .dashboard-header {
            text-align: center;
            margin-bottom: 20px;
            padding-bottom: 15px;
            border-bottom: 1px solid var(--vscode-widget-border);
        }
        .dashboard-title {
            font-size: 18px;
            font-weight: bold;
            color: var(--vscode-textLink-foreground);
            margin: 0;
        }
        .dashboard-subtitle {
            font-size: 12px;
            color: var(--vscode-descriptionForeground);
            margin: 5px 0 0 0;
        }
        .feature-section {
            margin-bottom: 20px;
        }
        .section-title {
            font-size: 14px;
            font-weight: bold;
            margin-bottom: 10px;
            color: var(--vscode-textLink-foreground);
        }
        .feature-btn {
            width: 100%;
            padding: 12px;
            margin-bottom: 8px;
            background: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            border: none;
            border-radius: 4px;
            cursor: pointer;
            font-size: 13px;
            display: flex;
            align-items: center;
            justify-content: flex-start;
            transition: background-color 0.2s;
        }
        .feature-btn:hover {
            background: var(--vscode-button-hoverBackground);
        }
        .feature-btn:disabled {
            background: var(--vscode-button-secondaryBackground);
            color: var(--vscode-button-secondaryForeground);
            cursor: not-allowed;
            opacity: 0.6;
        }
        .feature-btn .icon {
            margin-right: 8px;
            font-size: 16px;
        }
        .feature-btn .text {
            flex: 1;
            text-align: left;
        }
        .status-area {
            margin-top: 20px;
            padding: 10px;
            background: var(--vscode-editor-widget-background);
            border-radius: 4px;
            border: 1px solid var(--vscode-widget-border);
            min-height: 40px;
            display: flex;
            align-items: center;
        }
        .status-text {
            font-size: 12px;
            color: var(--vscode-descriptionForeground);
        }
        .refresh-btn {
            background: var(--vscode-button-secondaryBackground);
            color: var(--vscode-button-secondaryForeground);
        }
        .refresh-btn:hover {
            background: var(--vscode-button-secondaryHoverBackground);
        }
        .divider {
            height: 1px;
            background: var(--vscode-widget-border);
            margin: 15px 0;
        }
    </style>
</head>
<body>
    <div class="dashboard-header">
        <h1 class="dashboard-title">🔧 Dependency Visualizer</h1>
        <p class="dashboard-subtitle">Control Panel for Cross-Language Analysis</p>
    </div>

    <div class="feature-section">
        <div class="section-title">📊 Analysis Features</div>
        
        <button class="feature-btn" onclick="showDependencies()">
            <span class="icon">🔗</span>
            <span class="text">Show Dependencies Graph</span>
        </button>
        
        <button class="feature-btn" onclick="showFileConnections()">
            <span class="icon">🔄</span>
            <span class="text">Show File Linkages Report</span>
        </button>
        
        <button class="feature-btn" onclick="showConstants()">
            <span class="icon">📝</span>
            <span class="text">Show Constants Analysis</span>
        </button>
        

    </div>

    <div class="divider"></div>
    


    <div class="feature-section">
        <div class="section-title">🛠️ Refactoring Tools</div>
        
        <button class="feature-btn" id="refactoring-btn" onclick="executeRefactoring()">
            <span class="icon">⚡</span>
            <span class="text">Execute Refactoring</span>
        </button>
        <div style="font-size: 11px; color: var(--vscode-descriptionForeground); margin-left: 24px; margin-top: -5px;">
            Select code in editor to enable refactoring options
        </div>
    </div>

    <div class="divider"></div>

    <div class="feature-section">
        <button class="feature-btn refresh-btn" onclick="refreshAll()">
            <span class="icon">🔄</span>
            <span class="text">Refresh All Data</span>
        </button>
    </div>

    <div class="status-area">
        <div class="status-text" id="status-text">Ready. Select a feature above to get started.</div>
    </div>

    <script>
        const vscode = acquireVsCodeApi();

        function showDependencies() {
            vscode.postMessage({ type: 'showDependencies' });
        }

        function showFileConnections() {
            vscode.postMessage({ type: 'showFileConnections' });
        }

        function showConstants() {
            vscode.postMessage({ type: 'showConstants' });
        }



        function executeRefactoring() {
            vscode.postMessage({ type: 'executeRefactoring' });
        }

        function refreshAll() {
            vscode.postMessage({ type: 'refreshAll' });
            updateStatus('🔄 Refreshing all data...');
        }

        function updateStatus(message) {
            document.getElementById('status-text').textContent = message;
        }

        function updateRefactoringButton(available) {
            const btn = document.getElementById('refactoring-btn');
            if (available) {
                btn.disabled = false;
                btn.innerHTML = '<span class="icon">⚡</span><span class="text">Execute Refactoring (Available)</span>';
            } else {
                btn.disabled = true;
                btn.innerHTML = '<span class="icon">⚪</span><span class="text">Execute Refactoring (Not Available)</span>';
            }
        }



        // Listen for messages from the extension
        window.addEventListener('message', event => {
            const message = event.data;
            switch (message.type) {
                case 'updateRefactoringStatus':
                    updateRefactoringButton(message.available);
                    break;
                case 'showStatus':
                    updateStatus(message.message);
                    break;

            }
        });

        // Initial state
        updateRefactoringButton(false);
    </script>
</body>
</html>`;
    }
}
