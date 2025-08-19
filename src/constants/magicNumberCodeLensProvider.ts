// src/constants/magicNumberCodeLensProvider.ts
import * as vscode from 'vscode';
import { ConstantsAnalyzer, ConstantContext } from './constantsAnalyzer';

export class MagicNumberCodeLensProvider implements vscode.CodeLensProvider {
    private _onDidChangeCodeLenses: vscode.EventEmitter<void> = new vscode.EventEmitter<void>();
    public readonly onDidChangeCodeLenses: vscode.Event<void> = this._onDidChangeCodeLenses.event;

    constructor(private analyzer: ConstantsAnalyzer) {}

    refresh(): void {
        this._onDidChangeCodeLenses.fire();
    }

    async provideCodeLenses(
        document: vscode.TextDocument,
        token: vscode.CancellationToken
    ): Promise<vscode.CodeLens[]> {
        const codeLenses: vscode.CodeLens[] = [];
        
        // Only process Java and C++ files
        const language = document.languageId;
        if (!['java', 'cpp', 'c'].includes(language)) {
            return codeLenses;
        }

        const text = document.getText();
        const lines = text.split('\n');

        for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
            const line = lines[lineIndex];
            
            // Find magic numbers in the line
            const magicNumberRegex = /\b(\d{2,})\b/g;
            let match;
            
            while ((match = magicNumberRegex.exec(line)) !== null) {
                const value = match[1];
                
                // Skip common non-magic numbers
                if (this.isMagicNumber(value)) {
                    const startPos = new vscode.Position(lineIndex, match.index);
                    const endPos = new vscode.Position(lineIndex, match.index + value.length);
                    const range = new vscode.Range(startPos, endPos);
                    
                    // Get context for better suggestions
                    const context = this.getContext(document, startPos);
                    const suggestions = await this.generateSuggestions(value, context);
                    
                    if (suggestions.length > 0) {
                        // Create code lens with suggestion icon
                        const codeLens = new vscode.CodeLens(range, {
                            title: `💡 ${suggestions.length} suggestion${suggestions.length > 1 ? 's' : ''}`,
                            tooltip: `Click to see constant suggestions for ${value}`,
                            command: 'dependencyVisualizer.showMagicNumberSuggestions',
                            arguments: [{
                                value,
                                suggestions,
                                context,
                                range,
                                document: document.uri
                            }]
                        });
                        
                        codeLenses.push(codeLens);
                    }
                }
            }
        }

        return codeLenses;
    }

    private isMagicNumber(value: string): boolean {
        const numValue = parseInt(value);
        return /^\d{2,}$/.test(value) && 
               !['10', '100', '1000', '3600', '365', '24', '60', '99', '50', '256', '512'].includes(value) &&
               !/^0+$/.test(value) &&
               numValue > 1;
    }

    private getContext(document: vscode.TextDocument, position: vscode.Position): ConstantContext {
        const line = document.lineAt(position.line);
        const lineText = line.text;
        
        // Get surrounding lines for better context
        const startLine = Math.max(0, position.line - 2);
        const endLine = Math.min(document.lineCount - 1, position.line + 2);
        const surroundingLines = [];
        
        for (let i = startLine; i <= endLine; i++) {
            surroundingLines.push(document.lineAt(i).text);
        }
        
        const surroundingCode = surroundingLines.join('\n');
        
        // Determine context type
        let contextType: ConstantContext['type'] = 'unknown';
        let operation = '';
        let functionName = '';
        let variableName = '';
        
        if (lineText.includes('for') && (lineText.includes('<') || lineText.includes('>'))) {
            contextType = 'loop_condition';
        } else if (lineText.includes('if') && (lineText.includes('<') || lineText.includes('>') || lineText.includes('=='))) {
            contextType = 'comparison';
        } else if (lineText.includes('[') && lineText.includes(']')) {
            contextType = 'array_index';
        } else if (lineText.includes('=') && !lineText.includes('==')) {
            contextType = 'variable_assignment';
            const assignMatch = lineText.match(/(\w+)\s*=/);
            if (assignMatch) {
                variableName = assignMatch[1];
            }
        } else if (lineText.includes('(') && lineText.includes(')')) {
            contextType = 'function_argument';
            const funcMatch = lineText.match(/(\w+)\s*\(/);
            if (funcMatch) {
                functionName = funcMatch[1];
            }
        } else if (lineText.includes('+') || lineText.includes('-') || lineText.includes('*') || lineText.includes('/')) {
            contextType = 'calculation';
        } else if (lineText.includes('return')) {
            contextType = 'return_code';
        }

        return {
            type: contextType,
            surroundingCode,
            variableName,
            functionName,
            operation
        };
    }

    private async generateSuggestions(value: string, context: ConstantContext): Promise<string[]> {
        // Use the existing analyzer logic to generate suggestions
        const suggestions = this.analyzer['generateNameSuggestions'](value, context);
        return suggestions.suggestions || [];
    }
}
