// src/constants/magicNumberHoverProvider.ts
import * as vscode from 'vscode';
import { ConstantsAnalyzer, ConstantInfo, ConstantContext } from './constantsAnalyzer';

export class MagicNumberHoverProvider implements vscode.HoverProvider {
    constructor(private analyzer: ConstantsAnalyzer) {}

    async provideHover(
        document: vscode.TextDocument,
        position: vscode.Position,
        token: vscode.CancellationToken
    ): Promise<vscode.Hover | undefined> {
        const wordRange = document.getWordRangeAtPosition(position, /\b\d+\b/);
        if (!wordRange) {
            return undefined;
        }

        const word = document.getText(wordRange);
        
        // Check if this is a magic number
        if (!this.isMagicNumber(word)) {
            return undefined;
        }

        // Get context around the magic number
        const context = this.getContext(document, position);
        
        // Generate suggestions using the analyzer
        const suggestions = await this.generateSuggestions(word, context);
        
        if (suggestions.length === 0) {
            return undefined;
        }

        // Create hover content with suggestions
        const hoverContent = this.createHoverContent(word, suggestions, context);
        
        return new vscode.Hover(hoverContent, wordRange);
    }

    private isMagicNumber(value: string): boolean {
        const numValue = parseInt(value);
        return /^\d{2,}$/.test(value) && 
               !['10', '100', '1000', '3600', '365', '24', '60', '99', '50', '256', '512'].includes(value) &&
               !/^0+$/.test(value) &&
               numValue > 1; // Exclude 0 and 1
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
        
        // Determine context type based on surrounding code
        let contextType: ConstantContext['type'] = 'unknown';
        let operation = '';
        let functionName = '';
        let variableName = '';
        
        // Check for different context patterns
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

    private createHoverContent(value: string, suggestions: string[], context: ConstantContext): vscode.MarkdownString {
        const markdown = new vscode.MarkdownString();
        markdown.isTrusted = true;
        
        // Header
        markdown.appendMarkdown(`### 💡 Magic Number Detected: \`${value}\`\n\n`);
        
        // Context information
        const contextEmoji = this.getContextEmoji(context.type);
        markdown.appendMarkdown(`${contextEmoji} **Context**: ${this.getContextDescription(context.type)}\n\n`);
        
        // Suggestions
        markdown.appendMarkdown(`**🎯 Suggested constant names:**\n\n`);
        
        suggestions.slice(0, 3).forEach((suggestion, index) => {
            const icon = index === 0 ? '🔥' : '💡';
            const commandUri = vscode.Uri.parse(`command:dependencyVisualizer.createConstantFromHover?${encodeURIComponent(JSON.stringify({
                value,
                suggestion,
                context,
                isPrimary: index === 0
            }))}`);
            
            markdown.appendMarkdown(`${icon} [\`${suggestion}\`](${commandUri}) ${index === 0 ? '*(recommended)*' : ''}\n\n`);
        });
        
        // Additional info
        markdown.appendMarkdown(`---\n\n`);
        markdown.appendMarkdown(`💭 *Click a suggestion to create a constant and replace this magic number*\n\n`);
        markdown.appendMarkdown(`🔍 [View all suggestions](command:dependencyVisualizer.showAllSuggestions?${encodeURIComponent(JSON.stringify({ value, context }))})`);
        
        return markdown;
    }

    private getContextEmoji(contextType: ConstantContext['type']): string {
        const emojiMap: Record<ConstantContext['type'], string> = {
            'loop_condition': '🔄',
            'comparison': '⚖️',
            'array_index': '📊',
            'variable_assignment': '📝',
            'function_argument': '🔧',
            'calculation': '🧮',
            'return_code': '↩️',
            'bitwise': '🔢',
            'time_calc': '⏰',
            'ui_dimension': '📐',
            'buffer_size': '💾',
            'unknown': '❓'
        };
        return emojiMap[contextType] || '❓';
    }

    private getContextDescription(contextType: ConstantContext['type']): string {
        const descriptionMap: Record<ConstantContext['type'], string> = {
            'loop_condition': 'Loop condition',
            'comparison': 'Comparison operation',
            'array_index': 'Array indexing',
            'variable_assignment': 'Variable assignment',
            'function_argument': 'Function argument',
            'calculation': 'Mathematical calculation',
            'return_code': 'Return value',
            'bitwise': 'Bitwise operation',
            'time_calc': 'Time calculation',
            'ui_dimension': 'UI dimension',
            'buffer_size': 'Buffer size',
            'unknown': 'General usage'
        };
        return descriptionMap[contextType] || 'General usage';
    }
}
