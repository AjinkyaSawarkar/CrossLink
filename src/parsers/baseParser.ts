import { Dependency } from '../core/dependencyAnalyzer';

export abstract class BaseParser {
    abstract parseDependencies(buildFile: string): Promise<Dependency[]>;
    
    protected normalizeVersion(version: string): string {
        // Remove common prefixes and suffixes
        return version.replace(/^v/, '').replace(/-SNAPSHOT$/, '');
    }
    
    protected isValidVersion(version: string): boolean {
        // Basic version validation
        return /^\d+(\.\d+)*/.test(version);
    }
}
