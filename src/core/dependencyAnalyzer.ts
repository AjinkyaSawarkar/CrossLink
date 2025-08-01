import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { JavaParser } from '../parsers/javaParser';
import { CppParser } from '../parsers/cppParser';
import { ConflictDetector } from './conflictDetector';
import { PlatformChecker } from './platformChecker';

export interface Dependency {
    name: string;
    version: string;
    type: 'jar' | 'so' | 'dll' | 'dylib';
    path?: string;
    platform?: string;
    conflicts?: string[];
    missing?: boolean;
    platformIssue?: boolean;
}

export interface ProjectInfo {
    type: 'java' | 'cpp';
    buildSystem: 'maven' | 'gradle' | 'cmake' | 'conan' | 'vcpkg';
    dependencies: Dependency[];
    buildFile: string;
}

export interface FileConnection {
    javaFile: string;
    cppFile: string;
    methodName: string;
    isMatched: boolean;
    details: string; // e.g., "JNI signature matched" or error
}

export class DependencyAnalyzer {
    private javaParser = new JavaParser();
    private cppParser = new CppParser();
    private conflictDetector = new ConflictDetector();
    private platformChecker = new PlatformChecker();
    private projects: ProjectInfo[] = [];
    private diagnostics: vscode.Diagnostic[] = [];

    async analyzeDependencies(workspacePath: string): Promise<ProjectInfo[]> {
        this.projects = [];
        this.diagnostics = [];

        // Find Java projects
        const javaProjects = await this.findJavaProjects(workspacePath);
        for (const project of javaProjects) {
            const projectInfo = await this.analyzeJavaProject(project);
            if (projectInfo) {
                this.projects.push(projectInfo);
            }
        }

        // Find C++ projects
        const cppProjects = await this.findCppProjects(workspacePath);
        for (const project of cppProjects) {
            const projectInfo = await this.analyzeCppProject(project);
            if (projectInfo) {
                this.projects.push(projectInfo);
            }
        }

        // Analyze conflicts and issues
        await this.analyzeIssues();

        return this.projects;
    }

    private async findJavaProjects(workspacePath: string): Promise<string[]> {
    const projects: string[] = [];
    const glob = require('glob');

    // Find Maven projects
    const pomFiles = glob.sync('**/pom.xml', { cwd: workspacePath });
    projects.push(...pomFiles.map((f: string) => path.join(workspacePath, f)));

    // Find Gradle projects
    const gradleFiles = glob.sync('**/build.gradle*', { cwd: workspacePath });
    projects.push(...gradleFiles.map((f: string) => path.join(workspacePath, f)));

    return projects;
}

private async findCppProjects(workspacePath: string): Promise<string[]> {
    const projects: string[] = [];
    const glob = require('glob');

    // Find CMake projects
    const cmakeFiles = glob.sync('**/CMakeLists.txt', { cwd: workspacePath });
    projects.push(...cmakeFiles.map((f: string) => path.join(workspacePath, f)));

    // Find Conan projects
    const conanFiles = glob.sync('**/conanfile.*', { cwd: workspacePath });
    projects.push(...conanFiles.map((f: string) => path.join(workspacePath, f)));

    // Find vcpkg projects
    const vcpkgFiles = glob.sync('**/vcpkg.json', { cwd: workspacePath });
    projects.push(...vcpkgFiles.map((f: string) => path.join(workspacePath, f)));

    return projects;
}

    // private async findCppProjects(workspacePath: string): Promise<string[]> {
    //     const projects: string[] = [];
    //     const glob = require('glob');

    //     // Find CMake projects
    //     const cmakeFiles = glob.sync('**/CMakeLists.txt', { cwd: workspacePath });
    //     projects.push(...cmakeFiles.map(f => path.join(workspacePath, f)));

    //     // Find Conan projects
    //     const conanFiles = glob.sync('**/conanfile.*', { cwd: workspacePath });
    //     projects.push(...conanFiles.map(f => path.join(workspacePath, f)));

    //     // Find vcpkg projects
    //     const vcpkgFiles = glob.sync('**/vcpkg.json', { cwd: workspacePath });
    //     projects.push(...vcpkgFiles.map(f => path.join(workspacePath, f)));

    //     return projects;
    // }

    private async analyzeJavaProject(buildFile: string): Promise<ProjectInfo | null> {
        try {
            const dependencies = await this.javaParser.parseDependencies(buildFile);
            const buildSystem = buildFile.includes('pom.xml') ? 'maven' : 'gradle';
            
            return {
                type: 'java',
                buildSystem: buildSystem as 'maven' | 'gradle',
                dependencies,
                buildFile
            };
        } catch (error) {
            console.error(`Error analyzing Java project ${buildFile}:`, error);
            return null;
        }
    }

    private async analyzeCppProject(buildFile: string): Promise<ProjectInfo | null> {
        try {
            const dependencies = await this.cppParser.parseDependencies(buildFile);
            let buildSystem: 'cmake' | 'conan' | 'vcpkg' = 'cmake';
            
            if (buildFile.includes('conanfile')) {
                buildSystem = 'conan';
            } else if (buildFile.includes('vcpkg.json')) {
                buildSystem = 'vcpkg';
            }
            
            return {
                type: 'cpp',
                buildSystem,
                dependencies,
                buildFile
            };
        } catch (error) {
            console.error(`Error analyzing C++ project ${buildFile}:`, error);
            return null;
        }
    }

    private async analyzeIssues(): Promise<void> {
        for (const project of this.projects) {
            // Check for version conflicts
            const conflicts = this.conflictDetector.detectConflicts(project.dependencies);
            
            // Check for missing libraries
            const missingLibs = await this.checkMissingLibraries(project);
            
            // Check platform compatibility
            const platformIssues = this.platformChecker.checkCompatibility(project.dependencies);
            
            // Update dependencies with issues
            this.updateDependenciesWithIssues(project, conflicts, missingLibs, platformIssues);
            
            // Create diagnostics
            this.createDiagnostics(project, conflicts, missingLibs, platformIssues);
        }
    }

