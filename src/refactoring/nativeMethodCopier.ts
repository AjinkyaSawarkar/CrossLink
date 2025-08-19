// src/refactoring/nativeMethodCopier.ts
import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs/promises';
import { DependencyAnalyzer } from '../core/dependencyAnalyzer';

import { RefactoringContext, RefactoringOperation, RefactoringPreview } from './refactoringProvider';

interface NativeMethodInfo {
    methodName: string;
    className: string;
    packageName: string;
    jniSignature: string;
    parameters: string[];
    returnType: string;
    fullMethodSignature: string;
    methodBody: string;
}

interface TargetSelection {
    className: string;
    packageName: string;
    filePath?: string;
}

export class NativeMethodCopier implements RefactoringOperation {
    id = 'dependency-visualizer.copy-native-method';
    title = 'Copy Native Method';
    description = 'Copy Java native method to another class and create corresponding JNI C++ method';

    async canApply(context: RefactoringContext): Promise<boolean> {
        if (context.language !== 'java') {
            return false;
        }
        
        const document = context.document;
        const position = context.selection.active;
        const line = document.lineAt(position.line);
        
        // Check if current line contains 'native' keyword
        return line.text.includes('native') && line.text.includes('(');
    }

    async apply(context: RefactoringContext): Promise<vscode.WorkspaceEdit> {
        const methodInfo = await this.extractNativeMethodInfo(context);
        if (!methodInfo) {
            vscode.window.showErrorMessage('Unable to extract native method information');
            return new vscode.WorkspaceEdit();
        }

        const target = await this.selectTarget(context);
        if (!target) {
            vscode.window.showInformationMessage('Method copy cancelled');
            return new vscode.WorkspaceEdit();
        }

        const workspaceEdit = new vscode.WorkspaceEdit();
        
        // 1. Copy Java method to target class
        await this.copyJavaMethod(context, methodInfo, target, workspaceEdit);
        
        // 2. Create corresponding JNI C++ method
        await this.createJniImplementation(context, methodInfo, target, workspaceEdit);
        
        return workspaceEdit;
    }

    async preview(context: RefactoringContext): Promise<RefactoringPreview> {
        const methodInfo = await this.extractNativeMethodInfo(context);
        if (!methodInfo) {
            return { title: 'Copy Native Method', changes: [] };
        }

        const changes: Array<{file: string; oldContent: string; newContent: string; diff: string}> = [];
        
        // Preview would show the target Java file with the new method
        // and the target C++ file with the new JNI method
        
        return {
            title: `Copy Native Method: ${methodInfo.methodName}`,
            changes
        };
    }

    private async extractNativeMethodInfo(context: RefactoringContext): Promise<NativeMethodInfo | null> {
        const document = context.document;
        const position = context.selection.active;
        
        // Find the method that contains the current position
        const methodRange = await this.findMethodRange(document, position);
        if (!methodRange) {
            return null;
        }

        const methodText = document.getText(methodRange);
        
        // Parse native method signature
        const nativeMethodRegex = /(?:public|private|protected)?\s*(?:static\s+)?native\s+(\w+)\s+(\w+)\s*\(([^)]*)\)\s*;/;
        const match = methodText.match(nativeMethodRegex);
        
        if (!match) {
            return null;
        }
        
        const returnType = match[1];
        const methodName = match[2];
        const parametersStr = match[3];
        
        // Extract class and package information
        const className = this.extractClassName(document);
        const packageName = this.extractPackageName(document);
        
        // Parse parameters
        const parameters = this.parseParameters(parametersStr);
        
        // Generate JNI signature
        const jniSignature = this.generateJniSignature(packageName, className, methodName);
        
