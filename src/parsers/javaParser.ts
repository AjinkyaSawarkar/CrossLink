import * as fs from 'fs';
import * as path from 'path';
import * as xml2js from 'xml2js';
import { BaseParser } from './baseParser';
import { Dependency } from '../core/dependencyAnalyzer';

export class JavaParser extends BaseParser {
    async parseDependencies(buildFile: string): Promise<Dependency[]> {
        if (buildFile.includes('pom.xml')) {
            return this.parseMavenDependencies(buildFile);
        } else if (buildFile.includes('build.gradle')) {
            return this.parseGradleDependencies(buildFile);
        }
        return [];
    }

    private async parseMavenDependencies(pomFile: string): Promise<Dependency[]> {
        const dependencies: Dependency[] = [];
        
        try {
            const pomContent = fs.readFileSync(pomFile, 'utf8');
            const parser = new xml2js.Parser();
            const result = await parser.parseStringPromise(pomContent);
            
            const deps = result.project?.dependencies?.[0]?.dependency || [];
            
            for (const dep of deps) {
                const groupId = dep.groupId?.[0] || '';
                const artifactId = dep.artifactId?.[0] || '';
                const version = dep.version?.[0] || '';
                
                dependencies.push({
                    name: `${groupId}:${artifactId}`,
                    version: version,
                    type: 'jar',
                    path: this.resolveJarPath(groupId, artifactId, version)
                });
            }
        } catch (error) {
            console.error('Error parsing Maven dependencies:', error);
        }
        
        return dependencies;
    }

    private async parseGradleDependencies(buildFile: string): Promise<Dependency[]> {
        const dependencies: Dependency[] = [];
        
        try {
            const buildContent = fs.readFileSync(buildFile, 'utf8');
            
            // Simple regex parsing for Gradle dependencies
            const depRegex = /(?:implementation|compile|api|testImplementation)\s+['"]([^'"]+)['"]/g;
            let match;
            
            while ((match = depRegex.exec(buildContent)) !== null) {
                const depString = match[1];
                const parts = depString.split(':');
                
                if (parts.length >= 3) {
                    const groupId = parts[0];
                    const artifactId = parts[1];
                    const version = parts[2];
                    
                    dependencies.push({
                        name: `${groupId}:${artifactId}`,
                        version: version,
                        type: 'jar',
                        path: this.resolveJarPath(groupId, artifactId, version)
                    });
                }
            }
        } catch (error) {
            console.error('Error parsing Gradle dependencies:', error);
        }
        
        return dependencies;
    }

    private resolveJarPath(groupId: string, artifactId: string, version: string): string {
        // Typical Maven local repository path
        const userHome = require('os').homedir();
        const groupPath = groupId.replace(/\./g, '/');
        return path.join(
            userHome,
            '.m2/repository',
            groupPath,
            artifactId,
            version,
            `${artifactId}-${version}.jar`
        );
    }
}
