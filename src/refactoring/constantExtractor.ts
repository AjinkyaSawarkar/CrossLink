// src/refactoring/constantExtractor.ts
import * as vscode from 'vscode';
import { RefactoringContext, RefactoringOperation, RefactoringPreview } from './refactoringProvider';

export class ConstantExtractor implements RefactoringOperation {
    id = 'dependency-visualizer.extract-constant';
    title = 'Extract Constant/Macro';
    description = 'Extract selected literal value into a constant or macro';

    async canApply(context: RefactoringContext): Promise<boolean> {
        const document = context.document;
        const selection = context.selection;
        
        if (selection.isEmpty) {
            return false;
        }
        
        const selectedText = document.getText(selection);
        
        // Check if selection is a literal value
        return this.isLiteralValue(selectedText);
    }

    async apply(context: RefactoringContext): Promise<vscode.WorkspaceEdit> {
        const document = context.document;
        const selection = context.selection;
        const selectedText = document.getText(selection);
        
        const constantName = await vscode.window.showInputBox({
            prompt: 'Enter constant name',
            value: this.suggestConstantName(selectedText),
            validateInput: (value) => {
                if (!value.trim()) {
                    return 'Constant name cannot be empty';
                }
                if (!/^[A-Z_][A-Z0-9_]*$/.test(value)) {
                    return 'Constant name should use UPPER_CASE convention';
                }
                return null;
            }
        });

        if (!constantName) {
            return new vscode.WorkspaceEdit();
        }

        const workspaceEdit = new vscode.WorkspaceEdit();
        
        if (context.language === 'java') {
            await this.extractJavaConstant(context, selectedText, constantName, workspaceEdit);
        } else if (context.language === 'cpp') {
            await this.extractCppConstant(context, selectedText, constantName, workspaceEdit);
        }
        
        return workspaceEdit;
    }

    async preview(context: RefactoringContext): Promise<RefactoringPreview> {
        const document = context.document;
        const selection = context.selection;
        const selectedText = document.getText(selection);
        
        const changes: Array<{file: string; oldContent: string; newContent: string; diff: string}> = [];
        
        // Show preview of constant extraction
        const oldContent = document.getText();
        const newContent = this.generatePreviewContent(context, selectedText, 'EXTRACTED_CONSTANT');
        
        changes.push({
            file: document.uri.fsPath,
            oldContent,
            newContent,
            diff: this.generateDiff(oldContent, newContent)
        });
        
        return {
            title: `Extract Constant: ${selectedText}`,
            changes
        };
    }

    private isLiteralValue(text: string): boolean {
        // Check for string literals
        if (/^".*"$/.test(text) || /^'.*'$/.test(text)) {
            return true;
        }
        
        // Check for numeric literals
        if (/^-?\d+(\.\d+)?[fFdD]?$/.test(text)) {
            return true;
        }
        
        // Check for boolean literals
        if (/^(true|false)$/.test(text)) {
            return true;
        }
        
        // Check for null literal
        if (/^null$/.test(text)) {
            return true;
        }
        
        return false;
    }

