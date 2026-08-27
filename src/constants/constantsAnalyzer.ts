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
    language: 'java' | 'cpp' | 'c';
    scope: 'public' | 'private' | 'protected' | 'global';
    category: 'string' | 'numeric' | 'boolean' | 'magic_number' | 'other';
    context: ConstantContext;
    suggestedNames: string[];
    confidence: number;
    isMagicNumber?: boolean;
    usageContext?: string;
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

interface NamingRule {
    id: string;
    matches: (value: string, context: ConstantContext) => boolean;
    generateNames: (value: string, context: ConstantContext) => string[];
    confidence: number;
}

export class ConstantsAnalyzer {
    private constants: Map<string, ConstantInfo> = new Map();
    private namingRules: NamingRule[] = [];
    private cache: Map<string, { constants: ConstantInfo[]; mtime: number }> = new Map();

    constructor() {
        this.initializeNamingRules();
    }

    /**
     * Analyzes constants and magic numbers in the given workspace folder.
     * Uses caching based on file modification times.
     */
    async analyzeWorkspace(workspaceFolder: vscode.WorkspaceFolder): Promise<ConstantInfo[]> {
        console.log('🔍 Analyzing constants in workspace...');

        const workspacePath = workspaceFolder.uri.fsPath;
        const cacheKey = workspacePath;
        const cached = this.cache.get(cacheKey);

        // Simple cache invalidation: re-analyze if older than 5 minutes
        const now = Date.now();
        if (cached && now - cached.mtime < 5 * 60 * 1000) {
            console.log('✅ Using cached constants');
            return cached.constants;
        }

        this.constants.clear();

        await vscode.window.withProgress(
            {
                location: vscode.ProgressLocation.Window,
                title: 'Analyzing constants...',
                cancellable: false
            },
            async (progress) => {
                progress.report({ increment: 0 });

                // Find Java files
                const javaFiles = await vscode.workspace.findFiles(
                    new vscode.RelativePattern(workspaceFolder, '**/*.java'),
                    '**/{build,dist,node_modules,vendor,.git}/**'
                );
                progress.report({ increment: 20 });

                for (const file of javaFiles) {
                    await this.analyzeJavaFile(file);
                }
                progress.report({ increment: 40 });

                // Find C/C++ files
                const cppFiles = await vscode.workspace.findFiles(
                    new vscode.RelativePattern(workspaceFolder, '**/*.{cpp,cc,cxx,c,h,hpp}'),
                    '**/{build,dist,node_modules,vendor,.git}/**'
                );
                progress.report({ increment: 60 });

                for (const file of cppFiles) {
                    await this.analyzeCppFile(file);
                }
                progress.report({ increment: 80 });

                // Detect magic numbers
                const magicNumbers = await findMagicNumbersInWorkspace(workspaceFolder);
                progress.report({ increment: 95 });

                // Mark magic numbers explicitly
                for (const magic of magicNumbers) {
                    magic.isMagicNumber = true;
                    this.constants.set(`${magic.file}:${magic.name}:${magic.line}`, magic);
                }
                progress.report({ increment: 100 });
            }
        );

        console.log(`✅ Found ${this.constants.size} constants`);
        const result = Array.from(this.constants.values());

        // Update cache
        this.cache.set(cacheKey, {
            constants: result,
            mtime: Date.now()
        });

        return result;
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

        // Analyze interface constants and enum values
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
                language: fileUri.fsPath.endsWith('.h') || fileUri.fsPath.endsWith('.hpp') ? 'cpp' : 'c',
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
                language: fileUri.fsPath.endsWith('.h') || fileUri.fsPath.endsWith('.hpp') ? 'cpp' : 'c',
                scope: this.extractCppScope(content, match.index),
                category: this.categorizeValue(value),
                context,
                suggestedNames: suggestedNames.suggestions,
                confidence: suggestedNames.confidence
            };

