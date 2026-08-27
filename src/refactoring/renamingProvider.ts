// src/refactoring/renamingProvider.ts
import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { RefactoringContext, RefactoringOperation, RefactoringPreview } from './refactoringProvider';

export class RenamingProvider implements RefactoringOperation {
    id = 'dependency-visualizer.rename';
    title = 'Rename Symbol';
    description = 'Rename variables, functions, classes, or files across the codebase';

    async canApply(context: RefactoringContext): Promise<boolean> {
        const document = context.document;
        const position = context.selection.active;

        const symbols = await vscode.commands.executeCommand<vscode.DocumentSymbol[]>(
            'vscode.executeDocumentSymbolProvider',
            document.uri
        );

        return this.findSymbolAtPosition(symbols || [], position) !== null;
    }

    async apply(context: RefactoringContext): Promise<vscode.WorkspaceEdit> {
        const newName = await vscode.window.showInputBox({
            prompt: 'Enter new name',
            validateInput: (value) => {
                if (!value.trim()) {
                    return 'Name cannot be empty';
                }
                if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(value)) {
                    return 'Invalid identifier name';
                }
                return null;
            }
        });

        if (!newName) {
            return new vscode.WorkspaceEdit();
        }

        const workspaceEdit = new vscode.WorkspaceEdit();
        const references = await this.findAllReferences(context);

        for (const ref of references) {
            workspaceEdit.replace(ref.uri, ref.range, newName);
        }

        // Handle special cases for cross-language renaming
        if (context.language === 'java') {
            await this.handleJavaRenaming(context, newName, workspaceEdit);
        } else if (context.language === 'cpp' || context.language === 'c') {
            await this.handleCppRenaming(context, newName, workspaceEdit);
        }