    private suggestConstantName(literal: string): string {
        // Remove quotes and convert to constant naming convention
        let name = literal.replace(/^["']|["']$/g, '');
        
        // Convert to UPPER_CASE
        name = name.replace(/[^a-zA-Z0-9]/g, '_')
                   .replace(/([a-z])([A-Z])/g, '$1_$2')
                   .toUpperCase()
                   .replace(/_+/g, '_')
                   .replace(/^_|_$/g, '');
        
        return name || 'CONSTANT';
    }

    private async extractJavaConstant(
        context: RefactoringContext,
        literalValue: string,
        constantName: string,
        workspaceEdit: vscode.WorkspaceEdit
    ): Promise<void> {
        const document = context.document;
        const selection = context.selection;
        
        // Determine constant type
        const constantType = this.determineJavaType(literalValue);
        
        // Find class declaration
        const classPosition = await this.findJavaClassDeclaration(document);
        if (!classPosition) {
            return;
        }
        
        // Add constant declaration
        const constantDeclaration = `\n    public static final ${constantType} ${constantName} = ${literalValue};\n`;
        workspaceEdit.insert(document.uri, classPosition, constantDeclaration);
        
        // Replace selected literal with constant reference
        workspaceEdit.replace(document.uri, selection, constantName);
        
        // Find and replace other occurrences
        await this.replaceOtherOccurrences(document, literalValue, constantName, workspaceEdit);
    }

    private async extractCppConstant(
        context: RefactoringContext,
        literalValue: string,
        constantName: string,
        workspaceEdit: vscode.WorkspaceEdit
    ): Promise<void> {
        const document = context.document;
        const selection = context.selection;
        
        // Determine if it should be a const variable or #define
        const useDefine = await this.shouldUseCppDefine(literalValue);
        
        if (useDefine) {
            // Add #define macro
            const macroDefinition = `#define ${constantName} ${literalValue}\n`;
            const insertPosition = await this.findCppHeaderInsertion(document);
            workspaceEdit.insert(document.uri, insertPosition, macroDefinition);
        } else {
            // Add const variable
            const constantType = this.determineCppType(literalValue);
            const constantDeclaration = `const ${constantType} ${constantName} = ${literalValue};\n`;
            const insertPosition = await this.findCppConstantInsertion(document);
            workspaceEdit.insert(document.uri, insertPosition, constantDeclaration);
        }
        
        // Replace selected literal with constant reference
        workspaceEdit.replace(document.uri, selection, constantName);
        
        // Find and replace other occurrences
        await this.replaceOtherOccurrences(document, literalValue, constantName, workspaceEdit);
    }

    private determineJavaType(literal: string): string {
        if (/^".*"$/.test(literal)) {
            return 'String';
        } else if (/^'.*'$/.test(literal)) {
            return 'char';
        } else if (/^-?\d+$/.test(literal)) {
            return 'int';
        } else if (/^-?\d+\.\d+$/.test(literal)) {
            return 'double';
        } else if (/^-?\d+[fF]$/.test(literal)) {
            return 'float';
        } else if (/^-?\d+[lL]$/.test(literal)) {
            return 'long';
        } else if (/^(true|false)$/.test(literal)) {
            return 'boolean';
        }
        return 'Object';
    }

    private determineCppType(literal: string): string {
        if (/^".*"$/.test(literal)) {
            return 'char*';
        } else if (/^'.*'$/.test(literal)) {
            return 'char';
        } else if (/^-?\d+$/.test(literal)) {
            return 'int';
        } else if (/^-?\d+\.\d+$/.test(literal)) {
            return 'double';
        } else if (/^-?\d+[fF]$/.test(literal)) {
            return 'float';
        } else if (/^(true|false)$/.test(literal)) {
            return 'bool';
        }
        return 'auto';
    }

    private async findJavaClassDeclaration(document: vscode.TextDocument): Promise<vscode.Position | null> {
        const content = document.getText();
        const classMatch = content.match(/class\s+\w+[^{]*{/);
        
        if (classMatch) {
            const matchEnd = classMatch.index! + classMatch[0].length;
            return document.positionAt(matchEnd);
        }
        
        return null;
    }

    private async shouldUseCppDefine(literal: string): Promise<boolean> {
        const choice = await vscode.window.showQuickPick(
            ['#define macro', 'const variable'],
            { placeHolder: 'Choose constant type' }
        );
        
        return choice === '#define macro';
    }

    private async findCppHeaderInsertion(document: vscode.TextDocument): Promise<vscode.Position> {
        const content = document.getText();
        const includeMatch = content.match(/#include\s*[<"][^>"]*[>"](?:\s*\n)*/g);
        
        if (includeMatch) {
            const lastIncludeEnd = content.lastIndexOf(includeMatch[includeMatch.length - 1]) + includeMatch[includeMatch.length - 1].length;
            return document.positionAt(lastIncludeEnd);
        }
        
        return new vscode.Position(0, 0);
    }

    private async findCppConstantInsertion(document: vscode.TextDocument): Promise<vscode.Position> {
        const content = document.getText();
        
        // Find namespace or class declaration
        const namespaceMatch = content.match(/(namespace\s+\w+[^{]*{|class\s+\w+[^{]*{)/);
        
        if (namespaceMatch) {
            const matchEnd = namespaceMatch.index! + namespaceMatch[0].length;
            return document.positionAt(matchEnd);
        }
        
        return new vscode.Position(0, 0);
    }

    private async replaceOtherOccurrences(
        document: vscode.TextDocument,
        literalValue: string,
        constantName: string,
        workspaceEdit: vscode.WorkspaceEdit
    ): Promise<void> {
        const content = document.getText();
        const escapedLiteral = literalValue.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const regex = new RegExp(`\\b${escapedLiteral}\\b`, 'g');
        
        let match;
        while ((match = regex.exec(content)) !== null) {
            const startPos = document.positionAt(match.index);
            const endPos = document.positionAt(match.index + match[0].length);
            const range = new vscode.Range(startPos, endPos);
            
            workspaceEdit.replace(document.uri, range, constantName);
        }
    }

    private generatePreviewContent(context: RefactoringContext, literal: string, constantName: string): string {
        const document = context.document;
        const content = document.getText();
        
        // Simple preview - replace the literal with constant name
        return content.replace(literal, constantName);
    }

    private generateDiff(oldContent: string, newContent: string): string {
        return `--- Old\n+++ New\n@@ -1,${oldContent.split('\n').length} +1,${newContent.split('\n').length} @@\n`;
    }
}