            this.constants.set(`${fileUri.fsPath}:${name}`, constantInfo);
        }
    }

    /**
     * Improved context analysis using a scoring approach to handle multiple patterns.
     */
    private analyzeContext(content: string, index: number, lines: string[], lineNumber: number): ConstantContext {
        const surroundingStart = Math.max(0, lineNumber - 2);
        const surroundingEnd = Math.min(lines.length - 1, lineNumber + 2);
        const surroundingCode = lines.slice(surroundingStart, surroundingEnd + 1).join('\n');

        const currentLine = lines[lineNumber];
        const prevLine = lineNumber > 0 ? lines[lineNumber - 1] : '';
        const nextLine = lineNumber < lines.length - 1 ? lines[lineNumber + 1] : '';

        // Scoring-based context classification
        const scores: Record<ConstantContext['type'], number> = {
            variable_assignment: 0,
            function_argument: 0,
            calculation: 0,
            comparison: 0,
            loop_condition: 0,
            array_index: 0,
            bitwise: 0,
            return_code: 0,
            time_calc: 0,
            ui_dimension: 0,
            buffer_size: 0,
            unknown: 0
        };

        let variableName: string | undefined;
        let functionName: string | undefined;
        let operation: string | undefined;

        // Function arguments
        if (currentLine.includes('(') && currentLine.includes(')')) {
            const funcMatch = currentLine.match(/(\w+)\s*\(/);
            if (funcMatch) {
                functionName = funcMatch[1];
                scores.function_argument += 2;
            }
        }

        // Calculations
        if (currentLine.includes('*') || currentLine.includes('/') || currentLine.includes('+') || currentLine.includes('-')) {
            operation = this.extractOperation(currentLine);
            scores.calculation += 2;
        }

        // Comparisons
        if (currentLine.includes('>=') || currentLine.includes('<=') || currentLine.includes('==') || currentLine.includes('!=') || currentLine.includes('>') || currentLine.includes('<')) {
            scores.comparison += 3;
        }

        // Loop conditions
        if (currentLine.includes('for') || currentLine.includes('while') || prevLine.includes('for') || nextLine.includes('for')) {
            scores.loop_condition += 3;
        }

        // Array indexing
        if (currentLine.includes('[') && currentLine.includes(']')) {
            scores.array_index += 2;
        }

        // Bitwise operations
        if (currentLine.includes('&') || currentLine.includes('|') || currentLine.includes('^') || currentLine.includes('<<') || currentLine.includes('>>')) {
            scores.bitwise += 2;
        }

        // Return codes
        if (currentLine.includes('return') || currentLine.includes('status') || currentLine.includes('error')) {
            scores.return_code += 2;
        }

        // Variable assignment
        const varMatch = currentLine.match(/(\w+)\s*=\s*\d+/);
        if (varMatch) {
            variableName = varMatch[1];
            scores.variable_assignment += 3;
        }

        // Time-related context
        const lowerCode = surroundingCode.toLowerCase();
        if (/(ms|millisecond|second|minute|hour|day|time|delay|sleep|wait)/i.test(lowerCode)) {
            scores.time_calc += 4;
        }

        // UI-related context
        if (/(width|height|pixel|px|margin|padding|border|font)/i.test(lowerCode)) {
            scores.ui_dimension += 4;
        }

        // Buffer-related context
        if (/(buffer|size|length|capacity|bytes|kb|mb)/i.test(lowerCode)) {
            scores.buffer_size += 4;
        }

        // Choose type with highest score
        let contextType: ConstantContext['type'] = 'unknown';
        let maxScore = 0;
        for (const [type, score] of Object.entries(scores)) {
            if (score > maxScore) {
                maxScore = score;
                contextType = type as ConstantContext['type'];
            }
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
        let confidence = 50;

        for (const rule of this.namingRules) {
            if (rule.matches(value, context)) {
                suggestions.push(...rule.generateNames(value, context));
                confidence = Math.max(confidence, rule.confidence);
            }
        }

        if (/^-?\d+(?:\.\d+)?$/.test(value)) {
            const num = parseFloat(value);
            const lowerCode = context.surroundingCode.toLowerCase();
            const varHint = (context.variableName || context.functionName || '').toUpperCase();
            const add = (...arr: string[]) => arr.forEach(s => suggestions.push(toConstCase(s)));

            if (/(ms|millisecond)/i.test(lowerCode)) add(varHint ? `${varHint}_MS` : 'TIMEOUT_MS', 'DURATION_MS');
            if (/(sec|second)/i.test(lowerCode)) add(varHint ? `${varHint}_SECONDS` : 'SECONDS');
            if (/(kb|kilobyte)/i.test(lowerCode)) add('KILOBYTES');
            if (/(mb|megabyte)/i.test(lowerCode)) add('MEGABYTES');
            if (/(px|pixel)/i.test(lowerCode)) add(varHint ? `${varHint}_PX` : 'PIXELS');

            const isInt = Number.isInteger(num);
            if (isInt && num > 0 && (num & (num - 1)) === 0) {
                add('BUFFER_SIZE', 'CAPACITY', 'PAGE_SIZE');
            }

            if (num < 0) add('NEGATIVE_VALUE', 'SENTINEL_VALUE');
            if (num === 0) add('ZERO_VALUE');
            if (num === 1) add('ONE_VALUE');

            if (varHint) {
                add(`${varHint}_VALUE`, `${varHint}_LIMIT`, `${varHint}_COUNT`);
            }
        }

        const uniqueSuggestions = [...new Set(suggestions)].filter(Boolean).sort((a, b) => a.length - b.length);

        return {
            suggestions: uniqueSuggestions.slice(0, 5),
            confidence
        };
    }

    private initializeNamingRules(): void {
        this.namingRules = [
            new NamingRuleImpl(
                'magic_number',
                (value, context) => {
                    const numValue = parseInt(value);
                    return /^\d{2,}$/.test(value) &&
                        !['10', '100', '1000', '3600', '365', '24', '60', '99', '50', '256', '512'].includes(value) &&
                        !/^0+$/.test(value);
                },
                (value, context) => {
                    const suggestions = [];
                    const numValue = parseInt(value);

                    if (numValue >= 1000 && numValue <= 9999) {
                        suggestions.push('DEFAULT_TIMEOUT_MS', 'MAX_BUFFER_SIZE', 'DEFAULT_PORT');
                    } else if (numValue >= 100 && numValue <= 999) {
                        suggestions.push('MAX_RETRIES', 'DEFAULT_SIZE', 'MAX_LENGTH');
                    } else if (numValue >= 10 && numValue <= 99) {
                        suggestions.push('MAX_ATTEMPTS', 'RETRY_COUNT', 'DEFAULT_COUNT');
                    }

                    if (context.type === 'comparison') {
                        suggestions.push('THRESHOLD_VALUE', 'LIMIT_VALUE', 'MAX_VALUE');
                    } else if (context.type === 'loop_condition') {
                        suggestions.push('MAX_ITERATIONS', 'LOOP_LIMIT', 'ITERATION_COUNT');
                    } else if (context.type === 'array_index') {
                        suggestions.push('ARRAY_SIZE', 'INDEX_LIMIT', 'MAX_INDEX');
                    }

                    return suggestions;
                },
                95
            ),
            new NamingRuleImpl(
                'time_constants',
                (value, context) => {
                    const timeKeywords = ['second', 'minute', 'hour', 'day', 'ms', 'time', 'delay', 'sleep', 'wait'];
                    return timeKeywords.some(keyword => context.surroundingCode.toLowerCase().includes(keyword));
                },
                (value, context) => {
                    const suggestions = [];
                    const numValue = parseInt(value);

                    if (numValue === 1000) {
                        suggestions.push('MILLISECONDS_PER_SECOND', 'MS_PER_SECOND', 'DEFAULT_TIMEOUT_MS');
                    } else if (numValue === 60) {
                        suggestions.push('SECONDS_PER_MINUTE', 'MINUTES_PER_HOUR', 'DEFAULT_DELAY_SECONDS');
                    } else if (numValue === 3600) {
                        suggestions.push('SECONDS_PER_HOUR', 'HOUR_IN_SECONDS', 'DEFAULT_TIMEOUT_SECONDS');
                    } else if (numValue === 86400) {
                        suggestions.push('SECONDS_PER_DAY', 'DAY_IN_SECONDS', 'MAX_TIMEOUT_SECONDS');
                    } else if (numValue === 5000) {
                        suggestions.push('DEFAULT_TIMEOUT_MS', 'CONNECTION_TIMEOUT_MS', 'READ_TIMEOUT_MS');
                    } else if (numValue === 30000) {
                        suggestions.push('LONG_TIMEOUT_MS', 'SESSION_TIMEOUT_MS', 'IDLE_TIMEOUT_MS');
                    }

                    return suggestions;
                },
                90
            ),
            new NamingRuleImpl(
                'buffer_size',
                (value, context) => {
                    const bufferKeywords = ['buffer', 'size', 'length', 'capacity', 'bytes', 'kb', 'mb'];
                    return bufferKeywords.some(keyword => context.surroundingCode.toLowerCase().includes(keyword));
                },
                (value, context) => {
                    const suggestions = [];
                    const numValue = parseInt(value);

                    if (numValue === 1024) {
                        suggestions.push('DEFAULT_BUFFER_SIZE', 'BUFFER_CAPACITY', 'READ_BUFFER_SIZE', 'KILOBYTE_SIZE');
                    } else if (numValue === 2048) {
                        suggestions.push('LARGE_BUFFER_SIZE', 'WRITE_BUFFER_SIZE', 'DOUBLE_KILOBYTE_SIZE');
                    } else if (numValue === 4096) {
                        suggestions.push('PAGE_SIZE', 'MAX_BUFFER_SIZE', 'QUAD_KILOBYTE_SIZE');
                    } else if (numValue === 8192) {
                        suggestions.push('LARGE_PAGE_SIZE', 'EXTENDED_BUFFER_SIZE', 'EIGHT_KILOBYTE_SIZE');
                    } else if (numValue === 65536) {
                        suggestions.push('MAX_BUFFER_SIZE', 'LARGE_CHUNK_SIZE', 'SIXTY_FOUR_KILOBYTE_SIZE');
                    }

                    return suggestions;
                },
                85
            ),
            new NamingRuleImpl(
                'network_constants',
                (value, context) => {
                    const networkKeywords = ['port', 'connection', 'socket', 'http', 'tcp', 'udp', 'server', 'client'];
                    return networkKeywords.some(keyword => context.surroundingCode.toLowerCase().includes(keyword));
                },
                (value, context) => {
                    const suggestions = [];
                    const numValue = parseInt(value);

                    if (numValue === 80) {
                        suggestions.push('HTTP_PORT', 'DEFAULT_HTTP_PORT', 'WEB_PORT');
                    } else if (numValue === 443) {
                        suggestions.push('HTTPS_PORT', 'SECURE_HTTP_PORT', 'SSL_PORT');
                    } else if (numValue === 8080) {
                        suggestions.push('ALTERNATIVE_HTTP_PORT', 'DEV_PORT', 'PROXY_PORT');
                    } else if (numValue === 3000) {
                        suggestions.push('DEV_SERVER_PORT', 'NODE_PORT', 'APPLICATION_PORT');
                    } else if (numValue === 5432) {
                        suggestions.push('POSTGRES_PORT', 'DATABASE_PORT', 'DB_PORT');
                    } else if (numValue === 3306) {
                        suggestions.push('MYSQL_PORT', 'DATABASE_PORT', 'DB_PORT');
                    } else if (numValue === 27017) {
                        suggestions.push('MONGO_PORT', 'MONGODB_PORT', 'NOSQL_PORT');
                    }

                    if (numValue >= 100 && numValue <= 1000) {
                        suggestions.push('MAX_CONNECTIONS', 'CONNECTION_POOL_SIZE', 'DEFAULT_CONNECTION_LIMIT');
                    }

                    return suggestions;
                },
                88
            ),
            new NamingRuleImpl(
                'default_numeric',
                (value, context) => /^\d+$/.test(value),
                (value, context) => {
                    const suggestions = [];
                    const numValue = parseInt(value);

                    if (numValue > 0 && numValue < 10) {
                        suggestions.push('MAX_RETRIES', 'RETRY_COUNT', 'MAX_ATTEMPTS', 'DEFAULT_COUNT');
                    } else if (numValue >= 10 && numValue < 100) {
                        suggestions.push('DEFAULT_SIZE', 'STANDARD_COUNT', 'NORMAL_LIMIT');
                    } else if (numValue >= 100 && numValue < 1000) {
                        suggestions.push('MAX_LENGTH', 'SIZE_LIMIT', 'COUNT_LIMIT', 'DEFAULT_LIMIT');
                    } else if (numValue >= 1000) {
                        suggestions.push('LARGE_SIZE', 'MAX_CAPACITY', 'UPPER_LIMIT', 'MAX_VALUE');
                    }

                    return suggestions;
                },
                40
            )
        ];
    }

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
        return 'public';
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
        const content = document.getText();
        const lines = content.split('\n');

        // Interface constants: public static final is implicit
        const interfaceConstantRegex = /^\s*(?:public\s+)?(?:static\s+)?(?:final\s+)?(\w+)\s+([A-Z_][A-Z0-9_]*)\s*=\s*([^;]+);/gm;
        let match;

        while ((match = interfaceConstantRegex.exec(content)) !== null) {
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
                scope: 'public',
                category: this.categorizeValue(value),
                context,
                suggestedNames: suggestedNames.suggestions,
                confidence: suggestedNames.confidence
            };

            this.constants.set(`${fileUri.fsPath}:${name}`, constantInfo);
        }
    }

    private async analyzeJavaEnumConstants(document: vscode.TextDocument, fileUri: vscode.Uri): Promise<void> {
        const content = document.getText();
        const lines = content.split('\n');

        // Enum constants: ENUM_VALUE or ENUM_VALUE("text")
        const enumConstantRegex = /^\s*([A-Z_][A-Z0-9_]*)(?:\s*\([^)]*\))?;/gm;
        let match;

        while ((match = enumConstantRegex.exec(content)) !== null) {
            const name = match[1];
            const value = name; // Enum name is the value

            const position = document.positionAt(match.index);
            const context = this.analyzeContext(content, match.index, lines, position.line);

            const constantInfo: ConstantInfo = {
                name,
                value,
                type: 'enum',
                file: fileUri.fsPath,
                line: position.line,
                column: position.character,
                language: 'java',
                scope: 'public',
                category: 'other',
                context,
                suggestedNames: [],
                confidence: 50
            };

            this.constants.set(`${fileUri.fsPath}:${name}`, constantInfo);
        }
    }

    getConstants(): ConstantInfo[] {
        return Array.from(this.constants.values());
    }

    /**
     * Clears the cache for a specific workspace or all workspaces.
     */
    clearCache(workspacePath?: string): void {
        if (workspacePath) {
            this.cache.delete(workspacePath);
        } else {
            this.cache.clear();
        }
    }
}

