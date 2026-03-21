import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { getAnalyzer } from '../core/serviceRegistry';

export interface LibraryInfo {
    name: string;
    expectedExtension: string;
    currentPlatform: string;
    fileExists: boolean;
    extensionMatches: boolean;
    status: 'missing' | 'wrong_extension' | 'correct';
}

export interface NativeMethodInfo {
    methodName: string;
    className: string;
    packageName: string;
    libraryName: string;
    jniSignature: string;
    cppImplementationExists: boolean;
    status: 'implemented' | 'missing_implementation';
    implementationFile?: string;
    implementationLine?: number;
    isHeaderFile?: boolean;
}

export class LibraryHighlighter {
    private decorationTypes: Map<string, vscode.TextEditorDecorationType> = new Map();
    private currentPlatform: string;
    private refreshTimers: Map<string, NodeJS.Timeout> = new Map();

    constructor() {
        this.currentPlatform = os.platform();
        this.initializeDecorationTypes();
    }

    private scheduleHighlight(document: vscode.TextDocument, delayMs: number = 250): void {
        const key = document.uri.toString();
        const existing = this.refreshTimers.get(key);
        if (existing) {
            clearTimeout(existing);
        }
        const timer = setTimeout(async () => {
            try {
                const editor = vscode.window.visibleTextEditors.find(e => e.document === document);
                if (editor) {
                    await this.highlightLibrariesInEditor(editor);
                }
            } finally {
                this.refreshTimers.delete(key);
            }
        }, delayMs);
        this.refreshTimers.set(key, timer);
    }

    private initializeDecorationTypes(): void {
        // Red for missing files - Beautiful error styling
        this.decorationTypes.set('missing', vscode.window.createTextEditorDecorationType({
            backgroundColor: 'rgba(236, 23, 8, 0.15)',
            overviewRulerColor: '#f44336',
            overviewRulerLane: vscode.OverviewRulerLane.Right,
            after: {
                contentText: ' ❌',
                color: '#f44336',
                fontWeight: 'bold',
                margin: '0 0 0 8px'
            }
        }));

        // Blue for wrong extension - Beautiful warning styling
        this.decorationTypes.set('wrong_extension', vscode.window.createTextEditorDecorationType({
            backgroundColor: 'rgba(35, 156, 255, 0.15)',
            overviewRulerColor: '#2196f3',
            overviewRulerLane: vscode.OverviewRulerLane.Right,
            after: {
                contentText: ' ⚠️',
                color: '#2196f3',
                fontWeight: 'bold',
                margin: '0 0 0 8px'
            }
        }));

        // Green for correct files - Beautiful success styling
        this.decorationTypes.set('correct', vscode.window.createTextEditorDecorationType({
            backgroundColor: 'rgba(45, 238, 51, 0.15)',
            overviewRulerColor: '#4caf50',
            overviewRulerLane: vscode.OverviewRulerLane.Right,
            after: {
                contentText: ' ✅',
                color: '#4caf50',
                fontWeight: 'bold',
                margin: '0 0 0 8px'
            }
        }));

        // Green for implemented native methods - Beautiful success styling
        this.decorationTypes.set('implemented', vscode.window.createTextEditorDecorationType({
            backgroundColor: 'rgba(45, 238, 51, 0.15)',
            overviewRulerColor: '#4caf50',
            overviewRulerLane: vscode.OverviewRulerLane.Right,
            after: {
                contentText: ' 🔗',
                color: '#4caf50',
                fontWeight: 'bold',
                margin: '0 0 0 8px'
            }
        }));

        // Red for missing native method implementations - Beautiful error styling
        this.decorationTypes.set('missing_implementation', vscode.window.createTextEditorDecorationType({
            backgroundColor: 'rgba(219, 35, 21, 0.15)',
            overviewRulerColor: '#f44336',
            overviewRulerLane: vscode.OverviewRulerLane.Right,
            after: {
                contentText: ' 🔗❌',
                color: '#f44336',
                fontWeight: 'bold',
                margin: '0 0 0 8px'
            }
        }));
    }

