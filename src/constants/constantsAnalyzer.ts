// src/constants/constantsAnalyzer.ts
import * as vscode from 'vscode';
import * as path from 'path';

export interface ConstantInfo {
    name: string;
    value: string;
    type: string;
    file: string;
    line: number;
    column: number;
    language: 'java' | 'cpp';
    scope: 'public' | 'private' | 'protected' | 'global';
    category: 'string' | 'numeric' | 'boolean' | 'magic_number' | 'other';
    context: ConstantContext;
    suggestedNames: string[];
    confidence: number;
    isMagicNumber?: boolean; // NEW: Flag for magic numbers
    usageContext?: string; // NEW: Where the magic number is used
}

export interface ConstantContext {
    type: 'variable_assignment' | 'function_argument' | 'calculation' | 'comparison' | 
          'loop_condition' | 'array_index' | 'bitwise' | 'return_code' | 'time_calc' | 
          'ui_dimension' | 'buffer_size' | 'unknown';
    surroundingCode: string;
    variableName?: string;
    functionName?: string;
    operation?: string;
}

export class ConstantsAnalyzer {
    private constants: Map<string, ConstantInfo> = new Map();
    private namingRules: NamingRule[] = [];

    constructor() {
        this.initializeNamingRules();
    }

    async analyzeWorkspace(workspaceFolder: vscode.WorkspaceFolder): Promise<ConstantInfo[]> {
        console.log('🔍 Analyzing constants in workspace...');
        
        this.constants.clear();

        // Find Java files
        const javaFiles = await vscode.workspace.findFiles('**/*.java');
        for (const file of javaFiles) {
            await this.analyzeJavaFile(file);
        }

        // Find C++ files
        const cppFiles = await vscode.workspace.findFiles('**/*.{cpp,cc,cxx,c,h,hpp}');
        for (const file of cppFiles) {
            await this.analyzeCppFile(file);
        }

        console.log(`✅ Found ${this.constants.size} constants`);
        // Detect magic numbers everywhere in the workspace and add to output:
        const magicNumbers = await findMagicNumbersInWorkspace();
        return [...Array.from(this.constants.values()), ...magicNumbers];

    }

    private async analyzeJavaFile(fileUri: vscode.Uri): Promise<void> {
        const document = await vscode.workspace.openTextDocument(fileUri);
        const content = document.getText();
        const lines = content.split('\n');

        // Regex for Java constants (static final)
        const constantRegex = /(?:public|private|protected)?\s*static\s+final\s+(\w+)\s+([A-Z_][A-Z0-9_]*)\s*=\s*([^;]+);/g;
        
        let match;
        while ((match = constantRegex.exec(content)) !== null) {
            const type = match[1];
            const name = match[2];
            const value = match[3].trim();
            
            const position = document.positionAt(match.index);
            const context = this.analyzeContext(content, match.index, lines, position.line);
            const suggestedNames = this.generateNameSuggestions(value, context);
            
            const constantInfo: ConstantInfo = {
                name,
                value,
                type,
                file: fileUri.fsPath,
                line: position.line,
                column: position.character,
                language: 'java',
                scope: this.extractJavaScope(match[0]),
                category: this.categorizeValue(value),
                context,
                suggestedNames: suggestedNames.suggestions,
                confidence: suggestedNames.confidence
            };

            this.constants.set(`${fileUri.fsPath}:${name}`, constantInfo);
        }

        // Also look for interface constants and enum values
        await this.analyzeJavaInterfaceConstants(document, fileUri);
        await this.analyzeJavaEnumConstants(document, fileUri);
    }

    private async analyzeCppFile(fileUri: vscode.Uri): Promise<void> {
        const document = await vscode.workspace.openTextDocument(fileUri);
        const content = document.getText();
        const lines = content.split('\n');

        // Regex for #define macros
        const defineRegex = /#define\s+([A-Z_][A-Z0-9_]*)\s+(.+)/g;
        let match;
        
        while ((match = defineRegex.exec(content)) !== null) {
            const name = match[1];
            const value = match[2].trim();
            
            const position = document.positionAt(match.index);
            const context = this.analyzeContext(content, match.index, lines, position.line);
            const suggestedNames = this.generateNameSuggestions(value, context);
            
            const constantInfo: ConstantInfo = {
                name,
                value,
                type: 'macro',
                file: fileUri.fsPath,
                line: position.line,
                column: position.character,
                language: 'cpp',
                scope: 'global',
                category: this.categorizeValue(value),
                context,
                suggestedNames: suggestedNames.suggestions,
                confidence: suggestedNames.confidence
            };

            this.constants.set(`${fileUri.fsPath}:${name}`, constantInfo);
        }

        // Regex for const variables
        const constRegex = /const\s+(\w+)\s+([A-Z_][A-Z0-9_]*)\s*=\s*([^;]+);/g;
        while ((match = constRegex.exec(content)) !== null) {
            const type = match[1];
            const name = match[2];
            const value = match[3].trim();
            
            const position = document.positionAt(match.index);
            const context = this.analyzeContext(content, match.index, lines, position.line);
            const suggestedNames = this.generateNameSuggestions(value, context);
            
            const constantInfo: ConstantInfo = {
                name,
                value,
                type,
                file: fileUri.fsPath,
                line: position.line,
                column: position.character,
                language: 'cpp',
                scope: this.extractCppScope(content, match.index),
                category: this.categorizeValue(value),
                context,
                suggestedNames: suggestedNames.suggestions,
                confidence: suggestedNames.confidence
            };

            this.constants.set(`${fileUri.fsPath}:${name}`, constantInfo);
        }
    }