        return {
            methodName,
            className,
            packageName,
            jniSignature,
            parameters,
            returnType,
            fullMethodSignature: match[0],
            methodBody: methodText
        };
    }

    private async findMethodRange(document: vscode.TextDocument, position: vscode.Position): Promise<vscode.Range | null> {
        // Look for the method signature that contains 'native'
        const text = document.getText();
        const lines = text.split('\n');
        
        for (let i = Math.max(0, position.line - 5); i <= Math.min(lines.length - 1, position.line + 5); i++) {
            const line = lines[i];
            if (line.includes('native') && line.includes('(')) {
                // Find the end of the method declaration (semicolon)
                let endLine = i;
                let endChar = line.indexOf(';');
                
                if (endChar === -1) {
                    // Method declaration spans multiple lines
                    for (let j = i + 1; j < lines.length; j++) {
                        endChar = lines[j].indexOf(';');
                        if (endChar !== -1) {
                            endLine = j;
                            break;
                        }
                    }
                }
                
                if (endChar !== -1) {
                    return new vscode.Range(
                        new vscode.Position(i, 0),
                        new vscode.Position(endLine, endChar + 1)
                    );
                }
            }
        }
        
        return null;
    }

    private extractClassName(document: vscode.TextDocument): string {
        const text = document.getText();
        const classMatch = text.match(/class\s+(\w+)/);
        return classMatch ? classMatch[1] : 'UnknownClass';
    }

    private extractPackageName(document: vscode.TextDocument): string {
        const text = document.getText();
        const packageMatch = text.match(/package\s+([\w.]+);/);
        return packageMatch ? packageMatch[1] : '';
    }

    private parseParameters(parametersStr: string): string[] {
        if (!parametersStr.trim()) {
            return [];
        }
        
        return parametersStr.split(',').map(param => param.trim());
    }

    private generateJniSignature(packageName: string, className: string, methodName: string): string {
        const fullClassName = packageName ? `${packageName}.${className}` : className;
        return `Java_${fullClassName.replace(/\./g, '_')}_${methodName}`;
    }

    private async selectTarget(context: RefactoringContext): Promise<TargetSelection | null> {
        const workspaceFolder = context.workspaceFolder;
        if (!workspaceFolder) {
            vscode.window.showErrorMessage('No open workspace folder');
            return null;
        }

        // 1. Collect .java files in the current document's directory
        const currentDir = path.dirname(context.document.uri.fsPath);
        let javaFilesInDir: string[] = [];
        try {
            const dirEntries = await fs.readdir(currentDir);
            javaFilesInDir = dirEntries.filter(f => f.endsWith('.java'))
                                       .map(f => path.join(currentDir, f));
        } catch (err) {
            console.warn('Unable to list current directory for QuickPick:', err);
        }

        // Build QuickPick items
        interface FilePickItem extends vscode.QuickPickItem { fullPath?: string; browse?: boolean; }
        const items: FilePickItem[] = javaFilesInDir.map(fp => ({
            label: path.basename(fp),
            description: path.relative(workspaceFolder.uri.fsPath, fp),
            fullPath: fp
        }));

        items.push({ label: '$(file-directory) Browse…', description: 'Select another file', browse: true });

        const picked = await vscode.window.showQuickPick(items, {
            placeHolder: 'Select target Java file',
            matchOnDescription: true
        });

        if (!picked) {
            return null; // cancelled
        }

        let selectedFile: string | undefined;
        if (picked.browse) {
            const fileUris = await vscode.window.showOpenDialog({
                canSelectFiles: true,
                canSelectMany: false,
                openLabel: 'Select Target Java File',
                filters: { 'Java Files': ['java'] },
                defaultUri: workspaceFolder.uri
            });
            if (!fileUris || fileUris.length === 0) {
                return null; // cancelled
            }
            selectedFile = fileUris[0].fsPath;
        } else {
            selectedFile = picked.fullPath;
        }

        if (!selectedFile) {
            return null;
        }

        const { packageName, className } = await this.extractPackageAndClassFromFile(selectedFile);
        return { packageName, className, filePath: selectedFile };
    }

    
    private async extractPackageAndClassFromFile(filePath: string): Promise<{packageName: string, className: string}> {
        try {
            const content = await fs.readFile(filePath, 'utf8');
            
            const packageMatch = content.match(/package\s+([\w.]+);/);
            const packageName = packageMatch ? packageMatch[1] : '';
            
            const classMatch = content.match(/class\s+(\w+)/);
            const className = classMatch ? classMatch[1] : path.basename(filePath, '.java');
            
            return { packageName, className };
        } catch (error) {
            return { packageName: '', className: path.basename(filePath, '.java') };
        }
    }

    private async copyJavaMethod(
        context: RefactoringContext,
        methodInfo: NativeMethodInfo,
        target: TargetSelection,
        workspaceEdit: vscode.WorkspaceEdit
    ): Promise<void> {
        if (!target.filePath) {
            return;
        }

        const targetUri = vscode.Uri.file(target.filePath);
        
        try {
            const targetDocument = await vscode.workspace.openTextDocument(targetUri);
            const targetContent = targetDocument.getText();
            
            // Find a good place to insert the method (before the last closing brace)
            const lines = targetContent.split('\n');
            let insertLine = lines.length - 1;
            
            // Find the last closing brace of the class
            for (let i = lines.length - 1; i >= 0; i--) {
                if (lines[i].trim() === '}') {
                    insertLine = i;
                    break;
                }
            }
            
            // Create the method to insert
            const methodToInsert = `\n    // Copied from ${methodInfo.className}\n    ${methodInfo.fullMethodSignature}\n`;
            
            const insertPosition = new vscode.Position(insertLine, 0);
            workspaceEdit.insert(targetUri, insertPosition, methodToInsert);
            
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to copy method to target file: ${error}`);
        }
    }

    private async createJniImplementation(
        context: RefactoringContext,
        methodInfo: NativeMethodInfo,
        target: TargetSelection,
        workspaceEdit: vscode.WorkspaceEdit
    ): Promise<void> {
        // Find or create corresponding C++ file
        const cppFilePath = await this.findOrCreateCppFile(context.workspaceFolder, target);
        if (!cppFilePath) {
            return;
        }

        const cppUri = vscode.Uri.file(cppFilePath);
        
        // Generate JNI method signature for target class
        const targetJniSignature = this.generateJniSignature(target.packageName, target.className, methodInfo.methodName);
        
        // Create JNI method implementation
        const jniMethod = this.generateJniMethodImplementation(targetJniSignature, methodInfo);
        
        try {
            // Check if file exists
            let insertPosition: vscode.Position;
            
            try {
                const cppDocument = await vscode.workspace.openTextDocument(cppUri);
                const cppContent = cppDocument.getText();
                
                // Insert at the end of the file
                const lines = cppContent.split('\n');
                insertPosition = new vscode.Position(lines.length, 0);
                
                workspaceEdit.insert(cppUri, insertPosition, `\n${jniMethod}\n`);
            } catch (error) {
                // File doesn't exist, create it
                const fileContent = this.generateCppFileHeader(target) + jniMethod + '\n';
                workspaceEdit.createFile(cppUri, { overwrite: false });
                workspaceEdit.insert(cppUri, new vscode.Position(0, 0), fileContent);
            }
            
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to create JNI implementation: ${error}`);
        }
    }

    private async findOrCreateCppFile(workspaceFolder: vscode.WorkspaceFolder, target: TargetSelection): Promise<string | null> {
        // 1. Try DependencyAnalyzer connections first
        try {
            const analyzer = new DependencyAnalyzer();
            const allConnections = await analyzer.getFileConnections();
            const match = allConnections.find(c => path.normalize(c.javaFile) === path.normalize(target.filePath || '') && c.isMatched);
            if (match && match.cppFile && match.cppFile !== 'Not found') {
                // Verify the file still exists
                try {
                    await fs.access(match.cppFile);
                    return match.cppFile;
                } catch {
                    // File no longer exists, continue to fallback logic
                }
            }
        } catch (err) {
            console.warn('DependencyAnalyzer connection lookup failed, falling back to heuristic search:', err);
        }
        // 2. Fallback: Look for existing C++ file with similar name
        const possibleNames = [
            `${target.className.toLowerCase()}_native.cpp`,
            `${target.className}_native.cpp`,
            `${target.className.toLowerCase()}.cpp`,
            `${target.className}.cpp`
        ];
        
        const possiblePaths = [
            path.join(workspaceFolder.uri.fsPath, 'src', 'main', 'cpp'),
            path.join(workspaceFolder.uri.fsPath, 'cpp'),
            path.join(workspaceFolder.uri.fsPath, 'native'),
            path.join(workspaceFolder.uri.fsPath, 'jni')
        ];
        
        // Check if any existing file exists
        for (const basePath of possiblePaths) {
            for (const fileName of possibleNames) {
                const fullPath = path.join(basePath, fileName);
                try {
                    await fs.access(fullPath);
                    return fullPath; // File exists
                } catch {
                    // File doesn't exist, continue
                }
            }
        }
        
        // No existing file found, create new one
        const defaultPath = possiblePaths[0]; // Use first path as default
        const defaultFileName = possibleNames[0]; // Use first name as default
        
        try {
            await fs.mkdir(defaultPath, { recursive: true });
            return path.join(defaultPath, defaultFileName);
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to create directory: ${error}`);
            return null;
        }
    }

    private generateJniMethodImplementation(jniSignature: string, methodInfo: NativeMethodInfo): string {
        // Convert Java types to JNI types
        const jniReturnType = this.javaToJniType(methodInfo.returnType);
        const jniParams = methodInfo.parameters.map(param => {
            const [type] = param.trim().split(/\s+/);
            return this.javaToJniType(type);
        });
        
        // Generate parameter list
        const paramList = ['JNIEnv *env', 'jobject thiz', ...jniParams.map((type, index) => `${type} param${index}`)].join(', ');
        
        return `
// JNI implementation for ${methodInfo.methodName}
JNIEXPORT ${jniReturnType} JNICALL ${jniSignature}(${paramList}) {
    // TODO: Implement ${methodInfo.methodName}
    // This method was copied from ${methodInfo.className}
    
    ${this.generateDefaultReturn(jniReturnType)}
}`;
    }

    private generateCppFileHeader(target: TargetSelection): string {
        return `#include <jni.h>
#include <string>

// JNI implementations for ${target.className}
// Generated by Dependency Visualizer

`;
    }

    private javaToJniType(javaType: string): string {
        const typeMap: { [key: string]: string } = {
            'void': 'void',
            'boolean': 'jboolean',
            'byte': 'jbyte',
            'char': 'jchar',
            'short': 'jshort',
            'int': 'jint',
            'long': 'jlong',
            'float': 'jfloat',
            'double': 'jdouble',
            'String': 'jstring',
            'Object': 'jobject'
        };
        
        return typeMap[javaType] || 'jobject';
    }

    private generateDefaultReturn(jniReturnType: string): string {
        if (jniReturnType === 'void') {
            return '';
        }
        
        const defaultValues: { [key: string]: string } = {
            'jboolean': 'return JNI_FALSE;',
            'jbyte': 'return 0;',
            'jchar': 'return 0;',
            'jshort': 'return 0;',
            'jint': 'return 0;',
            'jlong': 'return 0L;',
            'jfloat': 'return 0.0f;',
            'jdouble': 'return 0.0;',
            'jstring': 'return env->NewStringUTF("");',
            'jobject': 'return nullptr;'
        };
        
        return defaultValues[jniReturnType] || 'return nullptr;';
    }
}