    public activate(context: vscode.ExtensionContext): void {
        // Register the hover provider
        const hoverProvider = vscode.languages.registerHoverProvider(
            { language: 'java' },
            {
                provideHover: (document, position) => {
                    return this.provideHover(document, position);
                }
            }
        );

        // Register the code lens provider
        const codeLensProvider = vscode.languages.registerCodeLensProvider(
            { language: 'java' },
            {
                provideCodeLenses: async (document) => {
                    return await this.provideCodeLenses(document);
                }
            }
        );

        // Register the diagnostic collection
        const diagnosticCollection = vscode.languages.createDiagnosticCollection('libraryHighlighter');

        // Register commands
        const refreshCommand = vscode.commands.registerCommand(
            'dependencyVisualizer.refreshLibraryHighlights',
            () => this.refreshHighlights()
        );

        const showLibraryInfoCommand = vscode.commands.registerCommand(
            'dependencyVisualizer.showLibraryInfo',
            (libraryName: string) => this.showLibraryInfo(libraryName)
        );

        const goToImplementationCommand = vscode.commands.registerCommand(
            'dependencyVisualizer.goToImplementation',
            (methodInfo: NativeMethodInfo) => this.goToImplementation(methodInfo)
        );

        // Register event listeners for persistent highlighting
        const onDidChangeActiveTextEditor = vscode.window.onDidChangeActiveTextEditor((editor) => {
            if (editor && editor.document.languageId === 'java') {
                this.scheduleHighlight(editor.document);
            }
        });

        const onDidChangeTextDocument = vscode.workspace.onDidChangeTextDocument((event) => {
            if (event.document.languageId === 'java') {
                this.scheduleHighlight(event.document);
            }
        });

        const onDidOpenTextDocument = vscode.workspace.onDidOpenTextDocument((document) => {
            if (document.languageId === 'java') {
                this.scheduleHighlight(document);
            }
        });

                // ── NEW: Watch C++ file saves → incremental index update + re-highlight Java ──
        const cppExtensions = new Set(['.cpp', '.cc', '.cxx', '.c', '.h', '.hpp']);
        const isCppFile = (doc: vscode.TextDocument) => {
            const ext = doc.uri.fsPath.substring(doc.uri.fsPath.lastIndexOf('.'));
            return cppExtensions.has(ext);
        };
        const onDidSaveCpp = vscode.workspace.onDidSaveTextDocument(async (document) => {
            if (isCppFile(document)) {
                // Incrementally update JNI index for just this file
                const analyzer = getAnalyzer();
                if (analyzer) {
                    await analyzer.updateJniIndexForFile(document.uri.fsPath);
                }
                // Re-highlight all visible Java editors immediately
                await this.refreshHighlights();
            }
        });
        // ── NEW: Watch Java file saves → immediate re-highlight ──
        const onDidSaveJava = vscode.workspace.onDidSaveTextDocument(async (document) => {
            if (document.languageId === 'java') {
                this.scheduleHighlight(document, 100); // faster refresh on save
            }
        });
        // ── NEW: Watch C++ file creation/deletion via FileSystemWatcher ──
        const cppWatcher = vscode.workspace.createFileSystemWatcher('**/*.{cpp,cc,cxx,c,h,hpp}');
        cppWatcher.onDidCreate(async (uri) => {
            const analyzer = getAnalyzer();
            if (analyzer) {
                await analyzer.updateJniIndexForFile(uri.fsPath);
            }
            await this.refreshHighlights();
        });
        cppWatcher.onDidDelete(async (uri) => {
            const analyzer = getAnalyzer();
            if (analyzer) {
                analyzer.invalidateJniIndexForFile(uri.fsPath);
            }
            await this.refreshHighlights();
        });
        cppWatcher.onDidChange(async (uri) => {
            // File changed on disk (e.g. external edit, git checkout)
            const analyzer = getAnalyzer();
            if (analyzer) {
                await analyzer.updateJniIndexForFile(uri.fsPath);
            }
            await this.refreshHighlights();
        });


        context.subscriptions.push(
            hoverProvider,
            codeLensProvider,
            diagnosticCollection,
            refreshCommand,
            showLibraryInfoCommand,
            goToImplementationCommand,
            onDidChangeActiveTextEditor,
            onDidChangeTextDocument,
            onDidOpenTextDocument,
            onDidSaveCpp,
            onDidSaveJava,
            cppWatcher
        );

        // Initial highlight
        this.refreshHighlights();

        // Warm JNI index in background for fast lookups
        const analyzer = getAnalyzer();
        if (analyzer) {
            analyzer.rebuildJniIndex?.().catch(() => { });
        }
    }

    private async provideHover(document: vscode.TextDocument, position: vscode.Position): Promise<vscode.Hover | undefined> {
        // Check for library calls first
        const libraryInfo = this.getLibraryAtPosition(document, position);
        if (libraryInfo) {
            const status = this.checkLibraryStatus(libraryInfo.libraryName);
            const message = this.createHoverMessage(libraryInfo.libraryName, status);
            return new vscode.Hover(message);
        }

        // Check for native methods
        const nativeMethodInfo = this.getNativeMethodAtPosition(document, position);
        if (nativeMethodInfo) {
            const updatedMethodInfo = await this.checkNativeMethodImplementation(nativeMethodInfo.methodInfo);
            const message = this.createNativeMethodHoverMessage(updatedMethodInfo);
            return new vscode.Hover(message);
        }

        return undefined;
    }

    private async provideCodeLenses(document: vscode.TextDocument): Promise<vscode.CodeLens[]> {
        const codeLenses: vscode.CodeLens[] = [];
        const libraryCalls = this.findLibraryCalls(document);
        const nativeMethods = this.findNativeMethods(document);

        // Add library call code lenses
        for (const call of libraryCalls) {
            const status = this.checkLibraryStatus(call.libraryName);
            const statusText = status.status === 'missing' ? 'Missing' :
                status.status === 'wrong_extension' ? 'Wrong Extension' : 'Ready';
            const command: vscode.Command = {
                title: `${this.getStatusIcon(status.status)} ${call.libraryName} • ${statusText}`,
                command: 'dependencyVisualizer.showLibraryInfo',
                arguments: [call.libraryName]
            };

            codeLenses.push(new vscode.CodeLens(call.range, command));
        }

        // Add native method code lenses - we need to check implementation status first
        for (const method of nativeMethods) {
            // Check implementation status for this method
            const updatedMethodInfo = await this.checkNativeMethodImplementation(method.methodInfo);

            const statusText = updatedMethodInfo.status === 'implemented' ? 'Implemented' : 'Missing Implementation';
            const icon = updatedMethodInfo.status === 'implemented' ? '🔗' : '🔗❌';

            // For implemented methods, add a "Go to Implementation" command
            if (updatedMethodInfo.status === 'implemented') {
                const goToCommand: vscode.Command = {
                    title: `${icon} ${updatedMethodInfo.methodName} • Go to Implementation`,
                    command: 'dependencyVisualizer.goToImplementation',
                    arguments: [updatedMethodInfo]
                };
                codeLenses.push(new vscode.CodeLens(method.range, goToCommand));
            } else {
                const command: vscode.Command = {
                    title: `${icon} ${updatedMethodInfo.methodName} • ${statusText}`,
                    command: 'dependencyVisualizer.showLibraryInfo',
                    arguments: [updatedMethodInfo.libraryName]
                };
                codeLenses.push(new vscode.CodeLens(method.range, command));
            }
        }

        return codeLenses;
    }

