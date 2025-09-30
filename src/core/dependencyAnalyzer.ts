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
    // Cache for JNI symbol index across a single analysis pass
    private jniIndex: Map<string, Set<string>> | null = null; // symbol -> set of file paths

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

    // Public API: rebuild the JNI index on demand
    async rebuildJniIndex(): Promise<{ symbols: number; files: number }> {
        this.jniIndex = await this.buildJniSymbolIndex();
        return this.getJniIndexStats();
    }

    // Public API: quick stats of current index
    getJniIndexStats(): { symbols: number; files: number } {
        const symbols = this.jniIndex ? this.jniIndex.size : 0;
        const files = this.jniIndex ? Array.from(this.jniIndex.values()).reduce((acc, s) => acc + s.size, 0) : 0;
        return { symbols, files };
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

        console.log('Starting file connection analysis (optimized)...');

        // 1) Build JNI symbol index once (Java_qualified_Class_method[__overload]) -> file paths
        if (!this.jniIndex) {
            this.jniIndex = await this.buildJniSymbolIndex();
        }
        const indexSize = Array.from(this.jniIndex.values()).reduce((acc, s) => acc + s.size, 0);
        console.log(`JNI index built: ${this.jniIndex.size} symbols across ${indexSize} hits`);

        // 2) Find Java files and extract native methods
        const javaFiles = await vscode.workspace.findFiles('**/*.java');
        console.log(`Found ${javaFiles.length} Java files`);

        // Process Java files with limited concurrency to avoid UI stalls
        const cfg = vscode.workspace.getConfiguration('dependencyVisualizer');
        const concurrency = Math.max(2, Math.min(16, cfg.get<number>('jni.indexConcurrency') ?? 8));
        let i = 0;
        const runNext = async (): Promise<void> => {
            if (i >= javaFiles.length) return;
            const file = javaFiles[i++];
            try {
                const javaDoc = await vscode.workspace.openTextDocument(file);
                const nativeMethods = this.extractNativeMethods(javaDoc);
                if (nativeMethods.length === 0) return runNext();

                for (const method of nativeMethods) {
                    const match = this.lookupInJniIndex(method);
                    connections.push({
                        javaFile: file.fsPath,
                        cppFile: match ?? 'Not found',
                        methodName: method.methodName,
                        isMatched: !!match,
                        details: match ? 'Matched (indexed)' : 'No C++ implementation found'
                    });
                }
            } catch (err) {
                console.warn(`Failed processing ${file.fsPath}:`, err);
            }
            return runNext();
        };

        await Promise.all(Array.from({ length: Math.min(concurrency, javaFiles.length) }, () => runNext()));

        console.log(`Found ${connections.length} connections (optimized)`);
        return connections;
    }

    // Add these helper methods if they don't exist
    private extractNativeMethods(document: vscode.TextDocument): Array<{ methodName: string; className: string; packageName: string }> {
        const content = document.getText();
        const methods: Array<{ methodName: string; className: string; packageName: string }> = [];

        // Line-based scanner tolerant to annotations and modifier order
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
            if (!/\bnative\b/.test(lines[i])) continue;

            let decl = lines[i];
            let endLine = i;
            const isTerminator = (s: string) => s.includes(';') || s.includes('{');
            while (endLine < lines.length && !isTerminator(lines[endLine])) {
                endLine++;
                if (endLine < lines.length) decl += '\n' + lines[endLine];
            }
            if (endLine >= lines.length) break;
            if (!decl.includes('(')) continue;

            // Flexible signature pattern: native among modifiers, capture method name as last identifier before '('
            const sigMatch = decl.match(/\bnative\b[\s\w@<>,\[\].()?]*?([A-Za-z_$][\w\[\]<>.?$]*)\s+([A-Za-z_$]\w*)\s*\(/);
            if (!sigMatch) continue;
            const methodName = sigMatch[2];

            methods.push({
                methodName,
                className: this.extractClassName(document),
                packageName: this.extractPackageName(document)
            });
        }
        
        // Fallback: robust global regex
        if (methods.length === 0) {
            const regex = /^(?:\s*@[\w.]+(?:\([^)]*\))?\s*)*(?:\s*(?:public|private|protected|static|final|abstract|strictfp|synchronized|native)\s+)+\s*(?:<[^>]+>\s*)?([A-Za-z_$][\w\[\]<>.?$]*)\s+([A-Za-z_$]\w*)\s*\([^;{)]*\)\s*;/gm;
            let m: RegExpExecArray | null;
            while ((m = regex.exec(content)) !== null) {
                methods.push({
                    methodName: m[2],
                    className: this.extractClassName(document),
                    packageName: this.extractPackageName(document)
                });
            }
        }

        return methods;
    }

    private async findMatchingCppImplementation(method: { methodName: string; className: string; packageName: string }): Promise<{ file: string } | null> {
        // Use the in-memory index if available for O(1) lookup
        const match = this.lookupInJniIndex(method);
        return match ? { file: match } : null;
    }

    private lookupInJniIndex(method: { methodName: string; className: string; packageName: string }): string | null {
        if (!this.jniIndex) return null;
        let expected = 'Java_';
        if (method.packageName) expected += method.packageName.replace(/\./g, '_') + '_';
        expected += `${method.className}_${method.methodName}`;

        // 1) Exact match
        if (this.jniIndex.has(expected)) {
            const files = this.jniIndex.get(expected)!;
            return files.values().next().value ?? null;
        }
        // 2) Overloaded matches: any symbol starting with expected + '__'
        const overloaded = Array.from(this.jniIndex.keys()).filter(k => k.startsWith(expected + '__'));
        if (overloaded.length > 0) {
            const files = this.jniIndex.get(overloaded[0]);
            if (files && files.size > 0) return files.values().next().value as string;
        }
        return null;
    }

    private async buildJniSymbolIndex(): Promise<Map<string, Set<string>>> {
        const index = new Map<string, Set<string>>();
        const query = /Java_([A-Za-z0-9_]+(?:__[-_A-Za-z0-9$]+)?)\s*\(/g;
        const cfg = vscode.workspace.getConfiguration('dependencyVisualizer');
        const includeGlobs = cfg.get<string[]>('jni.searchIncludes') ?? ['**/*.{cpp,cc,cxx,c,h,hpp}'];
        const excludeGlobs = cfg.get<string[]>('jni.searchExcludes') ?? [];

        // Build include and exclude patterns for findFiles
        const includePattern = includeGlobs.length === 1 ? includeGlobs[0] : `{${includeGlobs.join(',')}}`;
        const excludePattern = excludeGlobs.length ? `{${excludeGlobs.join(',')}}` : undefined;

        const files = await vscode.workspace.findFiles(includePattern, excludePattern);

        const fsPromises = require('fs').promises as typeof import('fs').promises;
        const concurrency = 16;
        let i = 0;
        const runNext = async (): Promise<void> => {
            if (i >= files.length) return;
            const file = files[i++];
            try {
                const content = await fsPromises.readFile(file.fsPath, 'utf8');
                let m: RegExpExecArray | null;
                while ((m = query.exec(content)) !== null) {
                    const symbol = 'Java_' + m[1];
                    if (!index.has(symbol)) index.set(symbol, new Set<string>());
                    index.get(symbol)!.add(file.fsPath);
                }
            } catch {
                // ignore read errors
            }
            return runNext();
        };
        await Promise.all(Array.from({ length: Math.min(concurrency, files.length) }, () => runNext()));
        return index;
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

    // Public: find JNI implementation by exact expected symbol (optionally with overload handling via index lookup)
    findJniImplementationByExpected(expectedName: string): string | null {
        if (!this.jniIndex) return null;
        if (this.jniIndex.has(expectedName)) {
            const files = this.jniIndex.get(expectedName)!;
            const first = files.values().next().value as string | undefined;
            if (first) return first;
        }
        // Try overloads
        const overloaded = Array.from(this.jniIndex.keys()).find(k => k.startsWith(expectedName + '__'));
        if (overloaded) {
            const files = this.jniIndex.get(overloaded)!;
            const first = files.values().next().value as string | undefined;
            if (first) return first;
        }
        return null;
    }

}
