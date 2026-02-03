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
        // Check if current position is on a symbol
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
        } else if (context.language === 'cpp') {
            await this.handleCppRenaming(context, newName, workspaceEdit);
        }
        
        return workspaceEdit;
    }

    async preview(context: RefactoringContext): Promise<RefactoringPreview> {
        const references = await this.findAllReferences(context);
        const changes: Array<{file: string; oldContent: string; newContent: string; diff: string}> = [];
        
        for (const ref of references) {
            const document = await vscode.workspace.openTextDocument(ref.uri);
            const oldContent = document.getText();
            
            // FIX: Get the actual text from the range instead of using character position
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

    // FIX: Added missing handleJavaRenaming method
    private async handleJavaRenaming(
        context: RefactoringContext, 
        newName: string, 
        workspaceEdit: vscode.WorkspaceEdit
    ): Promise<void> {
        const document = context.document;
        const position = context.selection.active;
        
        // Check if renaming a class or method
        const symbols = await vscode.commands.executeCommand<vscode.DocumentSymbol[]>(
            'vscode.executeDocumentSymbolProvider',
            document.uri
        );
        
        const symbol = this.findSymbolAtPosition(symbols || [], position);
        if (symbol) {
            if (symbol.kind === vscode.SymbolKind.Class) {
                // Handle class renaming - need to rename file too
                const currentFileName = path.basename(document.uri.fsPath, '.java');
                if (currentFileName === symbol.name) {
                    const newFilePath = path.join(
                        path.dirname(document.uri.fsPath),
                        `${newName}.java`
                    );
                    
                    workspaceEdit.renameFile(document.uri, vscode.Uri.file(newFilePath));
                }
                
                // Handle JNI class renaming in C/C++ files
                await this.handleJniClassRenaming(context, symbol.name, newName, workspaceEdit);
            } else if (symbol.kind === vscode.SymbolKind.Method) {
                // Check if this is a native method
                const methodText = document.getText(symbol.range);
                if (methodText.includes('native')) {
                    // Handle JNI method renaming in C/C++ files
                    await this.handleJniMethodRenaming(context, symbol.name, newName, workspaceEdit);
                }
            }
        }
    }

    // Handle JNI class renaming in C/C++ files
    private async handleJniClassRenaming(
        context: RefactoringContext,
        oldClassName: string,
        newClassName: string,
        workspaceEdit: vscode.WorkspaceEdit
    ): Promise<void> {
        console.log(`🔄 Updating JNI class signatures: ${oldClassName} -> ${newClassName}`);
        
        // Find corresponding C++ files in the workspace
        const cppFiles = await vscode.workspace.findFiles('**/*.{cpp,cc,cxx,c,h,hpp}');
        console.log(`📁 Found ${cppFiles.length} C++ files:`, cppFiles.map(f => f.fsPath));
        
        for (const cppFile of cppFiles) {
            const document = await vscode.workspace.openTextDocument(cppFile);
            const content = document.getText();
            
            // Look for JNI function signatures that match the old class name
            const packageName = this.extractPackageName(context.document);
            console.log(`📦 Package name extracted: ${packageName}`);
            
            if (packageName) {
                const oldJniPrefix = this.createJniClassPrefix(packageName, oldClassName);
                const newJniPrefix = this.createJniClassPrefix(packageName, newClassName);
                console.log(`🔧 JNI class signature update: ${oldJniPrefix} -> ${newJniPrefix}`);

                if (oldJniPrefix && newJniPrefix) {
                    // Find and replace JNI class signatures with precise targeting
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

    // Handle JNI method renaming in C/C++ files
    private async handleJniMethodRenaming(
        context: RefactoringContext,
        oldMethodName: string,
        newMethodName: string,
        workspaceEdit: vscode.WorkspaceEdit
    ): Promise<void> {
        console.log(`🔄 Updating JNI method signatures: ${oldMethodName} -> ${newMethodName}`);
        
        // Find corresponding C++ files in the workspace
        const cppFiles = await vscode.workspace.findFiles('**/*.{cpp,cc,cxx,c,h,hpp}');
        console.log(`📁 Found ${cppFiles.length} C++ files:`, cppFiles.map(f => f.fsPath));
        
        // Extract class name from the Java file
        const className = this.extractClassName(context.document);
        const packageName = this.extractPackageName(context.document);
        
        if (!className || !packageName) {
            console.log(`❌ Could not extract class name or package name`);
            return;
        }
        
        for (const cppFile of cppFiles) {
            const document = await vscode.workspace.openTextDocument(cppFile);
            const content = document.getText();
            
            // Create JNI function signature pattern
            const jniClassPrefix = this.createJniClassPrefix(packageName, className);
            if (jniClassPrefix) {
                const oldJniFunction = `${jniClassPrefix}_${oldMethodName}`;
                const newJniFunction = `${jniClassPrefix}_${newMethodName}`;
                console.log(`🔧 JNI method signature update: ${oldJniFunction} -> ${newJniFunction}`);
                
                // Find and replace specific JNI function occurrences with precise targeting
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

    private async handleCppRenaming(
        context: RefactoringContext,
        newName: string,
        workspaceEdit: vscode.WorkspaceEdit
    ): Promise<void> {
        // Handle C++ specific renaming logic
        const document = context.document;
        const content = document.getText();
        
        // Check for JNI function signatures
        const jniRegex = /JNIEXPORT\s+\w+\s+JNICALL\s+Java_[\w_]+_(\w+)/g;
        let match;
        
        while ((match = jniRegex.exec(content)) !== null) {
            const oldFunctionName = match[1];
            const fullMatch = match[0];
            
            // Replace JNI function name
            const newJniName = fullMatch.replace(oldFunctionName, newName);
            const range = new vscode.Range(
                document.positionAt(match.index),
                document.positionAt(match.index + fullMatch.length)
            );
            
            workspaceEdit.replace(document.uri, range, newJniName);
        }
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
        const classMatch = content.match(/(?:public\s+)?class\s+(\w+)/);
        return classMatch ? classMatch[1] : null;
    }

    // Helper method to find and replace JNI function signatures with precise targeting
    private findAndReplaceJniFunction(
        document: vscode.TextDocument, 
        oldJniFunction: string, 
        newJniFunction: string
    ): Array<{range: vscode.Range, newText: string}> {
        const content = document.getText();
        const edits: Array<{range: vscode.Range, newText: string}> = [];
        
        // Look for JNI function signatures in various contexts:
        // 1. JNIEXPORT ... JNICALL Java_package_Class_method
        // 2. Function definitions: Java_package_Class_method(...)
        // 3. Function declarations in headers
        
        const patterns = [
            // JNIEXPORT return_type JNICALL Java_package_Class_method
            new RegExp(`(JNIEXPORT\s+\w+\s+JNICALL\s+)${this.escapeRegex(oldJniFunction)}\\b`, 'g'),
            // Function definition: Java_package_Class_method(...)
            new RegExp(`\\b${this.escapeRegex(oldJniFunction)}(?=\\s*\\()`, 'g'),
            // Function declaration in header
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

    // Helper method to find and replace JNI class function signatures
    private findAndReplaceJniClassFunctions(
        document: vscode.TextDocument,
        oldJniPrefix: string,
        newJniPrefix: string
    ): Array<{range: vscode.Range, newText: string}> {
        const content = document.getText();
        const edits: Array<{range: vscode.Range, newText: string}> = [];
        
        // Look for JNI class function patterns: Java_package_OldClass_methodName
        const patterns = [
            // JNIEXPORT return_type JNICALL Java_package_Class_method
            new RegExp(`(JNIEXPORT\s+\w+\s+JNICALL\s+)${this.escapeRegex(oldJniPrefix)}_([a-zA-Z_][a-zA-Z0-9_]*)\\b`, 'g'),
            // Function definition: Java_package_Class_method(...)
            new RegExp(`\\b${this.escapeRegex(oldJniPrefix)}_([a-zA-Z_][a-zA-Z0-9_]*)(?=\\s*\\()`, 'g'),
            // Function declaration in header
            new RegExp(`\\b${this.escapeRegex(oldJniPrefix)}_([a-zA-Z_][a-zA-Z0-9_]*)(?=\\s*;)`, 'g')
        ];
        
        for (const pattern of patterns) {
            let match;
            while ((match = pattern.exec(content)) !== null) {
                const prefixStart = match.index + (match[1] ? match[1].length : 0);
                const prefixEnd = prefixStart + oldJniPrefix.length;
                const methodName = match[match.length - 1]; // Last capture group is the method name
                
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
                // Check children first
                const childSymbol = this.findSymbolAtPosition(symbol.children, position);
                if (childSymbol) {
                    return childSymbol;
                }
                
                // Check if position is on the symbol name
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
        // Simple diff implementation
        return `--- Old\n+++ New\n@@ -1,${oldContent.split('\n').length} +1,${newContent.split('\n').length} @@\n`;
    }
}