class NamingRuleImpl implements NamingRule {
    constructor(
        public id: string,
        public matches: (value: string, context: ConstantContext) => boolean,
        public generateNames: (value: string, context: ConstantContext) => string[],
        public confidence: number
    ) { }
}

function toConstCase(text: string): string {
    if (!text) return '';
    return text
        .replace(/([a-z])([A-Z])/g, '$1_$2')
        .replace(/[^A-Za-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '')
        .toUpperCase();
}

/**
 * Scan workspace for magic numbers with duplicate prevention.
 */
async function findMagicNumbersInWorkspace(workspaceFolder: vscode.WorkspaceFolder): Promise<ConstantInfo[]> {
    const allMagicNumbers: ConstantInfo[] = [];
    const seen = new Set<string>();

    const files = await vscode.workspace.findFiles(
        new vscode.RelativePattern(workspaceFolder, '**/*.{cpp,c,h,hpp,java}'),
        '**/{build,dist,node_modules,vendor,.git}/**'
    );

    for (const file of files) {
        const doc = await vscode.workspace.openTextDocument(file);
        const lines = doc.getText().split('\n');
        const language = guessLangFromExt(file.fsPath);

        for (let lineNumber = 0; lineNumber < lines.length; lineNumber++) {
            const line = lines[lineNumber];
            const trimmedLine = line.trim();

            // Skip comments
            if (trimmedLine.startsWith('//') || trimmedLine.startsWith('*') || trimmedLine.startsWith('/*')) continue;

            // Ignore numbers inside strings
            let cleaned = line.replace(/([\"'`]).*?\1/g, '');

            // === PATTERN 1: Variable assignments ===
            const assignmentMatch = cleaned.match(/(?:(?:int|long|short|float|double|byte)\s+)?(\w+)\s*=\s*(\d+)/);

            if (assignmentMatch) {
                const varName = assignmentMatch[1];
                const value = assignmentMatch[2];
                const numValue = parseInt(value);
                const key = `${file.fsPath}:${lineNumber}:${assignmentMatch.index}:${value}`;

                if (!/^[A-Z_][A-Z0-9_]*$/.test(varName) && numValue > 1 && !seen.has(key)) {
                    seen.add(key);
                    const suggestions = generateValueBasedSuggestions(varName, value, numValue);

                    if (suggestions.length > 0) {
                        allMagicNumbers.push({
                            name: varName,
                            value,
                            type: 'int',
                            file: file.fsPath,
                            line: lineNumber,
                            column: assignmentMatch.index || 0,
                            language: language as any,
                            category: 'magic_number',
                            context: {
                                type: 'variable_assignment',
                                surroundingCode: cleaned,
                                variableName: varName
                            },
                            suggestedNames: suggestions,
                            confidence: 85,
                            usageContext: `Variable "${varName}" = ${value}`
                        });
                    }
                }
            }

            // === PATTERN 2: Comparisons ===
            const isComparison = /\b(if|else\s*if|while|for)\s*\(/.test(cleaned);
            if (isComparison) {
                const comparisonMatches = cleaned.matchAll(/(?:<=|>=|<|>|==|!=)\s*(\d+)/g);

                for (const m of comparisonMatches) {
                    const value = m[1];
                    const numValue = parseInt(value);
                    const key = `${file.fsPath}:${lineNumber}:${m.index}:${value}`;

                    if (numValue <= 1) continue;
                    if (['10', '100', '1000'].includes(value)) continue;
                    if (seen.has(key)) continue;
                    seen.add(key);

                    const suggestions = generateValueBasedSuggestions('MAGIC', value, numValue);

                    if (suggestions.length > 0) {
                        allMagicNumbers.push({
                            name: `MagicNumber_${value}`,
                            value,
                            type: 'int',
                            file: file.fsPath,
                            line: lineNumber,
                            column: m.index || 0,
                            language: language as any,
                            category: 'magic_number',
                            context: {
                                type: 'comparison',
                                surroundingCode: cleaned
                            },
                            suggestedNames: suggestions,
                            confidence: 80,
                            usageContext: `Comparison with ${value}`
                        });
                    }
                }
            }

            // === PATTERN 3: Arithmetic operations ===
            const arithmeticMatches = cleaned.matchAll(/(\w+)\s*([*\/+\-])\s*(\d+\.?\d*)/g);

            for (const m of arithmeticMatches) {
                const varName = m[1];
                const operator = m[2];
                const value = m[3];
                const numValue = parseFloat(value);
                const key = `${file.fsPath}:${lineNumber}:${m.index}:${value}`;

                if (numValue <= 1 && operator !== '*' && operator !== '/') continue;
                if (/^[A-Z_][A-Z0-9_]*$/.test(varName)) continue;
                if (seen.has(key)) continue;
                seen.add(key);

                const suggestions = generateArithmeticSuggestions(varName, value, numValue, operator);

                if (suggestions.length > 0) {
                    allMagicNumbers.push({
                        name: `Magic_${value.replace('.', '_')}`,
                        value,
                        type: value.includes('.') ? 'float' : 'int',
                        file: file.fsPath,
                        line: lineNumber,
                        column: m.index || 0,
                        language: language as any,
                        category: 'magic_number',
                        context: {
                            type: 'calculation',
                            surroundingCode: cleaned,
                            operation: operator
                        },
                        suggestedNames: suggestions,
                        confidence: 82,
                        usageContext: `${varName} ${operator} ${value}`
                    });
                }
            }
        }
    }

    return allMagicNumbers;
}

function generateValueBasedSuggestions(varName: string, value: string, numValue: number): string[] {
    const suggestions: string[] = [];
    const upperVar = varName.toUpperCase();

    if (numValue === 80) {
        suggestions.push(`${upperVar}_HTTP_PORT`, 'HTTP_PORT', 'DEFAULT_PORT');
    } else if (numValue === 443) {
        suggestions.push(`${upperVar}_HTTPS_PORT`, 'HTTPS_PORT', 'SECURE_PORT');
    } else if (numValue === 8080) {
        suggestions.push(`${upperVar}_PORT`, 'SERVER_PORT', 'ALT_HTTP_PORT', 'DEV_PORT');
    } else if (numValue === 3000) {
        suggestions.push(`${upperVar}_PORT`, 'DEV_SERVER_PORT', 'NODE_PORT');
    } else if (numValue === 5432) {
        suggestions.push(`${upperVar}_PORT`, 'POSTGRES_PORT', 'DB_PORT');
    } else if (numValue === 3306) {
        suggestions.push(`${upperVar}_PORT`, 'MYSQL_PORT', 'DATABASE_PORT');
    } else if (numValue === 27017) {
        suggestions.push(`${upperVar}_PORT`, 'MONGO_PORT', 'NOSQL_PORT');
    } else if (numValue === 6379) {
        suggestions.push(`${upperVar}_PORT`, 'REDIS_PORT', 'CACHE_PORT');
    } else if (numValue === 1024) {
        suggestions.push(`${upperVar}_SIZE`, 'BUFFER_SIZE', 'KILOBYTE', 'DEFAULT_BUFFER');
    } else if (numValue === 2048) {
        suggestions.push(`${upperVar}_SIZE`, 'LARGE_BUFFER_SIZE', 'RSA_KEY_SIZE');
    } else if (numValue === 4096) {
        suggestions.push(`${upperVar}_SIZE`, 'PAGE_SIZE', 'MAX_BUFFER_SIZE');
    } else if (numValue === 8192) {
        suggestions.push(`${upperVar}_SIZE`, 'LARGE_PAGE_SIZE', 'EXTENDED_BUFFER');
    } else if (numValue === 256 || numValue === 512) {
        suggestions.push(`${upperVar}_SIZE`, 'BLOCK_SIZE', 'CHUNK_SIZE');
    } else if (numValue === 5000) {
        suggestions.push(`${upperVar}_TIMEOUT_MS`, 'DEFAULT_TIMEOUT_MS', 'CONNECTION_TIMEOUT');
    } else if (numValue === 10000) {
        suggestions.push(`${upperVar}_TIMEOUT_MS`, 'LONG_TIMEOUT_MS', 'READ_TIMEOUT');
    } else if (numValue === 30000) {
        suggestions.push(`${upperVar}_TIMEOUT_MS`, 'SESSION_TIMEOUT_MS`, 'IDLE_TIMEOUT');
    } else if (numValue === 60000) {
        suggestions.push(`${upperVar}_TIMEOUT_MS`, 'ONE_MINUTE_MS`, 'MAX_TIMEOUT');
    } else if (numValue === 1000) {
        suggestions.push(`${upperVar}_MS`, 'ONE_SECOND_MS', 'MILLISECONDS_PER_SECOND');
    } else if (numValue === 60) {
        suggestions.push(`${upperVar}_SECONDS`, 'SECONDS_PER_MINUTE', 'ONE_MINUTE');
    } else if (numValue === 3600) {
        suggestions.push(`${upperVar}_SECONDS`, 'SECONDS_PER_HOUR', 'ONE_HOUR');
    } else if (numValue === 86400) {
        suggestions.push(`${upperVar}_SECONDS`, 'SECONDS_PER_DAY', 'ONE_DAY');
    } else if (numValue === 24) {
        suggestions.push(`${upperVar}_HOURS`, 'HOURS_PER_DAY', 'MAX_HOURS');
    } else if (numValue === 365) {
        suggestions.push(`${upperVar}_DAYS`, 'DAYS_PER_YEAR', 'MAX_DAYS');
    } else if (numValue === 200) {
        suggestions.push(`${upperVar}_STATUS`, 'HTTP_OK', 'SUCCESS_STATUS');
    } else if (numValue === 404) {
        suggestions.push(`${upperVar}_ERROR`, 'NOT_FOUND_ERROR', 'HTTP_NOT_FOUND');
    } else if (numValue === 500) {
        suggestions.push(`${upperVar}_ERROR`, 'SERVER_ERROR', 'HTTP_SERVER_ERROR');
    } else if (numValue === 401) {
        suggestions.push(`${upperVar}_ERROR`, 'UNAUTHORIZED_ERROR', 'HTTP_UNAUTHORIZED');
    } else if (numValue === 403) {
        suggestions.push(`${upperVar}_ERROR`, 'FORBIDDEN_ERROR', 'HTTP_FORBIDDEN');
    } else if (numValue >= 2 && numValue <= 10) {
        suggestions.push(`MAX_${upperVar}`, `${upperVar}_LIMIT`, `${upperVar}_COUNT`, 'MAX_RETRIES');
    } else if (numValue === 50) {
        suggestions.push(`${upperVar}_PERCENT`, 'HALF_PERCENT', 'MID_THRESHOLD');
    } else if (numValue === 100) {
        suggestions.push(`${upperVar}_PERCENT`, 'FULL_PERCENT', 'MAX_PERCENTAGE');
    } else if (numValue === 755 || numValue === 644 || numValue === 777 || numValue === 700) {
        suggestions.push(`${upperVar}_PERMISSION`, 'FILE_MODE', 'DIR_PERMISSION');
    } else if (numValue === 128 || numValue === 192) {
        suggestions.push(`${upperVar}_KEY_SIZE`, 'AES_KEY_BITS', 'ENCRYPTION_BITS');
    } else if (numValue >= 100) {
        suggestions.push(`${upperVar}_VALUE`, `${upperVar}_LIMIT`, `MAX_${upperVar}`);
    }

    return [...new Set(suggestions)].slice(0, 5);
}

function generateArithmeticSuggestions(varName: string, value: string, numValue: number, operator: string): string[] {
    const suggestions: string[] = [];
    const upperVar = varName.toUpperCase();
    const isFloat = value.includes('.');

    if (operator === '*') {
        if (numValue >= 1.01 && numValue <= 1.50) {
            const percentage = Math.round((numValue - 1) * 100);
            suggestions.push(`TAX_RATE_${percentage}_PERCENT`, 'TAX_RATE_MULTIPLIER', 'FEE_MULTIPLIER');
            if (percentage === 15) suggestions.push('GST_RATE', 'TAX_RATE');
            if (percentage === 18) suggestions.push('GST_RATE_18', 'SERVICE_TAX');
            if (percentage === 5 || percentage === 10) suggestions.push('DISCOUNT_RATE', 'MARKUP_RATE');
        } else if (numValue >= 0.5 && numValue < 1) {
            const discount = Math.round((1 - numValue) * 100);
            suggestions.push(`DISCOUNT_${discount}_PERCENT`, 'DISCOUNT_MULTIPLIER', 'REDUCTION_FACTOR');
        } else if (numValue === 2) suggestions.push('DOUBLE_MULTIPLIER', 'TIMES_TWO', 'DOUBLING_FACTOR');
        else if (numValue === 10) suggestions.push('TIMES_TEN', 'DECIMAL_SHIFT', 'ORDER_MAGNITUDE');
        else if (numValue === 100) suggestions.push('PERCENTAGE_BASE', 'CENTS_TO_DOLLAR', 'HUNDRED_MULTIPLIER');
        else if (numValue === 1000) suggestions.push('KILO_MULTIPLIER', 'THOUSAND_FACTOR', 'MS_TO_SECONDS');
    } else if (operator === '/') {
        if (numValue === 100) suggestions.push('PERCENTAGE_DIVISOR', 'TO_PERCENTAGE', 'HUNDRED_DIVISOR');
        else if (numValue === 1000) suggestions.push('TO_KILO', 'THOUSAND_DIVISOR', 'SECONDS_TO_MS');
        else if (numValue === 2) suggestions.push('HALF_DIVISOR', 'SPLIT_FACTOR', 'BISECT_DIVISOR');
        else if (numValue === 60) suggestions.push('SECONDS_PER_MINUTE', 'TO_MINUTES', 'TIME_DIVISOR');
        else if (numValue === 24) suggestions.push('HOURS_PER_DAY', 'TO_DAYS', 'DAY_DIVISOR');
    } else if (operator === '+' || operator === '-') {
        if (numValue === 1) suggestions.push('INCREMENT_VALUE', 'OFFSET_ONE', 'UNIT_ADJUSTMENT');
        else if (numValue >= 2 && numValue <= 10) suggestions.push(`${upperVar}_OFFSET`, 'ADJUSTMENT_VALUE', 'MARGIN_VALUE');
    }

    if (suggestions.length === 0 && numValue > 1) {
        if (isFloat) {
            suggestions.push(`${upperVar}_FACTOR`, 'CONVERSION_RATE', 'MULTIPLIER_VALUE');
        } else {
            suggestions.push(`${upperVar}_CONSTANT`, 'ARITHMETIC_VALUE', 'CALCULATION_FACTOR');
        }
    }

    return [...new Set(suggestions)].slice(0, 5);
}

function guessLangFromExt(filePath: string): string {
    if (filePath.endsWith('.java')) return 'java';
    if (filePath.endsWith('.cpp') || filePath.endsWith('.cc') || filePath.endsWith('.cxx')) return 'cpp';
    if (filePath.endsWith('.c') || filePath.endsWith('.h')) return 'c';
    if (filePath.endsWith('.ts')) return 'java'; // Treat as Java-like for now
    if (filePath.endsWith('.js')) return 'java';
    return 'java';
}
