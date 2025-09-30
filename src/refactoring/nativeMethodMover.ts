// src/refactoring/nativeMethodMover.ts
import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs/promises'; // Use promises for async file operations

import { RefactoringContext, RefactoringOperation, RefactoringPreview } from './refactoringProvider';

interface NativeMethodInfo {
    methodName: string;
    className: string;
    packageName: string;
    jniSignature: string;
    parameters: string[];
    returnType: string;
}

interface TargetSelection {
    className: string;
    packageName: string;
    filePath?: string; // For browse option
}

export class NativeMethodMover implements RefactoringOperation {
    id = 'dependency-visualizer.move-native-method';
    title = 'Move Native Method';
    description = 'Move Java native method to another class/package with JNI adjustments';

    async canApply(context: RefactoringContext): Promise<boolean> {
        if (context.language !== 'java') {
            return false;
        }
        const document = context.document;
        const position = context.selection.active;
        const text = document.lineAt(position.line).text;
        if (text.includes('native') && text.includes('(')) return true;
        // Allow wrapper that calls *Impl(...)
        if (/\b\w+Impl\s*\(/.test(text)) return true;
        return false;
    }

    async apply(context: RefactoringContext): Promise<vscode.WorkspaceEdit> {
        const methodInfo = await this.extractNativeMethodInfo(context);
        if (!methodInfo) {
            vscode.window.showErrorMessage('Unable to extract native method information');
            return new vscode.WorkspaceEdit();
        }

        const target = await this.selectTarget(context);
        if (!target) {
            vscode.window.showInformationMessage('Method movement cancelled');
            return new vscode.WorkspaceEdit();
        }

        const workspaceEdit = new vscode.WorkspaceEdit();
        
        // 1. Move Java method
        await this.moveJavaMethod(context, methodInfo, target, workspaceEdit);
        
        // 2. Update JNI implementation
        await this.updateJniImplementation(context, methodInfo, target, workspaceEdit);
        
        // 3. Update CMakeLists.txt if needed
        await this.updateCMakeFiles(context, methodInfo, target, workspaceEdit);
        
        return workspaceEdit;
    }

    async preview(context: RefactoringContext): Promise<RefactoringPreview> {
        const methodInfo = await this.extractNativeMethodInfo(context);
        if (!methodInfo) {
            return { title: 'Move Native Method', changes: [] };
        }

        const changes: Array<{file: string; oldContent: string; newContent: string; diff: string}> = [];
        
        // Preview Java file changes
        const javaChanges = await this.previewJavaChanges(context, methodInfo);
        changes.push(...javaChanges);
        
        // Preview C++ file changes
        const cppChanges = await this.previewCppChanges(context, methodInfo);
        changes.push(...cppChanges);
        
        return {
            title: `Move Native Method: ${methodInfo.methodName}`,
            changes
        };
    }

    private async extractNativeMethodInfo(context: RefactoringContext): Promise<NativeMethodInfo | null> {
        const document = context.document;
        const position = context.selection.active;

        // Find the complete method declaration range near the cursor
        const methodRange = await this.findMethodRange(document, position);
        if (!methodRange) {
            return null;
        }

        const methodText = document.getText(methodRange);

        // Parse native method signature from the captured text
        // Allow flexible modifier order (e.g., 'native private'), annotations, arrays/generics
        const nativeMethodRegex = new RegExp(
            String.raw`^\s*` +
            String.raw`(?:@[\w.]+(?:\([^)]*\))?\s*)*` +
            String.raw`(?:(?:public|private|protected|static|final|abstract|strictfp|synchronized)\s+)*` +
            String.raw`native\s+` +
            String.raw`(?:(?:public|private|protected|static|final|abstract|strictfp|synchronized)\s+)*` +
            String.raw`([A-Za-z_$][\w$<>.?]*?(?:\s*\[\s*\])*)\s+` +
            String.raw`([A-Za-z_$]\w*)\s*` +
            String.raw`\(([^)]*)\)\s*;`,
            'm'
        );
        let match = methodText.match(nativeMethodRegex);
        if (!match) {
            // Loose fallback window around cursor
            const docText = document.getText();
            const pos = document.offsetAt(methodRange.start);
            const windowStart = Math.max(0, pos - 1000);
            const windowEnd = Math.min(docText.length, pos + 2000);
            const windowText = docText.slice(windowStart, windowEnd);
            const looseRegex = /native[\s\w@<>,\[\].$?]*?([A-Za-z_$][\w$<>.?]*(?:\s*\[\s*\])*)\s+([A-Za-z_$]\w*)\s*\(([^)]*)\)\s*;/m;
            const looseMatch = windowText.match(looseRegex);
            if (looseMatch) {
                match = looseMatch as any;
            }
        }
        if (!match) {
            // Wrapper fallback: find *Impl call and native declaration elsewhere in document
            const implCall = methodText.match(/([A-Za-z_$]\w*Impl)\s*\(/);
            if (implCall) {
                const implName = implCall[1];
                const found = this.findNativeDeclarationByName(document, implName);
                if (found) {
                    const returnType = found.returnType;
                    const methodName = implName;
                    const parametersStr = found.parametersStr;
                    const className = this.extractClassName(document);
                    const packageName = this.extractPackageName(document);
                    const parameters = this.parseParameters(parametersStr);
                    const jniSignature = this.generateJniSignature(packageName, className, methodName);
                    return { methodName, className, packageName, jniSignature, parameters, returnType };
                }
            }
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
            returnType
        };
    }

    // Helper: find a native declaration by its method name in the current document
    private findNativeDeclarationByName(document: vscode.TextDocument, methodName: string): { returnType: string; parametersStr: string } | null {
        const text = document.getText();
        const escaped = methodName.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
        const re = new RegExp(
            String.raw`^\s*(?:@[\w.]+(?:\([^)]*\))?\s*)*` +
            String.raw`(?:(?:public|private|protected|static|final|abstract|strictfp|synchronized)\s+)*native\s+` +
            String.raw`(?:(?:public|private|protected|static|final|abstract|strictfp|synchronized)\s+)*` +
            String.raw`([A-Za-z_$][\w$<>.?]*?(?:\s*\[\s*\])*)\s+` +
            escaped +
            String.raw`\s*\(([^)]*)\)\s*;`,
            'm'
        );
        const m = text.match(re);
        if (!m) return null;
        return { returnType: m[1], parametersStr: m[2] };
    }

    // UPDATED: Package and file selector logic
    private async selectTarget(context: RefactoringContext): Promise<TargetSelection | null> {
        const workspaceFolder = context.workspaceFolder;
        if (!workspaceFolder) {
            vscode.window.showErrorMessage('No open workspace folder');
            return null;
        }

        // Step 1: Scan available packages in the open folder
        const packages = await this.scanPackages(workspaceFolder.uri.fsPath);
        
        // Step 2: Prepare QuickPick items for packages
        const quickPickItems: vscode.QuickPickItem[] = [
            { label: '$(folder-opened) Browse for target file...', description: 'Select from filesystem', alwaysShow: true }
        ];
        
        packages.forEach(pkg => {
            quickPickItems.push({
                label: pkg.packageName,
                description: `Classes: ${pkg.classCount}`,
                detail: pkg.path
            });
        });

        // Step 3: Show QuickPick for packages
        const selectedPackage = await vscode.window.showQuickPick(quickPickItems, {
            placeHolder: 'Select target package or browse for file',
            matchOnDescription: true,
            matchOnDetail: true
        });

        if (!selectedPackage) {
            return null;
        }

        if (selectedPackage.label.startsWith('$(folder-opened)')) {
            // Browse option selected
            const fileUris = await vscode.window.showOpenDialog({
                canSelectFiles: true,
                canSelectMany: false,
                openLabel: 'Select Target Java File',
                filters: { 'Java Files': ['java'] }
            });

            if (!fileUris || fileUris.length === 0) {
                return null;
            }

            const selectedFile = fileUris[0].fsPath;
            const { packageName, className } = this.extractPackageAndClassFromFile(selectedFile, workspaceFolder.uri.fsPath);
            
            return { packageName, className, filePath: selectedFile };
        } else {
            // Package selected - now show existing classes/files in that package
            const packagePath = path.join(workspaceFolder.uri.fsPath, 'src', 'main', 'java', selectedPackage.label.replace(/\./g, path.sep));
            
            const classItems: vscode.QuickPickItem[] = [
                { label: '$(new-file) Create New Class...', description: 'Create a new class in this package', alwaysShow: true }
            ];
            
            // Scan for existing .java files in the package directory
            try {
                const files = await fs.readdir(packagePath);
                const javaFiles = files.filter(file => file.endsWith('.java'));
                
                javaFiles.forEach(file => {
                    const className = file.replace('.java', '');
                    classItems.push({
                        label: className,
                        description: 'Existing class',
                        detail: path.join(packagePath, file)
                    });
                });
            } catch (error) {
                console.error(`Error reading package directory ${packagePath}:`, error);
                vscode.window.showWarningMessage(`Package directory not found: ${selectedPackage.label}. You can still create a new class.`);
            }

            // Show QuickPick for classes
            const selectedClass = await vscode.window.showQuickPick(classItems, {
                placeHolder: `Select target class in package ${selectedPackage.label} or create new`,
                matchOnDescription: true,
                matchOnDetail: true
            });

            if (!selectedClass) {
                return null;
            }

            if (selectedClass.label.startsWith('$(new-file)')) {
                // Prompt for new class name
                const className = await vscode.window.showInputBox({
                    prompt: `Enter new class name in package ${selectedPackage.label}`,
                    validateInput: (value) => {
                        if (!value.trim()) return 'Class name cannot be empty';
                        if (!/^[A-Z][a-zA-Z0-9_]*$/.test(value)) return 'Invalid class name (should start with uppercase letter)';
                        return null;
                    }
                });

                if (!className) {
                    return null;
                }

                return { packageName: selectedPackage.label, className };
            } else {
                // Existing class selected
                return { packageName: selectedPackage.label, className: selectedClass.label };
            }
        }
    }

    // NEW: Scan packages in the open folder
    private async scanPackages(workspacePath: string): Promise<Array<{packageName: string; path: string; classCount: number}>> {
        const packages: Array<{packageName: string; path: string; classCount: number}> = [];
        
        // Assume standard Java source structure: src/main/java
        const javaSrcPath = path.join(workspacePath, 'src', 'main', 'java');
        
        try {
            await fs.access(javaSrcPath); // Check if path exists
        } catch {
            vscode.window.showWarningMessage('No src/main/java folder found in workspace');
            return packages;
        }

        // Recursively scan directories
        const scanDir = async (currentPath: string, currentPackage: string): Promise<number> => {
            let classCount = 0;
            try {
                const entries = await fs.readdir(currentPath, { withFileTypes: true });
                
                for (const entry of entries) {
                    const entryPath = path.join(currentPath, entry.name);
                    if (entry.isDirectory()) {
                        const newPackage = currentPackage ? `${currentPackage}.${entry.name}` : entry.name;
                        const subCount = await scanDir(entryPath, newPackage);
                        classCount += subCount;
                    } else if (entry.name.endsWith('.java')) {
                        classCount++;
                    }
                }

                if (classCount > 0 || entries.some(e => e.isDirectory())) {
                    packages.push({
                        packageName: currentPackage || '(root)',
                        path: path.relative(javaSrcPath, currentPath),
                        classCount
                    });
                }
            } catch (error) {
                console.error(`Error scanning directory ${currentPath}:`, error);
            }
            return classCount;
        };

        await scanDir(javaSrcPath, '');
        
        // Sort by package name
        packages.sort((a, b) => a.packageName.localeCompare(b.packageName));
        
        return packages;
    }

    // NEW: Extract package and class from file path (relative to workspace)
    private extractPackageAndClassFromFile(filePath: string, workspacePath: string): {packageName: string; className: string} {
        const relativePath = path.relative(workspacePath, filePath);
        const className = path.basename(relativePath, '.java');
        const dirPath = path.dirname(relativePath);
        
        // Derive package from directory structure (assuming src/main/java root)
        const packageParts = dirPath.split(path.sep).filter(part => part && !['src', 'main', 'java'].includes(part));
        const packageName = packageParts.join('.');
        
        return { packageName, className };
    }

    // NEW: Move Java method with package/class handling
    private async moveJavaMethod(
        context: RefactoringContext,
        methodInfo: NativeMethodInfo,
        target: TargetSelection,
        workspaceEdit: vscode.WorkspaceEdit
    ): Promise<void> {
        const document = context.document;
        const position = context.selection.active;
        
        // Find the complete method declaration
        const methodRange = await this.findMethodRange(document, position);
        if (!methodRange) {
            return;
        }
        
        const methodText = document.getText(methodRange);
        
        // Remove from current class
        workspaceEdit.delete(document.uri, methodRange);
        
        // Find or create target class file
        const targetClassFile = await this.findOrCreateTargetClass(target, workspaceEdit);
        
        // Add to target class
        await this.addMethodToTargetClass(targetClassFile, methodText, workspaceEdit);
    }

    private async updateJniImplementation(
        context: RefactoringContext,
        methodInfo: NativeMethodInfo,
        target: TargetSelection,
        workspaceEdit: vscode.WorkspaceEdit
    ): Promise<void> {
        // Find corresponding C/C++ source and header files
        const cppFiles = await this.findCppFiles(context.workspaceFolder);
        
        for (const cppFile of cppFiles) {
            const document = await vscode.workspace.openTextDocument(cppFile);
            const content = document.getText();
            
            // Find JNI function implementation
            const oldJniName = this.generateJniSignature(
                methodInfo.packageName,
                methodInfo.className,
                methodInfo.methodName
            );
            
            const newJniName = this.generateJniSignature(
                target.packageName,
                target.className,
                methodInfo.methodName
            );
            
            // Replace JNI function signatures (Java_qualifiedName_method) across impl and headers
            const escapedOld = oldJniName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const updatedContent = content.replace(new RegExp(`Java_${escapedOld}`, 'g'), `Java_${newJniName}`);
            
            if (updatedContent !== content) {
                const fullRange = new vscode.Range(
                    document.positionAt(0),
                    document.positionAt(content.length)
                );
                workspaceEdit.replace(document.uri, fullRange, updatedContent);
            }
        }
    }

    private async updateCMakeFiles(
        context: RefactoringContext,
        methodInfo: NativeMethodInfo,
        target: TargetSelection,
        workspaceEdit: vscode.WorkspaceEdit
    ): Promise<void> {
        const cmakeFiles = await vscode.workspace.findFiles('**/CMakeLists.txt');
        
        for (const cmakeFile of cmakeFiles) {
            const document = await vscode.workspace.openTextDocument(cmakeFile);
            const content = document.getText();
            
            // Look for JNI-related configurations that might need updating
            // (This is a placeholder; customize based on your CMake setup)
            const jniConfigRegex = /find_package\s*\(\s*JNI\s+REQUIRED\s*\)/g;
            if (jniConfigRegex.test(content)) {
                // Example: Add or update any necessary CMake entries for the moved method
                // For now, log for debugging
                console.log(`CMake file ${cmakeFile.fsPath} may need manual updates for moved method`);
            }
        }
    }

    private extractClassName(document: vscode.TextDocument): string {
        const content = document.getText();
        const classMatch = content.match(/class\s+(\w+)/);
        return classMatch ? classMatch[1] : '';
    }

    private extractPackageName(document: vscode.TextDocument): string {
        const content = document.getText();
        const packageMatch = content.match(/package\s+([\w.]+);/);
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
        return fullClassName.replace(/\./g, '_') + '_' + methodName;
    }

    private async findMethodRange(document: vscode.TextDocument, position: vscode.Position): Promise<vscode.Range | null> {
        const text = document.getText();
        const lines = text.split('\n');
        
        // Find method start and end
        let startLine = position.line;
        let endLine = position.line;
        
        // Find method start (look for native keyword)
        while (startLine > 0 && !lines[startLine].includes('native')) {
            startLine--;
        }
        
        // Find method end (look for semicolon)
        while (endLine < lines.length - 1 && !lines[endLine].includes(';')) {
            endLine++;
        }
        
        return new vscode.Range(
            new vscode.Position(startLine, 0),
            new vscode.Position(endLine, lines[endLine].length)
        );
    }

    private async findOrCreateTargetClass(
        target: TargetSelection,
        workspaceEdit: vscode.WorkspaceEdit
    ): Promise<vscode.Uri> {
        if (target.filePath) {
            // From browse option - use selected file directly
            const targetUri = vscode.Uri.file(target.filePath);
            try {
                await fs.access(target.filePath);
                return targetUri;
            } catch {
                // Create if not exists
                workspaceEdit.createFile(targetUri, { overwrite: false });
                const classTemplate = `package ${target.packageName};\n\npublic class ${target.className} {\n    \n}`;
                workspaceEdit.insert(targetUri, new vscode.Position(0, 0), classTemplate);
                return targetUri;
            }
        }

        // From package selection - build path
        const workspaceFolder = vscode.workspace.workspaceFolders![0];
        const packagePath = target.packageName.replace(/\./g, path.sep);
        const classFileName = `${target.className}.java`;
        const newFilePath = path.join(workspaceFolder.uri.fsPath, 'src', 'main', 'java', packagePath, classFileName);
        const newFileUri = vscode.Uri.file(newFilePath);
        
        try {
            await fs.access(newFilePath);
            return newFileUri;
        } catch {
            // Create new file
            workspaceEdit.createFile(newFileUri, { overwrite: false });
            const classTemplate = `package ${target.packageName};\n\npublic class ${target.className} {\n    \n}`;
            workspaceEdit.insert(newFileUri, new vscode.Position(0, 0), classTemplate);
            return newFileUri;
        }
    }

    private async addMethodToTargetClass(
        targetFile: vscode.Uri,
        methodText: string,
        workspaceEdit: vscode.WorkspaceEdit
    ): Promise<void> {
        const document = await vscode.workspace.openTextDocument(targetFile);
        const content = document.getText();
        
        // Find the class body end
        const classEndRegex = /}\s*$/;
        const match = classEndRegex.exec(content);
        
        if (match) {
            const insertPosition = document.positionAt(match.index);
            workspaceEdit.insert(targetFile, insertPosition, `\n    ${methodText}\n`);
        }
    }

    private async findCppFiles(workspaceFolder: vscode.WorkspaceFolder): Promise<vscode.Uri[]> {
        // Include headers too, as some projects declare JNI symbols in .h/.hpp
        const files = await vscode.workspace.findFiles('**/*.{cpp,cc,cxx,c,h,hpp}');
        return files;
    }

    private async previewJavaChanges(context: RefactoringContext, methodInfo: NativeMethodInfo): Promise<Array<{file: string; oldContent: string; newContent: string; diff: string}>> {
        // Implementation for previewing Java changes (stub; expand as needed)
        return [];
    }

    private async previewCppChanges(context: RefactoringContext, methodInfo: NativeMethodInfo): Promise<Array<{file: string; oldContent: string; newContent: string; diff: string}>> {
        // Implementation for previewing C++ changes (stub; expand as needed)
        return [];
    }
}