        return workspaceEdit;
    }

    async preview(context: RefactoringContext): Promise<RefactoringPreview> {
        const references = await this.findAllReferences(context);
        const changes: Array<{ file: string; oldContent: string; newContent: string; diff: string }> = [];

        for (const ref of references) {
            const document = await vscode.workspace.openTextDocument(ref.uri);
            const oldContent = document.getText();
            const oldText = document.getText(ref.range);
            const newContent = oldContent.replace(
                new RegExp(`\\b${this.escapeRegex(oldText)}\\b`, 'g'),
                'NEW_NAME'
            );

            changes.push({
                file: ref.uri.fsPath,
                oldContent,
                newContent,
                diff: this.generateDiff(oldContent, newContent)
            });
        }

        return {
            title: `Rename Symbol`,
            changes
        };
    }

    private async findAllReferences(context: RefactoringContext): Promise<vscode.Location[]> {
        const document = context.document;
        const position = context.selection.active;

        const references = await vscode.commands.executeCommand<vscode.Location[]>(
            'vscode.executeReferenceProvider',
            document.uri,
            position
        );

        return references || [];
    }

    private async handleJavaRenaming(
        context: RefactoringContext,
        newName: string,
        workspaceEdit: vscode.WorkspaceEdit
    ): Promise<void> {
        const document = context.document;
        const position = context.selection.active;

        const symbols = await vscode.commands.executeCommand<vscode.DocumentSymbol[]>(
            'vscode.executeDocumentSymbolProvider',
            document.uri
        );

        const symbol = this.findSymbolAtPosition(symbols || [], position);
        if (symbol) {
            if (symbol.kind === vscode.SymbolKind.Class) {
                const currentFileName = path.basename(document.uri.fsPath, '.java');
                if (currentFileName === symbol.name) {
                    const newFilePath = path.join(
                        path.dirname(document.uri.fsPath),
                        `${newName}.java`
                    );

                    workspaceEdit.renameFile(document.uri, vscode.Uri.file(newFilePath));
                }

                await this.handleJniClassRenaming(context, symbol.name, newName, workspaceEdit);
            } else if (symbol.kind === vscode.SymbolKind.Method) {
                const methodText = document.getText(symbol.range);
                if (methodText.includes('native')) {
                    await this.handleJniMethodRenaming(context, symbol.name, newName, workspaceEdit);
                }
            }
        }
    }

    private async handleJniClassRenaming(
        context: RefactoringContext,
        oldClassName: string,
        newClassName: string,
        workspaceEdit: vscode.WorkspaceEdit
    ): Promise<void> {
        console.log(`🔄 Updating JNI class signatures: ${oldClassName} -> ${newClassName}`);

        const cppFiles = await vscode.workspace.findFiles('**/*.{cpp,cc,cxx,c,h,hpp}');
        console.log(`📁 Found ${cppFiles.length} C++ files:`, cppFiles.map(f => f.fsPath));

        for (const cppFile of cppFiles) {
            const document = await vscode.workspace.openTextDocument(cppFile);
            const content = document.getText();

            const packageName = this.extractPackageName(context.document);
            console.log(`📦 Package name extracted: ${packageName}`);

            if (packageName) {
                const oldJniPrefix = this.createJniClassPrefix(packageName, oldClassName);
                const newJniPrefix = this.createJniClassPrefix(packageName, newClassName);
                console.log(`🔧 JNI class signature update: ${oldJniPrefix} -> ${newJniPrefix}`);

                if (oldJniPrefix && newJniPrefix) {
                    const edits = this.findAndReplaceJniClassFunctions(document, oldJniPrefix, newJniPrefix);

                    if (edits.length > 0) {
                        console.log(`✅ Found ${edits.length} JNI class function occurrences in ${cppFile.fsPath}`);
                        for (const edit of edits) {
                            workspaceEdit.replace(document.uri, edit.range, edit.newText);
                        }
                    } else {
                        console.log(`ℹ️ No JNI class functions found for ${oldJniPrefix} in ${cppFile.fsPath}`);
                    }
                }
            }
        }
    }

    private async handleJniMethodRenaming(
        context: RefactoringContext,
        oldMethodName: string,
        newMethodName: string,
        workspaceEdit: vscode.WorkspaceEdit
    ): Promise<void> {
        console.log(`🔄 Updating JNI method signatures: ${oldMethodName} -> ${newMethodName}`);

        const cppFiles = await vscode.workspace.findFiles('**/*.{cpp,cc,cxx,c,h,hpp}');
        console.log(`📁 Found ${cppFiles.length} C++ files:`, cppFiles.map(f => f.fsPath));

        const className = this.extractClassName(context.document);
        const packageName = this.extractPackageName(context.document);

        if (!className || !packageName) {
            console.log(`❌ Could not extract class name or package name`);
            return;
        }

        for (const cppFile of cppFiles) {
            const document = await vscode.workspace.openTextDocument(cppFile);
            const content = document.getText();

            const jniClassPrefix = this.createJniClassPrefix(packageName, className);
            if (jniClassPrefix) {
                const oldJniFunction = `${jniClassPrefix}_${oldMethodName}`;
                const newJniFunction = `${jniClassPrefix}_${newMethodName}`;
                console.log(`🔧 JNI method signature update: ${oldJniFunction} -> ${newJniFunction}`);

                const edits = this.findAndReplaceJniFunction(document, oldJniFunction, newJniFunction);

                if (edits.length > 0) {
                    console.log(`✅ Found ${edits.length} JNI function occurrences in ${cppFile.fsPath}`);
                    for (const edit of edits) {
                        workspaceEdit.replace(document.uri, edit.range, edit.newText);
                    }
                } else {
                    console.log(`ℹ️ No JNI function signatures found for ${oldJniFunction} in ${cppFile.fsPath}`);
                }
            }
        }
    }

    // FIX: Rewritten to search C++ files for JNI patterns when renaming in C++ context
    private async handleCppRenaming(
        context: RefactoringContext,
        newName: string,
        workspaceEdit: vscode.WorkspaceEdit
    ): Promise<void> {
        console.log(`🔄 Handling C++ renaming: ${newName}`);

        // Find all Java files to check for corresponding native method declarations
        const javaFiles = await vscode.workspace.findFiles('**/*.java');
        console.log(`📁 Found ${javaFiles.length} Java files`);

        for (const javaFile of javaFiles) {
            const document = await vscode.workspace.openTextDocument(javaFile);
            const content = document.getText();

            // Look for native method declarations that might match the C++ function being renamed
            const nativeMethodRegex = /^\s*(?:(?:public|private|protected|static|final|abstract|synchronized)\s+)*\w+\s+native\s+\w+\s+(\w+)\s*\([^)]*\)\s*;/gm;
            let match;

            while ((match = nativeMethodRegex.exec(content)) !== null) {
                const nativeMethodName = match[1];
                
                // Check if this native method name matches or is related to the new name
                // This helps when renaming the C++ function that implements a Java native method
                if (nativeMethodName === newName || this.isRelatedName(nativeMethodName, newName)) {
                    console.log(`🔍 Found potential native method match: ${nativeMethodName} in ${javaFile.fsPath}`);
                    
                    // The Java native method will be handled by the reference provider
                    // This is mainly for logging and potential future enhancements
                }
            }
        }

        // Also handle JNI function signature patterns in the current C++ file
        const document = context.document;
        const content = document.getText();

        // Check for JNI function signatures in the current C++ document
        const jniRegex = /JNIEXPORT\s+\w+\s+JNICALL\s+(Java_[\w_]+)_(\w+)/g;
        let jniMatch;

        while ((jniMatch = jniRegex.exec(content)) !== null) {
            const jniClassPart = jniMatch[1];
            const jniMethodPart = jniMatch[2];
            const fullMatch = jniMatch[0];

            console.log(`🔍 Found JNI function: Java_${jniClassPart}_${jniMethodPart}`);
            
            // If the method part matches what we're renaming, update the full signature
            if (jniMethodPart === context.symbolName || this.isRelatedName(jniMethodPart, context.symbolName || '')) {
                const newJniName = fullMatch.replace(jniMethodPart, newName);
                const range = new vscode.Range(
                    document.positionAt(jniMatch.index),
                    document.positionAt(jniMatch.index + fullMatch.length)
                );

                workspaceEdit.replace(document.uri, range, newJniName);
                console.log(`✅ Updated JNI signature to: ${newJniName}`);
            }
        }
    }

    // Helper to check if two names might be related (e.g., camelCase vs snake_case)
    private isRelatedName(name1: string, name2: string): boolean {
        // Simple heuristic: check if one contains the other (case-insensitive)
        return name1.toLowerCase().includes(name2.toLowerCase()) || 
               name2.toLowerCase().includes(name1.toLowerCase());
    }

    private extractPackageName(document: vscode.TextDocument): string {
        const content = document.getText();
        const packageMatch = content.match(/package\s+([\w.]+);/);
        return packageMatch ? packageMatch[1] : '';
    }

    private createJniClassPrefix(packageName: string, className: string): string | null {
        if (!packageName || !className) {
            return null;
        }

        const jniClassName = packageName.replace(/\./g, '_') + '_' + className;
        return `Java_${jniClassName}`;
    }

    private extractClassName(document: vscode.TextDocument): string | null {
        const content = document.getText();
        const classMatch = content.match(/^\s*(?:(?:public|private|protected|abstract|final|static)\s+)*\bclass\s+(\w+)/m);
        return classMatch ? classMatch[1] : null;
    }

    private findAndReplaceJniFunction(
        document: vscode.TextDocument,
        oldJniFunction: string,
        newJniFunction: string
    ): Array<{ range: vscode.Range, newText: string }> {
        const content = document.getText();
        const edits: Array<{ range: vscode.Range, newText: string }> = [];

        const patterns = [
            new RegExp(`(JNIEXPORT\s+\w+\s+JNICALL\s+)${this.escapeRegex(oldJniFunction)}\\b`, 'g'),
            new RegExp(`\\b${this.escapeRegex(oldJniFunction)}(?=\\s*\\()`, 'g'),
            new RegExp(`\\b${this.escapeRegex(oldJniFunction)}(?=\\s*;)`, 'g')
        ];

        for (const pattern of patterns) {
            let match;
            while ((match = pattern.exec(content)) !== null) {
                const matchStart = match.index + (match[1] ? match[1].length : 0);
                const matchEnd = matchStart + oldJniFunction.length;

                const range = new vscode.Range(
                    document.positionAt(matchStart),
                    document.positionAt(matchEnd)
                );

                edits.push({
                    range,
                    newText: newJniFunction
                });
            }
        }

        return edits;
    }

    private findAndReplaceJniClassFunctions(
        document: vscode.TextDocument,
        oldJniPrefix: string,
        newJniPrefix: string
    ): Array<{ range: vscode.Range, newText: string }> {
        const content = document.getText();
        const edits: Array<{ range: vscode.Range, newText: string }> = [];

        const patterns = [
            new RegExp(`(JNIEXPORT\s+\w+\s+JNICALL\s+)${this.escapeRegex(oldJniPrefix)}_([a-zA-Z_][a-zA-Z0-9_]*)\\b`, 'g'),
            new RegExp(`\\b${this.escapeRegex(oldJniPrefix)}_([a-zA-Z_][a-zA-Z0-9_]*)(?=\\s*\\()`, 'g'),
            new RegExp(`\\b${this.escapeRegex(oldJniPrefix)}_([a-zA-Z_][a-zA-Z0-9_]*)(?=\\s*;)`, 'g')
        ];

        for (const pattern of patterns) {
            let match;
            while ((match = pattern.exec(content)) !== null) {
                const prefixStart = match.index + (match[1] ? match[1].length : 0);
                const prefixEnd = prefixStart + oldJniPrefix.length;

                const range = new vscode.Range(
                    document.positionAt(prefixStart),
                    document.positionAt(prefixEnd)
                );

                edits.push({
                    range,
                    newText: newJniPrefix
                });
            }
        }

        return edits;
    }

    private findSymbolAtPosition(symbols: vscode.DocumentSymbol[], position: vscode.Position): vscode.DocumentSymbol | null {
        for (const symbol of symbols) {
            if (symbol.range.contains(position)) {
                const childSymbol = this.findSymbolAtPosition(symbol.children, position);
                if (childSymbol) {
                    return childSymbol;
                }

                if (symbol.selectionRange.contains(position)) {
                    return symbol;
                }
            }
        }
        return null;
    }

    private escapeRegex(str: string): string {
        return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }

    private generateDiff(oldContent: string, newContent: string): string {
        return `--- Old\n+++ New\n@@ -1,${oldContent.split('\n').length} +1,${newContent.split('\n').length} @@\n`;
    }
}