    private async refreshHighlights(): Promise<void> {
        const editors = vscode.window.visibleTextEditors.filter(editor =>
            editor.document.languageId === 'java'
        );

        for (const editor of editors) {
            await this.highlightLibrariesInEditor(editor);
        }
    }

    private async highlightLibrariesInEditor(editor: vscode.TextEditor): Promise<void> {
        const libraryCalls = this.findLibraryCalls(editor.document);
        const nativeMethods = this.findNativeMethods(editor.document);
        const decorations: Map<string, vscode.Range[]> = new Map();

        // Initialize decoration arrays
        decorations.set('missing', []);
        decorations.set('wrong_extension', []);
        decorations.set('correct', []);
        decorations.set('implemented', []);
        decorations.set('missing_implementation', []);

        // Process library calls
        for (const call of libraryCalls) {
            const status = this.checkLibraryStatus(call.libraryName);
            decorations.get(status.status)?.push(call.range);
        }

        // Process native methods
        for (const method of nativeMethods) {
            const updatedMethodInfo = await this.checkNativeMethodImplementation(method.methodInfo);
            decorations.get(updatedMethodInfo.status)?.push(method.range);
        }

        // Apply decorations
        for (const [status, ranges] of decorations) {
            const decorationType = this.decorationTypes.get(status);
            if (decorationType && ranges.length > 0) {
                editor.setDecorations(decorationType, ranges);
            }
        }
    }

    private findLibraryCalls(document: vscode.TextDocument): Array<{ libraryName: string; range: vscode.Range }> {
        const calls: Array<{ libraryName: string; range: vscode.Range }> = [];
        const content = document.getText();

        // Regex to match System.loadLibrary calls
        const loadLibraryRegex = /System\.loadLibrary\s*\(\s*["']([^"']+)["']\s*\)/g;
        let match;

        while ((match = loadLibraryRegex.exec(content)) !== null) {
            const libraryName = match[1];
            const startPos = document.positionAt(match.index);
            const endPos = document.positionAt(match.index + match[0].length);
            const range = new vscode.Range(startPos, endPos);

            calls.push({ libraryName, range });
        }

        return calls;
    }

    private findNativeMethods(document: vscode.TextDocument): Array<{ methodInfo: NativeMethodInfo; range: vscode.Range }> {
        const methods: Array<{ methodInfo: NativeMethodInfo; range: vscode.Range }> = [];
        const content = document.getText();

        // Extract class name and package
        const className = this.extractClassName(document);
        const packageName = this.extractPackageName(document);

        // Robust line-based scanner to capture multi-line native method declarations
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
            // Trigger only on the 'native' keyword as a standalone word to avoid matching parameter names like 'native_object'
            if (!/\bnative\b/.test(lines[i])) continue;

            // Accumulate declaration until semicolon or opening brace (be tolerant even if '{' appears)
            const startLine = i;
            let decl = lines[i];
            let endLine = i;
            const isTerminator = (s: string) => s.includes(';') || s.includes('{');
            while (endLine < lines.length && !isTerminator(lines[endLine])) {
                endLine++;
                if (endLine < lines.length) {
                    decl += '\n' + lines[endLine];
                }
            }

            if (endLine >= lines.length) {
                break; // Malformed/no semicolon
            }

            // Heuristic: ensure it looks like a method (has '(' before ';')
            if (!decl.includes('(')) continue;

            // Extract method name using a flexible signature pattern where 'native' can appear among modifiers
            // Group 1 ~ return type, Group 2 ~ method name
            const sigMatch = decl.match(/\bnative\b[\s\w@<>,\[\].()?]*?([A-Za-z_][\w\[\]<>.?]*)\s+([A-Za-z_]\w*)\s*\(/);
            if (!sigMatch) continue;
            const methodName = sigMatch[2];

            // Compute range positions - start from first non-whitespace to respect indentation
            const startLineText = lines[startLine] ?? '';
            const startCol = startLineText.search(/\S|$/); // index of first non-space, or end if blank
            const startPos = new vscode.Position(startLine, Math.max(0, startCol));
            const termIdx = lines[endLine].includes(';') ? lines[endLine].indexOf(';') + 1 : lines[endLine].indexOf('{');
            const endChar = termIdx >= 0 ? termIdx : lines[endLine].length;
            const endPos = new vscode.Position(endLine, endChar);
            const range = new vscode.Range(startPos, endPos);

            // Associated library and JNI signature
            const libraryName = this.findAssociatedLibrary(document);
            const jniSignature = this.generateJNISignature(decl, className, methodName);

            const methodInfo: NativeMethodInfo = {
                methodName,
                className,
                packageName,
                libraryName,
                jniSignature,
                cppImplementationExists: false,
                status: 'missing_implementation'
            };

            methods.push({ methodInfo, range });
        }

        // If no methods were found via the line-based scanner, try a robust global regex as fallback
        if (methods.length === 0) {
            const regex = /^(?:\s*@[\w.]+(?:\([^)]*\))?\s*)*(?:\s*(?:public|private|protected|static|final|abstract|strictfp|synchronized|native)\s+)+\s*(?:<[^>]+>\s*)?([A-Za-z_$][\w\[\]<>.?$]*)\s+([A-Za-z_$]\w*)\s*\([^;{)]*\)\s*;/gm;
            let m: RegExpExecArray | null;
            while ((m = regex.exec(content)) !== null) {
                const returnType = m[1];
                const methodName = m[2];
                const startPos = document.positionAt(m.index);
                const endPos = document.positionAt(m.index + m[0].length);
                const range = new vscode.Range(startPos, endPos);

                const libraryName = this.findAssociatedLibrary(document);
                const jniSignature = this.generateJNISignature(m[0], className, methodName);

                methods.push({
                    methodInfo: {
                        methodName,
                        className,
                        packageName,
                        libraryName,
                        jniSignature,
                        cppImplementationExists: false,
                        status: 'missing_implementation'
                    },
                    range
                });
            }
        }

