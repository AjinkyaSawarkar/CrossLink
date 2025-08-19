// src/constants/constantCreationProvider.ts
import * as vscode from 'vscode';
import * as path from 'path';
import { ConstantContext } from './constantsAnalyzer';

export interface ConstantCreationOptions {
    value: string;
    suggestion: string;
    context: ConstantContext;
    range: vscode.Range;
    document: vscode.Uri;
    isPrimary?: boolean;
}

export class ConstantCreationProvider {
    
    async createConstantFromMagicNumber(options: ConstantCreationOptions): Promise<boolean> {
        try {
            const document = await vscode.workspace.openTextDocument(options.document);
            const language = document.languageId;
            
            // Determine where to place the constant
            const constantLocation = this.findConstantLocation(document, language);
            
            // Create the constant declaration
            const constantDeclaration = this.generateConstantDeclaration(
                options.suggestion, 
                options.value, 
                language,
                options.context
            );
            
            // Create workspace edit
            const workspaceEdit = new vscode.WorkspaceEdit();
            
            // 1. Insert the constant declaration
            workspaceEdit.insert(options.document, constantLocation.position, constantDeclaration);
            
            // 2. Replace the magic number with the constant name
            workspaceEdit.replace(options.document, options.range, options.suggestion);
            
            // Apply the edit
            const success = await vscode.workspace.applyEdit(workspaceEdit);
            
            if (success) {
                // Show success message
                const confidenceIcon = options.isPrimary ? '🔥' : '💡';
                vscode.window.showInformationMessage(
                    `${confidenceIcon} Created constant "${options.suggestion}" and replaced magic number ${options.value}`
                );
                
                // Show the change in the editor
                const editor = await vscode.window.showTextDocument(document);
                editor.revealRange(constantLocation.range, vscode.TextEditorRevealType.InCenter);
                
                return true;
            }
            
            return false;
        } catch (error) {
            console.error('Error creating constant:', error);
            vscode.window.showErrorMessage(`❌ Failed to create constant: ${error}`);
            return false;
        }
    }
    
    private findConstantLocation(document: vscode.TextDocument, language: string): { position: vscode.Position; range: vscode.Range } {
        const text = document.getText();
        const lines = text.split('\n');
        
        if (language === 'java') {
            return this.findJavaConstantLocation(lines);
        } else if (['cpp', 'c'].includes(language)) {
            return this.findCppConstantLocation(lines);
        }
        
        // Default: add at the beginning of the file
        return {
            position: new vscode.Position(0, 0),
            range: new vscode.Range(0, 0, 0, 0)
        };
    }
    
    private findJavaConstantLocation(lines: string[]): { position: vscode.Position; range: vscode.Range } {
        let classStartLine = -1;
        let firstMethodLine = -1;
        let lastConstantLine = -1;
        
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i].trim();
            
            // Find class declaration
            if (line.includes('class ') && !line.includes('//')) {
                classStartLine = i;
            }
            
            // Find existing constants
            if (line.includes('static final') && !line.includes('//')) {
                lastConstantLine = i;
            }
            
