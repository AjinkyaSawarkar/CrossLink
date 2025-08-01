import * as fs from 'fs';
import * as path from 'path';
import { BaseParser } from './baseParser';
import { Dependency } from '../core/dependencyAnalyzer';

export class CppParser extends BaseParser {
    async parseDependencies(buildFile: string): Promise<Dependency[]> {
        if (buildFile.includes('CMakeLists.txt')) {
            return this.parseCMakeDependencies(buildFile);
        } else if (buildFile.includes('conanfile')) {
            return this.parseConanDependencies(buildFile);
        } else if (buildFile.includes('vcpkg.json')) {
            return this.parseVcpkgDependencies(buildFile);
        }
        return [];
    }

    private async parseCMakeDependencies(cmakeFile: string): Promise<Dependency[]> {
        const dependencies: Dependency[] = [];
        
        try {
            const cmakeContent = fs.readFileSync(cmakeFile, 'utf8');
            
            // Parse find_package commands
            const findPackageRegex = /find_package\s*\(\s*([^\s)]+)(?:\s+([^\s)]+))?\s*(?:REQUIRED)?\s*\)/g;
            let match;
            
            while ((match = findPackageRegex.exec(cmakeContent)) !== null) {
                const packageName = match[1];
                const version = match[2] || 'latest';
                
                dependencies.push({
                    name: packageName,
                    version: version,
                    type: this.getPlatformLibraryType(),
                    path: this.resolveCMakeLibraryPath(packageName)
                });
            }
            
            // Parse target_link_libraries commands
            const linkLibsRegex = /target_link_libraries\s*\([^)]*\s+([^)]+)\)/g;
            while ((match = linkLibsRegex.exec(cmakeContent)) !== null) {
                const libs = match[1].split(/\s+/);
                for (const lib of libs) {
                    if (lib && !lib.startsWith('${') && lib !== 'PUBLIC' && lib !== 'PRIVATE') {
                        dependencies.push({
                            name: lib,
                            version: 'unknown',
                            type: this.getPlatformLibraryType(),
                            path: this.resolveSystemLibraryPath(lib)
                        });
                    }
                }
            }
        } catch (error) {
            console.error('Error parsing CMake dependencies:', error);
        }
        
        return dependencies;
    }

    private async parseConanDependencies(conanFile: string): Promise<Dependency[]> {
        const dependencies: Dependency[] = [];
        
        try {
            if (conanFile.endsWith('.txt')) {
                const content = fs.readFileSync(conanFile, 'utf8');
                const lines = content.split('\n');
                
                let inRequires = false;
                for (const line of lines) {
                    const trimmed = line.trim();
                    if (trimmed === '[requires]') {
                        inRequires = true;
                        continue;
                    }
                    if (trimmed.startsWith('[') && trimmed !== '[requires]') {
                        inRequires = false;
                        continue;
                    }
                    
                    if (inRequires && trimmed && !trimmed.startsWith('#')) {
                        const parts = trimmed.split('/');
                        if (parts.length >= 2) {
                            dependencies.push({
                                name: parts[0],
                                version: parts[1].split('@')[0],
                                type: this.getPlatformLibraryType()
                            });
                        }
                    }
                }
            }
        } catch (error) {
            console.error('Error parsing Conan dependencies:', error);
        }
        
        return dependencies;
    }

    private async parseVcpkgDependencies(vcpkgFile: string): Promise<Dependency[]> {
        const dependencies: Dependency[] = [];
        
        try {
            const content = fs.readFileSync(vcpkgFile, 'utf8');
            const manifest = JSON.parse(content);
            
            if (manifest.dependencies) {
                for (const dep of manifest.dependencies) {
                    if (typeof dep === 'string') {
                        dependencies.push({
                            name: dep,
                            version: 'latest',
                            type: this.getPlatformLibraryType()
                        });
                    } else if (typeof dep === 'object' && dep.name) {
                        dependencies.push({
                            name: dep.name,
                            version: dep.version || 'latest',
                            type: this.getPlatformLibraryType()
                        });
                    }
                }
            }
        } catch (error) {
            console.error('Error parsing vcpkg dependencies:', error);
        }
        
        return dependencies;
    }

    private getPlatformLibraryType(): 'so' | 'dll' | 'dylib' {
        const platform = require('os').platform();
        switch (platform) {
            case 'win32':
                return 'dll';
            case 'darwin':
                return 'dylib';
            default:
                return 'so';
        }
    }

    private resolveCMakeLibraryPath(packageName: string): string {
        // This is a simplified path resolution
        // In practice, you'd need to check CMAKE_PREFIX_PATH, etc.
        return `/usr/lib/lib${packageName.toLowerCase()}.so`;
    }

    private resolveSystemLibraryPath(libName: string): string {
        const platform = require('os').platform();
        const extension = this.getPlatformLibraryType();
        
        if (platform === 'win32') {
            return `C:\\Windows\\System32\\${libName}.${extension}`;
        } else {
            return `/usr/lib/lib${libName}.${extension}`;
        }
    }
}