    private analyzeContext(content: string, index: number, lines: string[], lineNumber: number): ConstantContext {
        const surroundingStart = Math.max(0, lineNumber - 2);
        const surroundingEnd = Math.min(lines.length - 1, lineNumber + 2);
        const surroundingCode = lines.slice(surroundingStart, surroundingEnd + 1).join('\n');
        
        const currentLine = lines[lineNumber];
        const prevLine = lineNumber > 0 ? lines[lineNumber - 1] : '';
        const nextLine = lineNumber < lines.length - 1 ? lines[lineNumber + 1] : '';
        
        // Analyze context type based on surrounding code
        let contextType: ConstantContext['type'] = 'unknown';
        let variableName: string | undefined;
        let functionName: string | undefined;
        let operation: string | undefined;

        // Check for function arguments
        if (currentLine.includes('(') && currentLine.includes(')')) {
            const funcMatch = currentLine.match(/(\w+)\s*\(/);
            if (funcMatch) {
                functionName = funcMatch[1];
                contextType = 'function_argument';
            }
        }

        // Check for calculations
        if (currentLine.includes('*') || currentLine.includes('/') || currentLine.includes('+') || currentLine.includes('-')) {
            operation = this.extractOperation(currentLine);
            contextType = 'calculation';
        }

        // Check for comparisons
        if (currentLine.includes('>=') || currentLine.includes('<=') || currentLine.includes('==') || currentLine.includes('!=') || currentLine.includes('>') || currentLine.includes('<')) {
            contextType = 'comparison';
        }

        // Check for loop conditions
        if (currentLine.includes('for') || currentLine.includes('while') || prevLine.includes('for') || nextLine.includes('for')) {
            contextType = 'loop_condition';
        }

        // Check for array indexing
        if (currentLine.includes('[') && currentLine.includes(']')) {
            contextType = 'array_index';
        }

        // Check for bitwise operations
        if (currentLine.includes('&') || currentLine.includes('|') || currentLine.includes('^') || currentLine.includes('<<') || currentLine.includes('>>')) {
            contextType = 'bitwise';
        }

        // Check for return codes
        if (currentLine.includes('return') || currentLine.includes('status') || currentLine.includes('error')) {
            contextType = 'return_code';
        }

        // Extract variable name if it's a variable assignment
        const varMatch = currentLine.match(/(\w+)\s*=\s*\d+/);
        if (varMatch) {
            variableName = varMatch[1];
            contextType = 'variable_assignment';
        }

        return {
            type: contextType,
            surroundingCode,
            variableName,
            functionName,
            operation
        };
    }


    
    private generateNameSuggestions(value: string, context: ConstantContext): { suggestions: string[]; confidence: number } {
        const suggestions: string[] = [];
        let confidence = 50; // Base confidence

        // Apply naming rules based on context
        for (const rule of this.namingRules) {
            if (rule.matches(value, context)) {
                suggestions.push(...rule.generateNames(value, context));
                confidence = Math.max(confidence, rule.confidence);
            }
        }

        // Remove duplicates and sort by length (shorter names first)
        const uniqueSuggestions = [...new Set(suggestions)].sort((a, b) => a.length - b.length);
        
        return {
            suggestions: uniqueSuggestions.slice(0, 5), // Limit to top 5 suggestions
            confidence
        };
    }

    private initializeNamingRules(): void {
        this.namingRules = [
            // Variable Assignment Rules
            new NamingRule(
                'variable_assignment',
                (value, context) => context.type === 'variable_assignment',
                (value, context) => {
                    const suggestions = [];
                    if (context.variableName) {
                        if (context.variableName.toLowerCase().includes('connection')) {
                            suggestions.push('MAX_CONNECTIONS', 'CONNECTION_LIMIT');
                        } else if (context.variableName.toLowerCase().includes('timeout')) {
                            suggestions.push('TIMEOUT_DURATION', 'TIMEOUT_MS');
                        } else {
                            suggestions.push(`MAX_${context.variableName.toUpperCase()}`, `${context.variableName.toUpperCase()}_LIMIT`);
                        }
                    }
                    return suggestions;
                },
                80
            ),

            // Function Arguments Rules
            new NamingRule(
                'function_argument',
                (value, context) => context.type === 'function_argument',
                (value, context) => {
                    const suggestions = [];
                    if (context.functionName) {
                        const funcName = context.functionName.toLowerCase();
                        if (funcName.includes('listen') || funcName.includes('port')) {
                            suggestions.push('SERVER_PORT', 'DEFAULT_PORT', 'LISTEN_PORT');
                        } else if (funcName.includes('timeout') || funcName.includes('delay') || funcName.includes('sleep')) {
                            suggestions.push('TIMEOUT_DURATION_MS', 'DELAY_MS', 'SLEEP_DURATION');
                        } else if (funcName.includes('connect')) {
                            suggestions.push('CONNECTION_TIMEOUT', 'CONNECT_DELAY');
                        }
                    }
                    return suggestions;
                },
                85
            ),

            // Calculation Rules
            new NamingRule(
                'calculation',
                (value, context) => context.type === 'calculation',
                (value, context) => {
                    const suggestions = [];
                    const numValue = parseFloat(value);
                    
                    if (numValue > 1 && numValue < 2) {
                        suggestions.push('TAX_RATE_MULTIPLIER', 'INTEREST_RATE', 'FEE_MULTIPLIER');
                    } else if (numValue < 1 && numValue > 0) {
                        suggestions.push('DISCOUNT_FACTOR', 'REDUCTION_RATE', 'PERCENTAGE_FACTOR');
                    } else if (numValue > 10 && numValue < 100) {
                        suggestions.push('SHIPPING_FEE', 'SERVICE_FEE', 'PROCESSING_FEE');
                    }
                    return suggestions;
                },
                75
            ),

            // Time Calculations
            new NamingRule(
                'time_calc',
                (value, context) => {
                    const timeKeywords = ['second', 'minute', 'hour', 'day', 'ms', 'time'];
                    return timeKeywords.some(keyword => 
                        context.surroundingCode.toLowerCase().includes(keyword)
                    );
                },
                (value, context) => {
                    const suggestions = [];
                    const numValue = parseInt(value);
                    
                    if (numValue === 1000) {
                        suggestions.push('MILLISECONDS_PER_SECOND', 'MS_PER_SECOND');
                    } else if (numValue === 60) {
                        suggestions.push('SECONDS_PER_MINUTE', 'MINUTES_PER_HOUR');
                    } else if (numValue === 3600) {
                        suggestions.push('SECONDS_PER_HOUR');
                    } else if (numValue === 86400) {
                        suggestions.push('SECONDS_PER_DAY');
                    }
                    return suggestions;
                },
                90
            ),

            // Buffer Sizes
            new NamingRule(
                'buffer_size',
                (value, context) => {
                    const bufferKeywords = ['buffer', 'size', 'length', 'capacity'];
                    return bufferKeywords.some(keyword => 
                        context.surroundingCode.toLowerCase().includes(keyword)
                    );
                },
                (value, context) => {
                    const suggestions = [];
                    const numValue = parseInt(value);
                    
                    if (numValue === 1024 || numValue === 2048 || numValue === 4096) {
                        suggestions.push('DEFAULT_BUFFER_SIZE', 'BUFFER_CAPACITY', 'READ_BUFFER_SIZE');
                    } else {
                        suggestions.push('BUFFER_SIZE', 'MAX_BUFFER_SIZE');
                    }
                    return suggestions;
                },
                85
            ),

            // Default rule for numeric values
            new NamingRule(
                'default_numeric',
                (value, context) => /^\d+$/.test(value),
                (value, context) => {
                    const suggestions = [];
                    const numValue = parseInt(value);
                    
                    if (numValue > 0 && numValue < 10) {
                        suggestions.push('MAX_RETRIES', 'RETRY_COUNT', 'MAX_ATTEMPTS');
                    } else if (numValue >= 100 && numValue < 1000) {
                        suggestions.push('MAX_LENGTH', 'SIZE_LIMIT', 'COUNT_LIMIT');
                    }
                    return suggestions;
                },
                40
            )
        ];
    }

    // Helper methods
    private extractOperation(line: string): string {
        if (line.includes('*')) return 'multiplication';
        if (line.includes('/')) return 'division';
        if (line.includes('+')) return 'addition';
        if (line.includes('-')) return 'subtraction';
        return 'unknown';
    }

    private extractJavaScope(declaration: string): 'public' | 'private' | 'protected' {
        if (declaration.includes('public')) return 'public';
        if (declaration.includes('private')) return 'private';
        if (declaration.includes('protected')) return 'protected';
        return 'public'; // default for interface constants
    }

    private extractCppScope(content: string, index: number): 'public' | 'private' | 'global' {
        const beforeDeclaration = content.substring(0, index);
        const lines = beforeDeclaration.split('\n').reverse();
        
        for (const line of lines) {
            if (line.includes('public:')) return 'public';
            if (line.includes('private:')) return 'private';
            if (line.includes('class ') || line.includes('struct ')) break;
        }
        
        return 'global';
    }

    private categorizeValue(value: string): 'string' | 'numeric' | 'boolean' | 'other' {
        if (/^".*"$/.test(value) || /^'.*'$/.test(value)) return 'string';
        if (/^-?\d+(\.\d+)?[fFdD]?$/.test(value)) return 'numeric';
        if (/^(true|false)$/.test(value)) return 'boolean';
        return 'other';
    }

    private async analyzeJavaInterfaceConstants(document: vscode.TextDocument, fileUri: vscode.Uri): Promise<void> {
        // Implementation for interface constants
    }

    private async analyzeJavaEnumConstants(document: vscode.TextDocument, fileUri: vscode.Uri): Promise<void> {
        // Implementation for enum constants
    }

    getConstants(): ConstantInfo[] {
        return Array.from(this.constants.values());
    }


    

    
}

class NamingRule {
    constructor(
        public id: string,
        public matches: (value: string, context: ConstantContext) => boolean,
        public generateNames: (value: string, context: ConstantContext) => string[],
        public confidence: number
    ) {}
}


/**
 * Scan a workspace for magic numbers.
 * A magic number is any integer or float literal (not 0/1/2/10/100/1000 etc) outside of obvious constant/define lines.
 * It populates the returned array with objects that follow the same shape as your normal constants, but with category: 'magic_number'.
 */
async function findMagicNumbersInWorkspace(): Promise<any[]> {
    const allMagicNumbers: any[] = [];
    // Adjust the glob for your languages
    const files = await vscode.workspace.findFiles('**/*.{cpp,c,h,hpp,java,cs,js,ts}');
    for (const file of files) {
        const doc = await vscode.workspace.openTextDocument(file);
        const lines = doc.getText().split('\n');
        for (let lineNumber = 0; lineNumber < lines.length; lineNumber++) {
            const line = lines[lineNumber];
            // Skip comments and declarations
            if (line.trim().startsWith('//') || line.trim().startsWith('*')) continue;
            if (/(const|#define|final|constexpr|static const)\b/i.test(line)) continue;

            // Ignore numbers inside strings (basic version)
            let cleaned = line.replace(/(["'`]).*?\1/g, '');

            // INT magic numbers >= 2 digits, not obvious enums, not array init's like int arr[10]
            for (const m of cleaned.matchAll(/\b-?\d{2,}\b/g)) {
                const value = m[0];
                if (/^0+$/.test(value)) continue; // all zeros
                if (["10","100","1000","3600","365","24","60","99","50","256","512"].includes(value)) continue; // common
                allMagicNumbers.push({
                    name: `MAGIC_${value}`,
                    value,
                    type: /^\d+$/.test(value) ? 'int' : 'unknown',
                    file: file.fsPath,
                    line: lineNumber,
                    column: m.index,
                    language: guessLangFromExt(file.fsPath),
                    category: 'magic_number',
                    suggestedNames: [], // (optional: run suggestions here if you have it)
                });
            }
            // FLOATS: 1+ digits, dot, 1+ digits
            for (const m of cleaned.matchAll(/\b-?\d+\.\d+\b/g)) {
                const value = m[0];
                allMagicNumbers.push({
                    name: `MAGIC_${value.replace('.','_')}`,
                    value,
                    type: 'float',
                    file: file.fsPath,
                    line: lineNumber,
                    column: m.index,
                    language: guessLangFromExt(file.fsPath),
                    category: 'magic_number',
                    suggestedNames: [],
                });
            }
        }
    }
    return allMagicNumbers;
}

function guessLangFromExt(path: string): string {
    if (path.endsWith('.java')) return 'java';
    if (path.endsWith('.cpp') || path.endsWith('.cc') || path.endsWith('.cxx')) return 'cpp';
    if (path.endsWith('.c') || path.endsWith('.h')) return 'c';
    if (path.endsWith('.ts')) return 'ts';
    if (path.endsWith('.js')) return 'js';
    return 'unknown';
}
