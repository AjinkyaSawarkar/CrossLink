// src/refactoring/codeActionProvider.ts
import * as vscode from 'vscode';
import { RefactoringProvider, RefactoringContext } from './refactoringProvider';

export class RefactoringCodeActionProvider implements vscode.CodeActionProvider {
    constructor(private refactoringProvider: RefactoringProvider) {}

    async provideCodeActions(
        document: vscode.TextDocument,
        range: vscode.Range,
        context: vscode.CodeActionContext,
        token: vscode.CancellationToken
    ): Promise<vscode.CodeAction[]> {
        const refactoringContext: RefactoringContext = {
            workspaceFolder: vscode.workspace.getWorkspaceFolder(document.uri)!,
            document,
            selection: new vscode.Selection(range.start, range.end),
            language: document.languageId === 'java' ? 'java' : 'cpp'
        };
        
        const availableRefactorings = await this.refactoringProvider.getAvailableRefactorings(refactoringContext);
        
        return availableRefactorings.map(refactoring => {
            const action = new vscode.CodeAction(refactoring.title, vscode.CodeActionKind.Refactor);
            action.command = {
                title: refactoring.title,
                command: 'dependencyVisualizer.executeRefactoring',
                arguments: [refactoring.id, refactoringContext]
            };
            return action;
        });
    }
}
