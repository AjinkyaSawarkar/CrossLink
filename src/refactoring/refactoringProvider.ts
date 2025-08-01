// src/refactoring/refactoringProvider.ts
import * as vscode from 'vscode';

export interface RefactoringContext {
    workspaceFolder: vscode.WorkspaceFolder;
    document: vscode.TextDocument;
    selection: vscode.Selection;
    symbol?: vscode.DocumentSymbol;
    language: 'java' | 'cpp';
}

export interface RefactoringOperation {
    id: string;
    title: string;
    description: string;
    canApply(context: RefactoringContext): Promise<boolean>;
    apply(context: RefactoringContext): Promise<vscode.WorkspaceEdit>;
    preview(context: RefactoringContext): Promise<RefactoringPreview>;
}

export interface RefactoringPreview {
    title: string;
    changes: Array<{
        file: string;
        oldContent: string;
        newContent: string;
        diff: string;
    }>;
}

export class RefactoringProvider {
    static executeRefactoring(id: any, context: { workspaceFolder: vscode.WorkspaceFolder; document: vscode.TextDocument; selection: vscode.Selection; language: string; }) {
        throw new Error('Method not implemented.');
    }
    private operations: Map<string, RefactoringOperation> = new Map();
    
    registerOperation(operation: RefactoringOperation) {
        this.operations.set(operation.id, operation);
    }
    
    async getAvailableRefactorings(context: RefactoringContext): Promise<RefactoringOperation[]> {
        const available: RefactoringOperation[] = [];
        
        for (const operation of this.operations.values()) {
            if (await operation.canApply(context)) {
                available.push(operation);
            }
        }
        
        return available;
    }
    
    async executeRefactoring(operationId: string, context: RefactoringContext): Promise<boolean> {
        const operation = this.operations.get(operationId);
        if (!operation) {
            return false;
        }
        
        const workspaceEdit = await operation.apply(context);
        return await vscode.workspace.applyEdit(workspaceEdit);
    }
}
