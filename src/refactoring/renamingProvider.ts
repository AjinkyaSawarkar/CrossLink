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
        
        // Check if renaming a class
        const symbols = await vscode.commands.executeCommand<vscode.DocumentSymbol[]>(
            'vscode.executeDocumentSymbolProvider',
            document.uri
        );
        
        const symbol = this.findSymbolAtPosition(symbols || [], position);
        if (symbol && symbol.kind === vscode.SymbolKind.Class) {
            // Handle class renaming - need to rename file too
            const currentFileName = path.basename(document.uri.fsPath, '.java');
            if (currentFileName === symbol.name) {
                const newFilePath = path.join(
                    path.dirname(document.uri.fsPath),
                    `${newName}.java`
                );
                
                workspaceEdit.renameFile(document.uri, vscode.Uri.file(newFilePath));
            }
            
            // Handle JNI native method renaming
            await this.handleNativeMethodRenaming(context, symbol.name, newName, workspaceEdit);
        }
    }

    // FIX: Added missing handleNativeMethodRenaming method
    private async handleNativeMethodRenaming(
        context: RefactoringContext,
        oldClassName: string,
        newClassName: string,
        workspaceEdit: vscode.WorkspaceEdit
    ): Promise<void> {

        console.log(`🔄 Updating JNI signatures: ${oldClassName} -> ${newClassName}`);
        // Find corresponding C++ files in the workspace
        const cppFiles = await vscode.workspace.findFiles('**/*.{cpp,cc,cxx,c,h,hpp}');
        console.log(`📁 Found ${cppFiles.length} C++ files:`, cppFiles.map(f => f.fsPath));
        
        for (const cppFile of cppFiles) {
            const document = await vscode.workspace.openTextDocument(cppFile);
            const content = document.getText();
            
            // Look for JNI function signatures that match the old class name
            const packageName = this.extractPackageName(context.document);
            console.log(`📦 Package name extracted: ${packageName}`);
            const oldJniPattern = this.createJniPattern(packageName, oldClassName);
            const newJniPattern = this.createJniPattern(packageName, newClassName);
            console.log(`🔧 JNI signature update: ${oldJniPattern} -> ${newJniPattern}`);



            if (oldJniPattern && newJniPattern) {
                const updatedContent = content.replace(oldJniPattern, newJniPattern);
                
                if (updatedContent !== content) {
                    const fullRange = new vscode.Range(
                        document.positionAt(0),
                        document.positionAt(content.length)
                    );
                    workspaceEdit.replace(document.uri, fullRange, updatedContent);
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

    private createJniPattern(packageName: string, className: string): string | null {
        if (!packageName || !className) {
            return null;
        }
        
        const jniClassName = packageName.replace(/\./g, '_') + '_' + className;
        return `Java_${jniClassName}`;
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
