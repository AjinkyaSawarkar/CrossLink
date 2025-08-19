// src/extension.ts
import * as vscode from 'vscode';
import { DependencyAnalyzer } from './core/dependencyAnalyzer';
import { DependencyTreeProvider } from './visualizer/dependencyTreeProvider';
import { WebviewProvider } from './visualizer/webviewProvider';
import { FileWatcher } from './watchers/fileWatcher';
import { RefactoringProvider } from './refactoring/refactoringProvider';
import { RenamingProvider } from './refactoring/renamingProvider';
import { NativeMethodMover } from './refactoring/nativeMethodMover';
import { NativeMethodCopier } from './refactoring/nativeMethodCopier';
import { ConstantExtractor } from './refactoring/constantExtractor';
import { RefactoringCodeActionProvider } from './refactoring/codeActionProvider';
import { registerMagicNumberFeatures } from './features/magicNumberConverter';
import { EnhancedFileConnectionListProvider } from './visualizer/enhancedFileConnectionListProvider';
import { StatisticsViewProvider } from './visualizer/statisticsViewProvider';
import { ConstantsAnalyzer } from './constants/constantsAnalyzer';
import { ConstantsTreeProvider } from './constants/constantsTreeProvider';
import { ConstantsWebviewProvider } from './constants/constantsWebviewProvider';
import { DashboardProvider } from './dashboard/dashboardProvider';
import { LibraryHighlighter } from './features/libraryHighlighter';

