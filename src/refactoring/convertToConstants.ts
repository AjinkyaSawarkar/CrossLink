import * as vscode from 'vscode';

// --- TYPE DEFINITIONS for clarity ---
type LanguageId = 'java' | 'cpp';
type ConstantDataType = 'int' | 'double' | 'long' | 'float';

interface ConstantLocation {
  line: number;
  text: string;
}

interface ConstantUsageInfo {
  locations: ConstantLocation[];
  uri: vscode.Uri;
  linesInserted: number;
}

// --- MODULE-LEVEL STATE for the Hover Provider ---
// This map stores information about constants created during a session.
const generatedConstantsInfo: Map<string, ConstantUsageInfo> = new Map();

// --- HELPER FUNCTIONS for refactoring logic ---

function toSnakeCase(str: string): string {
  if (!str) return '';
  return str
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1_$2')
    .replace(/([a-z\d])([A-Z])/g, '$1_$2')
    .replace(/[-\s]/g, '_')
    .toUpperCase();
}

function inferDataType(numberStr: string): ConstantDataType {
    if (!numberStr.includes('.')) {
        const num = parseInt(numberStr, 10);
        // Assuming long for large integers, which is safe in both Java and C++
        if (num > 2147483647 || num < -2147483648) {
            return 'long';
        }
        return 'int';
    } else {
        // float is often sufficient, but double is safer for precision.
        if (numberStr.endsWith('f') || numberStr.endsWith('F')) {
            return 'float';
        }
        return 'double';
    }
}

function suggestConstantName(contextText: string, number: string): string {
  const numValue = parseFloat(number);
  
  // Rule: Function/Method Argument
  let match = contextText.match(/([a-zA-Z0-9_]+)\s*\(([^)]*)\)/);
  if (match && match[2].includes(number)) {
    const functionName = match[1].toLowerCase();
    if (functionName.includes('listen') || functionName.includes('port')) return 'SERVER_PORT';
    if (functionName.includes('timeout')) return 'TIMEOUT_DURATION_MS';
    if (functionName.includes('delay') || functionName.includes('sleep')) return 'DELAY_MS';
  }

  // Rule: Calculation
  if (contextText.includes('*')) {
    if (numValue > 1) return 'TAX_RATE_MULTIPLIER';
    if (numValue < 1 && numValue > 0) return 'DISCOUNT_FACTOR';
  }

  // Rule: Comparison
  match = contextText.match(/([a-zA-Z0-9_.]+)\s*(?:>|<|>=|<=|==|!=)/);
  if (match && match[1]) {
    const varName = match[1].toLowerCase();
    if (varName.includes('count') || varName.includes('retries')) return 'MAX_RETRIES';
    if (varName.includes('length')) return 'MAX_LENGTH';
    return `${toSnakeCase(varName)}_THRESHOLD`;
  }

  return 'NEW_CONSTANT';
}


// --- MAIN CLASS ---

export class ConstantExtractor {
    /**
     * Checks if the current selection is a number that can be extracted.
     */
    public async canApply(context: { document: vscode.TextDocument, selection: vscode.Selection }): Promise<boolean> {
        const selectionText = context.document.getText(context.selection);
        if (!selectionText.trim()) {
            return false;
        }
        return /^\d+(\.\d+)?f?$/.test(selectionText.trim());
    }

    /**
     * Applies the refactoring: finds all occurrences of the selected number,
     * prompts for a name, and replaces them.
     */
    public async apply(context: { document: vscode.TextDocument, selection: vscode.Selection }): Promise<vscode.WorkspaceEdit> {
        const edit = new vscode.WorkspaceEdit();
        const document = context.document;
        const languageId = document.languageId as LanguageId;
        
        const selectedNumber = document.getText(context.selection);

        // Find all occurrences of this number in the document.
        const text = document.getText();
        const numberRegex = new RegExp(`(?<![a-zA-Z0-9_\\.])\\b${selectedNumber}\\b(?![a-zA-Z0-9_\\.])`, 'g');
        const occurrences: vscode.Range[] = [];
        let match;
        while ((match = numberRegex.exec(text)) !== null) {
            const startPos = document.positionAt(match.index);
            const endPos = document.positionAt(match.index + match[0].length);
            occurrences.push(new vscode.Range(startPos, endPos));
        }

        if (occurrences.length === 0) {
            vscode.window.showInformationMessage("Could not find any occurrences of the selected number.");
            return edit;
        }

        // Suggest a name based on the context of the first occurrence.
        const firstOccurrenceLine = document.lineAt(occurrences[0].start.line).text;
        const suggestedName = suggestConstantName(firstOccurrenceLine, selectedNumber);
        
        const constantName = await vscode.window.showInputBox({
            prompt: `Enter a name for the constant "${selectedNumber}"`,
            value: suggestedName,
            validateInput: (text) => /^[A-Z_][A-Z0-9_]*$/.test(text) ? null : 'Invalid constant name (must be UPPER_SNAKE_CASE)',
        });

        if (!constantName) {
            return edit; // User cancelled
        }

        // 1. Replace all occurrences with the new constant name.
        occurrences.forEach(range => {
            edit.replace(document.uri, range, constantName);
        });

        // 2. Add the constant declaration at the top of the file.
        const constantType = inferDataType(selectedNumber);
        let declaration = '';
        if (languageId === 'java') {
            // A simple heuristic to place it inside the class body
            const classRegex = /public\s+class\s+\w+/;
            const match = text.match(classRegex);
            let insertPosition = new vscode.Position(0, 0);
            if (match && match.index !== undefined) {
                const line = document.positionAt(match.index).line + 1;
                declaration = `    public static final ${constantType} ${constantName} = ${selectedNumber};\n`;
                insertPosition = new vscode.Position(line, 0);
            }
            edit.insert(document.uri, insertPosition, declaration);
        } else { // cpp
            declaration = `const ${constantType} ${constantName} = ${selectedNumber};\n`;
            edit.insert(document.uri, new vscode.Position(0, 0), declaration);
        }

        // Store usage info for the hover provider
        const usageLocations = occurrences.map(occ => ({
            line: occ.start.line,
            text: document.lineAt(occ.start.line).text.trim(),
        }));
        generatedConstantsInfo.set(constantName, {
            locations: usageLocations,
            uri: document.uri,
            linesInserted: 1
        });
        
        return edit;
    }
}

/**
 * Registers the hover provider to show where constants are used.
 * This should be called from the main `activate` function.
 * @param context The extension context.
 */
export function registerConstantHoverProvider(context: vscode.ExtensionContext) {
    const hoverProvider = vscode.languages.registerHoverProvider(['java', 'cpp'], {
        provideHover(document, position) {
            const range = document.getWordRangeAtPosition(position);
            if (!range) return null;

            const word = document.getText(range);
            const info = generatedConstantsInfo.get(word);

            if (info) {
                const hoverContent = new vscode.MarkdownString();
                hoverContent.isTrusted = true;
                hoverContent.appendMarkdown(`**\`${word}\` is used on the following lines:**\n\n`);
                const usageLinks = info.locations.map(loc => {
                    const finalLine = loc.line + info.linesInserted + 1;
                    return `* [Line ${finalLine}: \`${loc.text}\`](command:vscode.open?${encodeURIComponent(JSON.stringify([info.uri, { selection: new vscode.Range(finalLine-1, 0, finalLine-1, 0) }]))})`;
                }).join('\n');
                hoverContent.appendMarkdown(usageLinks);
                return new vscode.Hover(hoverContent, range);
            }

            return null;
        }
    });

    context.subscriptions.push(hoverProvider);
}