        return methods;
    }

    private extractClassName(document: vscode.TextDocument): string {
        const content = document.getText();
        // Match class declaration at start of line (prevents matching within comments)
        const match = content.match(/^\s*(?:(?:public|private|protected|abstract|final|static)\s+)*\bclass\s+(\w+)/m);
        return match ? match[1] : 'UnknownClass';
    }

    private extractPackageName(document: vscode.TextDocument): string {
        const content = document.getText();
        const packageMatch = content.match(/package\s+([\w.]+);/);
        return packageMatch ? packageMatch[1] : '';
    }

    private findAssociatedLibrary(document: vscode.TextDocument): string {
        const content = document.getText();
        const loadLibraryMatch = content.match(/System\.loadLibrary\s*\(\s*["']([^"']+)["']\s*\)/);
        return loadLibraryMatch ? loadLibraryMatch[1] : 'unknown';
    }

    private generateJNISignature(methodDeclaration: string, className: string, methodName: string): string {
        // This is a simplified JNI signature generation
        // In a real implementation, you'd need to parse the method signature more carefully
        return `Java_${className}_${methodName}`;
    }

    private async checkNativeMethodImplementation(methodInfo: NativeMethodInfo): Promise<NativeMethodInfo> {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders) {
            return methodInfo;
        }

        // Generate the expected JNI function name
        let expectedFunctionName = `Java_${methodInfo.className}_${methodInfo.methodName}`;

        // If there's a package, include it in the function name
        if (methodInfo.packageName) {
            const packagePrefix = methodInfo.packageName.replace(/\./g, '_');
            expectedFunctionName = `Java_${packagePrefix}_${methodInfo.className}_${methodInfo.methodName}`;
        }

        // Fast path: consult global JNI index from DependencyAnalyzer (if available)
        try {
            const analyzer = getAnalyzer();
            const found = analyzer?.findJniImplementationByExpected?.(expectedFunctionName) ?? null;
            if (found) {
                methodInfo.cppImplementationExists = true;
                methodInfo.status = 'implemented';
                methodInfo.implementationFile = found;
                try {
                    const doc = await vscode.workspace.openTextDocument(found);
                    const content = doc.getText();
                    methodInfo.implementationLine = this.findImplementationLine(content, expectedFunctionName);
                } catch { }
                return methodInfo;
            }
        } catch { }

        // First, look for implementation files (.cpp, .cc, .cxx, .c) - these contain the actual implementation
        const implementationFiles = await vscode.workspace.findFiles('**/*.{cpp,cc,cxx,c}');

        // Slow path: Search for the JNI function in implementation files
        for (const implFile of implementationFiles) {
            try {
                const implDocument = await vscode.workspace.openTextDocument(implFile);
                const implContent = implDocument.getText();

                // Look for JNI function with the expected name (allow variants without JNIEXPORT/JNICALL and overload suffixes)
                const jniFunctionRegex = new RegExp(`\\b${expectedFunctionName}(?:__[-_A-Za-z0-9$]+)?\\s*\\(`, 'g');

                if (jniFunctionRegex.test(implContent)) {
                    methodInfo.cppImplementationExists = true;
                    methodInfo.status = 'implemented';
                    // Store the implementation file info for navigation
                    methodInfo.implementationFile = implFile.fsPath;
                    methodInfo.implementationLine = this.findImplementationLine(implContent, expectedFunctionName);
                    return methodInfo; // Found in implementation file, return immediately
                }
            } catch (error) {
                console.error(`Error reading implementation file ${implFile.fsPath}:`, error);
            }
        }

        // If not found in implementation files, check header files (.h, .hpp) for declarations
        const headerFiles = await vscode.workspace.findFiles('**/*.{h,hpp}');

        for (const headerFile of headerFiles) {
            try {
                const headerDocument = await vscode.workspace.openTextDocument(headerFile);
                const headerContent = headerDocument.getText();

                // Look for JNI function declaration with the expected name (allow overload suffixes)
                const jniDeclRegex = new RegExp(`\\b${expectedFunctionName}(?:__[-_A-Za-z0-9$]+)?\\s*\\(`, 'g');

                if (jniDeclRegex.test(headerContent)) {
                    methodInfo.cppImplementationExists = true;
                    methodInfo.status = 'implemented';
                    // Store the header file info for navigation (but mark it as a header)
                    methodInfo.implementationFile = headerFile.fsPath;
                    methodInfo.implementationLine = this.findImplementationLine(headerContent, expectedFunctionName);
                    methodInfo.isHeaderFile = true;
                    break;
                }
            } catch (error) {
                console.error(`Error reading header file ${headerFile.fsPath}:`, error);
            }
        }

        return methodInfo;
    }

    private findImplementationLine(cppContent: string, functionName: string): number {
        const lines = cppContent.split('\n');
        for (let i = 0; i < lines.length; i++) {
            if (lines[i].includes(functionName)) {
                return i + 1; // Convert to 1-based line number
            }
        }
        return 1; // Default to first line if not found
    }

    private async goToImplementation(methodInfo: NativeMethodInfo): Promise<void> {
        if (methodInfo.cppImplementationExists && methodInfo.implementationFile) {
            try {
                const document = await vscode.workspace.openTextDocument(methodInfo.implementationFile);
                const editor = await vscode.window.showTextDocument(document);

                // Go to the specific line where the implementation is
                const line = methodInfo.implementationLine || 1;
                const position = new vscode.Position(line - 1, 0);
                editor.selection = new vscode.Selection(position, position);
                editor.revealRange(new vscode.Range(position, position), vscode.TextEditorRevealType.InCenter);

                // Show a notification if we're in a header file
                if (methodInfo.isHeaderFile) {
                    vscode.window.showInformationMessage(
                        `Showing function declaration in header file. Look for the actual implementation in a .cpp file.`
                    );
                }
            } catch (error) {
                vscode.window.showErrorMessage(`Could not open implementation file: ${error}`);
            }
        } else {
            vscode.window.showInformationMessage('No implementation found for this native method.');
        }
    }

    private getLibraryAtPosition(document: vscode.TextDocument, position: vscode.Position): { libraryName: string; range: vscode.Range } | undefined {
        const libraryCalls = this.findLibraryCalls(document);

        for (const call of libraryCalls) {
            if (call.range.contains(position)) {
                return call;
            }
        }

        return undefined;
    }

    private getNativeMethodAtPosition(document: vscode.TextDocument, position: vscode.Position): { methodInfo: NativeMethodInfo; range: vscode.Range } | undefined {
        const nativeMethods = this.findNativeMethods(document);

        for (const method of nativeMethods) {
            if (method.range.contains(position)) {
                return method;
            }
        }

        return undefined;
    }

    private checkLibraryStatus(libraryName: string): LibraryInfo {
        const expectedExtension = this.getExpectedExtension();
        const validExtensions = this.getValidExtensions();
        const possiblePaths = this.getPossibleLibraryPaths(libraryName, expectedExtension);

        let fileExists = false;
        let extensionMatches = false;

        for (const libPath of possiblePaths) {
            if (fs.existsSync(libPath)) {
                fileExists = true;
                // Check if the file matches any of the valid extensions for this platform
                if (validExtensions.some(ext => libPath.endsWith(`.${ext}`))) {
                    extensionMatches = true;
                    break;
                }
            }
        }

        let status: 'missing' | 'wrong_extension' | 'correct';
        if (!fileExists) {
            status = 'missing';
        } else if (!extensionMatches) {
            status = 'wrong_extension';
        } else {
            status = 'correct';
        }

        return {
            name: libraryName,
            expectedExtension,
            currentPlatform: this.currentPlatform,
            fileExists,
            extensionMatches,
            status
        };
    }

    private getExpectedExtension(): string {
        switch (this.currentPlatform) {
            case 'win32':
                return 'dll';
            case 'linux':
                return 'so';
            case 'darwin':
                return 'jnilib'; // macOS JNI libraries can use .jnilib or .dylib
            default:
                return 'so';
        }
    }

    private getValidExtensions(): string[] {
        switch (this.currentPlatform) {
            case 'win32':
                return ['dll'];
            case 'linux':
                return ['so'];
            case 'darwin':
                return ['jnilib', 'dylib']; // macOS supports both .jnilib and .dylib
            default:
                return ['so'];
        }
    }

    private getPossibleLibraryPaths(libraryName: string, expectedExtension: string): string[] {
        const candidates: string[] = [];
        const workspaceFolders = vscode.workspace.workspaceFolders;

        // Helper: safe fs helpers
        const safeReaddir = (dir: string): string[] => {
            try { return fs.readdirSync(dir); } catch { return []; }
        };
        const safeStat = (p: string): fs.Stats | undefined => {
            try { return fs.statSync(p); } catch { return undefined; }
        };

        // Helper: discover directories with likely names up to limited depth (to avoid blocking)
        const discoverCandidateDirs = (root: string, names: string[], maxDepth: number = 3): string[] => {
            const found: string[] = [];
            const queue: Array<{ dir: string; depth: number }> = [{ dir: root, depth: 0 }];
            while (queue.length) {
                const { dir, depth } = queue.shift()!;
                if (depth > maxDepth) continue;
                const entries = safeReaddir(dir);
                for (const entry of entries) {
                    const full = path.join(dir, entry);
                    const st = safeStat(full);
                    if (!st) continue;
                    if (st.isDirectory()) {
                        if (names.includes(entry)) {
                            found.push(full);
                        }
                        // Only traverse further if directory is not node_modules/.git to limit noise
                        if (entry !== 'node_modules' && entry !== '.git' && entry !== '.gradle' && entry !== 'target' && entry !== 'build') {
                            queue.push({ dir: full, depth: depth + 1 });
                        }
                    }
                }
            }
            return found;
        };

        // Helper: generate file name variants for the library
        const extensions = ['dll', 'so', 'dylib'];
        const names: string[] = [libraryName];
        if (this.currentPlatform === 'linux' || this.currentPlatform === 'darwin') {
            // On Unix-like systems, libraries are commonly prefixed with 'lib'
            names.push(`lib${libraryName}`);
        }

        // Prefer the directory of the active Java file first (common pattern: library placed next to the caller)
        const activeEditor = vscode.window.activeTextEditor;
        const activeJavaDir = (activeEditor && activeEditor.document.languageId === 'java')
            ? path.dirname(activeEditor.document.uri.fsPath)
            : undefined;

        if (workspaceFolders) {
            for (const folder of workspaceFolders) {
                const root = folder.uri.fsPath;
                // Seed directories: known common paths near the root
                const seedDirs = [
                    activeJavaDir, // include the directory of the Java file containing loadLibrary
                    path.join(root, 'lib'),
                    path.join(root, 'libs'),
                    path.join(root, 'native'),
                    path.join(root, 'bin'),
                    path.join(root, 'target'),
                    path.join(root, 'build'),
                    path.join(root, 'demo'), // project-specific folder observed in this repo
                ].filter((p): p is string => typeof p === 'string' && fs.existsSync(p));

                // Add nested likely directories discovered within a bounded depth
                const discovered = new Set<string>();
                for (const seed of seedDirs) {
                    discovered.add(seed);
                    for (const dir of discoverCandidateDirs(seed, ['lib', 'libs', 'native', 'bin'], 2)) {
                        discovered.add(dir);
                    }
                }

                // Generate candidate files
                for (const dir of discovered) {
                    for (const base of names) {
                        for (const ext of extensions) {
                            candidates.push(path.join(dir, `${base}.${ext}`));
                        }
                    }
                }

                // Also check directly under the workspace root (some projects drop binaries here)
                for (const base of names) {
                    for (const ext of extensions) {
                        candidates.push(path.join(root, `${base}.${ext}`));
                    }
                }

                // System library paths
                if (this.currentPlatform === 'win32') {
                    const systemRoot = process.env.SYSTEMROOT || 'C:\\Windows';
                    for (const base of names) {
                        candidates.push(path.join(systemRoot, 'System32', `${base}.dll`));
                    }
                    // Also search PATH directories for dll
                    const pathEnv = process.env.PATH || '';
                    for (const pth of pathEnv.split(path.delimiter)) {
                        if (!pth) continue;
                        for (const base of names) {
                            candidates.push(path.join(pth, `${base}.dll`));
                        }
                    }
                } else if (this.currentPlatform === 'linux' || this.currentPlatform === 'darwin') {
                    const sysDirs = ['/usr/lib', '/usr/local/lib'];
                    for (const sys of sysDirs) {
                        for (const base of names) {
                            candidates.push(path.join(sys, `${base}.${expectedExtension}`));
                        }
                    }
                }
            }
        }

        return Array.from(new Set(candidates));
    }

    private createHoverMessage(libraryName: string, status: LibraryInfo): vscode.MarkdownString {
        const markdown = new vscode.MarkdownString();
        markdown.isTrusted = true;

        // Header with library name and status
        const statusIcon = this.getStatusIcon(status.status);
        const statusText = status.status.toUpperCase().replace('_', ' ');
        markdown.appendMarkdown(`## ${statusIcon} Library: \`${libraryName}\`\n\n`);

        // Status badge
        const statusColor = status.status === 'missing' ? '#f44336' :
            status.status === 'wrong_extension' ? '#2196f3' : '#4caf50';
        markdown.appendMarkdown(`<span style="background-color: ${statusColor}; color: white; padding: 2px 8px; border-radius: 12px; font-size: 0.8em; font-weight: bold;">${statusText}</span>\n\n`);

        // Platform information
        markdown.appendMarkdown(`**🖥️ Platform:** ${this.getPlatformName(status.currentPlatform)}\n`);
        markdown.appendMarkdown(`**📁 Expected Extension:** \`.${status.expectedExtension}\`\n\n`);

        switch (status.status) {
            case 'missing':
                markdown.appendMarkdown(`### ❌ Library Not Found\n\n`);
                markdown.appendMarkdown(`The library file \`${libraryName}.${status.expectedExtension}\` was not found in any of the expected locations.\n\n`);
                markdown.appendMarkdown(`**🔍 Locations checked:**\n`);
                markdown.appendMarkdown(`- 📂 Project lib/ directory\n`);
                markdown.appendMarkdown(`- 📂 Project libs/ directory\n`);
                markdown.appendMarkdown(`- 📂 Project native/ directory\n`);
                markdown.appendMarkdown(`- 📂 System library paths\n\n`);
                markdown.appendMarkdown(`**💡 Recommendation:** Build the native library for ${this.getPlatformName(status.currentPlatform)} and place it in a lib/ directory.\n`);
                break;

            case 'wrong_extension':
                markdown.appendMarkdown(`### ⚠️ Wrong File Extension\n\n`);
                markdown.appendMarkdown(`Library file exists but has the wrong extension for the current platform.\n\n`);
                markdown.appendMarkdown(`**✅ Expected:** \`.${status.expectedExtension}\`\n`);
                markdown.appendMarkdown(`**❌ Found:** Different extension\n\n`);
                markdown.appendMarkdown(`**💡 Recommendation:** Rebuild the library with the correct extension (\`.${status.expectedExtension}\`) for ${this.getPlatformName(status.currentPlatform)}.\n`);
                break;

            case 'correct':
                markdown.appendMarkdown(`### ✅ Library Ready\n\n`);
                markdown.appendMarkdown(`Library file exists with the correct extension for the current platform.\n\n`);
                markdown.appendMarkdown(`**🎉 Status:** Ready to use\n`);
                markdown.appendMarkdown(`**📁 File:** \`${libraryName}.${status.expectedExtension}\`\n\n`);
                markdown.appendMarkdown(`**✨ No action needed** - Your library is properly configured!\n`);
                break;
        }

        return markdown;
    }

    private createNativeMethodHoverMessage(methodInfo: NativeMethodInfo): vscode.MarkdownString {
        const markdown = new vscode.MarkdownString();
        markdown.isTrusted = true;

        // Header with method name and status
        const statusIcon = methodInfo.status === 'implemented' ? '🔗' : '🔗❌';
        const statusText = methodInfo.status === 'implemented' ? 'IMPLEMENTED' : 'MISSING IMPLEMENTATION';
        markdown.appendMarkdown(`## ${statusIcon} Native Method: \`${methodInfo.methodName}\`\n\n`);

        // Status badge
        const statusColor = methodInfo.status === 'implemented' ? '#4caf50' : '#f44336';
        markdown.appendMarkdown(`<span style="background-color: ${statusColor}; color: white; padding: 2px 8px; border-radius: 12px; font-size: 0.8em; font-weight: bold;">${statusText}</span>\n\n`);

        // Method information
        markdown.appendMarkdown(`**🏗️ Class:** \`${methodInfo.className}\`\n`);
        if (methodInfo.packageName) {
            markdown.appendMarkdown(`**📦 Package:** \`${methodInfo.packageName}\`\n`);
        }
        markdown.appendMarkdown(`**📚 Library:** \`${methodInfo.libraryName}\`\n`);
        markdown.appendMarkdown(`**🔗 JNI Signature:** \`${methodInfo.jniSignature}\`\n\n`);

        switch (methodInfo.status) {
            case 'implemented':
                markdown.appendMarkdown(`### ✅ C++ Implementation Found\n\n`);
                if (methodInfo.isHeaderFile) {
                    markdown.appendMarkdown(`The native method has a corresponding C++ **declaration** in a header file.\n\n`);
                    markdown.appendMarkdown(`**📁 Location:** Header file (declaration only)\n`);
                    markdown.appendMarkdown(`**💡 Note:** Look for the actual implementation in a .cpp file\n\n`);
                } else {
                    markdown.appendMarkdown(`The native method has a corresponding C++ **implementation**.\n\n`);
                    markdown.appendMarkdown(`**📁 Location:** Implementation file (.cpp)\n`);
                    markdown.appendMarkdown(`**🎉 Status:** Ready to use\n\n`);
                }
                markdown.appendMarkdown(`**🔍 Expected Function:** \`${methodInfo.jniSignature}\`\n\n`);
                if (methodInfo.isHeaderFile) {
                    markdown.appendMarkdown(`**🔍 Click to view** the function declaration in the header file.\n`);
                } else {
                    markdown.appendMarkdown(`**✨ No action needed** - Your native method is properly implemented!\n`);
                }
                break;

            case 'missing_implementation':
                markdown.appendMarkdown(`### ❌ C++ Implementation Missing\n\n`);
                markdown.appendMarkdown(`The native method does not have a corresponding C++ implementation.\n\n`);
                markdown.appendMarkdown(`**🔍 Expected Function:** \`${methodInfo.jniSignature}\`\n`);
                markdown.appendMarkdown(`**📁 Expected Location:** C++ source files\n\n`);
                markdown.appendMarkdown(`**💡 Recommendation:** Create a C++ implementation with the following signature:\n\n`);
                markdown.appendMarkdown(`\`\`\`cpp\n`);
                markdown.appendMarkdown(`JNIEXPORT void JNICALL ${methodInfo.jniSignature}(JNIEnv *env, jobject obj) {\n`);
                markdown.appendMarkdown(`    // Your native implementation here\n`);
                markdown.appendMarkdown(`}\n`);
                markdown.appendMarkdown(`\`\`\`\n`);
                break;
        }

        return markdown;
    }

    private getPlatformName(platform: string): string {
        switch (platform) {
            case 'win32':
                return 'Windows';
            case 'linux':
                return 'Linux';
            case 'darwin':
                return 'macOS';
            default:
                return 'Unknown';
        }
    }

    private getStatusIcon(status: string): string {
        switch (status) {
            case 'missing':
                return '❌';
            case 'wrong_extension':
                return '⚠️';
            case 'correct':
                return '✅';
            default:
                return '❓';
        }
    }

    private async showLibraryInfo(libraryName: string): Promise<void> {
        const status = this.checkLibraryStatus(libraryName);
        const message = this.createInfoMessage(libraryName, status);

        vscode.window.showInformationMessage(message, 'Refresh', 'Show Details').then(selection => {
            if (selection === 'Refresh') {
                this.refreshHighlights();
            } else if (selection === 'Show Details') {
                this.showDetailedInfo(libraryName, status);
            }
        });
    }

    private createInfoMessage(libraryName: string, status: LibraryInfo): string {
        const icon = this.getStatusIcon(status.status);
        const platform = this.getPlatformName(status.currentPlatform);

        switch (status.status) {
            case 'missing':
                return `${icon} Library '${libraryName}' not found for ${platform} (expected .${status.expectedExtension})`;
            case 'wrong_extension':
                return `${icon} Library '${libraryName}' exists but has wrong extension for ${platform}`;
            case 'correct':
                return `${icon} Library '${libraryName}' is correctly configured for ${platform}`;
            default:
                return `${icon} Unknown status for library '${libraryName}'`;
        }
    }

    private async showDetailedInfo(libraryName: string, status: LibraryInfo): Promise<void> {
        const panel = vscode.window.createWebviewPanel(
            'libraryInfo',
            `Library Info: ${libraryName}`,
            vscode.ViewColumn.One,
            {}
        );

        const html = this.generateDetailedInfoHtml(libraryName, status);
        panel.webview.html = html;
    }

    private generateDetailedInfoHtml(libraryName: string, status: LibraryInfo): string {
        return `
            <!DOCTYPE html>
            <html>
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <title>Library Info: ${libraryName}</title>
                <style>
                    body { 
                        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; 
                        padding: 20px; 
                        background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                        min-height: 100vh;
                        margin: 0;
                    }
                    .container {
                        background: white;
                        border-radius: 12px;
                        padding: 30px;
                        box-shadow: 0 10px 30px rgba(0,0,0,0.2);
                        max-width: 800px;
                        margin: 0 auto;
                    }
                    .header {
                        text-align: center;
                        margin-bottom: 30px;
                        padding-bottom: 20px;
                        border-bottom: 2px solid #f0f0f0;
                    }
                    .header h1 {
                        color: #333;
                        margin: 0;
                        font-size: 2.5em;
                        background: linear-gradient(45deg, #667eea, #764ba2);
                        -webkit-background-clip: text;
                        -webkit-text-fill-color: transparent;
                        background-clip: text;
                    }
                    .status-card {
                        padding: 20px;
                        border-radius: 10px;
                        margin: 20px 0;
                        box-shadow: 0 4px 15px rgba(0,0,0,0.1);
                        border-left: 5px solid;
                    }
                    .missing { 
                        background: linear-gradient(135deg, #ffebee 0%, #ffcdd2 100%);
                        border-left-color: #f44336;
                    }
                    .wrong_extension { 
                        background: linear-gradient(135deg, #e3f2fd 0%, #bbdefb 100%);
                        border-left-color: #2196f3;
                    }
                    .correct { 
                        background: linear-gradient(135deg, #e8f5e8 0%, #c8e6c9 100%);
                        border-left-color: #4caf50;
                    }
                    .status-header {
                        display: flex;
                        align-items: center;
                        margin-bottom: 15px;
                    }
                    .status-icon {
                        font-size: 2em;
                        margin-right: 15px;
                    }
                    .status-title {
                        font-size: 1.5em;
                        font-weight: bold;
                        color: #333;
                    }
                    .info-grid { 
                        display: grid; 
                        grid-template-columns: 1fr 1fr; 
                        gap: 20px; 
                        margin: 30px 0; 
                    }
                    .info-item { 
                        padding: 20px; 
                        background: linear-gradient(135deg, #f8f9fa 0%, #e9ecef 100%);
                        border-radius: 10px;
                        box-shadow: 0 2px 10px rgba(0,0,0,0.1);
                        border: 1px solid #dee2e6;
                    }
                    .info-item h3 {
                        color: #495057;
                        margin-top: 0;
                        display: flex;
                        align-items: center;
                    }
                    .info-item h3::before {
                        margin-right: 10px;
                        font-size: 1.2em;
                    }
                    .info-item ul {
                        list-style: none;
                        padding: 0;
                    }
                    .info-item li {
                        padding: 8px 0;
                        border-bottom: 1px solid #e9ecef;
                        display: flex;
                        align-items: center;
                    }
                    .info-item li:last-child {
                        border-bottom: none;
                    }
                    .info-item li::before {
                        margin-right: 10px;
                        color: #6c757d;
                    }
                    .badge {
                        display: inline-block;
                        padding: 4px 12px;
                        border-radius: 20px;
                        font-size: 0.8em;
                        font-weight: bold;
                        color: white;
                        margin: 5px;
                    }
                    .badge-success { background: #28a745; }
                    .badge-warning { background: #ffc107; color: #212529; }
                    .badge-danger { background: #dc3545; }
                    .badge-info { background: #17a2b8; }
                </style>
            </head>
            <body>
                <div class="container">
                    <div class="header">
                        <h1>📚 ${libraryName}</h1>
                        <p style="color: #6c757d; font-size: 1.1em;">Library Information & Status</p>
                    </div>
                    
                    <div class="status-card ${status.status}">
                        <div class="status-header">
                            <div class="status-icon">${this.getStatusIcon(status.status)}</div>
                            <div>
                                <div class="status-title">${status.status.toUpperCase().replace('_', ' ')}</div>
                                <div style="color: #6c757d;">Library Status Report</div>
                            </div>
                        </div>
                        
                        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 15px;">
                            <div>
                                <strong>🖥️ Platform:</strong><br>
                                <span class="badge badge-info">${this.getPlatformName(status.currentPlatform)}</span>
                            </div>
                            <div>
                                <strong>📁 Expected Extension:</strong><br>
                                <span class="badge badge-info">.${status.expectedExtension}</span>
                            </div>
                            <div>
                                <strong>📂 File Exists:</strong><br>
                                <span class="badge ${status.fileExists ? 'badge-success' : 'badge-danger'}">${status.fileExists ? 'Yes' : 'No'}</span>
                            </div>
                            <div>
                                <strong>✅ Extension Matches:</strong><br>
                                <span class="badge ${status.extensionMatches ? 'badge-success' : 'badge-warning'}">${status.extensionMatches ? 'Yes' : 'No'}</span>
                            </div>
                        </div>
                    </div>

                    <div class="info-grid">
                        <div class="info-item">
                            <h3>🔍 Common Library Locations</h3>
                            <ul>
                                <li>📂 ./lib/</li>
                                <li>📂 ./libs/</li>
                                <li>📂 ./native/</li>
                                <li>📂 ./bin/</li>
                                <li>📂 ./target/lib/</li>
                                <li>📂 ./build/lib/</li>
                            </ul>
                        </div>
                        <div class="info-item">
                            <h3>💡 Recommendations</h3>
                            ${this.getRecommendations(status)}
                        </div>
                    </div>
                </div>
            </body>
            </html>
        `;
    }

    private getRecommendations(status: LibraryInfo): string {
        switch (status.status) {
            case 'missing':
                return `
                    <ul>
                        <li>Build the native library for ${this.getPlatformName(status.currentPlatform)}</li>
                        <li>Place the .${status.expectedExtension} file in a lib/ directory</li>
                        <li>Check your build configuration</li>
                        <li>Verify the library name matches exactly</li>
                    </ul>
                `;
            case 'wrong_extension':
                return `
                    <ul>
                        <li>Rebuild the library with correct extension (.${status.expectedExtension})</li>
                        <li>Check your cross-compilation settings</li>
                        <li>Verify the target platform configuration</li>
                    </ul>
                `;
            case 'correct':
                return `
                    <ul>
                        <li>✅ Library is properly configured</li>
                        <li>No action needed</li>
                    </ul>
                `;
            default:
                return '<ul><li>Unknown status</li></ul>';
        }
    }

    public dispose(): void {
        for (const decorationType of this.decorationTypes.values()) {
            decorationType.dispose();
        }
        this.decorationTypes.clear();
    }
} 