export function activate(context: vscode.ExtensionContext) {
    const analyzer = new DependencyAnalyzer();
    const treeProvider = new DependencyTreeProvider(analyzer);
    const webviewProvider = new WebviewProvider(context, analyzer);
    const fileWatcher = new FileWatcher(analyzer, treeProvider);

    // Set context for showing views (must be early in activation)
    vscode.commands.executeCommand('setContext', 'dependencyVisualizer.hasProjects', true);

    // FIX: Create instance of RefactoringProvider instead of using static methods
    const refactoringProvider = new RefactoringProvider();
    
    // Register refactoring operations
    refactoringProvider.registerOperation(new RenamingProvider());
    refactoringProvider.registerOperation(new NativeMethodMover());
    refactoringProvider.registerOperation(new NativeMethodCopier());
    refactoringProvider.registerOperation(new ConstantExtractor());

    // Initialize constants analyzer and tree provider
    const constantsAnalyzer = new ConstantsAnalyzer();
    const constantsTreeProvider = new ConstantsTreeProvider(constantsAnalyzer);
    const constantsWebviewProvider = new ConstantsWebviewProvider(context.extensionUri, constantsAnalyzer);

    // Initialize library highlighter
    const libraryHighlighter = new LibraryHighlighter();

    // Register the unified dashboard provider
const dashboardProvider = new DashboardProvider(
    context.extensionUri, 
    analyzer, 
    constantsAnalyzer, 
    refactoringProvider
);

context.subscriptions.push(
    vscode.window.registerTreeDataProvider('dependencyTree', treeProvider),
    vscode.window.registerWebviewViewProvider(DashboardProvider.viewType, dashboardProvider),
);

    // Activate library highlighter
    libraryHighlighter.activate(context);

    // Register the constants tree view in the custom container
    const constantsTreeView = vscode.window.createTreeView('constantsList', {
        treeDataProvider: constantsTreeProvider,
        showCollapseAll: true
    });

    // Constants related commands
    const showConstantsAnalysisCommand = vscode.commands.registerCommand(
        'dependencyVisualizer.showConstantsAnalysis',
        async () => {
            await constantsWebviewProvider.showConstantsAnalysis();
        }
    );

    const showConstantsStatsCommand = vscode.commands.registerCommand(
        'dependencyVisualizer.showConstantsStats',
        async () => {
            const stats = constantsTreeProvider.getStats();
            const message = `📊 Constants Statistics:\n` +
                           `Total Constants: ${stats.total}\n` +
                           `With Suggestions: ${stats.withSuggestions}\n` +
                           `High Confidence: ${stats.highConfidence}\n` +
                           `Files: ${stats.files}`;
            vscode.window.showInformationMessage(message);
        }
    );

    const searchConstantsCommand = vscode.commands.registerCommand(
        'dependencyVisualizer.searchConstants',
        async () => {
            const searchTerm = await vscode.window.showInputBox({
                prompt: 'Search constants',
                placeHolder: 'Enter constant name, value, or file name...'
            });
            
            if (searchTerm !== undefined) {
                constantsTreeProvider.setSearchFilter(searchTerm);
            }
        }
    );

    const groupConstantsCommand = vscode.commands.registerCommand(
        'dependencyVisualizer.groupConstants',
        async () => {
            const options = [
                { label: '📄 Group by File', value: 'file' as const },
                { label: '🔧 Group by Type', value: 'type' as const },
                { label: '🔹 Group by Category', value: 'category' as const },
                { label: '💡 Group by Suggestions', value: 'suggestions' as const }
            ];
            
            const selected = await vscode.window.showQuickPick(options, {
                placeHolder: 'Choose grouping method'
            });
            
            if (selected) {
                constantsTreeProvider.setGroupBy(selected.value);
            }
        }
    );

    const toggleSuggestionsOnlyCommand = vscode.commands.registerCommand(
        'dependencyVisualizer.toggleSuggestionsOnly',
        async () => {
            const currentSetting = constantsTreeProvider['showOnlyWithSuggestions']; // Access private field
            constantsTreeProvider.setShowOnlyWithSuggestions(!currentSetting);
            vscode.window.showInformationMessage(
                !currentSetting ? 'Showing only constants with suggestions' : 'Showing all constants'
            );
        }
    );

    const goToConstantCommand = vscode.commands.registerCommand(
        'dependencyVisualizer.goToConstant',
        async (constant: any) => {
            const uri = vscode.Uri.file(constant.file);
            const document = await vscode.workspace.openTextDocument(uri);
            const editor = await vscode.window.showTextDocument(document);
            
            const position = new vscode.Position(constant.line, constant.column);
            editor.selection = new vscode.Selection(position, position);
            editor.revealRange(new vscode.Range(position, position));
        }
    );

    const applySuggestionCommand = vscode.commands.registerCommand(
        'dependencyVisualizer.applySuggestion',
        async (constant: any, suggestion: string) => {
            const uri = vscode.Uri.file(constant.file);
            const document = await vscode.workspace.openTextDocument(uri);
            
            try {
                const workspaceEdit = new vscode.WorkspaceEdit();
                const line = document.lineAt(constant.line);
                const lineText = line.text;
                
                // Handle different constant declaration patterns
                let newLineText = lineText;
                
                if (constant.language === 'java') {
                    // Java: static final TYPE NAME = value;
                    const javaRegex = /(static\s+final\s+\w+\s+)([A-Z_][A-Z0-9_]*)(\s*=\s*[^;]+;)/;
                    const match = lineText.match(javaRegex);
                    if (match) {
                        newLineText = lineText.replace(javaRegex, `$1${suggestion}$3`);
                    }
                } else if (constant.language === 'cpp') {
                    if (constant.type === 'macro') {
                        // C++: #define NAME value
                        const defineRegex = /(#define\s+)([A-Z_][A-Z0-9_]*)(\s+.+)/;
                        const match = lineText.match(defineRegex);
                        if (match) {
                            newLineText = lineText.replace(defineRegex, `$1${suggestion}$3`);
                        }
                    } else {
                        // C++: const TYPE NAME = value;
                        const constRegex = /(const\s+\w+\s+)([A-Z_][A-Z0-9_]*)(\s*=\s*[^;]+;)/;
                        const match = lineText.match(constRegex);
                        if (match) {
                            newLineText = lineText.replace(constRegex, `$1${suggestion}$3`);
                        }
                    }
                }
                
                // Apply the edit
                const range = new vscode.Range(constant.line, 0, constant.line, lineText.length);
                workspaceEdit.replace(uri, range, newLineText);
                
                const success = await vscode.workspace.applyEdit(workspaceEdit);
                
                if (success) {
                    // Show success message with confidence
                    const confidenceIcon = constant.confidence >= 80 ? '🔥' : 
                                         constant.confidence >= 60 ? '💡' : '💭';
                    vscode.window.showInformationMessage(
                        `${confidenceIcon} Successfully renamed "${constant.name}" to "${suggestion}" (${constant.confidence}% confidence)`
                    );
                    
                    // Refresh the constants view
                    await constantsTreeProvider.updateConstants();
                    
                    // Show the change in the editor
                    const editor = await vscode.window.showTextDocument(document);
                    const position = new vscode.Position(constant.line, 0);
                    editor.revealRange(new vscode.Range(position, position), vscode.TextEditorRevealType.InCenter);
                } else {
                    vscode.window.showErrorMessage('❌ Failed to apply suggestion');
                }
            } catch (error) {
                console.error('Error applying suggestion:', error);
                vscode.window.showErrorMessage(`❌ Error applying suggestion: ${error}`);
            }
        }
    );

    const applyBestSuggestionCommand = vscode.commands.registerCommand(
        'dependencyVisualizer.applyBestSuggestion',
        async (constant: any) => {
            if (constant.suggestedNames && constant.suggestedNames.length > 0) {
                const bestSuggestion = constant.suggestedNames[0]; // First suggestion is the best
                await vscode.commands.executeCommand('dependencyVisualizer.applySuggestion', constant, bestSuggestion);
            } else {
                vscode.window.showInformationMessage('No suggestions available for this constant');
            }
        }
    );

    const refreshConstantsCommand = vscode.commands.registerCommand(
        'dependencyVisualizer.refreshConstants',
        async () => {
            await constantsTreeProvider.updateConstants();
            vscode.window.showInformationMessage('Constants refreshed');
        }
    );
    
    // Auto-refresh constants when files change
    const constantsFileWatcher = vscode.workspace.createFileSystemWatcher('**/*.{java,cpp,cc,cxx,c,h,hpp}');
    constantsFileWatcher.onDidChange(() => constantsTreeProvider.updateConstants());
    constantsFileWatcher.onDidCreate(() => constantsTreeProvider.updateConstants());
    constantsFileWatcher.onDidDelete(() => constantsTreeProvider.updateConstants());

    // Initial load
    constantsTreeProvider.updateConstants();



    // Initialize enhanced file connection list provider for the dedicated panel
    const enhancedFileConnectionListProvider = new EnhancedFileConnectionListProvider(analyzer);
    
    // Register the enhanced file connections tree view in the custom container
    const enhancedFileConnectionsTreeView = vscode.window.createTreeView('enhancedFileConnectionsList', {
        treeDataProvider: enhancedFileConnectionListProvider,
        showCollapseAll: true
    });

    // Register the statistics webview provider
    const statisticsProvider = new StatisticsViewProvider(context.extensionUri, analyzer);
    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider(StatisticsViewProvider.viewType, statisticsProvider)
    );

    // Command to open files (for clickable items)
    const openFileCommand = vscode.commands.registerCommand(
        'dependencyVisualizer.openFile',
        async (filePath: string) => {
            try {
                const uri = vscode.Uri.file(filePath);
                await vscode.window.showTextDocument(uri);
            } catch (error) {
                vscode.window.showErrorMessage(`Failed to open file: ${filePath}`);
            }
        }
    );

    // Enhanced commands for the dedicated panel
    const showStatsCommand = vscode.commands.registerCommand(
        'dependencyVisualizer.showConnectionStats',
        async () => {
            const stats = enhancedFileConnectionListProvider.getStats();
            const message = `📊 Connection Statistics:\n` +
                           `Total Methods: ${stats.total}\n` +
                           `Connected: ${stats.connected}\n` +
                           `Missing: ${stats.missing}\n` +
                           `Packages: ${stats.packages}`;
            vscode.window.showInformationMessage(message);
        }
    );

    const searchCommand = vscode.commands.registerCommand(
        'dependencyVisualizer.searchConnections',
        async () => {
            const searchTerm = await vscode.window.showInputBox({
                prompt: 'Search file connections',
                placeHolder: 'Enter file name, method name, or package...'
            });
            
            if (searchTerm !== undefined) {
                enhancedFileConnectionListProvider.setSearchFilter(searchTerm);
            }
        }
    );

    const filterCommand = vscode.commands.registerCommand(
        'dependencyVisualizer.filterConnections',
        async () => {
            const options = [
                { label: '📋 All Connections', value: 'all' as const },
                { label: '✅ Connected Only', value: 'connected' as const },
                { label: '❌ Missing Only', value: 'missing' as const }
            ];
            
            const selected = await vscode.window.showQuickPick(options, {
                placeHolder: 'Filter connections by status'
            });
            
            if (selected) {
                enhancedFileConnectionListProvider.setStatusFilter(selected.value);
            }
        }
    );

    const groupByCommand = vscode.commands.registerCommand(
        'dependencyVisualizer.groupConnectionsBy',
        async () => {
            const options = [
                { label: '📄 Group by File', value: 'file' as const },
                { label: '📦 Group by Package', value: 'package' as const },
                { label: '🎯 Group by Status', value: 'status' as const }
            ];
            
            const selected = await vscode.window.showQuickPick(options, {
                placeHolder: 'Choose grouping method'
            });
            
            if (selected) {
                enhancedFileConnectionListProvider.setGroupBy(selected.value);
            }
        }
    );

    // Generate C++ stub command
    const generateStubCommand = vscode.commands.registerCommand(
        'dependencyVisualizer.generateCppStub',
        async (item: any) => {
            if (item && item.connection && !item.connection.isMatched) {
                const jniSignature = generateJniSignature(item.connection);
                const stubCode = `JNIEXPORT void JNICALL ${jniSignature}(JNIEnv* env, jobject obj) {\n    // TODO: Implement ${item.connection.methodName}\n}\n`;
                
                const document = await vscode.workspace.openTextDocument({
                    content: stubCode,
                    language: 'cpp'
                });
                
                await vscode.window.showTextDocument(document);
                vscode.window.showInformationMessage('C++ stub generated! Save to your C++ file.');
            }
        }
    );

    // Refresh all views command
    const refreshAllCommand = vscode.commands.registerCommand(
        'dependencyVisualizer.refreshAll',
        async () => {
        // Refresh all data sources
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (workspaceFolder) {
            await analyzer.analyzeDependencies(workspaceFolder.uri.fsPath);
            await constantsAnalyzer.analyzeWorkspace(workspaceFolder);
        }
        
        // Refresh tree providers
        if (enhancedFileConnectionListProvider) {
            await enhancedFileConnectionListProvider.updateConnections();
        }
        if (constantsTreeProvider) {
            await constantsTreeProvider.updateConstants();
        }
        
        vscode.window.showInformationMessage('✅ All data refreshed');
    }
    );

    context.subscriptions.push(refreshAllCommand);

    // File watcher for auto-refresh
    const connectionFileWatcher = vscode.workspace.createFileSystemWatcher('**/*.{java,cpp,cc,cxx,c,h,hpp}');
    connectionFileWatcher.onDidChange(() => {
        enhancedFileConnectionListProvider.updateConnections();
        statisticsProvider.updateStatistics();
    });
    connectionFileWatcher.onDidCreate(() => {
        enhancedFileConnectionListProvider.updateConnections();
        statisticsProvider.updateStatistics();
    });
    connectionFileWatcher.onDidDelete(() => {
        enhancedFileConnectionListProvider.updateConnections();
        statisticsProvider.updateStatistics();
    });

    // Initial load of connection data
    enhancedFileConnectionListProvider.updateConnections();

    // Register tree view
    vscode.window.createTreeView('dependencyTree', {
        treeDataProvider: treeProvider
    });

    registerMagicNumberFeatures(context);

    // Register commands
    const analyzeCommand = vscode.commands.registerCommand(
        'dependencyVisualizer.analyzeDependencies',
        async () => {
            const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
            if (!workspaceFolder) {
                vscode.window.showErrorMessage('No workspace folder found');
                return;
            }

            await vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: "Analyzing dependencies...",
                cancellable: false
            }, async (progress) => {
                const result = await analyzer.analyzeDependencies(workspaceFolder.uri.fsPath);
                treeProvider.refresh();
                
                // Show diagnostics
                const diagnostics = analyzer.getDiagnostics();
                if (diagnostics.length > 0) {
                    vscode.window.showWarningMessage(
                        `Found ${diagnostics.length} dependency issues`
                    );
                }
            });
        }
    );

    const showGraphCommand = vscode.commands.registerCommand(
        'dependencyVisualizer.showDependencyGraph',
        () => {
            webviewProvider.showDependencyGraph();
            
            // Track usage
            vscode.window.showInformationMessage(
                'Dependency Graph opened! 🎨 Use the controls to navigate and explore your dependencies.',
                { modal: false }
            );
        }
    );

    const refreshCommand = vscode.commands.registerCommand(
        'dependencyVisualizer.refreshDependencies',
        () => {
            treeProvider.refresh();
        }
    );

    // FIX: Corrected refactoring command implementation
    const refactorCommand = vscode.commands.registerCommand(
        'dependencyVisualizer.refactor',
        async () => {
            const editor = vscode.window.activeTextEditor;
            if (!editor) {
                vscode.window.showErrorMessage('No active editor found');
                return;
            }
            
            const workspaceFolder = vscode.workspace.getWorkspaceFolder(editor.document.uri);
            if (!workspaceFolder) {
                vscode.window.showErrorMessage('No workspace folder found');
                return;
            }

            const context = {
                workspaceFolder,
                document: editor.document,
                selection: editor.selection,
                language: editor.document.languageId === 'java' ? 'java' as const : 'cpp' as const
            };
            
            // FIX: Use instance method instead of static method
            const availableRefactorings = await refactoringProvider.getAvailableRefactorings(context);
            
            if (availableRefactorings.length === 0) {
                vscode.window.showInformationMessage('No refactoring options available at current position');
                return;
            }
            
            // FIX: Add explicit type annotation to resolve implicit any error
            interface RefactoringQuickPickItem extends vscode.QuickPickItem {
                refactoring: any; // You can create a more specific type if needed
            }
            
            const quickPickItems: RefactoringQuickPickItem[] = availableRefactorings.map((r: any) => ({
                label: r.title,
                description: r.description,
                refactoring: r
            }));
            
            const selectedRefactoring = await vscode.window.showQuickPick(
                quickPickItems,
                { placeHolder: 'Select refactoring operation' }
            );
            
            // FIX: Correct property access
            if (selectedRefactoring) {
                await refactoringProvider.executeRefactoring(selectedRefactoring.refactoring.id, context);
            }
        }
    );

    // Register code action provider
    const codeActionProvider = new RefactoringCodeActionProvider(refactoringProvider);
    context.subscriptions.push(
        vscode.languages.registerCodeActionsProvider(
            ['java', 'cpp'],
            codeActionProvider
        )
    );

    // Register execute refactoring command
    const executeRefactoringCommand = vscode.commands.registerCommand(
        'dependencyVisualizer.executeRefactoring',
        async (operationId: string, refactoringContext: any) => {
            await refactoringProvider.executeRefactoring(operationId, refactoringContext);
        }
    );

    // Add these individual command registrations to extension.ts
    const renameCommand = vscode.commands.registerCommand(
        'dependencyVisualizer.rename',
        async () => {
            const editor = vscode.window.activeTextEditor;
            if (!editor) return;
            
            const workspaceFolder = vscode.workspace.getWorkspaceFolder(editor.document.uri);
            if (!workspaceFolder) return;

            const context = {
                workspaceFolder,
                document: editor.document,
                selection: editor.selection,
                language: editor.document.languageId === 'java' ? 'java' as const : 'cpp' as const
            };
            
            const renamingProvider = new RenamingProvider();
            if (await renamingProvider.canApply(context)) {
                const workspaceEdit = await renamingProvider.apply(context);
                await vscode.workspace.applyEdit(workspaceEdit);
            }
        }
    );

    const extractConstantCommand = vscode.commands.registerCommand(
        'dependencyVisualizer.extractConstant',
        async () => {
            const editor = vscode.window.activeTextEditor;
            if (!editor) return;
            
            const workspaceFolder = vscode.workspace.getWorkspaceFolder(editor.document.uri);
            if (!workspaceFolder) return;

            const context = {
                workspaceFolder,
                document: editor.document,
                selection: editor.selection,
                language: editor.document.languageId === 'java' ? 'java' as const : 'cpp' as const
            };
            
            const constantExtractor = new ConstantExtractor();
            if (await constantExtractor.canApply(context)) {
                const workspaceEdit = await constantExtractor.apply(context);
                await vscode.workspace.applyEdit(workspaceEdit);
            }
        }
    );

    // ADD THIS DEBUG CODE
    console.log('Refactoring commands registered:', [
        'dependencyVisualizer.refactor',
        'dependencyVisualizer.rename',
        'dependencyVisualizer.executeRefactoring'
    ]);

    // Test if commands are available
    vscode.commands.getCommands().then(commands => {
        const refactorCommands = commands.filter(cmd => cmd.startsWith('dependencyVisualizer'));
        console.log('Available refactor commands:', refactorCommands);
    });

    // Add debug command for testing
    const debugCommand = vscode.commands.registerCommand(
        'dependencyVisualizer.debug',
        async () => {
            const editor = vscode.window.activeTextEditor;
            if (!editor) return;
            
            console.log('Document language:', editor.document.languageId);
            console.log('Selection:', editor.selection);
            console.log('Selected text:', editor.document.getText(editor.selection));
            
            const workspaceFolder = vscode.workspace.getWorkspaceFolder(editor.document.uri);
            console.log('Workspace folder:', workspaceFolder?.uri.fsPath);
            
            // Test file finding
            const cppFiles = await vscode.workspace.findFiles('**/*.{cpp,cc,cxx,c,h,hpp}');
            console.log('Found C++ files:', cppFiles.map(f => f.fsPath));
            
            vscode.window.showInformationMessage('Debug info logged to console');
        }
    );

    // Start file watching
    fileWatcher.startWatching();

    // Add all commands to subscriptions
    context.subscriptions.push(
        constantsTreeView,
        showConstantsAnalysisCommand,
        showConstantsStatsCommand,
        searchConstantsCommand,
        groupConstantsCommand,
        toggleSuggestionsOnlyCommand,
        goToConstantCommand,
        applySuggestionCommand,
        applyBestSuggestionCommand,
        refreshConstantsCommand,
        constantsFileWatcher,
        // Tree views
        enhancedFileConnectionsTreeView,
        
        // File connection related commands
        openFileCommand,
        showStatsCommand,
        searchCommand,
        filterCommand,
        groupByCommand,
        generateStubCommand,
        refreshAllCommand,
        
        // Main dependency commands
        analyzeCommand,
        showGraphCommand,
        refreshCommand,
        refactorCommand,
        executeRefactoringCommand,
        
        // Individual refactoring commands
        renameCommand,
        extractConstantCommand,
        
        // Debug command
        debugCommand,
        
        // Watchers
        fileWatcher,
        connectionFileWatcher
    );
}

function generateJniSignature(connection: any): string {
    // Helper function to generate JNI signature
    return `Java_com_example_Class_${connection.methodName}`;
}

export function deactivate() {}