            // Find first method
            if ((line.includes('public ') || line.includes('private ') || line.includes('protected ')) && 
                (line.includes('(') && line.includes(')')) && 
                !line.includes('static final') && 
                firstMethodLine === -1) {
                firstMethodLine = i;
            }
        }
        
        let insertLine: number;
        
        if (lastConstantLine !== -1) {
            // Insert after the last constant
            insertLine = lastConstantLine + 1;
        } else if (classStartLine !== -1) {
            // Insert after class declaration, before first method
            insertLine = firstMethodLine !== -1 ? firstMethodLine : classStartLine + 1;
        } else {
            // Insert at the beginning
            insertLine = 0;
        }
        
        const position = new vscode.Position(insertLine, 0);
        return {
            position,
            range: new vscode.Range(position, position)
        };
    }
    
    private findCppConstantLocation(lines: string[]): { position: vscode.Position; range: vscode.Range } {
        let lastIncludeLine = -1;
        let lastConstantLine = -1;
        let firstFunctionLine = -1;
        
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i].trim();
            
            // Find last #include
            if (line.startsWith('#include')) {
                lastIncludeLine = i;
            }
            
            // Find existing constants
            if ((line.includes('const ') || line.startsWith('#define')) && !line.includes('//')) {
                lastConstantLine = i;
            }
            
            // Find first function
            if (line.includes('(') && line.includes(')') && line.includes('{') && firstFunctionLine === -1) {
                firstFunctionLine = i;
            }
        }
        
        let insertLine: number;
        
        if (lastConstantLine !== -1) {
            // Insert after the last constant
            insertLine = lastConstantLine + 1;
        } else if (lastIncludeLine !== -1) {
            // Insert after includes
            insertLine = lastIncludeLine + 1;
        } else {
            // Insert at the beginning
            insertLine = 0;
        }
        
        const position = new vscode.Position(insertLine, 0);
        return {
            position,
            range: new vscode.Range(position, position)
        };
    }
    
    private generateConstantDeclaration(name: string, value: string, language: string, context: ConstantContext): string {
        if (language === 'java') {
            return this.generateJavaConstant(name, value, context);
        } else if (['cpp', 'c'].includes(language)) {
            return this.generateCppConstant(name, value, context);
        }
        
        return `// TODO: Add constant ${name} = ${value}\n`;
    }
    
    private generateJavaConstant(name: string, value: string, context: ConstantContext): string {
        const type = this.inferJavaType(value, context);
        const comment = this.generateComment(name, value, context);
        
        return `    ${comment}    public static final ${type} ${name} = ${value};\n\n`;
    }
    
    private generateCppConstant(name: string, value: string, context: ConstantContext): string {
        const type = this.inferCppType(value, context);
        const comment = this.generateComment(name, value, context);
        
        // Prefer const over #define for better type safety
        return `${comment}const ${type} ${name} = ${value};\n\n`;
    }
    
    private inferJavaType(value: string, context: ConstantContext): string {
        const numValue = parseInt(value);
        
        // Check if it's a time-related value
        if (context.surroundingCode.toLowerCase().includes('time') || 
            context.surroundingCode.toLowerCase().includes('ms') ||
            context.surroundingCode.toLowerCase().includes('second')) {
            return 'long';
        }
        
        // Check range for appropriate type
        if (numValue <= 127 && numValue >= -128) {
            return 'byte';
        } else if (numValue <= 32767 && numValue >= -32768) {
            return 'short';
        } else if (numValue <= 2147483647 && numValue >= -2147483648) {
            return 'int';
        } else {
            return 'long';
        }
    }
    
    private inferCppType(value: string, context: ConstantContext): string {
        const numValue = parseInt(value);
        
        // Check if it's a size-related value
        if (context.surroundingCode.toLowerCase().includes('size') || 
            context.surroundingCode.toLowerCase().includes('buffer') ||
            context.surroundingCode.toLowerCase().includes('length')) {
            return 'size_t';
        }
        
        // Check if it's unsigned (common for sizes, counts, etc.)
        if (numValue >= 0 && (context.type === 'array_index' || context.type === 'buffer_size')) {
            return 'unsigned int';
        }
        
        return 'int';
    }
    
    private generateComment(name: string, value: string, context: ConstantContext): string {
        const contextDesc = this.getContextDescription(context.type);
        return `    // ${contextDesc}: ${value}\n`;
    }
    
    private getContextDescription(contextType: ConstantContext['type']): string {
        const descriptionMap: Record<ConstantContext['type'], string> = {
            'loop_condition': 'Loop iteration limit',
            'comparison': 'Comparison threshold',
            'array_index': 'Array size limit',
            'variable_assignment': 'Default value',
            'function_argument': 'Function parameter',
            'calculation': 'Calculation constant',
            'return_code': 'Return code',
            'bitwise': 'Bitwise constant',
            'time_calc': 'Time constant',
            'ui_dimension': 'UI dimension',
            'buffer_size': 'Buffer size',
            'unknown': 'Constant value'
        };
        return descriptionMap[contextType] || 'Constant value';
    }
}
