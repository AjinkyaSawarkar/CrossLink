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

        // Heuristics for numeric values when rules didn't give enough
        if (/^-?\d+(?:\.\d+)?$/.test(value)) {
            const num = parseFloat(value);
            const lowerCode = context.surroundingCode.toLowerCase();
            const varHint = (context.variableName || context.functionName || '').toUpperCase();
            const add = (...arr: string[]) => arr.forEach(s => suggestions.push(toConstCase(s)));

            // Units detection
            if (/(ms|millisecond)/i.test(lowerCode)) add(varHint ? `${varHint}_MS` : 'TIMEOUT_MS', 'DURATION_MS');
            if (/(sec|second)/i.test(lowerCode)) add(varHint ? `${varHint}_SECONDS` : 'SECONDS');
            if (/(kb|kilobyte)/i.test(lowerCode)) add('KILOBYTES');
            if (/(mb|megabyte)/i.test(lowerCode)) add('MEGABYTES');
            if (/(px|pixel)/i.test(lowerCode)) add(varHint ? `${varHint}_PX` : 'PIXELS');

            // Power-of-two buffer sizes
            const isInt = Number.isInteger(num);
            if (isInt && num > 0 && (num & (num - 1)) === 0) {
                add('BUFFER_SIZE', 'CAPACITY', 'PAGE_SIZE');
            }

            // Negative and sentinel values
            if (num < 0) add('NEGATIVE_VALUE', 'SENTINEL_VALUE');
            if (num === 0) add('ZERO_VALUE');
            if (num === 1) add('ONE_VALUE');

            // Context-driven suffix
            if (varHint) {
                add(`${varHint}_VALUE`, `${varHint}_LIMIT`, `${varHint}_COUNT`);
            }
        }

        // Remove duplicates and sort by length (shorter names first)
        const uniqueSuggestions = [...new Set(suggestions)].filter(Boolean).sort((a, b) => a.length - b.length);

        return {
            suggestions: uniqueSuggestions.slice(0, 5), // Limit to top 5 suggestions
            confidence
        };
    }

    private initializeNamingRules(): void {
        this.namingRules = [
            // Magic Number Detection - High Priority
            new NamingRule(
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

                    // Common patterns for magic numbers
                    if (numValue >= 1000 && numValue <= 9999) {
                        suggestions.push('DEFAULT_TIMEOUT_MS', 'MAX_BUFFER_SIZE', 'DEFAULT_PORT');
                    } else if (numValue >= 100 && numValue <= 999) {
                        suggestions.push('MAX_RETRIES', 'DEFAULT_SIZE', 'MAX_LENGTH');
                    } else if (numValue >= 10 && numValue <= 99) {
                        suggestions.push('MAX_ATTEMPTS', 'RETRY_COUNT', 'DEFAULT_COUNT');
                    }

                    // Context-specific suggestions
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

            // Time-related Constants
            new NamingRule(
                'time_constants',
                (value, context) => {
                    const timeKeywords = ['second', 'minute', 'hour', 'day', 'ms', 'time', 'delay', 'sleep', 'wait'];
                    return timeKeywords.some(keyword =>
                        context.surroundingCode.toLowerCase().includes(keyword)
                    );
                },
                (value, context) => {
                    const suggestions = [];
                    const numValue = parseInt(value);

                    // Common time values
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

            // Buffer and Size Constants
            new NamingRule(
                'buffer_size',
                (value, context) => {
                    const bufferKeywords = ['buffer', 'size', 'length', 'capacity', 'bytes', 'kb', 'mb'];
                    return bufferKeywords.some(keyword =>
                        context.surroundingCode.toLowerCase().includes(keyword)
                    );
                },
                (value, context) => {
                    const suggestions = [];
                    const numValue = parseInt(value);

                    // Common buffer sizes
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

            // Network and Connection Constants
            new NamingRule(
                'network_constants',
                (value, context) => {
                    const networkKeywords = ['port', 'connection', 'socket', 'http', 'tcp', 'udp', 'server', 'client'];
                    return networkKeywords.some(keyword =>
                        context.surroundingCode.toLowerCase().includes(keyword)
                    );
                },
                (value, context) => {
                    const suggestions = [];
                    const numValue = parseInt(value);

                    // Common port numbers
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

                    // Connection limits
                    if (numValue >= 100 && numValue <= 1000) {
                        suggestions.push('MAX_CONNECTIONS', 'CONNECTION_POOL_SIZE', 'DEFAULT_CONNECTION_LIMIT');
                    }

                    return suggestions;
                },
                88
            ),

            // UI and Display Constants
            new NamingRule(
                'ui_constants',
                (value, context) => {
                    const uiKeywords = ['width', 'height', 'size', 'pixel', 'px', 'margin', 'padding', 'border', 'font'];
                    return uiKeywords.some(keyword =>
                        context.surroundingCode.toLowerCase().includes(keyword)
                    );
                },
                (value, context) => {
                    const suggestions = [];
                    const numValue = parseInt(value);

                    // Common UI dimensions
                    if (numValue === 800) {
                        suggestions.push('DEFAULT_WINDOW_WIDTH', 'MIN_WINDOW_WIDTH', 'STANDARD_WIDTH');
                    } else if (numValue === 600) {
                        suggestions.push('DEFAULT_WINDOW_HEIGHT', 'MIN_WINDOW_HEIGHT', 'STANDARD_HEIGHT');
                    } else if (numValue === 1024) {
                        suggestions.push('LARGE_WINDOW_WIDTH', 'HD_WIDTH', 'STANDARD_DESKTOP_WIDTH');
                    } else if (numValue === 768) {
                        suggestions.push('LARGE_WINDOW_HEIGHT', 'HD_HEIGHT', 'STANDARD_DESKTOP_HEIGHT');
                    } else if (numValue === 16) {
                        suggestions.push('DEFAULT_MARGIN', 'STANDARD_PADDING', 'BORDER_WIDTH');
                    } else if (numValue === 12) {
                        suggestions.push('SMALL_MARGIN', 'COMPACT_PADDING', 'MIN_BORDER_WIDTH');
                    }

                    return suggestions;
                },
                82
            ),

            // Error and Status Constants
            new NamingRule(
                'error_constants',
                (value, context) => {
                    const errorKeywords = ['error', 'status', 'code', 'exception', 'fail', 'success', 'ok'];
                    return errorKeywords.some(keyword =>
                        context.surroundingCode.toLowerCase().includes(keyword)
                    );
                },
                (value, context) => {
                    const suggestions = [];
                    const numValue = parseInt(value);

                    // Common status codes
                    if (numValue === 0) {
                        suggestions.push('SUCCESS_CODE', 'OK_STATUS', 'NO_ERROR');
                    } else if (numValue === 1) {
                        suggestions.push('ERROR_CODE', 'FAILURE_STATUS', 'GENERAL_ERROR');
                    } else if (numValue === -1) {
                        suggestions.push('INVALID_STATUS', 'ERROR_CODE', 'FAILURE_CODE');
                    } else if (numValue === 404) {
                        suggestions.push('NOT_FOUND_ERROR', 'RESOURCE_NOT_FOUND', 'HTTP_404');
                    } else if (numValue === 500) {
                        suggestions.push('INTERNAL_ERROR', 'SERVER_ERROR', 'HTTP_500');
                    }

                    return suggestions;
                },
                85
            ),

            // Mathematical Constants
            new NamingRule(
                'math_constants',
                (value, context) => {
                    const mathKeywords = ['pi', 'euler', 'sqrt', 'log', 'exp', 'sin', 'cos', 'tan'];
                    return mathKeywords.some(keyword =>
                        context.surroundingCode.toLowerCase().includes(keyword)
                    );
                },
                (value, context) => {
                    const suggestions = [];
                    const numValue = parseFloat(value);

                    if (Math.abs(numValue - Math.PI) < 0.01) {
                        suggestions.push('PI_VALUE', 'MATH_PI', 'PI_CONSTANT');
                    } else if (Math.abs(numValue - Math.E) < 0.01) {
                        suggestions.push('EULER_NUMBER', 'MATH_E', 'E_CONSTANT');
                    } else if (numValue === 2.718) {
                        suggestions.push('EULER_NUMBER', 'MATH_E', 'E_CONSTANT');
                    } else if (numValue === 3.14159) {
                        suggestions.push('PI_VALUE', 'MATH_PI', 'PI_CONSTANT');
                    }

                    return suggestions;
                },
                90
            ),

            // Cryptography and Security Constants - NEW
            new NamingRule(
                'crypto_constants',
                (value, context) => {
                    const cryptoKeywords = ['key', 'encrypt', 'decrypt', 'rsa', 'aes', 'ssl', 'tls', 'hash', 'cipher', 'crypto', 'secret', 'token'];
                    const cryptoValues = [128, 192, 256, 512, 1024, 2048, 4096, 8192];
                    const numValue = parseInt(value);
                    return cryptoKeywords.some(kw => context.surroundingCode.toLowerCase().includes(kw)) ||
                        cryptoValues.includes(numValue);
                },
                (value, context) => {
                    const suggestions = [];
                    const numValue = parseInt(value);

                    if (numValue === 128) suggestions.push('AES_KEY_SIZE_128', 'KEY_LENGTH_128', 'HASH_SIZE_BITS');
                    else if (numValue === 256) suggestions.push('AES_KEY_SIZE_256', 'SHA256_BITS', 'ENCRYPTION_KEY_SIZE');
                    else if (numValue === 512) suggestions.push('SHA512_BITS', 'RSA_KEY_SIZE_512', 'HASH_LENGTH_BITS');
                    else if (numValue === 1024) suggestions.push('RSA_KEY_SIZE_1024', 'KEY_SIZE_BITS', 'CRYPTO_BLOCK_SIZE');
                    else if (numValue === 2048) suggestions.push('RSA_KEY_SIZE_2048', 'RECOMMENDED_KEY_SIZE', 'SECURE_KEY_BITS');
                    else if (numValue === 4096) suggestions.push('RSA_KEY_SIZE_4096', 'HIGH_SECURITY_KEY_SIZE', 'MAX_KEY_SIZE');

                    return suggestions;
                },
                88
            ),

            // Unix Permission Constants - NEW
            new NamingRule(
                'permission_constants',
                (value, context) => {
                    const permKeywords = ['chmod', 'permission', 'mode', 'access', 'umask', 'file', 'dir', 'folder'];
                    const permValues = [400, 444, 600, 644, 700, 755, 777, 775, 664];
                    const numValue = parseInt(value);
                    return permKeywords.some(kw => context.surroundingCode.toLowerCase().includes(kw)) ||
                        permValues.includes(numValue);
                },
                (value, context) => {
                    const suggestions = [];
                    const numValue = parseInt(value);

                    if (numValue === 755) suggestions.push('DIR_PERMISSION_755', 'EXECUTABLE_PERMISSION', 'DEFAULT_DIR_MODE');
                    else if (numValue === 644) suggestions.push('FILE_PERMISSION_644', 'READ_WRITE_PERMISSION', 'DEFAULT_FILE_MODE');
                    else if (numValue === 777) suggestions.push('FULL_PERMISSION_777', 'ALL_ACCESS_PERMISSION', 'MAX_PERMISSION');
                    else if (numValue === 700) suggestions.push('OWNER_ONLY_PERMISSION', 'PRIVATE_DIR_MODE', 'SECURE_PERMISSION');
                    else if (numValue === 600) suggestions.push('PRIVATE_FILE_PERMISSION', 'OWNER_RW_ONLY', 'SECURE_FILE_MODE');
                    else if (numValue === 444) suggestions.push('READ_ONLY_PERMISSION', 'READONLY_FILE_MODE', 'NO_WRITE_PERMISSION');

                    return suggestions;
                },
                92
            ),

            // Retry and Polling Limits - NEW
            new NamingRule(
                'retry_constants',
                (value, context) => {
                    const retryKeywords = ['retry', 'retries', 'attempt', 'poll', 'max', 'limit', 'count', 'tries', 'repeat'];
                    const numValue = parseInt(value);
                    return retryKeywords.some(kw => context.surroundingCode.toLowerCase().includes(kw)) &&
                        numValue >= 1 && numValue <= 20;
                },
                (value, context) => {
                    const suggestions = [];
                    const numValue = parseInt(value);
                    const lowerCode = context.surroundingCode.toLowerCase();

                    if (lowerCode.includes('retry') || lowerCode.includes('retries')) {
                        suggestions.push('MAX_RETRIES', 'RETRY_LIMIT', 'MAX_RETRY_COUNT');
                    } else if (lowerCode.includes('poll')) {
                        suggestions.push('MAX_POLL_ATTEMPTS', 'POLL_RETRY_LIMIT', 'POLLING_MAX_TRIES');
                    } else if (lowerCode.includes('attempt')) {
                        suggestions.push('MAX_ATTEMPTS', 'ATTEMPT_LIMIT', 'TRY_COUNT_MAX');
                    } else {
                        suggestions.push('MAX_ITERATIONS', 'LOOP_LIMIT', 'REPEAT_COUNT');
                    }

                    return suggestions;
                },
                85
            ),

            // Character and ASCII Constants - NEW
            new NamingRule(
                'character_constants',
                (value, context) => {
                    const charKeywords = ['char', 'ascii', 'character', 'byte', 'code', 'unicode'];
                    const numValue = parseInt(value);
                    const commonChars = [0, 9, 10, 13, 32, 48, 65, 97, 127, 255];
                    return charKeywords.some(kw => context.surroundingCode.toLowerCase().includes(kw)) ||
                        (commonChars.includes(numValue) && context.type === 'comparison');
                },
                (value, context) => {
                    const suggestions = [];
                    const numValue = parseInt(value);

                    if (numValue === 0) suggestions.push('NULL_CHAR', 'NUL_BYTE', 'STRING_TERMINATOR');
                    else if (numValue === 9) suggestions.push('TAB_CHAR', 'HORIZONTAL_TAB', 'TAB_ASCII');
                    else if (numValue === 10) suggestions.push('NEWLINE_CHAR', 'LINE_FEED', 'LF_CHAR');
                    else if (numValue === 13) suggestions.push('CARRIAGE_RETURN', 'CR_CHAR', 'RETURN_CHAR');
                    else if (numValue === 32) suggestions.push('SPACE_CHAR', 'SPACE_ASCII', 'WHITESPACE_CHAR');
                    else if (numValue === 48) suggestions.push('ZERO_CHAR', 'DIGIT_ZERO_ASCII', 'CHAR_0');
                    else if (numValue === 65) suggestions.push('UPPERCASE_A', 'CHAR_A_ASCII', 'ALPHA_START');
                    else if (numValue === 97) suggestions.push('LOWERCASE_A', 'CHAR_a_ASCII', 'LOWER_ALPHA_START');
                    else if (numValue === 127) suggestions.push('DELETE_CHAR', 'DEL_ASCII', 'MAX_ASCII_CONTROL');
                    else if (numValue === 255) suggestions.push('MAX_BYTE_VALUE', 'UCHAR_MAX', 'BYTE_MAX');

                    return suggestions;
                },
                80
            ),

            // Memory and Data Structure Sizes - NEW
            new NamingRule(
                'memory_constants',
                (value, context) => {
                    const memKeywords = ['alloc', 'memory', 'heap', 'stack', 'cache', 'block', 'chunk', 'segment'];
                    const numValue = parseInt(value);
                    const powerOfTwo = numValue > 0 && (numValue & (numValue - 1)) === 0 && numValue >= 16;
                    return memKeywords.some(kw => context.surroundingCode.toLowerCase().includes(kw)) || powerOfTwo;
                },
                (value, context) => {
                    const suggestions = [];
                    const numValue = parseInt(value);

                    if (numValue === 16) suggestions.push('ALIGNMENT_SIZE', 'CACHE_LINE_MIN', 'WORD_SIZE');
                    else if (numValue === 32) suggestions.push('CACHE_LINE_SIZE', 'ALIGNMENT_32', 'STRUCT_PADDING');
                    else if (numValue === 64) suggestions.push('CACHE_LINE_SIZE_64', 'BLOCK_SIZE_64', 'ALIGNMENT_64');
                    else if (numValue === 128) suggestions.push('BLOCK_SIZE_128', 'CACHE_BLOCK_SIZE', 'MEMORY_ALIGNMENT');
                    else if (numValue === 256) suggestions.push('PAGE_SIZE_256', 'ALLOCATION_BLOCK', 'CHUNK_SIZE_256');

                    return suggestions;
                },
                82
            ),

            // Bit Flag Constants - NEW
            new NamingRule(
                'bitflag_constants',
                (value, context) => {
                    const bitwiseOps = ['&', '|', '^', '<<', '>>', '~'];
                    const numValue = parseInt(value);
                    const isPowerOfTwo = numValue > 0 && (numValue & (numValue - 1)) === 0;
                    return bitwiseOps.some(op => context.surroundingCode.includes(op)) && isPowerOfTwo;
                },
                (value, context) => {
                    const suggestions = [];
                    const numValue = parseInt(value);
                    const bitPosition = Math.log2(numValue);

                    suggestions.push(`FLAG_BIT_${bitPosition}`, `MASK_${numValue}`, `BIT_FLAG_${numValue}`);
                    if (numValue === 1) suggestions.push('FLAG_ENABLED', 'FIRST_BIT', 'LSB_MASK');
                    else if (numValue === 2) suggestions.push('FLAG_SECOND', 'SECOND_BIT', 'FLAG_ACTIVE');
                    else if (numValue === 4) suggestions.push('FLAG_THIRD', 'THIRD_BIT', 'FLAG_VISIBLE');
                    else if (numValue === 8) suggestions.push('FLAG_FOURTH', 'FOURTH_BIT', 'FLAG_SELECTED');

                    return suggestions;
                },
                90
            ),

            // Configuration and Threshold Constants - NEW
            new NamingRule(
                'config_constants',
                (value, context) => {
                    const configKeywords = ['config', 'setting', 'threshold', 'limit', 'max', 'min', 'default', 'initial'];
                    const numValue = parseInt(value);
                    const roundNumbers = [10, 25, 50, 75, 100, 150, 200, 250, 500, 750, 1000];
                    return configKeywords.some(kw => context.surroundingCode.toLowerCase().includes(kw)) ||
                        roundNumbers.includes(numValue);
                },
                (value, context) => {
                    const suggestions = [];
                    const numValue = parseInt(value);
                    const varHint = (context.variableName || '').toUpperCase();

                    if (varHint) {
                        suggestions.push(`${varHint}_THRESHOLD`, `DEFAULT_${varHint}`, `${varHint}_LIMIT`);
                    }
                    if (numValue === 50) suggestions.push('HALF_PERCENT', 'MID_THRESHOLD', 'DEFAULT_PERCENTAGE');
                    else if (numValue === 100) suggestions.push('FULL_PERCENT', 'MAX_PERCENTAGE', 'HUNDRED_PERCENT');
                    else if (numValue === 1000) suggestions.push('THOUSAND_VALUE', 'KILO_MULTIPLIER', 'DEFAULT_LARGE_LIMIT');

                    return suggestions;
                },
                75
            ),

            // Default rule for numeric values
            new NamingRule(
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
    ) { }
}

// Convert free-form text to SCREAMING_SNAKE_CASE constant style
function toConstCase(text: string): string {
    if (!text) return '';
    return text
        .replace(/([a-z])([A-Z])/g, '$1_$2')
        .replace(/[^A-Za-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '')
        .toUpperCase();
}

/**
 * Scan workspace for magic numbers in:
 * 1. Variable assignments: int ajinkya = 8080 → suggests AJINKYA_PORT, SERVER_PORT
 * 2. Comparisons: if(a < 8080) → suggests SERVER_PORT for 8080
 */
async function findMagicNumbersInWorkspace(): Promise<any[]> {
    const allMagicNumbers: any[] = [];
    const files = await vscode.workspace.findFiles('**/*.{cpp,c,h,hpp,java}');

    for (const file of files) {
        const doc = await vscode.workspace.openTextDocument(file);
        const lines = doc.getText().split('\n');

        for (let lineNumber = 0; lineNumber < lines.length; lineNumber++) {
            const line = lines[lineNumber];
            const trimmedLine = line.trim();

            // Skip comments
            if (trimmedLine.startsWith('//') || trimmedLine.startsWith('*') || trimmedLine.startsWith('/*')) continue;

            // Ignore numbers inside strings
            let cleaned = line.replace(/([\"'`]).*?\1/g, '');

            // === PATTERN 1: Variable assignments ===
            // "type varName = number" or "varName = number"
            const assignmentMatch = cleaned.match(/(?:(?:int|long|short|float|double|byte)\s+)?(\w+)\s*=\s*(\d+)/);

            if (assignmentMatch) {
                const varName = assignmentMatch[1];
                const value = assignmentMatch[2];
                const numValue = parseInt(value);

                // Skip already well-named constants (ALL_CAPS)
                if (!/^[A-Z_][A-Z0-9_]*$/.test(varName) && numValue > 1) {
                    const suggestions = generateValueBasedSuggestions(varName, value, numValue);

                    if (suggestions.length > 0) {
                        allMagicNumbers.push({
                            name: varName,
                            value,
                            type: 'int',
                            file: file.fsPath,
                            line: lineNumber,
                            column: assignmentMatch.index || 0,
                            language: guessLangFromExt(file.fsPath),
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

            // === PATTERN 2: Comparisons in if/while/for ===
            // if(a < 8080), while(x > 100), for(i = 0; i < 50; i++)
            const isComparison = /\b(if|else\s*if|while|for)\s*\(/.test(cleaned);
            if (isComparison) {
                // Find numbers in comparison operators: < > <= >= == !=
                const comparisonMatches = cleaned.matchAll(/(?:<=|>=|<|>|==|!=)\s*(\d+)/g);

                for (const m of comparisonMatches) {
                    const value = m[1];
                    const numValue = parseInt(value);

                    // Skip trivial values
                    if (numValue <= 1) continue;
                    if (['10', '100', '1000'].includes(value)) continue;

                    // Generate suggestions based on value
                    const suggestions = generateValueBasedSuggestions('MAGIC', value, numValue);

                    if (suggestions.length > 0) {
                        allMagicNumbers.push({
                            name: `MagicNumber_${value}`,
                            value,
                            type: 'int',
                            file: file.fsPath,
                            line: lineNumber,
                            column: m.index || 0,
                            language: guessLangFromExt(file.fsPath),
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
            // price * 1.15 → TAX_RATE_MULTIPLIER, amount / 100 → PERCENTAGE_DIVISOR
            const arithmeticMatches = cleaned.matchAll(/(\w+)\s*([*\/+\-])\s*(\d+\.?\d*)/g);

            for (const m of arithmeticMatches) {
                const varName = m[1];
                const operator = m[2];
                const value = m[3];
                const numValue = parseFloat(value);

                // Skip trivial values and already processed assignments
                if (numValue <= 1 && operator !== '*' && operator !== '/') continue;
                if (/^[A-Z_][A-Z0-9_]*$/.test(varName)) continue; // Already a constant

                // Generate arithmetic-context suggestions
                const suggestions = generateArithmeticSuggestions(varName, value, numValue, operator);

                if (suggestions.length > 0) {
                    allMagicNumbers.push({
                        name: `Magic_${value.replace('.', '_')}`,
                        value,
                        type: value.includes('.') ? 'float' : 'int',
                        file: file.fsPath,
                        line: lineNumber,
                        column: m.index || 0,
                        language: guessLangFromExt(file.fsPath),
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

/**
 * Generate naming suggestions based on the VALUE meaning.
 * E.g., 8080 → port, 1024 → buffer size, 5000 → timeout
 */
function generateValueBasedSuggestions(varName: string, value: string, numValue: number): string[] {
    const suggestions: string[] = [];
    const upperVar = varName.toUpperCase();

    // === NETWORK PORTS ===
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
    }

    // === BUFFER/MEMORY SIZES ===
    else if (numValue === 1024) {
        suggestions.push(`${upperVar}_SIZE`, 'BUFFER_SIZE', 'KILOBYTE', 'DEFAULT_BUFFER');
    } else if (numValue === 2048) {
        suggestions.push(`${upperVar}_SIZE`, 'LARGE_BUFFER_SIZE', 'RSA_KEY_SIZE');
    } else if (numValue === 4096) {
        suggestions.push(`${upperVar}_SIZE`, 'PAGE_SIZE', 'MAX_BUFFER_SIZE');
    } else if (numValue === 8192) {
        suggestions.push(`${upperVar}_SIZE`, 'LARGE_PAGE_SIZE', 'EXTENDED_BUFFER');
    } else if (numValue === 256 || numValue === 512) {
        suggestions.push(`${upperVar}_SIZE`, 'BLOCK_SIZE', 'CHUNK_SIZE');
    }

    // === TIMEOUTS (common milliseconds) ===
    else if (numValue === 5000) {
        suggestions.push(`${upperVar}_TIMEOUT_MS`, 'DEFAULT_TIMEOUT_MS', 'CONNECTION_TIMEOUT');
    } else if (numValue === 10000) {
        suggestions.push(`${upperVar}_TIMEOUT_MS`, 'LONG_TIMEOUT_MS', 'READ_TIMEOUT');
    } else if (numValue === 30000) {
        suggestions.push(`${upperVar}_TIMEOUT_MS`, 'SESSION_TIMEOUT_MS', 'IDLE_TIMEOUT');
    } else if (numValue === 60000) {
        suggestions.push(`${upperVar}_TIMEOUT_MS`, 'ONE_MINUTE_MS', 'MAX_TIMEOUT');
    } else if (numValue === 1000) {
        suggestions.push(`${upperVar}_MS`, 'ONE_SECOND_MS', 'MILLISECONDS_PER_SECOND');
    }

    // === TIME CONSTANTS ===
    else if (numValue === 60) {
        suggestions.push(`${upperVar}_SECONDS`, 'SECONDS_PER_MINUTE', 'ONE_MINUTE');
    } else if (numValue === 3600) {
        suggestions.push(`${upperVar}_SECONDS`, 'SECONDS_PER_HOUR', 'ONE_HOUR');
    } else if (numValue === 86400) {
        suggestions.push(`${upperVar}_SECONDS`, 'SECONDS_PER_DAY', 'ONE_DAY');
    } else if (numValue === 24) {
        suggestions.push(`${upperVar}_HOURS`, 'HOURS_PER_DAY', 'MAX_HOURS');
    } else if (numValue === 365) {
        suggestions.push(`${upperVar}_DAYS`, 'DAYS_PER_YEAR', 'MAX_DAYS');
    }

    // === HTTP STATUS CODES ===
    else if (numValue === 200) {
        suggestions.push(`${upperVar}_STATUS`, 'HTTP_OK', 'SUCCESS_STATUS');
    } else if (numValue === 404) {
        suggestions.push(`${upperVar}_ERROR`, 'NOT_FOUND_ERROR', 'HTTP_NOT_FOUND');
    } else if (numValue === 500) {
        suggestions.push(`${upperVar}_ERROR`, 'SERVER_ERROR', 'HTTP_SERVER_ERROR');
    } else if (numValue === 401) {
        suggestions.push(`${upperVar}_ERROR`, 'UNAUTHORIZED_ERROR', 'HTTP_UNAUTHORIZED');
    } else if (numValue === 403) {
        suggestions.push(`${upperVar}_ERROR`, 'FORBIDDEN_ERROR', 'HTTP_FORBIDDEN');
    }

    // === RETRY/COUNT LIMITS (small numbers 2-10) ===
    else if (numValue >= 2 && numValue <= 10) {
        suggestions.push(`MAX_${upperVar}`, `${upperVar}_LIMIT`, `${upperVar}_COUNT`, 'MAX_RETRIES');
    }

    // === PERCENTAGES ===
    else if (numValue === 50) {
        suggestions.push(`${upperVar}_PERCENT`, 'HALF_PERCENT', 'MID_THRESHOLD');
    } else if (numValue === 100) {
        suggestions.push(`${upperVar}_PERCENT`, 'FULL_PERCENT', 'MAX_PERCENTAGE');
    }

    // === UNIX PERMISSIONS ===
    else if (numValue === 755 || numValue === 644 || numValue === 777 || numValue === 700) {
        suggestions.push(`${upperVar}_PERMISSION`, 'FILE_MODE', 'DIR_PERMISSION');
    }

    // === CRYPTO KEY SIZES ===
    else if (numValue === 128 || numValue === 192) {
        suggestions.push(`${upperVar}_KEY_SIZE`, 'AES_KEY_BITS', 'ENCRYPTION_BITS');
    }

    // === GENERIC VALUES ===
    else if (numValue >= 100) {
        suggestions.push(`${upperVar}_VALUE`, `${upperVar}_LIMIT`, `MAX_${upperVar}`);
    }

    // Remove duplicates and limit to 5
    return [...new Set(suggestions)].slice(0, 5);
}

/**
 * Generate suggestions for numbers in arithmetic operations.
 * E.g., price * 1.15 → TAX_RATE_MULTIPLIER, amount / 100 → PERCENTAGE_DIVISOR
 */
function generateArithmeticSuggestions(varName: string, value: string, numValue: number, operator: string): string[] {
    const suggestions: string[] = [];
    const upperVar = varName.toUpperCase();
    const isFloat = value.includes('.');

    // === MULTIPLICATION CONTEXT ===
    if (operator === '*') {
        // Tax/fee rates (1.05 to 1.30)
        if (numValue >= 1.01 && numValue <= 1.50) {
            const percentage = Math.round((numValue - 1) * 100);
            suggestions.push(`TAX_RATE_${percentage}_PERCENT`, 'TAX_RATE_MULTIPLIER', 'FEE_MULTIPLIER');
            if (percentage === 15) suggestions.push('GST_RATE', 'TAX_RATE');
            if (percentage === 18) suggestions.push('GST_RATE_18', 'SERVICE_TAX');
            if (percentage === 5 || percentage === 10) suggestions.push('DISCOUNT_RATE', 'MARKUP_RATE');
        }
        // Discount multipliers (0.5 to 0.99)
        else if (numValue >= 0.5 && numValue < 1) {
            const discount = Math.round((1 - numValue) * 100);
            suggestions.push(`DISCOUNT_${discount}_PERCENT`, 'DISCOUNT_MULTIPLIER', 'REDUCTION_FACTOR');
        }
        // Round number multipliers
        else if (numValue === 2) suggestions.push('DOUBLE_MULTIPLIER', 'TIMES_TWO', 'DOUBLING_FACTOR');
        else if (numValue === 10) suggestions.push('TIMES_TEN', 'DECIMAL_SHIFT', 'ORDER_MAGNITUDE');
        else if (numValue === 100) suggestions.push('PERCENTAGE_BASE', 'CENTS_TO_DOLLAR', 'HUNDRED_MULTIPLIER');
        else if (numValue === 1000) suggestions.push('KILO_MULTIPLIER', 'THOUSAND_FACTOR', 'MS_TO_SECONDS');
    }

    // === DIVISION CONTEXT ===
    else if (operator === '/') {
        if (numValue === 100) suggestions.push('PERCENTAGE_DIVISOR', 'TO_PERCENTAGE', 'HUNDRED_DIVISOR');
        else if (numValue === 1000) suggestions.push('TO_KILO', 'THOUSAND_DIVISOR', 'SECONDS_TO_MS');
        else if (numValue === 2) suggestions.push('HALF_DIVISOR', 'SPLIT_FACTOR', 'BISECT_DIVISOR');
        else if (numValue === 60) suggestions.push('SECONDS_PER_MINUTE', 'TO_MINUTES', 'TIME_DIVISOR');
        else if (numValue === 24) suggestions.push('HOURS_PER_DAY', 'TO_DAYS', 'DAY_DIVISOR');
    }

    // === ADDITION/SUBTRACTION CONTEXT ===
    else if (operator === '+' || operator === '-') {
        if (numValue === 1) suggestions.push('INCREMENT_VALUE', 'OFFSET_ONE', 'UNIT_ADJUSTMENT');
        else if (numValue >= 2 && numValue <= 10) suggestions.push(`${upperVar}_OFFSET`, 'ADJUSTMENT_VALUE', 'MARGIN_VALUE');
    }

    // === GENERIC ARITHMETIC ===
    if (suggestions.length === 0 && numValue > 1) {
        if (isFloat) {
            suggestions.push(`${upperVar}_FACTOR`, 'CONVERSION_RATE', 'MULTIPLIER_VALUE');
        } else {
            suggestions.push(`${upperVar}_CONSTANT`, 'ARITHMETIC_VALUE', 'CALCULATION_FACTOR');
        }
    }

    return [...new Set(suggestions)].slice(0, 5);
}

function guessLangFromExt(path: string): string {
    if (path.endsWith('.java')) return 'java';
    if (path.endsWith('.cpp') || path.endsWith('.cc') || path.endsWith('.cxx')) return 'cpp';
    if (path.endsWith('.c') || path.endsWith('.h')) return 'c';
    if (path.endsWith('.ts')) return 'ts';
    if (path.endsWith('.js')) return 'js';
    return 'unknown';
}