    private async checkMissingLibraries(project: ProjectInfo): Promise<string[]> {
        const missing: string[] = [];
        
        for (const dep of project.dependencies) {
            if (dep.path && !fs.existsSync(dep.path)) {
                missing.push(dep.name);
                dep.missing = true;
            }
        }
        
        return missing;
    }

    private updateDependenciesWithIssues(
        project: ProjectInfo,
        conflicts: Map<string, string[]>,
        missingLibs: string[],
        platformIssues: string[]
    ): void {
        for (const dep of project.dependencies) {
            if (conflicts.has(dep.name)) {
                dep.conflicts = conflicts.get(dep.name);
            }
            if (missingLibs.includes(dep.name)) {
                dep.missing = true;
            }
            if (platformIssues.includes(dep.name)) {
                dep.platformIssue = true;
            }
        }
    }

    private createDiagnostics(
        project: ProjectInfo,
        conflicts: Map<string, string[]>,
        missingLibs: string[],
        platformIssues: string[]
    ): void {
        const uri = vscode.Uri.file(project.buildFile);
        
        // Add conflict diagnostics
        conflicts.forEach((versions, libName) => {
            const diagnostic = new vscode.Diagnostic(
                new vscode.Range(0, 0, 0, 0),
                `Version conflict for ${libName}: ${versions.join(', ')}`,
                vscode.DiagnosticSeverity.Warning
            );
            this.diagnostics.push(diagnostic);
        });
        
        // Add missing library diagnostics
        missingLibs.forEach(libName => {
            const diagnostic = new vscode.Diagnostic(
                new vscode.Range(0, 0, 0, 0),
                `Missing library: ${libName}`,
                vscode.DiagnosticSeverity.Error
            );
            this.diagnostics.push(diagnostic);
        });
        
        // Add platform issue diagnostics
        platformIssues.forEach(libName => {
            const diagnostic = new vscode.Diagnostic(
                new vscode.Range(0, 0, 0, 0),
                `Platform compatibility issue: ${libName}`,
                vscode.DiagnosticSeverity.Warning
            );
            this.diagnostics.push(diagnostic);
        });
    }

    getProjects(): ProjectInfo[] {
        return this.projects;
    }

    getDiagnostics(): vscode.Diagnostic[] {
        return this.diagnostics;
    }



     // Make sure this method exists and returns FileConnection[]
    async getFileConnections(): Promise<FileConnection[]> {
        const connections: FileConnection[] = [];
        
        console.log('Starting file connection analysis...');
        
        // Find Java files with native methods
        const javaFiles = await vscode.workspace.findFiles('**/*.java');
        console.log(`Found ${javaFiles.length} Java files`);
        
        for (const javaFile of javaFiles) {
            const javaDoc = await vscode.workspace.openTextDocument(javaFile);
            const nativeMethods = this.extractNativeMethods(javaDoc);
            console.log(`Extracted ${nativeMethods.length} native methods from ${javaFile.fsPath}`);
            
            for (const method of nativeMethods) {
                const cppMatch = await this.findMatchingCppImplementation(method);
                connections.push({
                    javaFile: javaFile.fsPath,
                    cppFile: cppMatch ? cppMatch.file : 'Not found',
                    methodName: method.methodName,
                    isMatched: !!cppMatch,
                    details: cppMatch ? 'Matched' : 'No C++ implementation found'
                });
            }
        }
        
        console.log(`Found ${connections.length} connections`);
        return connections;
    }

    // Add these helper methods if they don't exist
    private extractNativeMethods(document: vscode.TextDocument): Array<{ methodName: string; className: string; packageName: string }> {
        const content = document.getText();
        const methods = [];
        const nativeRegex = /native\s+\w+\s+(\w+)\s*\(/g;
        let match;
        while ((match = nativeRegex.exec(content)) !== null) {
            methods.push({
                methodName: match[1],
                className: this.extractClassName(document),
                packageName: this.extractPackageName(document)
            });
        }
        return methods;
    }

    private async findMatchingCppImplementation(method: { methodName: string; className: string; packageName: string }): Promise<{ file: string } | null> {
        const cppFiles = await vscode.workspace.findFiles('**/*.{cpp,cc,cxx,c,h,hpp}');
        
        // Build expected JNI prefix (handling empty package name)
        let expectedPrefix = 'Java_';
        if (method.packageName) {
            expectedPrefix += `${method.packageName.replace(/\./g, '_')}_`;
        }
        expectedPrefix += `${method.className}_${method.methodName}`;
        
        const regex = new RegExp(`JNIEXPORT\\s+\\w+\\s+JNICALL\\s+${expectedPrefix}\\b`, 'g');
        
        for (const cppFile of cppFiles) {
            const cppDoc = await vscode.workspace.openTextDocument(cppFile);
            const content = cppDoc.getText();
            if (regex.test(content)) {
                console.log(`Match found in ${cppFile.fsPath} for prefix ${expectedPrefix}`);
                return { file: cppFile.fsPath };
            }
        }
        
        console.log(`No match found for prefix ${expectedPrefix}`);
        return null;
    }

    private extractClassName(document: vscode.TextDocument): string {
        const content = document.getText();
        const match = content.match(/class\s+(\w+)/);
        return match ? match[1] : '';
    }

    private extractPackageName(document: vscode.TextDocument): string {
        const content = document.getText();
        const match = content.match(/package\s+([\w.]+);/);
        return match ? match[1] : '';
    }

}
